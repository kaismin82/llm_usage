import { describe, expect, it } from 'vitest';
import { chatgptAdapter } from '../src/providers/chatgpt';
import { makeCtx } from './helpers';

const SESSION = 'https://chatgpt.com/api/auth/session';
const USAGE = 'https://chatgpt.com/backend-api/wham/usage';
const CREDITS = 'https://chatgpt.com/backend-api/wham/rate-limit-reset-credits';

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
