import { createContextFactory } from '../core/context';
import { createPresenter } from '../core/presenter';
import { ADAPTERS } from '../core/registry';
import { dueProviders, parseResetAlarm, runProviders } from '../core/scheduler';
import type { ScheduleState, SchedulerDeps } from '../core/scheduler';
import {
  appendEvents,
  getSettings,
  getSnapshots,
  saveSnapshot,
} from '../core/store';
import type { ExtensionMessage } from '../core/store';
import { PROVIDER_IDS } from '../providers/types';
import type { ProviderId } from '../providers/types';
import { isCustomMessage } from '../custom/config';
import { registerCustomProviders } from '../custom/runtime';
import { selectRefreshTargets } from '../core/refresh-policy';
import { configureIdleDetection, isUserIdle, onUserActive } from '../core/idle';
import { registerPhoneRelay } from '../phone-relay/runtime';
import { isPhoneRelayMessage } from '../phone-relay/store';

const SCHEDULE_KEY = 'schedule';
const TICK_ALARM = 'tick';
const TAB_RETRY_MS = 300_000;

async function getScheduleState(): Promise<ScheduleState> {
  const stored = await chrome.storage.local.get(SCHEDULE_KEY);
  return (stored[SCHEDULE_KEY] as ScheduleState | undefined) ?? {};
}

async function saveScheduleState(update: ScheduleState): Promise<void> {
  const current = await getScheduleState();
  await chrome.storage.local.set({ [SCHEDULE_KEY]: { ...current, ...update } });
}

const contextFactory = createContextFactory();

const deps: SchedulerDeps = {
  now: () => new Date(),
  getSettings,
  getSnapshots,
  saveSnapshot,
  appendEvents,
  getState: getScheduleState,
  setState: saveScheduleState,
  adapters: ADAPTERS,
  makeContext: contextFactory,
  hasOrigins: (origins) => chrome.permissions.contains({ origins }),
  scheduleAlarm: async (name, whenMs) => {
    await chrome.alarms.create(name, { when: whenMs });
  },
  present: createPresenter(),
};

const inFlight = new Map<ProviderId, Promise<void>>();

function runProvider(id: ProviderId, opts: { force?: boolean } = {}): Promise<void> {
  const queued = (inFlight.get(id) ?? Promise.resolve()).then(
    () => undefined,
    () => undefined,
  );
  const run = queued.then(() => runProviders([id], deps, opts));
  inFlight.set(id, run);
  void run
    .catch(() => undefined)
    .finally(() => {
      if (inFlight.get(id) === run) inFlight.delete(id);
    });
  return run;
}

function runAll(ids: ProviderId[], opts: { force?: boolean } = {}): Promise<void> {
  // Sequential: concurrent runProviders instances each read schedule state and
  // write the whole map, so parallel finishes clobber other providers' entries.
  return (async () => {
    for (const id of ids) await runProvider(id, opts);
  })().then(() => undefined);
}

async function runDue(): Promise<void> {
  const [settings, state, snapshots] = await Promise.all([getSettings(), getScheduleState(), getSnapshots()]);
  // Recover session-auth states persisted by versions that paused them indefinitely.
  const pausedSessions = PROVIDER_IDS.filter((id) =>
    (id === 'claude' || id === 'chatgpt') && settings.providers[id].enabled &&
    state[id]?.nextDueAt === null && snapshots[id]?.status === 'auth_required',
  );
  if (pausedSessions.length > 0) await runAll(pausedSessions, { force: true });
  await runAll(dueProviders(settings, state, snapshots, new Date()));
}

async function ensureTickAlarm(): Promise<void> {
  const alarm = await chrome.alarms.get(TICK_ALARM);
  // Sub-minute tick so 1-minute provider intervals are refreshed promptly.
  if (!alarm) await chrome.alarms.create(TICK_ALARM, { periodInMinutes: 0.5 });
  await runDue();
}

async function runUnlessIdle(run: () => Promise<void>): Promise<void> {
  if (!(await isUserIdle())) await run();
}

function providerForTab(url: string | undefined): ProviderId | null {
  if (!url) return null;
  let host: string;
  try {
    host = new URL(url).hostname;
  } catch {
    return null;
  }
  if (host === 'claude.ai') return 'claude';
  if (host === 'chatgpt.com') return 'chatgpt';
  return null;
}

// Dock the dashboard in Chrome's side panel (right side by default) instead of a popup.
function enableSidePanel(): void {
  void chrome.sidePanel?.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => undefined);
}

chrome.runtime.onInstalled.addListener(() => {
  enableSidePanel();
  void ensureTickAlarm();
});

chrome.runtime.onStartup.addListener(() => {
  enableSidePanel();
  void ensureTickAlarm();
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === TICK_ALARM) {
    // Scheduled collection must keep running while the browser is unattended;
    // the phone relay depends on it. The idle gate stays only on reset alarms.
    void runDue();
    return;
  }
  if (alarm.name.startsWith('reset:')) {
    const provider = parseResetAlarm(alarm.name);
    if (provider !== null) void runUnlessIdle(() => runProvider(provider, { force: true }));
  }
});

chrome.runtime.onMessage.addListener((message: ExtensionMessage, _sender, sendResponse) => {
  if (isCustomMessage(message) || isPhoneRelayMessage(message)) return;
  if (message.type === 'refresh') {
    void (async () => {
      const [settings, snapshots] = await Promise.all([getSettings(), getSnapshots()]);
      const targets = selectRefreshTargets(message, settings, snapshots, Date.now());
      await runAll(targets as ProviderId[], { force: true });
      sendResponse({ ok: true });
    })();
    return true;
  }
  void (async () => {
    const [settings, state, snapshots] = await Promise.all([
      getSettings(),
      getScheduleState(),
      getSnapshots(),
    ]);
    const resumed: ScheduleState = {};
    for (const id of PROVIDER_IDS) {
      const entry = state[id];
      if (entry === undefined) continue;
      if (settings.providers[id].enabled && entry.nextDueAt === null) continue;
      resumed[id] = entry;
    }
    await chrome.storage.local.set({ [SCHEDULE_KEY]: resumed });
    const due = new Set(dueProviders(settings, resumed, snapshots, new Date()));
    for (const id of PROVIDER_IDS) {
      if (settings.providers[id].enabled && snapshots[id] === undefined) due.add(id);
    }
    await runAll([...due]);
  })();
});

const tabPollAt = new Map<ProviderId, number>();

chrome.tabs.onUpdated.addListener((_tabId, changeInfo, tab) => {
  if (changeInfo.status !== 'complete') return;
  const provider = providerForTab(tab.url);
  if (provider === null) return;
  void (async () => {
    const [settings, snapshots] = await Promise.all([getSettings(), getSnapshots()]);
    if (!settings.providers[provider].enabled) return;
    const snapshot = snapshots[provider];
    if (snapshot === undefined) return;
    // Never retry a challenge on page load: that would add requests while blocked.
    if (snapshot.status !== 'auth_required') return;
    const now = Date.now();
    if (now - (tabPollAt.get(provider) ?? 0) < TAB_RETRY_MS) return;
    tabPollAt.set(provider, now);
    await runProvider(provider, { force: true });
  })();
});

chrome.permissions.onAdded.addListener(() => {
  void runDue();
});

configureIdleDetection();
onUserActive(() => {
  void runDue();
});

registerCustomProviders();
registerPhoneRelay();
