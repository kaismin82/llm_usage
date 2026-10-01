import { describe, expect, it } from 'vitest';
import { litellmAdapter } from '../src/providers/litellm';
import { makeCtx } from './helpers';

describe('litellmAdapter', () => {
  it('normalizes the URL and returns budget plus UTC daily, weekly, and monthly usage', async () => {
    const ctx = makeCtx({
      provider: 'litellm',
      now: new Date('2026-10-01T12:00:00Z'),
      providerSettings: { baseUrl: 'https://proxy.example/v1/', apiKey: 'secret' },
      routes: [
        {
          match: '/key/info',
          reply: { json: { key: 'ignored', info: { spend: 4, max_budget: 20, budget_reset_at: '2026-10-07T00:00:00Z', user_id: 'u-1', key_alias: 'work' } } },
        },
        {
          match: '/user/daily/activity/aggregated',
          reply: { json: { results: [
            { date: '2026-10-01', metrics: { spend: 2 } },
            { date: '2026-09-28', metrics: { spend: 3 } },
            { date: '2026-09-01', metrics: { spend: 5 } },
          ] } },
        },
      ],
    });

    const snapshot = await litellmAdapter.fetchSnapshot(ctx);

    expect(snapshot.status).toBe('ok');
    expect(snapshot.account).toBe('work');
    expect(snapshot.windows).toEqual([
      { kind: 'budget', label: '예산', unit: 'usd', usedAmount: 4, limitAmount: 20, usedPercent: 20, resetsAt: '2026-10-07T00:00:00Z', periodTz: 'UTC' },
      { kind: 'day', label: '오늘', unit: 'usd', usedAmount: 2, periodTz: 'UTC' },
      { kind: 'week', label: '이번주', unit: 'usd', usedAmount: 5, periodTz: 'UTC' },
      { kind: 'month', label: '이번달', unit: 'usd', usedAmount: 2, periodTz: 'UTC' },
    ]);
    expect(ctx.calls[0]).toMatchObject({
      url: 'https://proxy.example/key/info',
      init: { credentials: 'omit', headers: { Accept: 'application/json', Authorization: 'Bearer secret' } },
    });
    expect(ctx.calls.find((call) => call.url.includes('/user/daily/activity'))?.url).toContain('start_date=2026-08-31&end_date=2026-10-01&include_current_utc_day=true&user_id=u-1');
  });

  it('does not add a budget window when its fields are null or absent', async () => {
    const ctx = makeCtx({
      provider: 'litellm',
      providerSettings: { baseUrl: 'https://proxy.example', apiKey: 'secret' },
      routes: [
        { match: '/key/info', reply: { json: { info: { spend: null, max_budget: null, user_id: 'u-1' } } } },
        { match: '/user/daily/activity/aggregated', reply: { json: { results: [] } } },
      ],
    });

    const snapshot = await litellmAdapter.fetchSnapshot(ctx);

    expect(snapshot.status).toBe('ok');
    expect(snapshot.windows.map((window) => window.kind)).toEqual(['day', 'week', 'month']);
  });

  it('returns auth_required for a 401 response', async () => {
    const snapshot = await litellmAdapter.fetchSnapshot(makeCtx({
      provider: 'litellm',
      providerSettings: { baseUrl: 'https://proxy.example', apiKey: 'secret' },
      routes: [{ match: '/key/info', reply: { status: 401 } }],
    }));

    expect(snapshot.status).toBe('auth_required');
  });

  it('returns challenge for a Cloudflare challenge', async () => {
    const snapshot = await litellmAdapter.fetchSnapshot(makeCtx({
      provider: 'litellm',
      providerSettings: { baseUrl: 'https://proxy.example', apiKey: 'secret' },
      routes: [{ match: '/key/info', reply: { status: 403, challenge: true } }],
    }));

    expect(snapshot.status).toBe('challenge');
  });

  it('reports schema_changed when a daily response does not contain results', async () => {
    const snapshot = await litellmAdapter.fetchSnapshot(makeCtx({
      provider: 'litellm',
      providerSettings: { baseUrl: 'https://proxy.example', apiKey: 'secret' },
      routes: [
        { match: '/key/info', reply: { json: { info: { user_id: 'u-1' } } } },
        { match: '/user/daily/activity/aggregated', reply: { text: '<html>not json</html>' } },
      ],
    }));

    expect(snapshot.status).toBe('schema_changed');
  });

  it('is not configured without both base URL and API key', async () => {
    const snapshot = await litellmAdapter.fetchSnapshot(makeCtx({
      provider: 'litellm',
      providerSettings: { baseUrl: 'https://proxy.example' },
      routes: [],
    }));

    expect(snapshot.status).toBe('not_configured');
  });

  it('falls back to paginated daily activity after a 404 aggregated response', async () => {
    const ctx = makeCtx({
      provider: 'litellm',
      providerSettings: { baseUrl: 'https://proxy.example', apiKey: 'secret', headerName: 'x-litellm-api-key' },
      routes: [
        { match: '/key/info', reply: { json: { info: { user_id: 'u-1' } } } },
        { match: '/user/daily/activity/aggregated', reply: { status: 404 } },
        {
          match: /\/user\/daily\/activity\?.*page=1/,
          reply: { json: { results: [{ date: '2026-10-01', metrics: { spend: 2 } }], metadata: { has_more: true } } },
        },
        {
          match: /\/user\/daily\/activity\?.*page=2/,
          reply: { json: { results: [{ date: '2026-09-30', metrics: { spend: 3 } }], metadata: { has_more: false, total_spend: 3 } } },
        },
      ],
    });

    const snapshot = await litellmAdapter.fetchSnapshot(ctx);

    expect(snapshot.status).toBe('ok');
    expect(snapshot.windows.find((window) => window.kind === 'week')?.usedAmount).toBe(5);
    expect(ctx.calls).toHaveLength(5);
    expect(ctx.calls[3]?.url).toContain('/user/daily/activity?');
    expect(ctx.calls[3]?.init?.headers).toMatchObject({ 'x-litellm-api-key': 'Bearer secret' });
  });

  it('keeps the budget window and returns partial for a service-account key', async () => {
    const snapshot = await litellmAdapter.fetchSnapshot(makeCtx({
      provider: 'litellm',
      providerSettings: { baseUrl: 'https://proxy.example', apiKey: 'secret' },
      routes: [{ match: '/key/info', reply: { json: { info: { spend: 7, max_budget: 10 } } } }],
    }));

    expect(snapshot.status).toBe('ok');
    expect(snapshot.error?.code).toBe('partial');
    expect(snapshot.windows).toEqual([expect.objectContaining({ kind: 'budget', usedAmount: 7 })]);
  });

  it('uses aggregate activity without key info in admin mode', async () => {
    const ctx = makeCtx({
      provider: 'litellm',
      providerSettings: { baseUrl: 'https://proxy.example', apiKey: 'secret', mode: 'admin' },
      routes: [
        { match: '/user/daily/activity/aggregated', reply: { json: { results: [{ date: '2026-10-01', metrics: { spend: 9 } }] } } },
      ],
    });

    const snapshot = await litellmAdapter.fetchSnapshot(ctx);

    expect(snapshot.status).toBe('ok');
    expect(snapshot.windows.find((window) => window.kind === 'day')?.usedAmount).toBe(9);
    expect(ctx.calls).toHaveLength(1);
    expect(ctx.calls[0]?.url).not.toContain('user_id=');
  });

  it('uses Monday UTC week and UTC month boundaries', async () => {
    const snapshot = await litellmAdapter.fetchSnapshot(makeCtx({
      provider: 'litellm',
      now: new Date('2026-03-01T23:30:00Z'),
      providerSettings: { baseUrl: 'https://proxy.example', apiKey: 'secret', mode: 'admin' },
      routes: [
        {
          match: '/user/daily/activity/aggregated',
          reply: { json: { results: [
            { date: '2026-03-01', metrics: { spend: 1 } },
            { date: '2026-02-28', metrics: { spend: 2 } },
            { date: '2026-02-23', metrics: { spend: 4 } },
          ] } },
        },
      ],
    }));

    expect(snapshot.windows).toEqual([
      { kind: 'day', label: '오늘', unit: 'usd', usedAmount: 1, periodTz: 'UTC' },
      { kind: 'week', label: '이번주', unit: 'usd', usedAmount: 7, periodTz: 'UTC' },
      { kind: 'month', label: '이번달', unit: 'usd', usedAmount: 1, periodTz: 'UTC' },
    ]);
  });
});
