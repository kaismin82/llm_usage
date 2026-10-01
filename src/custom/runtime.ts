import { isCustomMessage } from './config';
import { createCustomRunner } from './runner';
import { createCustomStore } from './store';

export function registerCustomProviders(): void {
  const runner = createCustomRunner({
    store: createCustomStore(),
    now: () => new Date(),
    hasOrigin: (origin) => chrome.permissions.contains({ origins: [origin] }),
  });
  chrome.runtime.onMessage.addListener((message: unknown, _sender, sendResponse) => {
    if (!isCustomMessage(message)) return;
    void runner.run(message.id, true).then(
      () => sendResponse({ ok: true }),
      (error: unknown) => sendResponse({ ok: false, error: error instanceof Error ? error.name : 'error' }),
    );
    return true;
  });
  chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === 'tick') void runner.run();
  });
  chrome.runtime.onInstalled.addListener(() => { void runner.run(); });
  chrome.runtime.onStartup.addListener(() => { void runner.run(); });
  chrome.permissions.onAdded.addListener(() => { void runner.run(undefined, true); });
}
