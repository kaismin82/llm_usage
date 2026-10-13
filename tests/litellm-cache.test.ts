import { describe, expect, it } from 'vitest';
import { litellmAdapter } from '../src/providers/litellm';
import { makeCtx } from './helpers';

describe('litellm detail caching', () => {
  it('reuses user info and daily activity on the next poll but refetches key info', async () => {
    const ctx = makeCtx({
      provider: 'litellm',
      providerSettings: { baseUrl: 'https://proxy.example', apiKey: 'secret' },
      routes: [
        { match: '/key/info', reply: { json: { info: { spend: 4, user_id: 'u-1' } } } },
        { match: '/user/info', reply: { json: { user_info: { max_budget: 50, spend: 10 } } } },
        { match: '/user/daily/activity/aggregated', reply: { json: { results: [{ date: '2026-10-01', metrics: { spend: 2 } }] } } },
      ],
    });

    const first = await litellmAdapter.fetchSnapshot(ctx);
    expect(ctx.calls).toHaveLength(3);
    const second = await litellmAdapter.fetchSnapshot(ctx);

    expect(ctx.calls.slice(3).map((call) => call.url)).toEqual(['https://proxy.example/key/info']);
    expect(second.balance?.amount).toBe(40);
    expect(second.windows).toEqual(first.windows);
  });
});
