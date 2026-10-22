import { describe, expect, it } from 'vitest';
import { makeCtx } from './helpers';
import type { RouteReply } from './helpers';
import { zaiAdapter } from '../src/providers/zai';
import type { ProviderSnapshot } from '../src/providers/types';
import { availableGrantCount, detectResetEvents } from '../src/core/reset-detector';

const quota = { success: true, data: { level: 'PRO', limits: [
  { type: 'TIME_LIMIT', unit: 5, currentValue: 38, usage: 100 },
  { type: 'TOKENS_LIMIT', unit: 6, percentage: 20, nextResetTime: 1791500000000 },
  { type: 'TOKENS_LIMIT', unit: 3, percentage: 47, nextResetTime: 1791480000000 },
] } };

const previous: ProviderSnapshot = {
  provider: 'zai', status: 'ok', grantSupport: 'supported',
  windows: [{ kind: 'session_5h', label: '5시간', unit: 'percent', usedPercent: 90 }],
  grants: [{ provider: 'zai', idHash: 'known-reset', scope: 'session_5h', remaining: 1, status: 'available', expiresAt: '2026-11-07T15:59:59.000Z' }],
  fetchedAt: '2026-10-01T11:00:00.000Z', attemptedAt: '2026-10-01T11:00:00.000Z',
};

const unavailableInventories: readonly RouteReply[] = [
  { status: 500 },
  { json: { success: false } },
  { json: { success: true } },
  { json: { success: true, data: { fiveHourResets: [] } } },
  { json: { success: true, data: { fiveHourResets: {}, weekResets: [] } } },
  { json: { success: true, data: { fiveHourResets: [{ recordId: 1 }], weekResets: [] } } },
  { json: { success: true, data: { fiveHourResets: [{ recordId: null, available: true }], weekResets: [] } } },
];

