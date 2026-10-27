(() => {
  'use strict';

  const REFRESH_MS = 30_000;
  const TIMEOUT_MS = 12_000;
  const STALE_MS = 15 * 60_000;
  const STORAGE_KEY = 'llm-usage.reader-token';
  const BUILTINS = ['claude', 'chatgpt', 'zai', 'openrouter', 'litellm', 'poe', 'claude_platform'];
  const SUBSCRIPTIONS = ['claude', 'chatgpt', 'zai'];
  const COSTS = ['openrouter', 'litellm', 'poe', 'claude_platform'];
  const LETTERS = { claude: 'C', chatgpt: 'G', zai: 'Z', openrouter: 'O', litellm: 'L', poe: 'P', claude_platform: 'P' };
  const STATUS = {
    ok: '정상', stale: '갱신 지연', auth_required: 'PC에서 로그인 필요',
    challenge: 'PC에서 Cloudflare 확인', rate_limited: '요청 제한',
    schema_changed: 'API 변경 감지', permission_missing: 'PC에서 권한 필요',
    not_configured: 'PC에서 설정 필요', unsupported: '미지원', error: '수집 오류',
  };
  const GRANT_STATUS = { available: '사용 가능', paused: '일시 중지', not_yet: '시작 전', used: '사용됨', expired: '만료됨', unknown: '상태 알 수 없음' };
  const GRANT_SCOPE = { session_5h: '5시간', weekly_7d: '7일', all: '전체', unknown: '범위 미제공' };
  const baseId = (id) => String(id).split('#')[0];
  const $ = (id) => document.getElementById(id);
  const number = new Intl.NumberFormat('ko-KR', { maximumFractionDigits: 8 });
  let token = '';
  let snapshot = null;
  let checkedAt = null;
  let activeRequest = null;
  let refreshTimer = null;
  let generation = 0;
  let connectionError = '';
  let storageWarning = '';

  function element(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = String(text);
    return node;
  }

  function record(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
  }

  function validDate(value, empty = false) {
    return typeof value === 'string' && ((empty && value === '') || Number.isFinite(Date.parse(value)));
  }

  function optionalNumbers(value, fields) {
    return fields.every((key) => value[key] === undefined || (typeof value[key] === 'number' && Number.isFinite(value[key])));
  }

  function optionalDates(value, fields) {
    return fields.every((key) => value[key] == null || validDate(value[key]));
  }

  function validWindow(value) {
    return record(value) && ['kind', 'label', 'unit'].every((key) => typeof value[key] === 'string')
      && optionalNumbers(value, ['usedPercent', 'usedAmount', 'limitAmount', 'windowSeconds'])
      && optionalDates(value, ['resetsAt'])
      && (value.periodTz === undefined || typeof value.periodTz === 'string')
      && (value.partial === undefined || typeof value.partial === 'boolean');
  }

  function validGrant(value) {
    return record(value) && typeof value.scope === 'string' && typeof value.status === 'string'
      && typeof value.remaining === 'number' && Number.isFinite(value.remaining)
      && optionalDates(value, ['startsAt', 'expiresAt'])
      && (value.countOnly === undefined || typeof value.countOnly === 'boolean');
  }

  function validProvider(value) {
    if (!record(value) || !['id', 'name', 'status'].every((key) => typeof value[key] === 'string')
      || !validDate(value.fetchedAt, true) || !validDate(value.attemptedAt, true)
      || !Array.isArray(value.windows) || !value.windows.every(validWindow)
      || !Array.isArray(value.grants) || !value.grants.every(validGrant)
      || (value.grantSupport !== undefined && typeof value.grantSupport !== 'string')) return false;
    const extra = value.extraCredits;
    if (extra !== undefined && (!record(extra) || !['usd', 'credits'].includes(extra.unit)
      || !optionalNumbers(extra, ['balanceAmount'])
      || !['unlimited', 'isEnabled'].every((key) => extra[key] === undefined || typeof extra[key] === 'boolean'))) return false;
    const balance = value.balance;
    return balance === undefined || (record(balance) && typeof balance.amount === 'number' && Number.isFinite(balance.amount)
      && ['usd', 'points'].includes(balance.unit) && optionalNumbers(balance, ['limit'])
      && optionalDates(balance, ['resetsAt']) && (balance.label === undefined || typeof balance.label === 'string'));
  }

  function validateEnvelope(value) {
    if (!record(value)) throw new Error('invalid_snapshot');
    if (value.data === null && value.receivedAt === null) return value;
    if (!validDate(value.receivedAt) || !record(value.data) || value.data.version !== 1
      || !validDate(value.data.sentAt) || !Array.isArray(value.data.providers)
      || !value.data.providers.every(validProvider)) throw new Error('invalid_snapshot');
    return value;
  }

  function absolute(iso) {
    if (!validDate(iso)) return '기록 없음';
    const date = new Date(iso);
    const pad = (value) => String(value).padStart(2, '0');
    return `${date.getFullYear()}.${pad(date.getMonth() + 1)}.${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
  }

  function age(iso) {
    if (!validDate(iso)) return '수집 기록 없음';
    const elapsed = Date.now() - Date.parse(iso);
    if (elapsed < -60_000) return '미래 시각 · PC 시계 확인';
    if (elapsed < 60_000) return '방금';
    if (elapsed < 3_600_000) return `${Math.floor(elapsed / 60_000)}분 전`;
    if (elapsed < 86_400_000) return `${Math.floor(elapsed / 3_600_000)}시간 전`;
    return `${Math.floor(elapsed / 86_400_000)}일 전`;
  }

  function old(iso) {
    return !validDate(iso) || Date.now() - Date.parse(iso) >= STALE_MS;
  }

  function until(iso) {
    const remaining = Date.parse(iso) - Date.now();
    if (remaining <= 0) return '예정 시각 지남 · 새 수집 대기';
    const minutes = Math.ceil(remaining / 60_000);
    if (minutes < 60) return `${minutes}분 뒤`;
    if (minutes < 1440) return `${Math.floor(minutes / 60)}시간 ${minutes % 60}분 뒤`;
    return `${Math.floor(minutes / 1440)}일 ${Math.floor((minutes % 1440) / 60)}시간 뒤`;
  }

  function amount(value, unit) {
    if (value === undefined) return '알 수 없음';
    if (unit === 'usd') {
      const places = Math.abs(value) > 0 && Math.abs(value) < 0.01 ? 4 : 2;
      return `${value < 0 ? '-' : ''}$${Math.abs(value).toLocaleString('en-US', { minimumFractionDigits: places, maximumFractionDigits: places })}`;
    }
    const suffix = { credits: ' cr', points: ' pt', percent: '%', calls: ' calls', tokens: ' tokens' }[unit];
    return `${number.format(value)}${typeof suffix === 'string' ? suffix : ` ${unit}`}`;
  }

  function tone(percent) {
    return percent >= 90 ? 'crit' : percent >= 70 ? 'warn' : 'ok';
  }

  function meter(percent, label, usagePercent = percent) {
    const progress = element('progress', `tone-${tone(usagePercent)}`);
    progress.max = 100;
    progress.value = Math.max(0, Math.min(100, percent));
    progress.setAttribute('aria-label', label);
    progress.textContent = `${number.format(percent)}%`;
    return progress;
  }

  const WINDOW_LABEL = { day: '오늘', week: '이번주', month: '이번달' };

  function compactAmount(value, unit) {
    if (value === undefined) return '-';
    if (unit === 'usd') return amount(value, 'usd');
    const abs = Math.abs(value);
    if (abs >= 1e6) return String((value / 1e6).toFixed(1)).replace(/\.0$/, '') + 'M';
    if (abs >= 1e4) return Math.round(value / 1e3) + 'k';
    return number.format(value);
  }

  function shortStamp(iso) {
    const date = new Date(iso);
    const now = new Date();
    const pad = (value) => String(value).padStart(2, '0');
    const time = pad(date.getHours()) + ':' + pad(date.getMinutes());
    return date.toDateString() === now.toDateString() ? time : (date.getMonth() + 1) + '/' + date.getDate() + ' ' + time;
  }

  function untilShort(iso) {
    const remaining = Date.parse(iso) - Date.now();
    if (remaining <= 0) return '갱신 대기';
    const minutes = Math.ceil(remaining / 60_000);
    if (minutes < 60) return minutes + '분 뒤';
    if (minutes < 1440) return Math.floor(minutes / 60) + '시간 ' + (minutes % 60) + '분 뒤';
    return Math.floor(minutes / 1440) + '일 ' + Math.floor((minutes % 1440) / 60) + '시간 뒤';
  }

  function resetShort(iso) {
    return validDate(iso) ? untilShort(iso) + ' · ' + shortStamp(iso) : '';
  }

  function grantCount(provider) {
    return provider.grants.filter((grant) => grant.status === 'available').reduce((sum, grant) => sum + grant.remaining, 0);
  }

  function nextGrantExpiry(provider) {
    const times = provider.grants
      .filter((grant) => grant.status === 'available' && validDate(grant.expiresAt))
      .map((grant) => Date.parse(grant.expiresAt)).sort((x, y) => x - y);
    if (!times.length) return '';
    const date = new Date(times[0]);
    return ' ~' + (date.getMonth() + 1) + '/' + date.getDate();
  }

  function windowRow(window) {
    const row = element('div', 'row');
    const hasPercent = window.usedPercent !== undefined;
    const label = window.label + (window.partial ? '*' : '');
    row.append(element('span', 'row-label', label));
    if (hasPercent) {
      row.append(meter(window.usedPercent, window.label + ' 사용 ' + amount(window.usedPercent, 'percent')),
        element('span', 'row-pct text-' + tone(window.usedPercent), number.format(Math.round(window.usedPercent * 10) / 10) + '%'));
      let right = resetShort(window.resetsAt);
      if (!right && window.usedAmount !== undefined && window.limitAmount !== undefined) {
        right = window.label.includes('MCP') || window.kind === 'month' ? '월간 ' + number.format(window.usedAmount) + '/' + number.format(window.limitAmount) : '';
      }
      if (!right && window.usedPercent === 0) right = '시작 전';
      row.append(element('span', 'row-reset', right));
    } else {
      let text = window.usedAmount === undefined ? '알 수 없음' : amount(window.usedAmount, window.unit);
      if (window.limitAmount !== undefined) text += ' / ' + amount(window.limitAmount, window.unit);
      if (window.resetsAt) text += ' · ' + resetShort(window.resetsAt);
      row.append(element('span', 'row-value', text));
    }
    return row;
  }

  function extraRow(provider) {
    const extra = provider.extraCredits;
    const unit = extra?.unit ?? (provider.id === 'claude' ? 'usd' : 'credits');
    const monthly = provider.windows.find((window) => window.kind === 'month' && window.unit === unit);
    let month = '수집 월 미확인';
    if (validDate(provider.fetchedAt)) {
      const date = new Date(provider.fetchedAt);
      const utc = provider.id === 'chatgpt';
      month = (utc ? date.getUTCFullYear() : date.getFullYear()) + '. ' + ((utc ? date.getUTCMonth() : date.getMonth()) + 1) + '.';
    }
    const left = element('span', '', month + ' Extra' + (extra?.isEnabled === false ? ' · 비활성' : ''));
    const used = monthly?.usedAmount === undefined ? '조회 불가' : amount(monthly.usedAmount, unit);
    let right;
    if (unit === 'usd') right = '사용 ' + used + ' / 월 한도 ' + (monthly?.limitAmount === undefined ? '미제공' : amount(monthly.limitAmount, unit));
    else right = '사용 ' + used + ' · 잔액 ' + (extra?.unlimited ? '무제한' : extra?.balanceAmount === undefined ? '미제공' : amount(extra.balanceAmount, unit));
    const row = element('div', 'extra-row');
    row.append(left, element('span', '', right));
    return row;
  }

  function providerCard(provider) {
    const stale = old(provider.fetchedAt) || provider.status !== 'ok';
    const card = element('article', 'card provider-card compact' + (stale ? ' is-stale' : ''));
    card.dataset.providerId = provider.id;
    const head = element('div', 'card-head');
    const known = BUILTINS.includes(baseId(provider.id));
    const avatar = element('span', 'avatar' + (known ? ' avatar-' + baseId(provider.id) : ''), known ? LETTERS[baseId(provider.id)] : Array.from(provider.name)[0] || '?');
    avatar.setAttribute('aria-hidden', 'true');
    head.append(avatar, element('h3', 'provider-name', provider.name));
    if (provider.status !== 'ok') head.append(element('span', 'chip ' + (provider.status === 'error' ? 'chip-error' : 'chip-warn'), STATUS[provider.status] ?? provider.status));
    else if (!provider.fetchedAt) head.append(element('span', 'chip', '수집 기록 없음'));
    else if (old(provider.fetchedAt)) head.append(element('span', 'chip chip-warn', '오래된 수집 · ' + age(provider.fetchedAt)));
    const grants = grantCount(provider);
    if (grants > 0) head.append(element('span', 'chip chip-grant chip-end', '리셋권 ' + number.format(grants)));
    card.append(head);
    const hasExtra = provider.id === 'claude' || provider.id === 'chatgpt' || provider.extraCredits !== undefined;
    const extraUnit = provider.extraCredits?.unit ?? (provider.id === 'claude' ? 'usd' : 'credits');
    const extraMonth = hasExtra ? provider.windows.find((window) => window.kind === 'month' && window.unit === extraUnit) : undefined;
    const windows = provider.windows.filter((window) => window !== extraMonth);
    if (windows.length) {
      const rows = element('div', 'rows');
      windows.forEach((window) => rows.append(windowRow(window)));
      card.append(rows);
    } else if (!provider.balance && !hasExtra) card.append(element('p', 'caption', '사용량 정보가 제공되지 않았습니다.'));
    if (provider.balance) {
      const row = element('div', 'extra-row');
      row.append(element('span', '', provider.balance.label || (provider.balance.unit === 'points' ? '남은 포인트' : '남은 금액')),
        element('span', 'balance-value', amount(provider.balance.amount, provider.balance.unit)));
      card.append(row);
    }
    if (hasExtra) card.append(extraRow(provider));
    return card;
  }

  function costTable(providers) {
    const card = element('section', 'card provider-card compact cost-table');
    card.setAttribute('aria-label', 'API 비용 · 포인트');
    const head = element('div', 'cost-row cost-head');
    ['API 비용', '오늘', '이번주', '이번달', '남은 금액'].forEach((text) => head.append(element('span', '', text)));
    card.append(head);
    for (const provider of providers) {
      const row = element('div', 'cost-row');
      row.dataset.providerId = provider.id;
      if (provider.status !== 'ok' || old(provider.fetchedAt)) row.classList.add('is-stale');
      const name = element('span', 'cost-name');
      const avatar = element('span', 'avatar avatar-' + baseId(provider.id), LETTERS[baseId(provider.id)]);
      avatar.setAttribute('aria-hidden', 'true');
      const label = element('span', 'cost-title');
      label.append(element('span', '', provider.name));
      const tz = provider.windows.find((window) => window.periodTz)?.periodTz;
      if (tz) label.append(element('small', '', tz === 'local' ? 'local' : tz));
      if (provider.status !== 'ok') label.append(element('small', 'text-warn', STATUS[provider.status] ?? provider.status));
      else if (old(provider.fetchedAt)) label.append(element('small', 'text-warn', '오래됨 ' + age(provider.fetchedAt)));
      name.append(avatar, label);
      row.append(name);
      for (const kind of ['day', 'week', 'month']) {
        const window = provider.windows.find((item) => item.kind === kind);
        row.append(element('span', 'cost-value', window ? compactAmount(window.usedAmount, window.unit) + (window.partial ? '*' : '') : '-'));
      }
      const balance = element('span', 'cost-balance');
      if (provider.balance) {
        balance.append(element('span', '', compactAmount(provider.balance.amount, provider.balance.unit) + (provider.balance.unit === 'points' ? ' pt' : '')));
        if (provider.balance.limit !== undefined && provider.balance.limit > 0) {
          const remaining = provider.balance.amount / provider.balance.limit * 100;
          balance.append(meter(remaining, '잔액 ' + number.format(Math.round(remaining)) + '% 남음', 100 - remaining));
        }
      } else balance.append(element('span', 'text-muted', '미제공'));
      row.append(balance);
      card.append(row);
    }
    return card;
  }

  function grantDetails(provider) {
    if (!provider.grants.length) return null;
    const details = element('details', 'grants');
    details.dataset.providerId = provider.id;
    details.append(element('summary', '', provider.name + ' · 수집 당시 리셋권 ' + number.format(grantCount(provider)) + '개 사용 가능'));
    for (const grant of provider.grants) {
      const item = element('div', 'grant-item');
      const head = element('div', 'metric-head');
      head.append(element('span', 'metric-label', GRANT_SCOPE[grant.scope] ?? grant.scope),
        element('span', 'chip chip-grant', (GRANT_STATUS[grant.status] ?? grant.status) + ' · ' + number.format(grant.remaining) + '개'));
      item.append(head);
      if (grant.countOnly) item.append(element('p', 'metric-meta', '개수만 확인 · 개별 리셋권 정보 없음'));
      if (grant.startsAt) item.append(element('p', 'metric-meta', '시작 ' + absolute(grant.startsAt)));
      item.append(element('p', 'metric-meta', grant.expiresAt ? '만료 ' + absolute(grant.expiresAt) + (Date.parse(grant.expiresAt) <= Date.now() ? ' · 만료 시각 지남' : '') : '만료 시각 미제공'));
      details.append(item);
    }
    return details;
  }

  function renderSnapshot() {
    $('dashboard').hidden = snapshot === null;
    if (snapshot === null) {
      $('updated').textContent = '';
      return;
    }
    const providers = snapshot.data?.providers ?? [];
    $('sent-at').textContent = snapshot.data ? absolute(snapshot.data.sentAt) + ' · ' + age(snapshot.data.sentAt) : '아직 없음';
    $('received-at').textContent = snapshot.receivedAt ? absolute(snapshot.receivedAt) + ' · ' + age(snapshot.receivedAt) : '아직 없음';
    $('checked-at').textContent = checkedAt ? absolute(checkedAt) : '아직 없음';
    $('provider-count').textContent = providers.length + '개 제공업체';
    const fetched = providers.map((provider) => Date.parse(provider.fetchedAt)).filter(Number.isFinite);
    $('updated').textContent = fetched.length ? age(new Date(Math.min(...fetched)).toISOString()) + ' 갱신' : '';
    $('empty').hidden = providers.length > 0;
    $('empty-title').textContent = snapshot.data ? '표시할 제공업체가 없습니다.' : '첫 PC 전송을 기다리고 있어요.';
    $('empty-message').textContent = snapshot.data ? 'PC 확장 프로그램에서 사용할 제공업체를 활성화하세요. 이 화면에서는 계정을 설정하지 않습니다.' : '연결은 완료됐습니다. PC 확장 프로그램의 휴대폰 동기화를 켜면 수집된 사용량이 여기에 표시됩니다.';
    const cards = [
      ...providers.filter((provider) => SUBSCRIPTIONS.includes(baseId(provider.id))),
      ...providers.filter((provider) => !BUILTINS.includes(baseId(provider.id))),
    ];
    const costs = COSTS.map((id) => providers.find((provider) => baseId(provider.id) === id)).filter(Boolean);
    const fragment = document.createDocumentFragment();
    cards.forEach((provider) => fragment.append(providerCard(provider)));
    if (costs.length) fragment.append(costTable(costs));
    $('providers').replaceChildren(fragment);

    const openGrants = new Set(Array.from($('grant-detail').querySelectorAll('details[open]')).map((node) => node.dataset.providerId));
    const detailFragment = document.createDocumentFragment();
    for (const provider of providers) {
      const details = grantDetails(provider);
      if (!details) continue;
      if (openGrants.has(provider.id)) details.open = true;
      detailFragment.append(details);
    }
    $('grant-detail').replaceChildren(detailFragment);

    const available = providers.filter((provider) => grantCount(provider) > 0);
    $('grant-banner').hidden = available.length === 0;
    $('grant-banner').replaceChildren();
    if (available.length) {
      const total = available.reduce((sum, provider) => sum + grantCount(provider), 0);
      $('grant-banner').append(element('span', 'grant-star', '★'), element('strong', '', '리셋권 ' + number.format(total) + '개'),
        ...available.map((provider) => element('span', 'chip chip-grant', provider.name + ' ×' + number.format(grantCount(provider)) + nextGrantExpiry(provider))));
    }
  }

  function renderConnection() {
    const connected = Boolean(token);
    $('pairing').hidden = connected;
    $('more').hidden = !connected;
    $('refresh').hidden = !connected;
    $('refresh').disabled = Boolean(activeRequest);
    $('refresh').setAttribute('aria-busy', String(Boolean(activeRequest)));
    $('storage-message').textContent = storageWarning;
    $('storage-message').hidden = !storageWarning;
    $('header-dot').hidden = !connected;
    if (!connected) {
      $('alert').hidden = true;
      return;
    }
    let label = '릴레이 연결됨';
    let message = 'PC의 저장된 정보를 읽었습니다. 제공업체별 수집 시각을 확인하세요.';
    let state = 'ok';
    if (activeRequest) {
      label = '저장된 정보 확인 중';
      message = '제공업체에 새 조회를 요청하지 않습니다.';
      state = '';
    } else if (connectionError) {
      label = navigator.onLine ? '릴레이 연결 확인 필요' : '오프라인';
      message = connectionError + (snapshot ? ' 마지막으로 확인한 화면을 유지합니다.' : '');
      state = 'error';
    } else if (document.hidden) {
      label = '자동 확인 일시 중지';
      message = '화면으로 돌아오면 다시 확인합니다.';
      state = '';
    } else if (snapshot?.receivedAt && old(snapshot.receivedAt)) {
      label = '릴레이 연결됨 · PC 전송 지연';
      message = '릴레이 응답은 받았지만 PC의 전송이 오래됐습니다. PC와 확장 프로그램을 확인하세요.';
      state = 'warn';
    } else if (!snapshot?.data) {
      message = '릴레이 연결은 정상입니다. PC의 첫 전송을 기다립니다.';
    }
    $('connection-label').textContent = label;
    $('connection-message').textContent = message;
    $('connection-dot').className = 'status-dot ' + state;
    $('header-dot').className = 'status-dot ' + state;
    $('alert').hidden = state !== 'error' && state !== 'warn';
    $('alert').className = 'alert' + (state === 'error' ? ' alert-error' : '');
    $('alert').textContent = state === 'error' || state === 'warn' ? label + ' · ' + message : '';
  }

  function storeToken(value) {
    try {
      if (value) sessionStorage.setItem(STORAGE_KEY, value);
      else sessionStorage.removeItem(STORAGE_KEY);
      storageWarning = '';
    } catch {
      storageWarning = value
        ? '이 브라우저에서는 세션 저장을 사용할 수 없습니다. 새로 열 때 키를 다시 입력하세요.'
        : '세션 저장 접근이 차단되어 저장된 키의 삭제는 확인할 수 없습니다. 이 탭을 닫아 주세요.';
    }
  }

  function clearTimer() {
    if (refreshTimer !== null) clearTimeout(refreshTimer);
    refreshTimer = null;
  }

  function cancelRequest() {
    generation += 1;
    activeRequest?.controller.abort();
    activeRequest = null;
  }

  function clearSession(message = '') {
    cancelRequest();
    token = '';
    snapshot = null;
    checkedAt = null;
    connectionError = '';
    clearTimer();
    storeToken('');
    $('reader-key').value = '';
    $('providers').replaceChildren();
    $('grant-banner').replaceChildren();
    $('grant-banner').hidden = true;
    $('grant-detail').replaceChildren();
    $('updated').textContent = '';
    $('sent-at').textContent = '아직 없음';
    $('received-at').textContent = '아직 없음';
    $('checked-at').textContent = '아직 없음';
    $('provider-count').textContent = '';
    $('connection-label').textContent = '';
    $('connection-message').textContent = '';
    $('pair-message').textContent = [message, storageWarning].filter(Boolean).join(' ');
    $('pair-message').hidden = !message && !storageWarning;
    renderSnapshot();
    renderConnection();
  }

  function scheduleRefresh() {
    clearTimer();
    if (token && !document.hidden) {
      refreshTimer = setTimeout(() => {
        renderSnapshot();
        void fetchSnapshot();
      }, REFRESH_MS);
    }
  }

  async function fetchSnapshot() {
    if (!token || activeRequest || document.hidden) return;
    clearTimer();
    if (!navigator.onLine) {
      connectionError = '네트워크 연결을 확인하세요.';
      renderConnection();
      scheduleRefresh();
      return;
    }
    const request = { controller: new AbortController(), generation };
    activeRequest = request;
    let timedOut = false;
    const timeout = setTimeout(() => { timedOut = true; request.controller.abort(); }, TIMEOUT_MS);
    renderConnection();
    try {
      const response = await fetch('/api/snapshot', {
        method: 'GET',
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
        cache: 'no-store',
        credentials: 'omit',
        redirect: 'error',
        signal: request.controller.signal,
      });
      if (request.generation !== generation) return;
      if (response.status === 401 || response.status === 403) {
        clearSession('읽기 키를 확인할 수 없습니다. 표시된 정보와 키를 지웠습니다. PC의 읽기 키로 다시 연결하세요.');
        $('reader-key').focus();
        return;
      }
      if (!response.ok) throw new Error('relay_unavailable');
      const next = validateEnvelope(await response.json());
      if (request.generation !== generation || request.controller.signal.aborted) return;
      snapshot = next;
      checkedAt = new Date().toISOString();
      connectionError = '';
      storeToken(token);
      renderSnapshot();
    } catch (error) {
      if (request.generation !== generation) return;
      if (request.controller.signal.aborted && !timedOut && document.hidden) return;
      connectionError = timedOut ? '12초 안에 응답이 없었습니다. PC와 Tailscale 연결을 확인하세요.'
        : error instanceof Error && (error.message === 'invalid_snapshot' || error.name === 'SyntaxError') ? '릴레이 응답 형식을 확인할 수 없습니다.'
          : 'PC 릴레이에 연결하지 못했습니다. PC와 Tailscale 연결을 확인하세요.';
    } finally {
      clearTimeout(timeout);
      if (activeRequest === request) {
        activeRequest = null;
        renderSnapshot();
        renderConnection();
        scheduleRefresh();
      }
    }
  }

  $('pair-form').addEventListener('submit', (event) => {
    event.preventDefault();
    const value = $('reader-key').value.trim();
    if (!value) return;
    clearSession();
    token = value;
    renderConnection();
    void fetchSnapshot();
  });
  $('disconnect').addEventListener('click', () => {
    clearSession('연결을 해제했습니다. 읽기 키와 표시된 정보를 지웠습니다.');
    $('reader-key').focus();
  });
  $('refresh').addEventListener('click', () => { void fetchSnapshot(); });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      clearTimer();
      cancelRequest();
      renderConnection();
    } else {
      renderSnapshot();
      void fetchSnapshot();
    }
  });
  window.addEventListener('offline', () => {
    clearTimer();
    cancelRequest();
    connectionError = '네트워크 연결이 끊겼습니다.';
    renderSnapshot();
    renderConnection();
    scheduleRefresh();
  });
  window.addEventListener('online', () => { void fetchSnapshot(); });
  window.addEventListener('pagehide', () => {
    clearTimer();
    cancelRequest();
  });
  window.addEventListener('pageshow', () => {
    if (token) void fetchSnapshot();
  });

  try {
    token = sessionStorage.getItem(STORAGE_KEY) || '';
  } catch {
    storageWarning = '이 브라우저에서는 세션 저장을 사용할 수 없습니다. 키는 현재 화면에서만 사용합니다.';
    $('pair-message').textContent = storageWarning;
    $('pair-message').hidden = false;
  }
  renderConnection();
  if (token) void fetchSnapshot();
})();
