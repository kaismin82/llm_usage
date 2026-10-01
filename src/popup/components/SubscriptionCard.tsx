import type {
  AppSettings,
  ProviderId,
  ProviderSnapshot,
  UsageWindow,
} from '../../providers/types';
import {
  formatRelative,
  formatShortAbsolute,
  formatAgo,
  percentTone,
  availableGrantCount,
  STATUS_LABELS,
  PROVIDER_LABELS,
} from '../format';
import { Avatar } from './Avatar';

interface Props {
  snapshot: ProviderSnapshot | undefined;
  providerId: ProviderId;
  settings: AppSettings;
  now: Date;
}

function isStaleData(snapshot: ProviderSnapshot, settings: AppSettings): boolean {
  const interval = settings.providers[snapshot.provider]?.intervalMin ?? 3;
  return Date.now() - Date.parse(snapshot.fetchedAt) > interval * 3 * 60_000;
}

function WindowRow({ w, warn, crit, now }: { w: UsageWindow; warn: number; crit: number; now: Date }) {
  const pct = w.usedPercent ?? 0;
  const tone = percentTone(pct, warn, crit);
  const full = pct >= 100;
  const reset = w.resetsAt
    ? `${formatRelative(w.resetsAt, now)} · ${formatShortAbsolute(w.resetsAt, now)}`
    : null;

  return (
    <div class="win-row">
      <span class="win-label">{w.label}</span>
      <div
        class="bar"
        role="progressbar"
        aria-label={`${w.label} ${Math.round(pct)}%`}
        aria-valuenow={Math.round(pct)}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <div class={`bar-fill tone-${tone}`} style={{ width: `${Math.min(pct, 100)}%` }} />
      </div>
      <span class={`win-pct text-${tone}`}>{full ? '한도 도달' : `${Math.round(pct)}%`}</span>
      <span class="win-reset" title={w.resetsAt ?? undefined}>
        {reset ?? '시작 전'}
      </span>
    </div>
  );
}

export function SubscriptionCard({ snapshot, providerId, settings, now }: Props) {
  const label = PROVIDER_LABELS[providerId] ?? providerId;

  if (!snapshot) {
    return (
      <div class="card is-dim">
        <div class="card-h">
          <Avatar id={providerId} />
          <span class="name">{label}</span>
          <span class="chip chip-muted">데이터 없음</span>
        </div>
      </div>
    );
  }

  const ok = snapshot.status === 'ok';
  const dim = !ok || isStaleData(snapshot, settings);
  const grants = availableGrantCount(snapshot);
  const { warnPercent, criticalPercent } = settings;

  const mainWindows = snapshot.windows.filter((w) => w.kind === 'session_5h' || w.kind === 'weekly_7d');
  const modelWindows = snapshot.windows.filter((w) => w.kind === 'weekly_model');
  const tool = snapshot.windows.find((w) => w.kind === 'monthly_tool');
  const toolPct = tool?.usedPercent ?? 0;
  const toolTone = percentTone(toolPct, warnPercent, criticalPercent);

  return (
    <div class={`card${dim ? ' is-dim' : ''}`}>
      <div class="card-h">
        <Avatar id={providerId} />
        <span class="name">{label}</span>
        {snapshot.plan && <span class="plan">{snapshot.plan}</span>}
        <span class="spacer" />
        {grants > 0 && <span class="chip chip-grant">리셋권 {grants}</span>}
        {!ok && (
          <span class={`chip chip-${snapshot.status}`} title={`마지막 성공 ${formatAgo(snapshot.fetchedAt, now)}`}>
            {STATUS_LABELS[snapshot.status] ?? snapshot.status}
          </span>
        )}
      </div>

      {mainWindows.map((w, i) => (
        <WindowRow key={`main-${i}`} w={w} warn={warnPercent} crit={criticalPercent} now={now} />
      ))}

      {tool && (
        <div class="win-row">
          <span class="win-label">MCP</span>
          <div class="bar" role="progressbar" aria-label={`MCP 월간 ${Math.round(toolPct)}%`} aria-valuenow={Math.round(toolPct)} aria-valuemin={0} aria-valuemax={100}>
            <div class={`bar-fill tone-${toolTone}`} style={{ width: `${Math.min(toolPct, 100)}%` }} />
          </div>
          <span class={`win-pct text-${toolTone}`}>{Math.round(toolPct)}%</span>
          <span class="win-reset">
            월간 {tool.usedAmount != null && tool.limitAmount != null ? `${tool.usedAmount}/${tool.limitAmount}` : ''}
          </span>
        </div>
      )}

      {modelWindows.length > 0 && (
        <div class="models">
          <span class="models-label">모델별 주간</span>
          {modelWindows.map((w, i) => (
            <span key={i} class="model-item">
              {w.label.replace(/^7일 · /, '')}{' '}
              <b class={`text-${percentTone(w.usedPercent ?? 0, warnPercent, criticalPercent)}`}>
                {w.usedPercent != null ? `${Math.round(w.usedPercent)}%` : ''}
              </b>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
