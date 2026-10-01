import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import type { JSX } from 'preact';
import type {
  AppSettings,
  ProviderId,
  ProviderSettings,
  ProviderSnapshot,
} from '../providers/types';
import { PROVIDER_IDS } from '../providers/types';
import { defaultSettings } from '../core/settings';
import {
  getSettings,
  getSnapshots,
  notifySettingsChanged,
  onStoreChange,
  requestRefresh,
  saveSettings,
  type SnapshotMap,
} from '../core/store';
import { originsFor } from '../core/permissions';
import {
  clampInterval,
  COMMON_TIMEZONES,
  formatLastSuccess,
  isValidTimezone,
  maskErrorMessage,
  maskKey,
  needsApiKey,
  needsSessionLogin,
  PROVIDER_DISPLAY,
  PROVIDER_ORDER,
  statusLabel,
  validateProviderSettings,
} from './logic';

type FocusedKeys = Partial<Record<ProviderId, boolean>>;

const SITE_LINKS: Partial<Record<ProviderId, { url: string; label: string }>> = {
  claude: { url: 'https://claude.ai/', label: 'claude.ai 열기' },
  chatgpt: { url: 'https://chatgpt.com/', label: 'chatgpt.com 열기' },
};

export function App() {
  const [settings, setSettings] = useState<AppSettings>(defaultSettings);
  const [snapshots, setSnapshots] = useState<SnapshotMap>({});
  const [testingProvider, setTestingProvider] = useState<ProviderId | null>(null);
  const [testResult, setTestResult] = useState<Partial<Record<ProviderId, string>>>({});
  const [permError, setPermError] = useState<Partial<Record<ProviderId, string>>>({});
  const [focusedKeys, setFocusedKeys] = useState<FocusedKeys>({});
  const [tzError, setTzError] = useState('');
  const [notifDenied, setNotifDenied] = useState(false);
  const [dirty, setDirty] = useState(false);
  const testClickTime = useRef<number>(0);
  const dirtyRef = useRef(false);
  dirtyRef.current = dirty;

  useEffect(() => {
    let mounted = true;
    const load = async () => {
      const [s, sn] = await Promise.all([getSettings(), getSnapshots()]);
      if (mounted) {
        if (!dirtyRef.current) setSettings(s);
        setSnapshots(sn);
      }
    };
    load();
    const unsub = onStoreChange(() => {
      if (mounted) load();
    });
    return () => {
      mounted = false;
      unsub();
    };
  }, []);

  const updateProvider = useCallback(
    (id: ProviderId, patch: Partial<ProviderSettings>) => {
      setSettings((prev) => ({
        ...prev,
        providers: {
          ...prev.providers,
          [id]: { ...prev.providers[id], ...patch },
        },
      }));
      setDirty(true);
    },
    [],
  );

  const handleSave = useCallback(async () => {
    await saveSettings(settings);
    await notifySettingsChanged();
    setDirty(false);
  }, [settings]);

  const handleToggle = useCallback(
    async (id: ProviderId) => {
      const ps = settings.providers[id];
      if (!ps.enabled) {
        if (id === 'litellm') {
          const err = validateProviderSettings(id, { ...ps, enabled: true });
          if (err) {
            setPermError((p) => ({ ...p, [id]: err }));
            return;
          }
        }
        const origins = originsFor(id, ps);
        if (origins.length > 0) {
          try {
            const granted = await chrome.permissions.request({ origins });
            if (!granted) {
              setPermError((p) => ({ ...p, [id]: '권한이 거부되었습니다' }));
              return;
            }
          } catch {
            setPermError((p) => ({ ...p, [id]: '권한이 거부되었습니다' }));
            return;
          }
        }
        setPermError((p) => ({ ...p, [id]: undefined }));
        updateProvider(id, { enabled: true });
      } else {
        updateProvider(id, { enabled: false });
        setPermError((p) => ({ ...p, [id]: undefined }));
      }
      setDirty(true);
    },
    [settings, updateProvider],
  );

  const handleRegionChange = useCallback(
    async (id: ProviderId, region: 'global' | 'china') => {
      const ps = { ...settings.providers[id], region };
      if (ps.enabled) {
        const origins = originsFor(id, ps);
        if (origins.length > 0) {
          try {
            const granted = await chrome.permissions.request({ origins });
            if (!granted) {
              setPermError((p) => ({ ...p, [id]: '권한이 거부되었습니다' }));
              return;
            }
          } catch {
            setPermError((p) => ({ ...p, [id]: '권한이 거부되었습니다' }));
            return;
          }
        }
      }
      updateProvider(id, { region });
    },
    [settings, updateProvider],
  );

  const handleBaseUrlChange = useCallback(
    async (id: ProviderId, baseUrl: string) => {
      const ps = { ...settings.providers[id], baseUrl };
      updateProvider(id, { baseUrl });
      if (ps.enabled && baseUrl) {
        const origins = originsFor(id, ps);
        if (origins.length > 0) {
          try {
            const granted = await chrome.permissions.request({ origins });
            if (!granted) {
              setPermError((p) => ({ ...p, [id]: '권한이 거부되었습니다' }));
            }
          } catch {
            setPermError((p) => ({ ...p, [id]: '권한이 거부되었습니다' }));
          }
        }
      }
    },
    [settings, updateProvider],
  );

  const handleTest = useCallback(
    async (id: ProviderId) => {
      const err = validateProviderSettings(id, settings.providers[id]);
      if (err) {
        setTestResult((p) => ({ ...p, [id]: err }));
        return;
      }
      setTestingProvider(id);
      setTestResult((p) => ({ ...p, [id]: '테스트 중...' }));
      const clickTime = Date.now();
      testClickTime.current = clickTime;

      await saveSettings(settings);
      setDirty(false);

      const timeout = 20_000;
      const waitForAttempt = (): Promise<string> =>
        new Promise((resolve) => {
          let finished = false;
          let unsub: () => void = () => {};
          let timer: ReturnType<typeof setTimeout> | undefined;
          const finish = (text: string) => {
            if (finished) return;
            finished = true;
            unsub();
            if (timer !== undefined) clearTimeout(timer);
            resolve(text);
          };
          const evaluate = async () => {
            const sn = await getSnapshots();
            const snap = sn[id];
            if (!snap || new Date(snap.attemptedAt).getTime() <= clickTime) return;
            if (snap.status === 'ok') {
              finish(`${statusLabel(snap.status)} — 창 ${snap.windows.length}개`);
              return;
            }
            const errMsg = snap.error ? maskErrorMessage(snap.error.message) : '';
            finish(`${statusLabel(snap.status)}${errMsg ? ': ' + errMsg : ''}`);
          };
          unsub = onStoreChange(() => {
            void evaluate();
          });
          timer = setTimeout(() => finish('시간 초과 (20초)'), timeout);
          notifySettingsChanged()
            .then(() => requestRefresh(id))
            .then(() => evaluate())
            .catch(() => finish('백그라운드 응답 없음'));
        });

      const result = await waitForAttempt();
      setTestResult((p) => ({ ...p, [id]: result }));
      setTestingProvider(null);
    },
    [settings],
  );

  const handleNotifToggle = useCallback(async () => {
    if (!settings.notifications) {
      try {
        const granted = await chrome.permissions.request({
          permissions: ['notifications'],
        });
        if (!granted) {
          setNotifDenied(true);
          return;
        }
      } catch {
        setNotifDenied(true);
        return;
      }
      setNotifDenied(false);
    }
    setSettings((s) => ({ ...s, notifications: !s.notifications }));
    setDirty(true);
  }, [settings.notifications]);

  const handleClearData = useCallback(async () => {
    if (!confirm('모든 데이터를 삭제하시겠습니까? 이 작업은 되돌릴 수 없습니다.')) return;
    await chrome.storage.local.clear();
    await chrome.storage.session.clear();
    setSettings(defaultSettings());
    setSnapshots({});
    setDirty(false);
  }, []);

  const renderProviderFields = (id: ProviderId) => {
    const ps = settings.providers[id];
    const isFocused = focusedKeys[id] ?? false;

    const apiKeyInput = (label = 'API 키') => (
      <label class="field">
        <span class="field-label">{label}</span>
        <input
          type={isFocused ? 'text' : 'password'}
          class="input"
          value={isFocused ? (ps.apiKey ?? '') : maskKey(ps.apiKey)}
          onFocus={() => setFocusedKeys((f) => ({ ...f, [id]: true }))}
          onBlur={() => setFocusedKeys((f) => ({ ...f, [id]: false }))}
          onInput={(e) =>
            updateProvider(id, {
              apiKey: (e.target as HTMLInputElement).value,
            })
          }
          placeholder="키를 입력하세요"
        />
      </label>
    );

    switch (id) {
      case 'claude':
        return (
          <div class="provider-fields">
            <label class="field">
              <span class="field-label">조직 ID (선택)</span>
              <input
                type="text"
                class="input"
                value={ps.orgId ?? ''}
                onInput={(e) =>
                  updateProvider(id, {
                    orgId: (e.target as HTMLInputElement).value || undefined,
                  })
                }
                placeholder="자동 탐색"
              />
            </label>
            <p class="note">
              브라우저에서 claude.ai에 로그인되어 있어야 합니다. 비공개 내부
              API를 사용하며 약관상 자동화 접근으로 해석될 수 있습니다.
            </p>
          </div>
        );
      case 'chatgpt':
        return (
          <div class="provider-fields">
            <label class="field">
              <span class="field-label">계정 ID (선택)</span>
              <input
                type="text"
                class="input"
                value={ps.accountId ?? ''}
                onInput={(e) =>
                  updateProvider(id, {
                    accountId:
                      (e.target as HTMLInputElement).value || undefined,
                  })
                }
                placeholder="자동 탐색"
              />
            </label>
            <label class="field checkbox-field">
              <input
                type="checkbox"
                checked={ps.showFiveHour ?? true}
                onChange={(e) =>
                  updateProvider(id, {
                    showFiveHour: (e.target as HTMLInputElement).checked,
                  })
                }
              />
              <span>5시간 창도 표시</span>
            </label>
            <p class="note">
              브라우저에서 chatgpt.com에 로그인되어 있어야 합니다. 비공개 내부
              API를 사용하며 약관상 자동화 접근으로 해석될 수 있습니다.
            </p>
          </div>
        );
      case 'zai':
        return (
          <div class="provider-fields">
            <label class="field">
              <span class="field-label">리전</span>
              <select
                class="select"
                value={ps.region ?? 'global'}
                onChange={(e) =>
                  handleRegionChange(
                    id,
                    (e.target as HTMLSelectElement).value as
                      | 'global'
                      | 'china',
                  )
                }
              >
                <option value="global">Global (api.z.ai)</option>
                <option value="china">China (open.bigmodel.cn)</option>
              </select>
            </label>
            {apiKeyInput()}
          </div>
        );
      case 'poe':
        return (
          <div class="provider-fields">
            {apiKeyInput()}
            <label class="field">
              <span class="field-label">사용 유형</span>
              <select
                class="select"
                value={ps.usageTypeFilter ?? 'all'}
                onChange={(e) =>
                  updateProvider(id, {
                    usageTypeFilter: (e.target as HTMLSelectElement).value as
                      | 'all'
                      | 'api'
                      | 'chat',
                  })
                }
              >
                <option value="all">전체</option>
                <option value="api">API만</option>
                <option value="chat">Chat만</option>
              </select>
            </label>
          </div>
        );
      case 'litellm':
        return (
          <div class="provider-fields">
            <label class="field">
              <span class="field-label">Base URL</span>
              <input
                type="url"
                class="input"
                value={ps.baseUrl ?? ''}
                onInput={(e) =>
                  handleBaseUrlChange(
                    id,
                    (e.target as HTMLInputElement).value,
                  )
                }
                placeholder="https://proxy.example.com"
              />
            </label>
            {apiKeyInput()}
            <label class="field">
              <span class="field-label">인증 헤더명</span>
              <input
                type="text"
                class="input"
                value={ps.headerName ?? 'Authorization'}
                onInput={(e) =>
                  updateProvider(id, {
                    headerName: (e.target as HTMLInputElement).value || 'Authorization',
                  })
                }
              />
            </label>
            <label class="field">
              <span class="field-label">모드</span>
              <select
                class="select"
                value={ps.mode ?? 'user'}
                onChange={(e) =>
                  updateProvider(id, {
                    mode: (e.target as HTMLSelectElement).value as
                      | 'user'
                      | 'admin',
                  })
                }
              >
                <option value="user">사용자 (가상키)</option>
                <option value="admin">관리자</option>
              </select>
            </label>
          </div>
        );
      case 'openrouter':
        return (
          <div class="provider-fields">
            {apiKeyInput()}
            <label class="field">
              <span class="field-label">모드</span>
              <select
                class="select"
                value={ps.mode ?? 'key'}
                onChange={(e) =>
                  updateProvider(id, {
                    mode: (e.target as HTMLSelectElement).value as
                      | 'key'
                      | 'management',
                  })
                }
              >
                <option value="key">키 단위</option>
                <option value="management">관리키 (계정 전체)</option>
              </select>
            </label>
            {(ps.mode ?? 'key') === 'management' && (
              <p class="warning">
                관리키는 모든 키의 조회/생성/삭제 권한이 있습니다. 주의하세요.
              </p>
            )}
          </div>
        );
    }
  };

  const renderSnapshot = (id: ProviderId) => {
    const snap = snapshots[id];
    if (!snap) return <span class="status-chip not-configured">데이터 없음</span>;
    const site = SITE_LINKS[id];
    const needsSite = site !== undefined && (snap.status === 'auth_required' || snap.status === 'challenge');
    const succeeded = snap.status === 'ok';
    return (
      <div class="snapshot-line">
        <span class={`status-chip ${snap.status}`}>{statusLabel(snap.status)}</span>
        <span class="last-success">
          {succeeded ? '마지막 성공' : '마지막 시도'}: {formatLastSuccess(succeeded ? snap.fetchedAt : snap.attemptedAt)}
        </span>
        {snap.error && (
          <span class="error-msg">{maskErrorMessage(snap.error.message)}</span>
        )}
        {needsSite && (
          <a class="site-link" href={site.url} target="_blank" rel="noreferrer">
            {site.label}
          </a>
        )}
      </div>
    );
  };

  return (
    <div class="options-container">
      <header class="header">
        <h1>LLM Usage Glance 설정</h1>
      </header>

      <section class="section">
        <h2>프로바이더</h2>
        {PROVIDER_ORDER.map((id) => {
          const ps = settings.providers[id];
          return (
            <div class={`card ${ps.enabled ? 'enabled' : ''}`} key={id}>
              <div class="card-header">
                <div class="card-title-row">
                  <label class="toggle-label">
                    <input
                      type="checkbox"
                      class="toggle"
                      checked={ps.enabled}
                      onChange={() => handleToggle(id)}
                    />
                    <span class="toggle-slider" />
                    <span class="provider-name">{PROVIDER_DISPLAY[id]}</span>
                  </label>
                  <div class="card-actions">
                    <label class="interval-label">
                      <input
                        type="number"
                        class="interval-input"
                        min={1}
                        max={60}
                        value={ps.intervalMin}
                        onInput={(e) =>
                          updateProvider(id, {
                            intervalMin: clampInterval(
                              Number((e.target as HTMLInputElement).value),
                            ),
                          })
                        }
                      />
                      <span>분</span>
                    </label>
                    <button
                      class="btn btn-test"
                      disabled={!ps.enabled || testingProvider === id}
                      onClick={() => handleTest(id)}
                    >
                      {testingProvider === id ? '테스트 중...' : '연결 테스트'}
                    </button>
                  </div>
                </div>
                {renderSnapshot(id)}
                {permError[id] && (
                  <p class="error-text">{permError[id]}</p>
                )}
                {testResult[id] && (
                  <p class="test-result">{testResult[id]}</p>
                )}
              </div>
              {renderProviderFields(id)}
            </div>
          );
        })}
      </section>

      <section class="section">
        <h2>표시 설정</h2>
        <label class="field">
          <span class="field-label">타임존</span>
          <input
            type="text"
            class="input"
            list="tz-list"
            value={settings.timezone}
            onInput={(e) => {
              const v = (e.target as HTMLInputElement).value;
              if (isValidTimezone(v)) {
                setSettings((s) => ({ ...s, timezone: v }));
                setTzError('');
                setDirty(true);
              } else {
                setSettings((s) => ({ ...s, timezone: v }));
                setTzError('유효하지 않은 타임존입니다');
                setDirty(true);
              }
            }}
          />
          <datalist id="tz-list">
            {COMMON_TIMEZONES.map((tz) => (
              <option key={tz} value={tz} />
            ))}
          </datalist>
          {tzError && <span class="error-text">{tzError}</span>}
        </label>

        <label class="field">
          <span class="field-label">주 시작</span>
          <select
            class="select"
            value={settings.weekStart}
            onChange={(e) => {
              setSettings((s) => ({
                ...s,
                weekStart: Number((e.target as HTMLSelectElement).value) as
                  | 0
                  | 1,
              }));
              setDirty(true);
            }}
          >
            <option value={1}>월요일</option>
            <option value={0}>일요일</option>
          </select>
        </label>

        <label class="field">
          <span class="field-label">배지 모드</span>
          <select
            class="select"
            value={settings.badgeMode}
            onChange={(e) => {
              setSettings((s) => ({
                ...s,
                badgeMode: (e.target as HTMLSelectElement).value as
                  | 'maxPercent'
                  | 'grants'
                  | 'off',
              }));
              setDirty(true);
            }}
          >
            <option value="maxPercent">최대 사용률 (%)</option>
            <option value="grants">리셋권 수</option>
            <option value="off">끄기</option>
          </select>
        </label>

        <label class="field checkbox-field">
          <input
            type="checkbox"
            checked={settings.notifications}
            onChange={handleNotifToggle}
          />
          <span>알림</span>
          {notifDenied && (
            <span class="error-text">알림 권한이 거부되었습니다</span>
          )}
        </label>

        <div class="threshold-row">
          <label class="field">
            <span class="field-label">경고 (%)</span>
            <input
              type="number"
              class="input narrow"
              min={0}
              max={100}
              value={settings.warnPercent}
              onInput={(e) => {
                setSettings((s) => ({
                  ...s,
                  warnPercent: Math.max(
                    0,
                    Math.min(100, Number((e.target as HTMLInputElement).value)),
                  ),
                }));
                setDirty(true);
              }}
            />
          </label>
          <label class="field">
            <span class="field-label">위험 (%)</span>
            <input
              type="number"
              class="input narrow"
              min={0}
              max={100}
              value={settings.criticalPercent}
              onInput={(e) => {
                setSettings((s) => ({
                  ...s,
                  criticalPercent: Math.max(
                    0,
                    Math.min(100, Number((e.target as HTMLInputElement).value)),
                  ),
                }));
                setDirty(true);
              }}
            />
          </label>
        </div>
      </section>

      <section class="section">
        <h2>진단</h2>
        <div class="diag-block">
          {PROVIDER_IDS.map((id) => {
            const snap = snapshots[id];
            if (!snap) return null;
            return (
              <div class="diag-row" key={id}>
                <span class="diag-label">{PROVIDER_DISPLAY[id]}</span>
                <span class={`status-chip ${snap.status}`}>
                  {statusLabel(snap.status)}
                </span>
                {snap.error && (
                  <span class="diag-code">{snap.error.code}</span>
                )}
              </div>
            );
          })}
        </div>
      </section>

      <section class="section danger-section">
        <h2>데이터</h2>
        <button class="btn btn-danger" onClick={handleClearData}>
          데이터 삭제
        </button>
      </section>

      <footer class="footer">
        <button
          class="btn btn-save"
          onClick={handleSave}
          disabled={!dirty || !!tzError}
        >
          저장
        </button>
      </footer>
    </div>
  );
}
