import { useState } from 'preact/hooks';
import { customOrigin, parseCustomHeaders, validateCustomProvider } from '../custom/config';
import { createCustomStore, notifyCustomChanged } from '../custom/store';
import { CustomConfigError } from '../custom/types';
import type { CustomProviderConfig, CustomWindowConfig } from '../custom/types';
import { CustomConnectionFields } from './CustomConnectionFields';
import { CustomWindowFields, newCustomWindow } from './CustomWindowFields';

type Props = {
  readonly value: CustomProviderConfig;
  readonly onSaved: () => void;
  readonly onCancel: () => void;
};

export function CustomProviderEditor({ value, onSaved, onCancel }: Props) {
  const [draft, setDraft] = useState(value);
  const [headers, setHeaders] = useState(JSON.stringify(value.headers, null, 2));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const change = (patch: Partial<CustomProviderConfig>) => setDraft((old) => ({ ...old, ...patch }));
  const changeWindows = (update: (windows: readonly CustomWindowConfig[]) => readonly CustomWindowConfig[]) =>
    setDraft((old) => ({ ...old, windows: update(old.windows) }));
  const save = async (event: Event) => {
    event.preventDefault();
    setError('');
    setBusy(true);
    try {
      const provider = { ...draft, headers: parseCustomHeaders(headers) };
      const validation = validateCustomProvider(provider);
      if (validation) throw new CustomConfigError(validation);
      if (provider.enabled && !(await chrome.permissions.request({ origins: [customOrigin(provider)] }))) {
        throw new CustomConfigError('호스트 권한이 거부되었습니다');
      }
      await createCustomStore().saveProvider(provider);
      await notifyCustomChanged(provider.id);
      onSaved();
    } catch (cause) {
      setError(cause instanceof CustomConfigError ? cause.message
        : cause instanceof SyntaxError ? '추가 헤더 JSON을 확인해주세요' : 'Custom provider 저장 또는 연결에 실패했습니다');
    } finally { setBusy(false); }
  };
  return (
    <form class="card custom-editor" data-custom-editor onSubmit={save}>
      <h3>{value.name || 'Custom provider 추가'}</h3>
      <fieldset class="provider-fields custom-editor-fields" disabled={busy}>
        <CustomConnectionFields value={draft} onChange={change} />
        <WindowList value={draft.windows} onChange={changeWindows} />
        <BalanceFields value={draft} onChange={change} />
        <label class="field"><span class="field-label">추가 헤더 (JSON, 선택)</span>
          <textarea class="input" name="custom-headers" rows={3} value={headers}
            onInput={(e) => setHeaders(e.currentTarget.value)} /></label>
        <p class="custom-help">필드 경로 예: data.used, data.windows[0].used. 사용량과 한도를 입력하면 사용률을 계산합니다. 채팅 URL이 아닌 사용량 조회 JSON URL이 필요합니다.</p>
        <div class="card-actions">
          <button class="btn btn-save" data-action="save-custom" type="submit">{busy ? '저장 및 조회 중...' : '저장 및 조회'}</button>
          <button class="btn" type="button" onClick={onCancel}>취소</button>
        </div>
      </fieldset>
      {error && <p class="error-text" data-custom-error role="alert">{error}</p>}
    </form>
  );
}

function WindowList({ value, onChange }: {
  readonly value: readonly CustomWindowConfig[];
  readonly onChange: (update: (windows: readonly CustomWindowConfig[]) => readonly CustomWindowConfig[]) => void;
}) {
  return <>
    {value.map((window, index) => <CustomWindowFields key={index} value={window}
      onChange={(patch) => onChange((windows) => windows.map((old, i) => i === index ? { ...old, ...patch } : old))}
      onRemove={() => onChange((windows) => windows.filter((_, i) => i !== index))} />)}
    <button class="btn" type="button" onClick={() => onChange((windows) => [...windows, newCustomWindow()])}>사용량 창 추가</button>
  </>;
}

function BalanceFields({ value, onChange }: { readonly value: CustomProviderConfig; readonly onChange: (patch: Partial<CustomProviderConfig>) => void }) {
  return <>
    <label class="field"><span class="field-label">잔액 경로 (선택)</span>
      <input class="input" name="custom-balance" value={value.balancePath} placeholder="data.balance"
        onInput={(e) => onChange({ balancePath: e.currentTarget.value })} /></label>
    <label class="field"><span class="field-label">잔액 단위</span>
      <select class="select" value={value.balanceUnit} onChange={(e) => {
        const unit = e.currentTarget.value;
        if (unit === 'usd' || unit === 'points') onChange({ balanceUnit: unit });
      }}><option value="usd">USD</option><option value="points">포인트</option></select></label>
  </>;
}
