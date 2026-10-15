import { describe, expect, it } from 'vitest';
import { chatgptAdapter } from '../src/providers/chatgpt';
import { makeCtx } from './helpers';
import { baseSnapshot } from '../src/providers/util';
import { availableGrantCount as popupGrantCount } from '../src/popup/format';
import { availableGrantCount, detectResetEvents } from '../src/core/reset-detector';

const SESSION = 'https://chatgpt.com/api/auth/session';
const USAGE = 'https://chatgpt.com/backend-api/wham/usage';
const CREDITS = 'https://chatgpt.com/backend-api/wham/rate-limit-reset-credits';
const CREDIT_USAGE = 'https://chatgpt.com/backend-api/wham/usage/credit-usage-events';

function token(payload: Record<string, unknown> = {}): string {
  const encoded = btoa(JSON.stringify(payload)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
  return `header.${encoded}.signature`;
}

function signedIn() {
  return { accessToken: token({ exp: 1_800_000_000 }), account: { id: 'workspace-1' } };
}

describe('chatgptAdapter', () => {
  it('normalizes usage windows and reset credits', async () => {
    const ctx = makeCtx({
      provider: 'chatgpt',
      routes: [
        { match: SESSION, reply: { json: signedIn() } },
        {
          match: USAGE,
          reply: {
            json: {
              plan_type: 'plus',
              rate_limit: {
                primary_window: { limit_window_seconds: 18_000, used_percent: 10, reset_after_seconds: 1_800 },
                secondary_window: { limit_window_seconds: 604_800, used_percent: 52, reset_at: 1_790_000_000 },
              },
              additional_rate_limits: [
                {
                  limit_name: 'GPT-5',
                  rate_limit: {
                    primary_window: { limit_window_seconds: 604_800, used_percent: 40, reset_at: 1_790_100_000 },
                    secondary_window: null,
                  },
                },
              ],
              rate_limit_reset_credits: { available_count: 1 },
            },
          },
        },
        {
          match: CREDITS,
          reply: {
            json: {
              available_count: 1,
              credits: [
                {
                  id: 'grant-secret',
                  reset_type: 'weekly',
                  status: 'available',
                  granted_at: '2026-10-01T00:00:00Z',
                  expires_at: null,
                  title: 'Weekly reset',
                },
              ],
            },
          },
        },
      ],
    });

    const snapshot = await chatgptAdapter.fetchSnapshot(ctx);

    expect(snapshot).toMatchObject({
      provider: 'chatgpt',
      status: 'ok',
      plan: 'plus',
      account: 'workspace-1',
      grantSupport: 'supported',
      windows: [
        { kind: 'session_5h', label: '5시간', usedPercent: 10, resetsAt: '2026-10-01T12:30:00.000Z' },
        { kind: 'weekly_7d', label: '7일', usedPercent: 52, resetsAt: '2026-09-21T14:13:20.000Z' },
        { kind: 'weekly_model', label: '7일 · GPT-5', usedPercent: 40 },
      ],
      grants: [
        {
          provider: 'chatgpt',
          scope: 'weekly_7d',
          remaining: 1,
          status: 'available',
          title: 'Weekly reset',
        },
      ],
    });
    expect(snapshot.grants[0]?.idHash).not.toContain('grant-secret');
    expect(ctx.calls.map((call) => call.url)).toEqual([SESSION, USAGE, CREDITS]);
    expect(ctx.calls[1]?.init?.headers).toMatchObject({
      Authorization: expect.stringContaining('Bearer '),
      'ChatGPT-Account-Id': 'workspace-1',
    });
  });

  it('removes the last used reset credit instead of keeping the previous available grant', async () => {
    const previous = baseSnapshot('chatgpt', new Date('2026-10-01T11:00:00Z'));
    previous.grantSupport = 'supported';
    previous.grants = [{ provider: 'chatgpt', idHash: 'previous-grant', scope: 'weekly_7d', remaining: 1, status: 'available' }];
    const ctx = makeCtx({
      provider: 'chatgpt',
      previous,
      routes: [
        { match: SESSION, reply: { json: signedIn() } },
        { match: USAGE, reply: { json: { rate_limit: {}, rate_limit_reset_credits: { available_count: 0 } } } },
      ],
    });

    const snapshot = await chatgptAdapter.fetchSnapshot(ctx);

    expect(snapshot).toMatchObject({ status: 'ok', grantSupport: 'supported', grants: [] });
    expect(popupGrantCount(snapshot)).toBe(0);
    expect(availableGrantCount(snapshot)).toBe(0);
    expect(detectResetEvents(previous, snapshot, ctx.now())).toContainEqual({
      type: 'GRANT_USED', provider: 'chatgpt', scope: 'weekly_7d', at: ctx.now().toISOString(),
    });
    expect(ctx.calls.map((call) => call.url)).toEqual([SESSION, USAGE]);
    expect(previous.grants[0]?.status).toBe('available');
  });

  it('sums this UTC month across surfaces without treating credits as dollars or inventing a cap', async () => {
    // Given
    const ctx = makeCtx({
      provider: 'chatgpt',
      now: new Date('2026-10-15T23:30:00Z'),
      settings: { timezone: 'Asia/Seoul' },
      routes: [
        { match: SESSION, reply: { json: signedIn() } },
        { match: CREDIT_USAGE, reply: { json: { data: [
          { date: '2026-09-30', product_surface: 'cli', credit_amount: 999 },
          { date: '2026-10-01', product_surface: 'cli', credit_amount: 12.5 },
          { date: '2026-10-15T12:00:00Z', product_surface: 'work', credit_amount: 7.25 },
          { date: '2026-10-15', product_surface: 'cli', credit_amount: -0.004 },
          { date: '2026-10-16', product_surface: 'cli', credit_amount: 100 },
          { date: '2026-11-01', product_surface: 'cli', credit_amount: 100 },
        ] } } },
        { match: USAGE, reply: { json: {
          plan_type: 'pro', rate_limit: {},
          credits: { has_credits: true, unlimited: false, balance: '1234.567' },
          rate_limit_reset_credits: { available_count: 0 },
        } } },
      ],
    });

    // When
    const snapshot = await chatgptAdapter.fetchSnapshot(ctx);

    // Then
    expect(snapshot.extraCredits).toEqual({ unit: 'credits', balanceAmount: 1234.567, unlimited: false });
    const monthly = snapshot.windows.find((w) => w.kind === 'month');
    expect(monthly).toMatchObject({ unit: 'credits', periodTz: 'UTC', resetsAt: '2026-11-01T00:00:00.000Z' });
    expect(monthly?.usedAmount).toBeCloseTo(19.746, 6);
    expect(monthly?.limitAmount).toBeUndefined();
    expect(monthly?.usedPercent).toBeUndefined();
    expect(snapshot.grants).toEqual([]);
    expect(ctx.calls.find((call) => call.url === CREDIT_USAGE)?.init).toEqual(ctx.calls.find((call) => call.url === USAGE)?.init);
  });

  it.each([
    { now: '2027-01-01T00:00:00Z', date: '2026-12-31', reset: '2027-02-01T00:00:00.000Z' },
    { now: '2026-12-01T00:00:00Z', date: '2026-11-30', reset: '2027-01-01T00:00:00.000Z' },
  ])('resets the reported monthly sum at UTC month boundaries: %j', async ({ now, date, reset }) => {
    // Given
    const ctx = makeCtx({
      provider: 'chatgpt', now: new Date(now),
      routes: [
        { match: SESSION, reply: { json: signedIn() } },
        { match: CREDIT_USAGE, reply: { json: { data: [{ date, product_surface: 'cli', credit_amount: 88 }] } } },
        { match: USAGE, reply: { json: { rate_limit: {}, credits: { has_credits: false, unlimited: false, balance: '0' } } } },
      ],
    });

    // When
    const snapshot = await chatgptAdapter.fetchSnapshot(ctx);

    // Then
    expect(snapshot.windows.find((w) => w.kind === 'month')).toMatchObject({ usedAmount: 0, resetsAt: reset });
    expect(snapshot.extraCredits?.balanceAmount).toBe(0);
  });

  it.each([
    { status: 403 },
    { status: 429 },
    { json: { unexpected: [] } },
    { json: { data: [{ date: '2026-10-01', credit_amount: 'bad' }] } },
    { json: { data: [{ date: '2026-02-30', credit_amount: 10 }] } },
  ])('keeps the live balance and limits without a fabricated zero when history is unavailable: %j', async (reply) => {
    // Given
    const ctx = makeCtx({
      provider: 'chatgpt',
      routes: [
        { match: SESSION, reply: { json: signedIn() } },
        { match: CREDIT_USAGE, reply },
        { match: USAGE, reply: { json: {
          rate_limit: { primary_window: { limit_window_seconds: 18_000, used_percent: 23 } },
          credits: { has_credits: true, unlimited: false, balance: '-2.5' },
        } } },
      ],
    });

    // When
    const snapshot = await chatgptAdapter.fetchSnapshot(ctx);

    // Then
    expect(snapshot.status).toBe('ok');
    expect(snapshot.extraCredits?.balanceAmount).toBe(-2.5);
    expect(snapshot.windows).toEqual([expect.objectContaining({ kind: 'session_5h', usedPercent: 23 })]);
  });

  it.each([
    { unlimited: true, balance: null },
    { unlimited: false, balance: null },
    { unlimited: false, balance: 'not-a-number' },
  ])('preserves unlimited or unknown balances without replacing them with zero: %j', async (input) => {
    // Given
    const ctx = makeCtx({
      provider: 'chatgpt',
      routes: [
        { match: SESSION, reply: { json: signedIn() } },
        { match: CREDIT_USAGE, reply: { json: { data: [] } } },
        { match: USAGE, reply: { json: { rate_limit: {}, credits: { has_credits: false, ...input } } } },
      ],
    });

    // When
    const snapshot = await chatgptAdapter.fetchSnapshot(ctx);

    // Then
    expect(snapshot.extraCredits).toEqual({ unit: 'credits', unlimited: input.unlimited, balanceAmount: undefined });
    expect(snapshot.windows.find((w) => w.kind === 'month')?.usedAmount).toBe(0);
  });

  it('does not query personal purchased-credit history for a workspace account', async () => {
    // Given
    const ctx = makeCtx({
      provider: 'chatgpt',
      routes: [
        { match: SESSION, reply: { json: signedIn() } },
        { match: USAGE, reply: { json: { plan_type: 'business', rate_limit: {}, credits: { has_credits: true, unlimited: true } } } },
      ],
    });

    // When
    const snapshot = await chatgptAdapter.fetchSnapshot(ctx);

    // Then
    expect(snapshot.extraCredits?.unlimited).toBe(true);
    expect(ctx.calls.map((call) => call.url)).toEqual([SESSION, USAGE]);
  });

  it('uses the current count when the detail endpoint still returns already-used credits as available', async () => {
    const previous = baseSnapshot('chatgpt', new Date('2026-10-01T11:00:00Z'));
    previous.grantSupport = 'supported';
    previous.grants = ['old-1', 'old-2'].map((idHash) => ({
      provider: 'chatgpt' as const, idHash, scope: 'unknown' as const, remaining: 1, status: 'available' as const,
    }));
    const ctx = makeCtx({
      provider: 'chatgpt', previous,
      routes: [
        { match: SESSION, reply: { json: signedIn() } },
        { match: USAGE, reply: { json: { rate_limit: {}, rate_limit_reset_credits: { available_count: 1 } } } },
        { match: CREDITS, reply: { json: { credits: [
          { id: 'old-1', status: 'available' }, { id: 'old-2', status: 'available' },
        ] } } },
      ],
    });

    const snapshot = await chatgptAdapter.fetchSnapshot(ctx);

    expect(snapshot.status).toBe('ok');
    expect(popupGrantCount(snapshot)).toBe(1);
    expect(availableGrantCount(snapshot)).toBe(1);
    expect(snapshot.grants.every((grant) => grant.countOnly)).toBe(true);
    expect(detectResetEvents(previous, snapshot, ctx.now())).toEqual([
      { type: 'GRANT_USED', provider: 'chatgpt', scope: 'unknown', at: ctx.now().toISOString() },
    ]);
  });

  it('refreshes credit details even when the available count is unchanged', async () => {
    const routes = [
      { match: SESSION, reply: { json: signedIn() } },
      { match: USAGE, reply: { json: { rate_limit: {}, rate_limit_reset_credits: { available_count: 1 } } } },
      { match: CREDITS, reply: { json: { credits: [{ id: 'old-credit', status: 'available', reset_type: 'weekly' }] } } },
    ];
    const previous = await chatgptAdapter.fetchSnapshot(makeCtx({ provider: 'chatgpt', routes }));
    const ctx = makeCtx({
      provider: 'chatgpt', previous,
      routes: [routes[0]!, routes[1]!, {
        match: CREDITS, reply: { json: { credits: [
          { id: 'old-credit', status: 'consumed', reset_type: 'weekly' },
          { id: 'new-credit', status: 'available', reset_type: 'weekly' },
        ] } },
      }],
    });

    const snapshot = await chatgptAdapter.fetchSnapshot(ctx);

    expect(ctx.calls.map((call) => call.url)).toEqual([SESSION, USAGE, CREDITS]);
    expect(snapshot.grants).toContainEqual(expect.objectContaining({
      idHash: previous.grants[0]?.idHash, status: 'used', remaining: 0,
    }));
    expect(popupGrantCount(snapshot)).toBe(1);
    expect(snapshot.grants.find((grant) => grant.status === 'available')?.idHash).not.toBe(previous.grants[0]?.idHash);
  });

  it('falls back to the current count when credit details cannot be fetched', async () => {
    const ctx = makeCtx({
      provider: 'chatgpt',
      routes: [
        { match: SESSION, reply: { json: signedIn() } },
        { match: USAGE, reply: { json: { rate_limit: {}, rate_limit_reset_credits: { available_count: 2 } } } },
        { match: CREDITS, reply: { status: 403 } },
      ],
    });

    const snapshot = await chatgptAdapter.fetchSnapshot(ctx);

    expect(snapshot).toMatchObject({ status: 'ok', grantSupport: 'supported' });
    expect(popupGrantCount(snapshot)).toBe(2);
    expect(snapshot.grants.every((grant) => grant.scope === 'unknown')).toBe(true);
  });

  it('preserves the last successful grant data when the usage request fails', async () => {
    const previous = baseSnapshot('chatgpt', new Date('2026-10-01T11:00:00Z'));
    previous.grantSupport = 'supported';
    previous.grants = [{ provider: 'chatgpt', idHash: 'previous-grant', scope: 'weekly_7d', remaining: 1, status: 'available' }];
    const ctx = makeCtx({
      provider: 'chatgpt', previous,
      routes: [
        { match: SESSION, reply: { json: signedIn() } },
        { match: USAGE, reply: { status: 500 } },
      ],
    });

    const snapshot = await chatgptAdapter.fetchSnapshot(ctx);

    expect(snapshot).toMatchObject({ status: 'error', fetchedAt: previous.fetchedAt, grants: previous.grants });
  });

  it.each([
    { primary_window: null },
    { secondary_window: null },
  ])('accepts null or missing usage windows', async (rateLimit) => {
    const ctx = makeCtx({
      provider: 'chatgpt',
      routes: [
        { match: SESSION, reply: { json: signedIn() } },
        { match: USAGE, reply: { json: { rate_limit: rateLimit } } },
      ],
    });

    const snapshot = await chatgptAdapter.fetchSnapshot(ctx);

    expect(snapshot).toMatchObject({ status: 'ok', windows: [], grantSupport: 'unsupported' });
  });

  it('refreshes a rejected usage token once before reporting auth_required', async () => {
    let usageCalls = 0;
    const ctx = makeCtx({
      provider: 'chatgpt',
      routes: [
        { match: SESSION, reply: { json: signedIn() } },
        {
          match: USAGE,
          reply: () => {
            usageCalls += 1;
            return { status: 401 };
          },
        },
      ],
    });

    const snapshot = await chatgptAdapter.fetchSnapshot(ctx);

    expect(snapshot.status).toBe('auth_required');
    expect(usageCalls).toBe(2);
    expect(ctx.calls.filter((call) => call.url === SESSION)).toHaveLength(2);
  });

  it('reports a session Cloudflare challenge', async () => {
    const ctx = makeCtx({
      provider: 'chatgpt',
      routes: [{ match: SESSION, reply: { status: 403, challenge: true } }],
    });

    const snapshot = await chatgptAdapter.fetchSnapshot(ctx);

    expect(snapshot).toMatchObject({ status: 'challenge', error: { code: 'challenge' } });
  });

  it('reports malformed usage as a schema change', async () => {
    const ctx = makeCtx({
      provider: 'chatgpt',
      routes: [
        { match: SESSION, reply: { json: signedIn() } },
        { match: USAGE, reply: { json: { rate_limit: { primary_window: { used_percent: 10 } } } } },
      ],
    });

    const snapshot = await chatgptAdapter.fetchSnapshot(ctx);

    expect(snapshot).toMatchObject({ status: 'schema_changed', error: { code: 'schema_changed' } });
  });
});
