import { AUTH_MODES } from '../custom/types';
import type { CustomProviderConfig } from '../custom/types';

type Props = {
  readonly value: CustomProviderConfig;
  readonly onChange: (patch: Partial<CustomProviderConfig>) => void;
};

export function CustomConnectionFields({ value, onChange }: Props) {
  return <>
    <label class="field"><span class="field-label">이름</span>
      <input class="input" name="custom-name" value={value.name} required
        onInput={(e) => onChange({ name: e.currentTarget.value })} /></label>
    <label class="field"><span class="field-label">사용량 JSON URL (GET)</span>
      <input class="input" name="custom-endpoint" type="url" value={value.endpoint} required
        placeholder="https://api.example.com/account/usage"
        onInput={(e) => onChange({ endpoint: e.currentTarget.value })} /></label>
    <label class="field"><span class="field-label">인증 방식</span>
      <select class="select" name="custom-auth" value={value.authMode} onChange={(e) => {
        const authMode = AUTH_MODES.find((item) => item === e.currentTarget.value);
        if (authMode) onChange({ authMode });
      }}>
        <option value="none">인증 없음</option><option value="bearer">Bearer API 키</option>
        <option value="header">API 키 헤더</option><option value="session">브라우저 로그인 세션</option>
      </select></label>
    {(value.authMode === 'bearer' || value.authMode === 'header') && (
      <label class="field"><span class="field-label">API 키</span>
        <input class="input" name="custom-api-key" type="password" value={value.apiKey} autoComplete="off"
          onInput={(e) => onChange({ apiKey: e.currentTarget.value })} /></label>
    )}
    {value.authMode === 'header' && <label class="field"><span class="field-label">인증 헤더명</span>
      <input class="input" value={value.headerName}
        onInput={(e) => onChange({ headerName: e.currentTarget.value })} /></label>}
    <label class="field"><span class="field-label">조회 주기 (분)</span>
      <input class="input narrow" name="custom-interval" type="number" min="1" max="60" value={value.intervalMin}
        onInput={(e) => onChange({ intervalMin: Number(e.currentTarget.value) })} /></label>
    <label class="field checkbox-field">
      <input type="checkbox" checked={value.enabled} onChange={(e) => onChange({ enabled: e.currentTarget.checked })} />
      <span>사용</span></label>
  </>;
}
