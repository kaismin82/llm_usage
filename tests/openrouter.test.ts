import { describe, expect, it } from 'vitest';
import { openrouterAdapter } from '../src/providers/openrouter';
import { makeCtx } from './helpers';

const keyData = { label: 'primary', usage_daily: 1, usage_weekly: 2, usage_monthly: 3 };

function context(reply: { status?: number; json?: unknown; challenge?: boolean }) {
  return makeCtx({ provider: 'openrouter', providerSettings: { apiKey: 'secret' }, routes: [{ match: '/api/v1/key', reply }] });
}

describe('openrouterAdapter', () => {
  it('maps key usage and limit', async () => {
    const ctx = context({ json: { data: { ...keyData, limit: 20, limit_remaining: 15, limit_reset: 'daily' } } });
    const result = await openrouterAdapter.fetchSnapshot(ctx);
    expect(result.status).toBe('ok');
    expect(result.account).toBe('primary');
    expect(result.windows.slice(0, 3).map((w) => w.usedAmount)).toEqual([1, 2, 3]);
    expect(result.windows[3]).toMatchObject({ kind: 'budget', usedAmount: 5, limitAmount: 20, usedPercent: 25 });
    expect(ctx.calls[0].init).toMatchObject({ credentials: 'omit', headers: { Authorization: 'Bearer secret', Accept: 'application/json' } });
  });

  it('handles null windows as zero values only when the fields are numeric', async () => {
    const result = await openrouterAdapter.fetchSnapshot(context({ json: { data: { ...keyData, usage_daily: 0, usage_weekly: 0, usage_monthly: 0 } } }));
    expect(result.windows.map((w) => w.usedAmount)).toEqual([0, 0, 0]);
  });

  it('requires all usage fields', async () => {
    const result = await openrouterAdapter.fetchSnapshot(context({ json: { data: { usage_daily: null, usage_weekly: 2, usage_monthly: 3 } } }));
    expect(result.status).toBe('schema_changed');
  });

  it.each([401, 403])('maps HTTP %s to auth_required', async (status) => {
    const result = await openrouterAdapter.fetchSnapshot(context({ status }));
    expect(result.status).toBe('auth_required');
  });

  it('maps Cloudflare challenges', async () => {
    const result = await openrouterAdapter.fetchSnapshot(context({ status: 403, challenge: true }));
    expect(result.status).toBe('challenge');
  });

  it('marks malformed responses schema_changed', async () => {
    const result = await openrouterAdapter.fetchSnapshot(context({ json: { nope: true } }));
    expect(result.status).toBe('schema_changed');
  });

  it('does not request when the key is missing', async () => {
    const ctx = makeCtx({ provider: 'openrouter', routes: [] });
    const result = await openrouterAdapter.fetchSnapshot(ctx);
    expect(result.status).toBe('not_configured');
    expect(ctx.calls).toHaveLength(0);
  });

  it('sums management keys across pages', async () => {
    const ctx = makeCtx({ provider: 'openrouter', providerSettings: { apiKey: 'secret', mode: 'management' }, routes: [{ match: '/api/v1/keys', reply: (url) => ({ json: { data: url.endsWith('offset=0') ? [{ usage_daily: 1, usage_weekly: 2, usage_monthly: 3 }] : [{ usage_daily: 4, usage_weekly: 5, usage_monthly: 6 }] } }) }] });
    const result = await openrouterAdapter.fetchSnapshot(ctx);
    expect(result.account).toBe('20 keys');
    expect(result.windows.map((w) => w.usedAmount)).toEqual([77, 97, 117]);
    expect(ctx.calls).toHaveLength(21);
    expect(ctx.calls.at(-1)?.url).toContain('/api/v1/credits');
  });

  it('provides the management-specific 403 message', async () => {
    const ctx = makeCtx({ provider: 'openrouter', providerSettings: { apiKey: 'secret', mode: 'management' }, routes: [{ match: '/api/v1/keys', reply: { status: 403 } }] });
    expect((await openrouterAdapter.fetchSnapshot(ctx)).error?.message).toBe('management key required');
  });
});
