import { describe, expect, it } from 'vitest';
import { claudeAdapter } from '../src/providers/claude';
import { availableGrantCount, detectResetEvents } from '../src/core/reset-detector';
import type { ProviderSnapshot } from '../src/providers/types';
import { makeCtx } from './helpers';

describe('claudeAdapter', () => {
  it('discovers an organization and maps usage, plan, and reset grants', async () => {
    const ctx = makeCtx({
      provider: 'claude',
      now: new Date('2026-10-01T12:00:00Z'),
      routes: [
        {
          match: /\/api\/organizations$/,
          reply: {
            json: [
              { uuid: '00000000-0000-0000-0000-000000000001', name: 'Other', capabilities: [] },
              {
                uuid: '00000000-0000-0000-0000-000000000002',
                name: 'Workspace',
                capabilities: ['chat', 'claude_pro'],
                rate_limit_tier: 'MAX_20X',
              },
            ],
          },
        },
        {
          match: '/usage?cedar_ember=1',
          reply: {
            json: {
              limits: [
                { kind: 'session', percent: 101, resets_at: '2026-10-01T15:00:00+00:00' },
                { kind: 'weekly_all', percent: 42, resets_at: null },
                {
                  kind: 'weekly_scoped',
                  percent: 11,
                  resets_at: '2026-10-04T00:00:00Z',
                  scope: { model: { display_name: 'Opus' } },
                },
              ],
              extra_usage: { is_enabled: true, used_credits: 1234, monthly_limit: 5000 },
              cedar_ember: {
                eligible: true,
                grants: [
                  {
                    id: 'secret-grant-id',
                    resets_left: 1,
                    paused: false,
                    starts_at: '2026-09-30T00:00:00Z',
                    ends_at: '2026-10-02T00:00:00Z',
                    clears: ['five_hour'],
                    label: 'Launch credit',
                  },
                ],
              },
            },
          },
        },
      ],
    });

    const snapshot = await claudeAdapter.fetchSnapshot(ctx);

    expect(snapshot).toMatchObject({
      status: 'ok',
      plan: 'Max 20x',
      account: 'Workspace',
      grantSupport: 'supported',
    });
    expect(snapshot.windows).toEqual([
      expect.objectContaining({ kind: 'session_5h', usedPercent: 101, resetsAt: '2026-10-01T15:00:00.000Z' }),
      expect.objectContaining({ kind: 'weekly_7d', usedPercent: 42, resetsAt: null }),
      expect.objectContaining({ kind: 'weekly_model', label: '7일 · Opus' }),
      expect.objectContaining({ kind: 'month', unit: 'usd', usedAmount: 12.34, limitAmount: 50, usedPercent: 24.68 }),
    ]);
    expect(snapshot.grants).toEqual([
      expect.objectContaining({ provider: 'claude', scope: 'session_5h', remaining: 1, status: 'available', title: 'Launch credit' }),
    ]);
    expect(snapshot.grants[0].idHash).not.toContain('secret-grant-id');
    expect(ctx.calls).toHaveLength(2);
    expect(ctx.calls[0].init).toEqual({ credentials: 'include', headers: { Accept: 'application/json, text/plain, */*' } });
  });

  it('falls back to flat windows when limits are absent and treats null windows as absent', async () => {
    const ctx = makeCtx({
      provider: 'claude',
      providerSettings: { orgId: '00000000-0000-0000-0000-000000000003' },
      routes: [
        {
          match: '/usage?cedar_ember=1',
          reply: {
            json: {
              five_hour: null,
              seven_day: { utilization: 55, resets_at: null },
              seven_day_opus: null,
              cedar_ember: { eligible: false, grants: [] },
            },
          },
        },
      ],
    });

    const snapshot = await claudeAdapter.fetchSnapshot(ctx);

    expect(snapshot.status).toBe('ok');
    expect(snapshot.windows).toEqual([
      expect.objectContaining({ kind: 'weekly_7d', label: '7일', usedPercent: 55, resetsAt: null }),
    ]);
    expect(snapshot.grantSupport).toBe('not_eligible');
  });

  it.each([
    { used_credits: 2294, monthly_limit: 11500, decimal_places: 2, used: 22.94, limit: 115 },
    { used_credits: 1234, monthly_limit: null, decimal_places: 2, used: 12.34, limit: undefined },
    { used_credits: 0, monthly_limit: 0, decimal_places: 2, used: 0, limit: 0 },
    { used_credits: 1234, monthly_limit: 5000, decimal_places: 3, used: 1.234, limit: 5 },
  ])('retains monthly extra usage with provider precision and nullable caps: %j', async (input) => {
    // Given
    const ctx = makeCtx({
      provider: 'claude',
      providerSettings: { orgId: '00000000-0000-0000-0000-000000000003' },
      routes: [{
        match: '/usage',
        reply: { json: {
          five_hour: { utilization: 5, resets_at: null },
          extra_usage: { is_enabled: true, currency: 'USD', ...input },
        } },
      }],
    });

    // When
    const snapshot = await claudeAdapter.fetchSnapshot(ctx);

    // Then
    expect(snapshot.extraCredits).toEqual({ unit: 'usd', isEnabled: true });
    expect(snapshot.windows.find((w) => w.kind === 'month')).toMatchObject({
      unit: 'usd', usedAmount: input.used, limitAmount: input.limit,
    });
    expect(snapshot.windows.find((w) => w.kind === 'month')?.usedPercent).toBe(
      input.limit !== undefined && input.limit > 0 ? input.used / input.limit * 100 : undefined,
    );
  });

  it('distinguishes disabled extra usage from missing or malformed amounts', async () => {
    // Given
    const ctx = makeCtx({
      provider: 'claude',
      providerSettings: { orgId: '00000000-0000-0000-0000-000000000003' },
      routes: [{
        match: '/usage',
        reply: { json: {
          five_hour: { utilization: 5, resets_at: null },
          extra_usage: { is_enabled: false, used_credits: null, monthly_limit: null },
        } },
      }],
    });

    // When
    const snapshot = await claudeAdapter.fetchSnapshot(ctx);

    // Then
    expect(snapshot.extraCredits).toEqual({ unit: 'usd', isEnabled: false });
    expect(snapshot.windows.some((w) => w.kind === 'month')).toBe(false);
  });

  it('returns auth_required for an unauthorized usage response', async () => {
    const ctx = makeCtx({
      provider: 'claude',
      providerSettings: { orgId: '00000000-0000-0000-0000-000000000004' },
      routes: [{ match: '/usage', reply: { status: 401 } }],
    });

    await expect(claudeAdapter.fetchSnapshot(ctx)).resolves.toMatchObject({ status: 'auth_required', windows: [] });
  });

  it('returns challenge for a Cloudflare challenge', async () => {
    const ctx = makeCtx({
      provider: 'claude',
      providerSettings: { orgId: '00000000-0000-0000-0000-000000000005' },
      routes: [{ match: '/usage', reply: { status: 403, challenge: true } }],
    });

    await expect(claudeAdapter.fetchSnapshot(ctx)).resolves.toMatchObject({ status: 'challenge' });
  });

  it('returns schema_changed for a malformed usage body', async () => {
    const ctx = makeCtx({
      provider: 'claude',
      providerSettings: { orgId: '00000000-0000-0000-0000-000000000006' },
      routes: [{ match: '/usage', reply: { json: { limits: [{ kind: 'session', percent: 'bad' }] } } }],
    });

    await expect(claudeAdapter.fetchSnapshot(ctx)).resolves.toMatchObject({ status: 'schema_changed', windows: [] });
  });

  it('uses session authentication and does not require an API key', async () => {
    const ctx = makeCtx({
      provider: 'claude',
      providerSettings: { orgId: '00000000-0000-0000-0000-000000000007', apiKey: undefined },
      routes: [
        {
          match: '/usage',
          reply: { json: { five_hour: { utilization: 1, resets_at: null } } },
        },
      ],
    });

    await expect(claudeAdapter.fetchSnapshot(ctx)).resolves.toMatchObject({ status: 'ok' });
  });

  it.each([401, 403])('rediscovers a cached organization rejected with HTTP %s', async (status) => {
    // Given
    const oldId = '00000000-0000-0000-0000-000000000008';
    const newId = '00000000-0000-0000-0000-000000000009';
    const ctx = makeCtx({
      provider: 'claude',
      routes: [
        { match: `/organizations/${oldId}/usage`, reply: { status } },
        { match: /\/api\/organizations$/, reply: { json: [{ uuid: newId, capabilities: ['chat'] }] } },
        { match: `/organizations/${newId}/usage`, reply: { json: { five_hour: { utilization: 7, resets_at: null } } } },
      ],
    });
    await ctx.cache.set('claude:orgId', oldId);

    // When
    const result = await claudeAdapter.fetchSnapshot(ctx);

    // Then
    expect(result).toMatchObject({ status: 'ok', windows: [expect.objectContaining({ usedPercent: 7 })] });
    expect(await ctx.cache.get('claude:orgId')).toBe(newId);
    expect(ctx.calls).toHaveLength(status === 403 ? 4 : 3);
  });

  it('preserves auth classification when organization rediscovery finds an expired session', async () => {
    // Given
    const oldId = '00000000-0000-0000-0000-000000000008';
    const ctx = makeCtx({
      provider: 'claude',
      routes: [
        { match: `/organizations/${oldId}/usage`, reply: { status: 404 } },
        { match: /\/api\/organizations$/, reply: { status: 403 } },
      ],
    });
    await ctx.cache.set('claude:orgId', oldId);

    // When
    const result = await claudeAdapter.fetchSnapshot(ctx);

    // Then
    expect(result.status).toBe('auth_required');
    expect(ctx.calls).toHaveLength(3);
  });

  it('keeps plain usage working when the optional grant query is forbidden', async () => {
    // Given
    const orgId = '00000000-0000-0000-0000-000000000008';
    const ctx = makeCtx({
      provider: 'claude',
      routes: [
        { match: '/usage?cedar_ember=1', reply: { status: 403 } },
        { match: /\/usage$/, reply: { json: { five_hour: { utilization: 8, resets_at: null } } } },
      ],
    });
    await ctx.cache.set('claude:orgId', orgId);

    // When
    const result = await claudeAdapter.fetchSnapshot(ctx);

    // Then
    expect(result).toMatchObject({ status: 'ok', grantSupport: 'unsupported' });
    expect(result.windows[0].usedPercent).toBe(8);
    expect(ctx.calls.map((call) => call.url)).toEqual([
      `https://claude.ai/api/organizations/${orgId}/usage?cedar_ember=1`,
      `https://claude.ai/api/organizations/${orgId}/usage`,
    ]);
  });

  it('retains known Claude grants as stale when only plain usage remains available', async () => {
    // Given
    const previous: ProviderSnapshot = {
      provider: 'claude', status: 'ok', windows: [], grantSupport: 'supported',
      grants: [{ provider: 'claude', idHash: 'known-credit', scope: 'session_5h', remaining: 1, status: 'available' }],
      fetchedAt: '2026-10-01T11:00:00.000Z', attemptedAt: '2026-10-01T11:00:00.000Z',
    };
    const ctx = makeCtx({
      provider: 'claude', previous,
      providerSettings: { orgId: '00000000-0000-0000-0000-000000000008' },
      routes: [
        { match: '/usage?cedar_ember=1', reply: { status: 403 } },
        { match: /\/usage$/, reply: { json: { five_hour: { utilization: 8, resets_at: null } } } },
      ],
    });

    // When
    const result = await claudeAdapter.fetchSnapshot(ctx);

    // Then
    expect(result).toMatchObject({
      status: 'stale', grantSupport: 'supported', grants: previous.grants, fetchedAt: previous.fetchedAt,
      windows: [expect.objectContaining({ usedPercent: 8 })],
    });
    expect(detectResetEvents(previous, result, ctx.now())).toEqual([]);
  });

  it.each([1, 0])('reflects a consumed Claude grant with %s uses left in totals and reset events', async (remaining) => {
    // Given
    const orgId = '00000000-0000-0000-0000-000000000003';
    const responseFor = (remaining: number) => ({
      five_hour: { utilization: 5, resets_at: null },
      cedar_ember: { eligible: true, grants: [{
        id: 'same-credit', resets_left: remaining, paused: false,
        starts_at: null, ends_at: null, clears: ['five_hour'],
      }] },
    });
    const previous = await claudeAdapter.fetchSnapshot(makeCtx({
      provider: 'claude', providerSettings: { orgId },
      routes: [{ match: '/usage', reply: { json: responseFor(2) } }],
    }));
    const ctx = makeCtx({
      provider: 'claude', providerSettings: { orgId }, previous,
      routes: [{ match: '/usage', reply: { json: responseFor(remaining) } }],
    });

    // When
    const current = await claudeAdapter.fetchSnapshot(ctx);

    // Then
    expect(current.grants).toEqual([expect.objectContaining({ remaining, status: remaining === 0 ? 'used' : 'available' })]);
    expect(current.grants[0].idHash).toBe(previous.grants[0].idHash);
    expect(availableGrantCount(current)).toBe(remaining);
    expect(detectResetEvents(previous, current, ctx.now())).toEqual([
      { type: 'GRANT_USED', provider: 'claude', scope: 'session_5h', at: ctx.now().toISOString() },
    ]);
  });
});
