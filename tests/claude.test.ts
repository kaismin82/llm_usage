import { describe, expect, it } from 'vitest';
import { claudeAdapter } from '../src/providers/claude';
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
});
