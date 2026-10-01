import { useState } from 'preact/hooks';
import { customOrigin } from '../custom/config';
import { createCustomStore, notifyCustomChanged, requestCustomRefresh } from '../custom/store';
import { CustomConfigError } from '../custom/types';
import type { CustomProviderConfig, CustomSnapshot } from '../custom/types';
import { useCustomData } from '../custom/use-data';
import { CustomProviderEditor } from './CustomProviderEditor';
import { newCustomWindow } from './CustomWindowFields';
import { formatLastSuccess, statusLabel } from './logic';
import './custom.css';

type Action = 'toggle' | 'test' | 'delete';

function useCustomActions() {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState('');
  const act = async (provider: CustomProviderConfig, action: Action) => {
    setError('');
    setBusy(provider.id);
    try {
      const store = createCustomStore();
      switch (action) {
        case 'toggle': {
          const next = { ...provider, enabled: !provider.enabled };
          if (next.enabled && !(await chrome.permissions.request({ origins: [customOrigin(next)] }))) {
            throw new CustomConfigError('호스트 권한이 거부되었습니다');
          }
          await store.saveProvider(next);
          await notifyCustomChanged(next.id);
          break;
        }
        case 'test':
          if (!(await chrome.permissions.request({ origins: [customOrigin(provider)] }))) {
            throw new CustomConfigError('호스트 권한이 거부되었습니다');
          }
          await requestCustomRefresh(provider.id);
          break;
        case 'delete':
          if (!confirm(`${provider.name} custom provider를 삭제하시겠습니까?`)) break;
          await store.deleteProvider(provider.id);
          await notifyCustomChanged(provider.id);
          break;
        default: {
          const exhaustive: never = action;
          return exhaustive;
        }
      }
    } catch (cause) {
      setError(cause instanceof CustomConfigError ? cause.message : 'Custom provider 작업에 실패했습니다');
    } finally { setBusy(null); }
  };
  return { busy, error, act };
}

function SavedCustomProvider({ provider, snapshot, busy, onAction, onEdit }: {
  readonly provider: CustomProviderConfig;
  readonly snapshot?: CustomSnapshot;
  readonly busy: boolean;
  readonly onAction: (action: Action) => void;
  readonly onEdit: () => void;
}) {
  return <div class="card custom-provider" data-custom-config-id={provider.id}>
    <div class="card-title-row">
      <label class="field checkbox-field">
        <input type="checkbox" checked={provider.enabled} disabled={busy} onChange={() => onAction('toggle')} />
        <span class="provider-name custom-provider-name">{provider.name}</span>
      </label>
      <div class="card-actions custom-actions">
        <button class="btn" data-action="edit-custom" disabled={busy} onClick={onEdit}>편집</button>
        <button class="btn btn-test" disabled={busy || !provider.enabled} onClick={() => onAction('test')}>연결 테스트</button>
        <button class="btn btn-danger" disabled={busy} onClick={() => onAction('delete')}>삭제</button>
      </div>
    </div>
    <div class="snapshot-line" aria-live="polite">
      <span class={`status-chip ${snapshot?.status ?? 'not_configured'}`} data-custom-status={snapshot?.status}>
        {busy ? '조회 중...' : snapshot ? statusLabel(snapshot.status) : '데이터 없음'}
      </span>
      {snapshot && <span class="last-success">마지막 시도: {formatLastSuccess(snapshot.attemptedAt)}</span>}
      {snapshot?.error && <span class="error-msg">{snapshot.error.message}</span>}
    </div>
  </div>;
}

export function CustomProviders() {
  const data = useCustomData();
  const [draft, setDraft] = useState<CustomProviderConfig | null>(null);
  const actions = useCustomActions();
  const add = () => setDraft({
    id: crypto.randomUUID(), name: '', enabled: true, intervalMin: 10, endpoint: '',
    authMode: 'none', apiKey: '', headerName: 'X-API-Key', headers: {},
    windows: [newCustomWindow()], balancePath: '', balanceUnit: 'usd',
  });
  return <section class="section custom-providers" aria-label="Custom providers">
    <div class="custom-section-heading"><h2>Custom providers</h2>
      <button class="btn" data-action="add-custom" disabled={!data.loaded || draft !== null || actions.busy !== null} onClick={add}>프로바이더 추가</button>
    </div>
    <p class="custom-help">기존 프로바이더와 별도로 저장됩니다. 사용량 API와 응답 필드 경로를 입력해 추가하실 수 있습니다.</p>
    {data.providers.map((provider) => <SavedCustomProvider key={provider.id} provider={provider}
      snapshot={data.snapshots[provider.id]} busy={actions.busy === provider.id || draft !== null}
      onAction={(action) => { void actions.act(provider, action); }} onEdit={() => setDraft(provider)} />)}
    {draft && <CustomProviderEditor key={draft.id} value={draft} onSaved={() => setDraft(null)} onCancel={() => setDraft(null)} />}
    {(actions.error || data.error) && <p class="error-text" data-custom-error role="alert">{actions.error || data.error}</p>}
  </section>;
}
