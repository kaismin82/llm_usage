import type { PhonePayload } from './payload';
import { RELAY_ENDPOINT, type RelayConfig, type RelayStatus } from './store';

export const RELAY_TIMEOUT_MS = 5000;

type RelayDependencies = {
  getConfig(): Promise<RelayConfig>;
  getPayload(): Promise<PhonePayload>;
  hasPermission(): Promise<boolean>;
  recordStatus(status: RelayStatus): Promise<void>;
  now(): Date;
  fetchImpl: typeof fetch;
};

// This queue never invokes collection and never exposes transport failures to its callers.
export function createRelaySender(deps: RelayDependencies) {
  let pending = false;
  let running: Promise<void> | undefined;
  let generation = 0;
  let active: AbortController | undefined;
  let lastSuccessAt: string | undefined;

  const drain = async () => {
    while (pending) {
      pending = false;
      const current = generation;
      const attemptedAt = deps.now().toISOString();
      let timer: ReturnType<typeof setTimeout> | undefined;
      let result: RelayStatus['result'] = 'unavailable';
      let httpStatus: number | undefined;
      try {
        const config = await deps.getConfig();
        if (current !== generation || !config.enabled) continue;
        if (!config.writeToken.trim()) {
          result = 'not_configured';
        } else if (!(await deps.hasPermission())) {
          result = 'permission_missing';
        } else {
          const payload = await deps.getPayload();
          if (current !== generation) continue;
          // Re-read after asynchronous snapshot loading, including saves not yet observed by the listener.
          const latest = await deps.getConfig();
          if (current !== generation || !latest.enabled || latest.writeToken !== config.writeToken) continue;
          const controller = new AbortController();
          active = controller;
          timer = setTimeout(() => controller.abort(), RELAY_TIMEOUT_MS);
          const response = await deps.fetchImpl(RELAY_ENDPOINT, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.writeToken}` },
            body: JSON.stringify(payload),
            credentials: 'omit',
            redirect: 'error',
            cache: 'no-store',
            signal: controller.signal,
          });
          result = response.ok ? 'ok' : 'http_error';
          httpStatus = response.status;
          // Never read response text: relay errors may contain credentials or request data.
          await response.body?.cancel();
        }
      } catch {
        result = 'unavailable';
      } finally {
        if (timer !== undefined) clearTimeout(timer);
        active = undefined;
      }
      if (current !== generation) continue;
      if (result === 'ok') lastSuccessAt = deps.now().toISOString();
      await deps.recordStatus({ attemptedAt, lastSuccessAt, result, httpStatus }).catch(() => undefined);
    }
  };

  const send = (): Promise<void> => {
    pending = true;
    if (!running) {
      running = drain().catch(() => undefined).finally(() => {
        running = undefined;
        if (pending) return send();
      });
    }
    return running;
  };
  return {
    invalidate() {
      generation += 1;
      active?.abort();
    },
    send,
  };
}
