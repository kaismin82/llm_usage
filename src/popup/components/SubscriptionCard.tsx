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
  formatUsd,
  formatCredits,
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
  const showExtra = providerId === 'claude' || providerId === 'chatgpt';
  const extra = snapshot.extraCredits;
  const monthly = snapshot.windows.find((w) => w.kind === 'month' && (w.unit === 'usd' || w.unit === 'credits'));
  const extraUnit = extra?.unit ?? (providerId === 'claude' ? 'usd' : 'credits');
  const extraAmount = (amount: number) => extraUnit === 'usd' ? formatUsd(amount) : `${formatCredits(amount)} cr`;
  const observedMonth = new Intl.DateTimeFormat('ko-KR', {
    year: 'numeric', month: 'numeric',
    timeZone: providerId === 'chatgpt' ? 'UTC' : settings.timezone,
  }).format(new Date(snapshot.fetchedAt));
  const extraTitle = extraUnit === 'usd'
    ? `${observedMonth} 추가 사용액 / 월 지출 한도. 월 지출 한도는 선불 크레딧 잔액이 아닙니다.`
    : `${observedMonth} UTC 서버 제공 이력의 월간 사용량 · 현재 사용 가능 잔액. 크레딧은 USD가 아닙니다.`;

  return (
    <div class={`card${showExtra ? ' has-extra-credits' : ''}${dim ? ' is-dim' : ''}`}>
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

      {showExtra && (
        <div class="extra-credit-row" title={extraTitle}>
          <span class="extra-credit-label">{observedMonth} Extra</span>
          <span class="extra-credit-values">
            {extra?.isEnabled === false && <span>비활성</span>}
            {monthly?.usedAmount !== undefined ? (
              <span>사용 <b class="extra-used" title={String(monthly.usedAmount)}>{extraAmount(monthly.usedAmount)}</b></span>
            ) : extra?.isEnabled !== false && <span>사용량 조회 불가</span>}
            {monthly?.limitAmount !== undefined && (
              <span>/ 월 한도 <b class="extra-limit" title={String(monthly.limitAmount)}>{extraAmount(monthly.limitAmount)}</b></span>
            )}
            {extraUnit === 'usd' && monthly && monthly.limitAmount === undefined && <span>월 한도 미제공</span>}
            {extraUnit === 'credits' && (
              <span>
                · 잔액 {extra?.unlimited ? (
                  <b class="extra-balance">무제한</b>
                ) : extra?.balanceAmount !== undefined ? (
                  <b class="extra-balance" title={String(extra.balanceAmount)}>{extraAmount(extra.balanceAmount)}</b>
                ) : '미제공'}
              </span>
            )}
          </span>
        </div>
      )}
    </div>
  );
}
