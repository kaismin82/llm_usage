import { useEffect, useRef, useState } from 'preact/hooks';
import type { AppSettings, UsageWindow } from '../../providers/types';
import type { CustomProviderConfig, CustomSnapshot } from '../../custom/types';
import { requestCustomRefresh } from '../../custom/store';
import { formatAgo, formatRelative, formatPoints, formatUsd, percentTone, STATUS_LABELS } from '../format';
import '../custom.css';

function amount(value: number, unit: UsageWindow['unit']): string {
  switch (unit) {
    case 'usd': return formatUsd(value);
    case 'points': return `${formatPoints(value)} pt`;
    case 'percent': return `${value.toLocaleString('ko-KR', { maximumFractionDigits: 1 })}%`;
    case 'calls': return `${value.toLocaleString('ko-KR')} calls`;
    case 'tokens': return `${value.toLocaleString('ko-KR')} tokens`;
    default: {
      const exhaustive: never = unit;
      return exhaustive;
    }
  }
}

function Metric({ window, now, settings }: { readonly window: UsageWindow; readonly now: Date; readonly settings: AppSettings }) {
  const percent = window.usedPercent;
  const clamped = percent === undefined ? undefined : Math.max(0, Math.min(100, percent));
  const tone = percent === undefined ? 'ok' : percentTone(percent, settings.warnPercent, settings.criticalPercent);
  const value = window.usedAmount === undefined
    ? percent === undefined ? '-' : amount(percent, 'percent')
    : window.limitAmount === undefined ? amount(window.usedAmount, window.unit)
      : `${window.usedAmount.toLocaleString('ko-KR')} / ${amount(window.limitAmount, window.unit)}`;
  return <div class="custom-metric">
    <span class="custom-metric-label">{window.label}</span><span class="custom-metric-value">{value}</span>
    {clamped !== undefined && <div class="bar custom-metric-bar" role="progressbar" aria-label={window.label}
      aria-valuenow={clamped} aria-valuemin={0} aria-valuemax={100}>
      <div class={`bar-fill tone-${tone}`} style={{ width: `${clamped}%` }} />
    </div>}
    {window.resetsAt && <span class="custom-metric-reset">리셋 {formatRelative(window.resetsAt, now)}</span>}
  </div>;
}

function CustomCard({ provider, snapshot, now, settings, error }: {
  readonly provider: CustomProviderConfig; readonly snapshot?: CustomSnapshot;
  readonly now: Date; readonly settings: AppSettings; readonly error?: string;
}) {
  const stale = snapshot && now.getTime() - Date.parse(snapshot.fetchedAt) > provider.intervalMin * 3 * 60_000;
  return <article class={`card custom-card${snapshot?.status !== 'ok' || stale ? ' is-dim' : ''}`} data-custom-provider-id={provider.id}>
    <div class="card-h">
      <span class="avatar avatar-custom" aria-hidden="true">{provider.name.slice(0, 1)}</span>
      <span class="name custom-name">{provider.name}</span><span class="spacer" />
      <span class={`chip chip-${snapshot?.status ?? 'muted'}`}>
        {snapshot?.status === 'ok' ? '정상' : snapshot ? STATUS_LABELS[snapshot.status] ?? snapshot.status : '데이터 없음'}
      </span>
    </div>
    {snapshot?.windows.map((window, index) => <Metric key={index} window={window} now={now} settings={settings} />)}
    {snapshot?.balance && <div class="custom-metric">
      <span class="custom-metric-label">잔액</span>
      <span class="remain-val">{amount(snapshot.balance.amount, snapshot.balance.unit)}</span>
    </div>}
    {snapshot && <div class="custom-meta">{formatAgo(snapshot.fetchedAt, now)} 갱신{stale ? ' · 오래된 데이터' : ''}</div>}
    {(snapshot?.error || error) && <p class="custom-error" role="status">{snapshot?.error?.message || error}</p>}
  </article>;
}

export function CustomProviderCards({ providers, snapshots, now, settings }: {
  readonly providers: readonly CustomProviderConfig[]; readonly snapshots: Record<string, CustomSnapshot>;
  readonly now: Date; readonly settings: AppSettings;
}) {
  const checked = useRef(new Set<string>());
  const [errors, setErrors] = useState<Record<string, string>>({});
  useEffect(() => {
    for (const provider of providers) {
      if (!provider.enabled || checked.current.has(provider.id)) continue;
      checked.current.add(provider.id);
      const snapshot = snapshots[provider.id];
      if (!snapshot || Date.now() - Date.parse(snapshot.attemptedAt) > 30_000) {
        void requestCustomRefresh(provider.id).catch((cause: unknown) => {
          setErrors((old) => ({ ...old, [provider.id]: cause instanceof Error ? 'Custom provider 갱신에 실패했습니다' : '백그라운드 응답 없음' }));
        });
      }
    }
  }, [providers, snapshots]);
  return <section aria-label="Custom providers">
    {providers.filter((p) => p.enabled).map((provider) => <CustomCard key={provider.id} provider={provider}
      snapshot={snapshots[provider.id]} now={now} settings={settings} error={errors[provider.id]} />)}
  </section>;
}
