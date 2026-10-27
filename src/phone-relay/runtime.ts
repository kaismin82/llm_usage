import { getSettings, getSnapshots, STORAGE_KEYS } from '../core/store';
import { createCustomStore, CUSTOM_PROVIDERS_KEY } from '../custom/store';
import { buildPhonePayload } from './payload';
import { createRelaySender } from './sender';
import {
  getRelayConfig, getRelayStatus, isPhoneRelayMessage,
  RELAY_ALARM, RELAY_CONFIG_KEY, RELAY_ORIGIN, RELAY_STATUS_KEY,
} from './store';

export function registerPhoneRelay(): void {
  const customStore = createCustomStore();
  const sender = createRelaySender({
    getConfig: getRelayConfig,
    getPayload: async () => {
      const [settings, snapshots, custom] = await Promise.all([
        getSettings(), getSnapshots(), customStore.getProviders(),
      ]);
      return buildPhonePayload(settings, snapshots, custom, await customStore.getSnapshots(custom), new Date());
    },
    hasPermission: () => chrome.permissions.contains({ origins: [RELAY_ORIGIN] }),
    recordStatus: async (status) => {
      const previous = await getRelayStatus();
      await chrome.storage.local.set({
        [RELAY_STATUS_KEY]: {
          attemptedAt: status.attemptedAt,
          lastSuccessAt: status.lastSuccessAt ?? previous?.lastSuccessAt,
          result: status.result,
          httpStatus: status.httpStatus,
        },
      });
    },
    now: () => new Date(),
    fetchImpl: (input, init) => fetch(input, init),
  });
  let alarmUpdate = Promise.resolve();
  const configure = () => {
    alarmUpdate = alarmUpdate.then(async () => {
      const config = await getRelayConfig();
      if (config.enabled) {
        const alarm = await chrome.alarms.get(RELAY_ALARM);
        if (!alarm) await chrome.alarms.create(RELAY_ALARM, { periodInMinutes: 1 });
      } else {
        await chrome.alarms.clear(RELAY_ALARM);
      }
    }).catch(() => undefined);
    void sender.send();
  };
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    if (RELAY_CONFIG_KEY in changes) {
      sender.invalidate();
      configure();
    } else if (Object.keys(changes).some((key) =>
      key === STORAGE_KEYS.settings || key === STORAGE_KEYS.snapshots ||
      key === CUSTOM_PROVIDERS_KEY || key.startsWith('customSnapshot:'))) {
      if (STORAGE_KEYS.settings in changes || CUSTOM_PROVIDERS_KEY in changes) sender.invalidate();
      void sender.send();
    }
  });
  chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === RELAY_ALARM) void sender.send();
  });
  chrome.runtime.onMessage.addListener((message: unknown, _sender, sendResponse) => {
    if (!isPhoneRelayMessage(message)) return;
    void sender.send().then(() => sendResponse({ ok: true }));
    return true;
  });
  chrome.runtime.onInstalled.addListener(configure);
  chrome.runtime.onStartup.addListener(configure);
  // Service workers may be started by storage/messages rather than browser startup.
  configure();
}
