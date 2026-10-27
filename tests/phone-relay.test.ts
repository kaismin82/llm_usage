import { afterEach, describe, expect, it, vi } from 'vitest';
import { defaultSettings } from '../src/core/settings';
import { baseSnapshot } from '../src/providers/util';
import { buildPhonePayload, type PhonePayload } from '../src/phone-relay/payload';
import { createRelaySender, RELAY_TIMEOUT_MS } from '../src/phone-relay/sender';
import { defaultRelayConfig, RELAY_ENDPOINT, type RelayConfig, type RelayStatus } from '../src/phone-relay/store';
import { customConfig } from './custom-ui-helpers';

const NOW = new Date('2026-10-25T12:00:00Z');
const payload: PhonePayload = { version: 1, sentAt: NOW.toISOString(), providers: [] };

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

function setup() {
  let config: RelayConfig = { enabled: true, writeToken: 'relay-only-token' };
  const statuses: RelayStatus[] = [];
  const fetchImpl = vi.fn<typeof fetch>(async () => new Response(null, { status: 204 }));
  const getPayload = vi.fn(async () => payload);
  const hasPermission = vi.fn(async () => true);
  const sender = createRelaySender({
    getConfig: async () => ({ ...config }), getPayload, hasPermission, fetchImpl,
    recordStatus: async (status) => { statuses.push(status); }, now: () => NOW,
  });
  return { sender, fetchImpl, getPayload, hasPermission, statuses, setConfig: (next: RelayConfig) => { config = next; } };
}

describe('phone relay payload whitelist', () => {
  it('selects enabled saved observations and all supported usage fields without secrets or invented zeros', () => {
    const settings = defaultSettings();
    settings.providers.chatgpt = { ...settings.providers.chatgpt, enabled: true, apiKey: 'SECRET-API', accountId: 'SECRET-ACCOUNT' };
    const snapshot = {
      ...baseSnapshot('chatgpt', NOW), plan: 'SECRET-PLAN', account: 'SECRET-ACCOUNT',
      status: 'stale' as const, fetchedAt: '2026-10-24T12:00:00Z',
      error: { code: 'error', message: 'SECRET-ERROR' },
      windows: [{
        kind: 'month' as const, label: 'Monthly', unit: 'credits' as const, usedAmount: 2,
        resetsAt: null, windowSeconds: 60, periodTz: 'UTC' as const, partial: true,
        secret: 'SECRET-WINDOW',
      }],
      grants: [{
        provider: 'chatgpt' as const, idHash: 'SECRET-GRANT', title: 'SECRET-TITLE',
        scope: 'all' as const, remaining: 1, status: 'available' as const,
        startsAt: null, expiresAt: '2026-11-01T00:00:00Z', countOnly: true,
      }],
      extraCredits: { unit: 'credits' as const, balanceAmount: -2, unlimited: false, isEnabled: true, secret: 'SECRET-EXTRA' },
      balance: { amount: 4, unit: 'usd' as const, limit: 10, label: 'Balance', resetsAt: null, secret: 'SECRET-BALANCE' },
    };
    const custom = { ...customConfig, endpoint: 'https://SECRET-ENDPOINT', apiKey: 'SECRET-CUSTOM' };
    const result = JSON.parse(JSON.stringify(buildPhonePayload(settings, {
      chatgpt: snapshot, claude: baseSnapshot('claude', NOW),
    }, [custom, { ...custom, id: 'disabled', enabled: false }], {
      [custom.id]: { ...baseSnapshot('claude', NOW), provider: custom.id, windows: [{ kind: 'budget', label: 'Unknown', unit: 'tokens' }] },
      disabled: { ...baseSnapshot('claude', NOW), provider: 'disabled' },
    }, NOW))) as PhonePayload;
    expect(result.providers.map((p) => p.id)).toEqual(['chatgpt', custom.id]);
    expect(JSON.stringify(result)).not.toContain('SECRET');
    expect(result.sentAt).toBe(NOW.toISOString());
    expect(result.providers[0]).toMatchObject({
      status: 'stale', fetchedAt: snapshot.fetchedAt,
      extraCredits: { unit: 'credits', balanceAmount: -2, unlimited: false, isEnabled: true },
      windows: [{ kind: 'month', usedAmount: 2, resetsAt: null, windowSeconds: 60, periodTz: 'UTC', partial: true }],
      grants: [{ scope: 'all', remaining: 1, status: 'available', startsAt: null, countOnly: true }],
      balance: { amount: 4, unit: 'usd', limit: 10, label: 'Balance', resetsAt: null },
    });
    expect(result.providers[0].windows[0]).not.toHaveProperty('limitAmount');
    expect(result.providers[1].windows[0]).not.toHaveProperty('usedAmount');
  });
});

