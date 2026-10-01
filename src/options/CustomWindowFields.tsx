import { CUSTOM_UNITS, RESET_FORMATS } from '../custom/types';
import type { CustomWindowConfig } from '../custom/types';

const PATH_FIELDS = [
  ['label', '창 이름', '월간 사용량'],
  ['usedPath', '사용량 경로', 'data.usage.used'],
  ['limitPath', '한도 경로 (선택)', 'data.usage.limit'],
  ['percentPath', '사용률 경로 (선택, 0~100)', 'data.usage.percent'],
  ['resetPath', '리셋 시각 경로 (선택)', 'data.reset_at'],
] as const;

export function newCustomWindow(): CustomWindowConfig {
  return {
    label: '사용량', unit: 'tokens', usedPath: '', limitPath: '',
    percentPath: '', resetPath: '', resetFormat: 'iso',
  };
}

type Props = {
  readonly value: CustomWindowConfig;
  readonly onChange: (patch: Partial<CustomWindowConfig>) => void;
  readonly onRemove: () => void;
};

export function CustomWindowFields({ value, onChange, onRemove }: Props) {
  return (
    <div class="custom-window-fields">
      {PATH_FIELDS.map(([key, label, placeholder]) => (
        <label class="field" key={key}>
          <span class="field-label">{label}</span>
          <input class="input" name={key} value={value[key]} placeholder={placeholder}
            onInput={(e) => onChange({ [key]: e.currentTarget.value })} />
        </label>
      ))}
      <label class="field">
        <span class="field-label">단위</span>
        <select class="select" name="custom-unit" value={value.unit} onChange={(e) => {
          const unit = CUSTOM_UNITS.find((item) => item === e.currentTarget.value);
          if (unit) onChange({ unit });
        }}>
          {CUSTOM_UNITS.map((unit) => <option key={unit} value={unit}>{unit}</option>)}
        </select>
      </label>
      <label class="field">
        <span class="field-label">리셋 시각 형식</span>
        <select class="select" value={value.resetFormat} onChange={(e) => {
          const resetFormat = RESET_FORMATS.find((item) => item === e.currentTarget.value);
          if (resetFormat) onChange({ resetFormat });
        }}>
          <option value="iso">ISO 날짜 문자열</option>
          <option value="seconds">Unix 초</option>
          <option value="milliseconds">Unix 밀리초</option>
        </select>
      </label>
      <button type="button" class="btn" onClick={onRemove}>사용량 창 삭제</button>
    </div>
  );
}
