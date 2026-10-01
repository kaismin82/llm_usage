import { describe, expect, it } from 'vitest';
import { assertAllowed, BlockedError } from '../src/core/allowlist';

const allowed = [
  'https://claude.ai/api/organizations',
  'https://claude.ai/api/organizations/0f9a7c1e-1111-2222-3333-444455556666/usage?cedar_ember=1',
  'https://chatgpt.com/api/auth/session',
  'https://chatgpt.com/backend-api/wham/usage',
  'https://chatgpt.com/backend-api/wham/rate-limit-reset-credits',
  'https://api.z.ai/api/monitor/usage/quota/limit',
  'https://open.bigmodel.cn/api/monitor/usage/quota/limit',
  'https://api.z.ai/api/biz/customer-package-reset/list?targetType=PERSONAL',
  'https://api.poe.com/usage/current_balance',
  'https://api.poe.com/usage/points_history?limit=100',
  'https://openrouter.ai/api/v1/key',
  'https://openrouter.ai/api/v1/keys?include_disabled=true&offset=0',
  'https://status.claude.com/api/v2/incidents.json',
  'https://litellm.example.com/key/info',
  'http://localhost:4000/user/daily/activity/aggregated?start_date=2026-09-01',
  'https://gw.example.com/litellm/spend/logs',
];

const blocked = [
  'https://chatgpt.com/backend-api/wham/rate-limit-reset-credits/consume',
  'https://api.anthropic.com/api/organizations/abc/reset_rate_limits',
  'https://api.anthropic.com/api/oauth/usage',
  'https://claude.ai/api/organizations/0f9a7c1e-1111-2222-3333-444455556666/reset_rate_limits',
  'https://claude.ai/api/bootstrap',
  'https://api.z.ai/api/biz/customer-package-reset/redeem',
  'https://api.z.ai/api/biz/customer-package-reset/use',
  'https://openrouter.ai/api/v1/chat/completions',
  'https://litellm.example.com/chat/completions',
  'https://litellm.example.com/key/delete',
  'https://litellm.example.com/key/generate',
  'ftp://litellm.example.com/key/info',
  'not a url',
  'http://claude.ai/api/organizations',
];

describe('assertAllowed', () => {
  it.each(allowed)('allows %s', (url) => {
    expect(() => assertAllowed(url, 'GET')).not.toThrow();
  });

  it.each(blocked)('blocks %s', (url) => {
    expect(() => assertAllowed(url, 'GET')).toThrow(BlockedError);
  });

  it.each(['POST', 'PUT', 'DELETE', 'PATCH', 'post'])('blocks method %s on an allowed URL', (method) => {
    expect(() => assertAllowed('https://api.poe.com/usage/current_balance', method)).toThrow(BlockedError);
  });

  it('throws an error named BlockedError', () => {
    try {
      assertAllowed('https://example.com/x', 'GET');
    } catch (e) {
      expect((e as Error).name).toBe('BlockedError');
      return;
    }
    throw new Error('expected throw');
  });
});
