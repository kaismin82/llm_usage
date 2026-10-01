import type { AppSettings, ProviderId, ProviderSnapshot, UsageWindow } from '../../providers/types';
import {
  formatUsd,
  formatPoints,
  formatShortDate,
  formatAgo,
  percentTone,
  STATUS_LABELS,
  PROVIDER_LABELS,
} from '../format';
import type { SnapshotMap } from '../../core/store';
import { Avatar } from './Avatar';

interface Props {
  providerIds: ProviderId[];
  snapshots: SnapshotMap;
  settings: AppSettings;
  now: Date;
}

function windowByKind(windows: UsageWindow[], kind: string): UsageWindow | undefined {
  return windows.find((w) => w.kind === kind);
}

function formatAmount(w: UsageWindow | undefined): string {
  if (!w || w.usedAmount == null) return '-';
  if (w.unit === 'usd') return formatUsd(w.usedAmount);
  if (w.unit === 'points') return formatPoints(w.usedAmount);
  return String(w.usedAmount);
}

function formatBalance(balance: NonNullable<ProviderSnapshot['balance']>, amount: number): string {
  return balance.unit === 'points' ? `${formatPoints(amount)} pt` : formatUsd(amount);
}

function isStaleData(snapshot: ProviderSnapshot, settings: AppSettings): boolean {
  const interval = settings.providers[snapshot.provider]?.intervalMin ?? 10;
  return Date.now() - Date.parse(snapshot.fetchedAt) > interval * 3 * 60_000;
}

function Partial({ w }: { w: UsageWindow | undefined }) {
  return w?.partial ? <sup class="partial" title="부분 데이터">*</sup> : null;
}

function Remaining({ snap, warn, crit }: { snap: ProviderSnapshot; warn: number; crit: number }) {
  const balance = snap.balance;
  if (!balance) return <div class="remain"><span class="remain-none" title="잔액 정보 없음">-</span></div>;

  const hasLimit = balance.limit !== undefined && balance.limit > 0;
  const remainingPct = hasLimit ? Math.max(0, Math.min(100, (balance.amount / (balance.limit as number)) * 100)) : undefined;
  const tone = remainingPct === undefined ? 'ok' : percentTone(100 - remainingPct, warn, crit);
  const details = [
    balance.label ?? '남은 금액',
    hasLimit ? `한도 ${formatBalance(balance, balance.limit as number)}` : null,
    balance.resetsAt ? `리셋 ${formatShortDate(balance.resetsAt)}` : null,
  ].filter(Boolean).join(' · ');

  return (
    <div class="remain" title={details}>
      <span class="remain-val">{formatBalance(balance, balance.amount)}</span>
      {remainingPct !== undefined && (
        <div class="mini-bar" role="progressbar" aria-label={`${balance.label ?? '남은 금액'} ${Math.round(remainingPct)}%`} aria-valuenow={Math.round(remainingPct)} aria-valuemin={0} aria-valuemax={100}>
          <div class={`bar-fill tone-${tone}`} style={{ width: `${remainingPct}%` }} />
        </div>
      )}
    </div>
  );
}

export function CostTable({ providerIds, snapshots, settings, now }: Props) {
  const anyPartial = providerIds.some((id) => snapshots[id]?.windows.some((w) => w.partial));
  const { warnPercent, criticalPercent } = settings;

  return (
    <section class="cost" aria-label="API 비용">
      <div class="cost-head">
        <span>API 비용</span>
        <span>오늘</span>
        <span>이번주</span>
        <span>이번달</span>
        <span>남은 금액</span>
      </div>
      {providerIds.map((id) => {
        const snap = snapshots[id];
        const label = PROVIDER_LABELS[id] ?? id;
        if (!snap) {
          return (
            <div class="cost-row is-dim" key={id}>
              <div class="cost-name">
                <Avatar id={id} />
                <div class="cost-title">
                  <span class="name">{label}</span>
                  <span class="chip chip-muted">데이터 없음</span>
                </div>
              </div>
            </div>
          );
        }

        const ok = snap.status === 'ok';
        const dim = !ok || isStaleData(snap, settings);
        const day = windowByKind(snap.windows, 'day');
        const week = windowByKind(snap.windows, 'week');
        const month = windowByKind(snap.windows, 'month');
        const tag = snap.windows.some((w) => w.periodTz === 'UTC')
          ? 'UTC'
          : snap.windows.some((w) => w.unit === 'points')
            ? 'pt'
            : '';

        return (
          <div class={`cost-row${dim ? ' is-dim' : ''}`} key={id}>
            <div class="cost-name">
              <Avatar id={id} />
              <div class="cost-title">
                <span class="name-line">
                  <span class="name">{label}</span>
                  {ok && tag && <span class="tag">{tag}</span>}
                </span>
                {!ok && (
                  <span class={`chip chip-${snap.status}`} title={`마지막 성공 ${formatAgo(snap.fetchedAt, now)}`}>
                    {STATUS_LABELS[snap.status] ?? snap.status}
                  </span>
                )}
              </div>
            </div>
            <span class="num">{formatAmount(day)}<Partial w={day} /></span>
            <span class="num">{formatAmount(week)}<Partial w={week} /></span>
            <span class="num">{formatAmount(month)}<Partial w={month} /></span>
            <Remaining snap={snap} warn={warnPercent} crit={criticalPercent} />
          </div>
        );
      })}
      {anyPartial && <div class="footnote">* 부분 데이터 (설치 이후 누적분)</div>}
    </section>
  );
}