describe('zaiAdapter', () => {
  it.each(unavailableInventories)('preserves known inventory and fresh quota when reset inventory is unavailable: %j', async (reply) => {
    // Given
    const ctx = makeCtx({ provider: 'zai', providerSettings: { apiKey: 'private-key' }, previous, routes: [
      { match: 'quota/limit', reply: { json: quota } },
      { match: 'customer-package-reset/list', reply },
    ] });
    // When
    const result = await zaiAdapter.fetchSnapshot(ctx);
    // Then
    expect(result).toMatchObject({ status: 'stale', grants: previous.grants, grantSupport: 'supported', fetchedAt: previous.fetchedAt, attemptedAt: ctx.now().toISOString() });
    expect(result.windows.map((entry) => entry.usedPercent)).toEqual([38, 20, 47]);
    expect(result.error?.code).toBeTruthy();
    expect(result.error?.message).toBeTruthy();
    expect(result.error?.message).not.toContain('private-key');
    expect(detectResetEvents(previous, result, ctx.now())).toEqual([]);
  });

  it.each(unavailableInventories)('does not call unavailable inventory authoritative empty without previous inventory: %j', async (reply) => {
    // Given
    const ctx = makeCtx({ provider: 'zai', providerSettings: { apiKey: 'k' }, routes: [
      { match: 'quota/limit', reply: { json: quota } },
      { match: 'customer-package-reset/list', reply },
    ] });
    // When
    const result = await zaiAdapter.fetchSnapshot(ctx);
    // Then
    expect(result).toMatchObject({ status: 'ok', grants: [], grantSupport: 'unsupported' });
    expect(result.windows).toHaveLength(3);
  });

  it('retains known inventory and fresh quota when the reset request rejects', async () => {
    // Given
    const ctx = makeCtx({ provider: 'zai', providerSettings: { apiKey: 'private-key' }, previous, routes: [
      { match: 'quota/limit', reply: { json: quota } },
      { match: 'customer-package-reset/list', reply: () => { throw new TypeError('request failed: private-key'); } },
    ] });
    // When
    const result = await zaiAdapter.fetchSnapshot(ctx);
    // Then
    expect(result).toMatchObject({ status: 'stale', grants: previous.grants, grantSupport: 'supported' });
    expect(result.windows.map((entry) => entry.usedPercent)).toEqual([38, 20, 47]);
    expect(result.error?.message).toBeTruthy();
    expect(result.error?.message).not.toContain('private-key');
  });

  it.each([false, true])('detects consumed count after successful reset inventory refresh (removed: %s)', async (removed) => {
    // Given
    const routes = [{ match: 'quota/limit', reply: { json: quota } }];
    const record = { recordId: 910002, expireTime: '2026-11-07 23:59:59', available: true };
    const known = await zaiAdapter.fetchSnapshot(makeCtx({ provider: 'zai', providerSettings: { apiKey: 'k' }, routes: [
      ...routes, { match: 'customer-package-reset/list', reply: { json: { success: true, data: { fiveHourResets: [record], weekResets: [] } } } },
    ] }));
    const ctx = makeCtx({ provider: 'zai', providerSettings: { apiKey: 'k' }, previous: { ...known, status: 'stale' }, routes: [
      ...routes, { match: 'customer-package-reset/list', reply: { json: { success: true, data: { fiveHourResets: removed ? [] : [{ ...record, available: false }], weekResets: [] } } } },
    ] });
    // When
    const result = await zaiAdapter.fetchSnapshot(ctx);
    // Then
    expect(availableGrantCount(known)).toBe(1);
    expect(availableGrantCount(result)).toBe(0);
    expect(result).toMatchObject({ status: 'ok', grantSupport: 'supported' });
    expect(result.grants).toHaveLength(removed ? 0 : 1);
    expect(detectResetEvents(ctx.previous, result, ctx.now()).map((entry) => entry.type)).toEqual(['GRANT_USED']);
  });

  it('maps quota and reset packs independent of array order', async () => {
    const ctx = makeCtx({ provider: 'zai', providerSettings: { apiKey: 'secret' }, routes: [
      { match: 'quota/limit', reply: { json: quota } },
      { match: 'customer-package-reset/list', reply: { json: { success: true, data: { fiveHourResets: [{ recordId: 910002, expireTime: '2026-11-07 23:59:59', available: true }], weekResets: [] } } } },
    ] });
    const result = await zaiAdapter.fetchSnapshot(ctx);
    expect(result.status).toBe('ok');
    expect(result.plan).toBe('PRO');
    expect(result.windows.map((w) => w.kind)).toEqual(['monthly_tool', 'weekly_7d', 'session_5h']);
    expect(result.windows[0].usedPercent).toBe(38);
    expect(result.grantSupport).toBe('supported');
    expect(result.grants[0]).toMatchObject({ scope: 'session_5h', remaining: 1, expiresAt: '2026-11-07T15:59:59.000Z', status: 'available' });
    expect(ctx.calls).toHaveLength(2);
    expect(ctx.calls[0].init).toMatchObject({ credentials: 'omit', headers: { Authorization: 'Bearer secret', Accept: 'application/json' } });
  });

  it('falls back to limits and allows null reset windows', async () => {
    const result = await zaiAdapter.fetchSnapshot(makeCtx({ provider: 'zai', providerSettings: { apiKey: 'k' }, routes: [
      { match: 'quota/limit', reply: { json: { success: true, limits: [{ type: 'CREDIT_LIMIT', unit: 3, percentage: 10, nextResetTime: null }] } } },
      { match: 'customer-package-reset/list', reply: { json: { success: true } } },
    ] }));
    expect(result.windows[0]).toMatchObject({ kind: 'session_5h', usedPercent: 10, resetsAt: null });
  });

  it('maps missing quota key to not_configured', async () => {
    const result = await zaiAdapter.fetchSnapshot(makeCtx({ provider: 'zai', routes: [] }));
    expect(result.status).toBe('not_configured');
  });

  it('maps 401 and challenge HTTP failures', async () => {
    const unauthorized = await zaiAdapter.fetchSnapshot(makeCtx({ provider: 'zai', providerSettings: { apiKey: 'k' }, routes: [{ match: 'quota/limit', reply: { status: 401 } }] }));
    expect(unauthorized.status).toBe('auth_required');
    const challenged = await zaiAdapter.fetchSnapshot(makeCtx({ provider: 'zai', providerSettings: { apiKey: 'k' }, routes: [{ match: 'quota/limit', reply: { status: 403, challenge: true } }] }));
    expect(challenged.status).toBe('challenge');
  });

  it('maps unsuccessful envelope and malformed quota schemas', async () => {
    const auth = await zaiAdapter.fetchSnapshot(makeCtx({ provider: 'zai', providerSettings: { apiKey: 'k' }, routes: [{ match: 'quota/limit', reply: { json: { success: false, code: 1001, msg: 'bad key' } } }] }));
    expect(auth).toMatchObject({ status: 'auth_required', error: { message: 'bad key' } });
    const malformed = await zaiAdapter.fetchSnapshot(makeCtx({ provider: 'zai', providerSettings: { apiKey: 'k' }, routes: [{ match: 'quota/limit', reply: { json: { success: true, data: { limits: [] } } } }] }));
    expect(malformed.status).toBe('schema_changed');
  });

  it('keeps quota data when reset call fails', async () => {
    const result = await zaiAdapter.fetchSnapshot(makeCtx({ provider: 'zai', providerSettings: { apiKey: 'k' }, routes: [
      { match: 'quota/limit', reply: { json: quota } },
      { match: 'customer-package-reset/list', reply: { status: 500 } },
    ] }));
    expect(result.status).toBe('ok');
    expect(result.windows).toHaveLength(3);
    expect(result.grantSupport).toBe('unsupported');
    expect(result.grants).toEqual([]);
  });
});
