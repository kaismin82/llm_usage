import { useEffect, useState, useCallback, useRef } from 'preact/hooks';
import type {
  AppSettings,
  ProviderId,
  ProviderSnapshot,
  ResetEvent,
  UsageWindow,
} from '../providers/types';
import { PROVIDER_IDS } from '../providers/types';
import { defaultSettings } from '../core/settings';
import {
  getSettings,
  getSnapshots,
  getEvents,
  onStoreChange,
  requestRefresh,
  type SnapshotMap,
} from '../core/store';
import {
  formatRelative,
  formatAbsolute,
  formatAgo,
  formatPoints,
  formatUsd,
  percentTone,
  availableGrantCount,
  nextGrantExpiry,
  STATUS_LABELS,
  PROVIDER_LABELS,
} from './format';
import { GrantBanner } from './components/GrantBanner';
import { SubscriptionCard } from './components/SubscriptionCard';
import { CostTable } from './components/CostTable';
import { CustomProviderCards } from './components/CustomProviderCards';
import { useCustomData } from '../custom/use-data';
import { requestCustomRefresh } from '../custom/store';

const STALE_THRESHOLD_MS = 30_000;
const SUBSCRIPTION_IDS: ProviderId[] = ['claude', 'chatgpt', 'zai'];
const COST_IDS: ProviderId[] = ['openrouter', 'litellm', 'poe'];

export function App() {
  const [settings, setSettings] = useState<AppSettings>(defaultSettings);
  const [snapshots, setSnapshots] = useState<SnapshotMap>({});
  const [events, setEvents] = useState<ResetEvent[]>([]);
  const [now, setNow] = useState(() => new Date());
  const [loaded, setLoaded] = useState(false);
  const refreshedOnOpen = useRef(false);
  const custom = useCustomData();
  const [customRefreshError, setCustomRefreshError] = useState('');

  const load = useCallback(async () => {
    const [s, sn, ev] = await Promise.all([getSettings(), getSnapshots(), getEvents()]);
    setSettings(s);
    setSnapshots(sn);
    setEvents(ev);
  }, []);

  useEffect(() => {
    let mounted = true;
    const doLoad = async () => {
      await load();
      if (!mounted) return;
      setNow(new Date());
      setLoaded(true);
    };
    doLoad();
    const unsub = onStoreChange(() => {
      if (mounted) doLoad();
    });
    const timer = setInterval(() => {
      if (mounted) setNow(new Date());
    }, 15_000);
    return () => {
      mounted = false;
      unsub();
      clearInterval(timer);
    };
  }, [load]);

  useEffect(() => {
    if (!loaded || refreshedOnOpen.current) return;
    refreshedOnOpen.current = true;
    const openedAt = Date.now();
    for (const id of PROVIDER_IDS) {
      if (!settings.providers[id].enabled) continue;
      const snap = snapshots[id];
      if (!snap || openedAt - Date.parse(snap.attemptedAt) > STALE_THRESHOLD_MS) {
        void requestRefresh(id);
      }
    }
  }, [loaded, settings, snapshots]);

  const enabledSub = SUBSCRIPTION_IDS.filter((id) => settings.providers[id].enabled);
  const enabledCost = COST_IDS.filter((id) => settings.providers[id].enabled);
  const anyEnabled = enabledSub.length > 0 || enabledCost.length > 0 || custom.providers.some((p) => p.enabled);

  const allGrantSnapshots = enabledSub
    .map((id) => snapshots[id])
    .filter((s): s is ProviderSnapshot => s != null && availableGrantCount(s) > 0);

  const recentEvent = events
    .filter((e) => now.getTime() - Date.parse(e.at) < 24 * 60 * 60_000)
    .at(-1);

  const oldestFetch = Object.values(snapshots)
    .filter((s): s is ProviderSnapshot => s != null)
    .reduce<string | null>((oldest, s) => {
      if (!oldest) return s.fetchedAt;
      return Date.parse(s.fetchedAt) > Date.parse(oldest) ? oldest : s.fetchedAt;
    }, null);

  const handleRefresh = () => {
    requestRefresh();
    setCustomRefreshError('');
    if (custom.providers.some((p) => p.enabled)) {
      void requestCustomRefresh().catch((cause: unknown) => {
        setCustomRefreshError(cause instanceof Error ? 'Custom provider 갱신에 실패했습니다' : '백그라운드 응답 없음');
      });
    }
  };
  const handleSettings = () => { chrome.runtime.openOptionsPage(); };

  return (
    <div class="popup">
      <header class="hdr">
        <span class="logo" aria-hidden="true" />
        <h1 class="title">LLM Usage</h1>
        {oldestFetch && <span class="updated">{formatAgo(oldestFetch, now)} 갱신</span>}
        <button class="icon-btn" onClick={handleRefresh} aria-label="새로고침" title="새로고침">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M21 12a9 9 0 1 1-2.64-6.36" />
            <path d="M21 3v6h-6" />
          </svg>
        </button>
        <button class="icon-btn" onClick={handleSettings} aria-label="설정" title="설정">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0" />
            <circle cx="16" cy="6" r="2" />
            <circle cx="10" cy="12" r="2" />
            <circle cx="18" cy="18" r="2" />
          </svg>
        </button>
      </header>

      {!anyEnabled && (
        <div class="empty">
          <p>활성화된 프로바이더가 없습니다.</p>
          <button class="link-btn" onClick={handleSettings}>
            설정하기
          </button>
        </div>
      )}

      {allGrantSnapshots.length > 0 && (
        <GrantBanner snapshots={allGrantSnapshots} recentEvent={recentEvent} now={now} />
      )}

      {enabledSub.length > 0 && (
        <section>
          {enabledSub.map((id) => (
            <SubscriptionCard
              key={id}
              snapshot={snapshots[id]}
              providerId={id}
              settings={settings}
              now={now}
            />
          ))}
        </section>
      )}

      {enabledCost.length > 0 && (
        <section>
          <CostTable
            providerIds={enabledCost}
            snapshots={snapshots}
            settings={settings}
            now={now}
          />
        </section>
      )}
      <CustomProviderCards providers={custom.providers} snapshots={custom.snapshots} now={now} settings={settings} />
      {(custom.error || customRefreshError) && <p class="custom-error" role="alert">{custom.error || customRefreshError}</p>}
    </div>
  );
}
