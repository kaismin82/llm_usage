import { describe, expect, it } from 'vitest';
import { makeCtx } from './helpers';
import { zaiAdapter } from '../src/providers/zai';

const quota = { success: true, data: { level: 'PRO', limits: [
  { type: 'TIME_LIMIT', unit: 5, currentValue: 38, usage: 100 },
  { type: 'TOKENS_LIMIT', unit: 6, percentage: 20, nextResetTime: 1791500000000 },
  { type: 'TOKENS_LIMIT', unit: 3, percentage: 47, nextResetTime: 1791480000000 },
] } };

describe('zaiAdapter', () => {
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
