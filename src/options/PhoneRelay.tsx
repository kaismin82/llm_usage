import { useEffect, useRef, useState } from 'preact/hooks';
import { onStoreChange } from '../core/store';
import {
  defaultRelayConfig, getRelayConfig, getRelayStatus, saveRelayConfig,
  defaultSecondaryConfig, getSecondaryConfig, saveSecondaryConfig,
  RELAY_ENDPOINT, RELAY_ORIGIN, type RelayStatus,
} from '../phone-relay/store';

const RESULTS = {
  ok: '전송 성공', unavailable: '연결 실패 또는 시간 초과', http_error: '서버 응답 오류',
  permission_missing: '로컬 연결 권한 없음', not_configured: '쓰기 토큰 없음',
};

export function PhoneRelay() {
  const [config, setConfig] = useState(defaultRelayConfig);
  const [secondary, setSecondary] = useState(defaultSecondaryConfig);
  const [secondaryDirty, setSecondaryDirty] = useState(false);
  const [status, setStatus] = useState<RelayStatus>();
  const [dirty, setDirty] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const dirtyRef = useRef(false);
  dirtyRef.current = dirty;

  useEffect(() => {
    let mounted = true;
    const load = async () => {
      try {
        const [saved, latest, savedSecondary] = await Promise.all([getRelayConfig(), getRelayStatus(), getSecondaryConfig()]);
        if (!mounted) return;
        if (!dirtyRef.current) setConfig(saved);
        if (!secondaryDirty) setSecondary(savedSecondary);
        setStatus(latest);
        setLoaded(true);
      } catch {
        if (mounted) setMessage('동기화 설정을 불러오지 못했습니다');
      }
    };
    const unsubscribe = onStoreChange(() => { void load(); });
    void load();
    return () => { mounted = false; unsubscribe(); };
  }, []);

  const save = async () => {
    setBusy(true);
    setMessage('');
    try {
      if (config.enabled) {
        if (!config.writeToken.trim()) {
          setMessage('릴레이의 쓰기 토큰을 입력하세요');
          return;
        }
        const granted = await chrome.permissions.request({ origins: [RELAY_ORIGIN] });
        if (!granted) {
          setMessage('로컬 연결 권한이 거부되었습니다');
          return;
        }
      }
      if (secondary.enabled && !secondary.readToken.trim()) {
        setMessage('보조 계정의 릴레이 읽기 토큰을 입력하세요');
        return;
      }
      if (secondary.enabled) {
        const granted = await chrome.permissions.request({ origins: [RELAY_ORIGIN] });
        if (!granted) {
          setMessage('로컬 연결 권한이 거부되었습니다');
          return;
        }
      }
      await saveSecondaryConfig(secondary);
      setSecondaryDirty(false);
      await saveRelayConfig(config);
      setDirty(false);
      setMessage('동기화 설정을 저장했습니다');
    } catch {
      setMessage('동기화 설정을 저장하지 못했습니다');
    } finally {
      setBusy(false);
    }
  };
  const send = async () => {
    setBusy(true);
    setMessage('');
    try {
      const response: unknown = await chrome.runtime.sendMessage({ type: 'phone-relay-send' });
      if (!response || typeof response !== 'object' || !('ok' in response) || response.ok !== true) {
        setMessage('백그라운드 응답 없음');
      }
    } catch {
      setMessage('백그라운드 응답 없음');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section class="section phone-relay" aria-label="휴대폰 동기화">
      <h2>휴대폰 동기화 (선택)</h2>
      <div class={`card ${config.enabled ? 'enabled' : ''}`}>
        <div class="provider-fields">
          <label class="toggle-label">
            <input class="toggle" type="checkbox" name="phoneRelayEnabled" checked={config.enabled}
              disabled={!loaded || busy}
              onChange={(event) => {
                const enabled = event.currentTarget.checked;
                setConfig((previous) => ({ ...previous, enabled }));
                setDirty(true);
              }} />
            <span class="toggle-slider" />
            <span class="provider-name">PC 사용량을 휴대폰으로</span>
          </label>
          <p class="note">기본 꺼짐. 저장된 사용량만 로컬 릴레이로 전송합니다. 수집 주기와 절전 동작은 바뀌지 않습니다.</p>
          <label class="field">
            <span class="field-label">계정 라벨 (기본 main · 다른 프로필의 확장은 다른 라벨)</span>
            <input class="input" type="text" name="phoneRelayAccountLabel" autoComplete="off"
              value={config.accountLabel}
              disabled={!loaded || busy}
              onInput={(event) => {
                const accountLabel = event.currentTarget.value;
                setConfig((previous) => ({ ...previous, accountLabel }));
                setDirty(true);
              }} />
          </label>
          <label class="field">
            <span class="field-label">릴레이 쓰기 토큰 (프로바이더 API 키 아님)</span>
            <input class="input" type="password" name="phoneRelayWriteToken" autoComplete="off"
              value={config.writeToken} disabled={!loaded || busy}
              onInput={(event) => {
                const writeToken = event.currentTarget.value;
                setConfig((previous) => ({ ...previous, writeToken }));
                setDirty(true);
              }} />
          </label>
          <p class="last-success phone-relay-endpoint">{RELAY_ENDPOINT}</p>
          <label class="toggle-label">
            <input class="toggle" type="checkbox" name="claudeSecondaryEnabled" checked={secondary.enabled}
              disabled={!loaded || busy}
              onChange={(event) => {
                const enabled = event.currentTarget.checked;
                setSecondary((previous) => ({ ...previous, enabled }));
                setSecondaryDirty(true);
              }} />
            <span class="toggle-slider" />
            <span class="provider-name">보조 Claude 계정 표시 (릴레이에서 읽기)</span>
          </label>
          <p class="note">릴레이의 읽기 토큰(credentials.json의 readToken)으로 다른 프로필이 올린 Claude 카드를 이 프로필의 패널에 함께 표시합니다. 계정 라벨이 다른 프로필의 것과 겹치지 않아야 합니다.</p>
          <label class="field">
            <span class="field-label">릴레이 읽기 토큰 (readToken)</span>
            <input class="input" type="password" name="claudeSecondaryReadToken" autoComplete="off"
              value={secondary.readToken} disabled={!loaded || busy}
              onInput={(event) => {
                const readToken = event.currentTarget.value;
                setSecondary((previous) => ({ ...previous, readToken }));
                setSecondaryDirty(true);
              }} />
          </label>
          <div class="card-actions">
            <button class="btn btn-test" data-action="relay-save" disabled={!loaded || !dirty || busy} onClick={() => void save()}>
              동기화 설정 저장
            </button>
            <button class="btn" data-action="relay-send" disabled={!loaded || dirty || !config.enabled || busy} onClick={() => void send()}>
              지금 전송
            </button>
          </div>
          <div class="last-success" role="status" aria-live="polite">
            <p>{status ? `${RESULTS[status.result]}${status.httpStatus ? ` (HTTP ${status.httpStatus})` : ''}` : '전송 기록 없음'}</p>
            {status?.httpStatus === 401 && <p>릴레이가 쓰기 토큰을 거부했습니다. 읽기 키가 아닌 릴레이의 쓰기 토큰인지 확인하세요.</p>}
            {status?.attemptedAt && <p>마지막 시도: {new Date(status.attemptedAt).toLocaleString('ko-KR')}</p>}
            {status?.lastSuccessAt && <p>마지막 성공: {new Date(status.lastSuccessAt).toLocaleString('ko-KR')}</p>}
            {message && <p>{message}</p>}
          </div>
        </div>
      </div>
    </section>
  );
}