describe('isolated relay sender', () => {
  afterEach(() => vi.useRealTimers());

  it('defaults off and performs no permission, payload or network work while disabled', async () => {
    const env = setup();
    expect(defaultRelayConfig()).toEqual({ enabled: false, writeToken: '' });
    env.setConfig(defaultRelayConfig());
    await env.sender.send();
    expect(env.hasPermission).not.toHaveBeenCalled();
    expect(env.getPayload).not.toHaveBeenCalled();
    expect(env.fetchImpl).not.toHaveBeenCalled();
    expect(env.statuses).toEqual([]);
  });

  it('uses only the fixed loopback endpoint, dedicated token and isolated transport policy', async () => {
    const env = setup();
    await env.sender.send();
    expect(env.fetchImpl).toHaveBeenCalledWith(RELAY_ENDPOINT, expect.objectContaining({
      method: 'POST', redirect: 'error', credentials: 'omit', cache: 'no-store',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer relay-only-token' },
      body: JSON.stringify(payload), signal: expect.any(AbortSignal),
    }));
    expect(env.statuses).toEqual([{ attemptedAt: NOW.toISOString(), lastSuccessAt: NOW.toISOString(), result: 'ok', httpStatus: 204 }]);
  });

  it('serializes and coalesces requests while loading the latest payload again', async () => {
    const env = setup();
    const started = deferred<void>();
    const response = deferred<Response>();
    env.fetchImpl.mockImplementationOnce(() => { started.resolve(); return response.promise; });
    const first = env.sender.send();
    await started.promise;
    const queued = [env.sender.send(), env.sender.send(), env.sender.send()];
    expect(env.fetchImpl).toHaveBeenCalledOnce();
    env.getPayload.mockResolvedValue({ ...payload, sentAt: '2026-10-25T12:01:00Z' });
    response.resolve(new Response(null, { status: 204 }));
    await Promise.all([first, ...queued]);
    expect(env.fetchImpl).toHaveBeenCalledTimes(2);
    expect(JSON.parse(env.fetchImpl.mock.calls[1][1]!.body as string).sentAt).toBe('2026-10-25T12:01:00Z');
  });

  it('aborts an active send and drops queued sends and stale status after disabling', async () => {
    const env = setup();
    const started = deferred<AbortSignal>();
    env.fetchImpl.mockImplementationOnce((_url, init) => new Promise((_resolve, reject) => {
      const signal = init!.signal!;
      signal.addEventListener('abort', () => reject(new Error('SECRET-ABORT')), { once: true });
      started.resolve(signal);
    }));
    const first = env.sender.send();
    const signal = await started.promise;
    env.sender.send();
    env.setConfig(defaultRelayConfig());
    env.sender.invalidate();
    await first;
    expect(signal.aborted).toBe(true);
    expect(env.fetchImpl).toHaveBeenCalledOnce();
    expect(env.statuses).toEqual([]);
  });

  it('rechecks saved configuration after asynchronous payload loading even without an event', async () => {
    const env = setup();
    env.getPayload.mockImplementationOnce(async () => {
      env.setConfig(defaultRelayConfig());
      return payload;
    });
    await env.sender.send();
    expect(env.fetchImpl).not.toHaveBeenCalled();
  });

  it('bounds transport time and records only a safe failure code', async () => {
    vi.useFakeTimers();
    const env = setup();
    const started = deferred<void>();
    env.fetchImpl.mockImplementation((_url, init) => new Promise((_resolve, reject) => {
      init!.signal!.addEventListener('abort', () => reject(new Error('SECRET-TOKEN')), { once: true });
      started.resolve();
    }));
    const sent = env.sender.send();
    await started.promise;
    await vi.advanceTimersByTimeAsync(RELAY_TIMEOUT_MS);
    await sent;
    expect(env.statuses).toEqual([{ attemptedAt: NOW.toISOString(), result: 'unavailable' }]);
  });

  it('records HTTP failure without reading the response body and remains usable', async () => {
    const env = setup();
    env.fetchImpl.mockResolvedValueOnce(new Response('SECRET-RESPONSE', { status: 401 }));
    await env.sender.send();
    expect(env.statuses[0]).toMatchObject({ result: 'http_error', httpStatus: 401 });
    expect(JSON.stringify(env.statuses)).not.toContain('SECRET');
    await env.sender.send();
    expect(env.statuses[1].result).toBe('ok');
  });

  it('contains storage and transport failures without rejecting', async () => {
    const sender = createRelaySender({
      getConfig: async () => { throw new Error('SECRET-STORAGE'); },
      getPayload: async () => payload, hasPermission: async () => true, fetchImpl: vi.fn(),
      recordStatus: async () => { throw new Error('SECRET-WRITE'); }, now: () => NOW,
    });
    await expect(sender.send()).resolves.toBeUndefined();
  });

  it('does not send without a token or host permission', async () => {
    const env = setup();
    env.setConfig({ enabled: true, writeToken: '' });
    await env.sender.send();
    expect(env.statuses[0].result).toBe('not_configured');
    env.setConfig({ enabled: true, writeToken: 'dedicated' });
    env.hasPermission.mockResolvedValue(false);
    await env.sender.send();
    expect(env.statuses[1].result).toBe('permission_missing');
    expect(env.fetchImpl).not.toHaveBeenCalled();
  });
});
