import type { ProviderSnapshot, ResetEvent } from '../../providers/types';
import {
  availableGrantCount,
  nextGrantExpiry,
  formatShortDate,
  PROVIDER_LABELS,
} from '../format';

interface Props {
  snapshots: ProviderSnapshot[];
  recentEvent: ResetEvent | undefined;
  now: Date;
}

const EVENT_LABELS: Record<string, string> = {
  GRANT_ADDED: '새 리셋권',
  GRANT_USED: '리셋권 사용됨',
  GRANT_EXPIRING: '만료 임박',
  GRANT_EXPIRED: '리셋권 만료',
  WINDOW_RESET_EARLY: '조기 리셋 감지',
};

export function GrantBanner({ snapshots, recentEvent }: Props) {
  const total = snapshots.reduce((sum, sn) => sum + availableGrantCount(sn), 0);
  if (total === 0) return null;

  return (
    <div class="banner" role="status">
      <span class="banner-star" aria-hidden="true">★</span>
      <span class="banner-title">리셋권 {total}개</span>
      <span class="banner-pills">
        {snapshots.map((sn) => {
          const expiry = nextGrantExpiry(sn);
          return (
            <span class="pill" key={sn.provider} title={expiry ? `${formatShortDate(expiry)} 만료` : undefined}>
              {PROVIDER_LABELS[sn.provider] ?? sn.provider}
              {availableGrantCount(sn) > 1 && ` ×${availableGrantCount(sn)}`}
              {expiry && <em>~{formatShortDate(expiry)}</em>}
            </span>
          );
        })}
      </span>
      {recentEvent && <span class="banner-event">{EVENT_LABELS[recentEvent.type] ?? recentEvent.type}</span>}
    </div>
  );
}
