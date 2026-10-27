import { describe, expect, it, vi } from 'vitest';
import { BlockedError, assertAllowed } from '../src/core/allowlist';
import { createSafeFetch } from '../src/core/safe-fetch';

describe('createSafeFetch', () => {
  it('blocks forbidden paths before invoking fetch', async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    const get = createSafeFetch({ fetchImpl });

    await expect(get('https://chatgpt.com/backend-api/wham/rate-limit-reset-credits/consume')).rejects.toBeInstanceOf(
      BlockedError,
    );
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('keeps the read-only policy from allowing POST requests', () => {
    expect(() => assertAllowed('https://claude.ai/api/organizations', 'POST')).toThrow(BlockedError);
  });

  it('normalizes response headers and detects challenges', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response('Just a moment...', {
        status: 403,
        headers: { 'CF-Mitigated': 'challenge', 'X-Test': 'value' },
      }),
    );
    const get = createSafeFetch({ fetchImpl });

    const result = await get('https://claude.ai/api/organizations');

    expect(result.headers).toMatchObject({ 'cf-mitigated': 'challenge', 'x-test': 'value' });
    expect(result.challenge).toBe(true);
    expect(result.json).toBeUndefined();
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://claude.ai/api/organizations',
      expect.objectContaining({ method: 'GET', credentials: 'omit', redirect: 'follow', cache: 'no-store' }),
    );
  });

  const OK = { status: 200, headers: {}, text: '{"ok":true}', json: { ok: true }, challenge: false };

  it.each([
    'https://claude.ai/api/organizations',
    'https://chatgpt.com/api/auth/session',
  ])('sends cookie-carrying %s requests only through the signed-in tab', async (url) => {
    const tabBridge = { fetchViaTab: vi.fn().mockResolvedValue(OK) };
    const fetchImpl = vi.fn<typeof fetch>();
    const get = createSafeFetch({ fetchImpl, tabBridge });

    await expect(get(url, { credentials: 'include' })).resolves.toBe(OK);

    expect(tabBridge.fetchViaTab).toHaveBeenCalledWith(url, { credentials: 'include', timeoutMs: expect.any(Number) });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('never falls back to a service-worker request when no signed-in tab exists', async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    const withoutTab = createSafeFetch({ fetchImpl, tabBridge: { fetchViaTab: vi.fn().mockResolvedValue(null) } });
    const withoutBridge = createSafeFetch({ fetchImpl });

    await expect(withoutTab('https://claude.ai/api/organizations', { credentials: 'include' }))
      .rejects.toMatchObject({ name: 'NoSessionTab' });
    await expect(withoutBridge('https://chatgpt.com/api/auth/session', { credentials: 'include' }))
      .rejects.toMatchObject({ name: 'NoSessionTab' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('does not mistake a tab login page for successful JSON authentication', async () => {
    const tabBridge = { fetchViaTab: vi.fn().mockResolvedValue({
      status: 200, headers: {}, text: '<html>Sign in</html>', json: undefined, challenge: false,
    }) };
    const get = createSafeFetch({ fetchImpl: vi.fn<typeof fetch>(), tabBridge });

    const result = await get('https://claude.ai/api/organizations', { credentials: 'include' });

    expect(result.status).toBe(401);
  });

  it('passes a tab challenge or auth failure through unchanged', async () => {
    const challenge = { status: 403, headers: {}, text: 'Just a moment...', json: undefined, challenge: true };
    const get = createSafeFetch({ tabBridge: { fetchViaTab: vi.fn().mockResolvedValue(challenge) } });

    await expect(get('https://claude.ai/api/organizations', { credentials: 'include' })).resolves.toBe(challenge);
  });

  it('never attaches credentials to other requests and never uses the tab for them', async () => {
    const tabBridge = { fetchViaTab: vi.fn() };
    const fetchImpl = vi.fn<typeof fetch>().mockImplementation(async () => new Response('{}', { status: 401 }));
    const get = createSafeFetch({ fetchImpl, tabBridge });

    await get('https://claude.ai/api/organizations');
    await get('https://api.poe.com/usage/current_balance', { credentials: 'include' });

    expect(tabBridge.fetchViaTab).not.toHaveBeenCalled();
    for (const call of fetchImpl.mock.calls) expect(call[1]).toMatchObject({ credentials: 'omit' });
  });

  it('names network and timeout failures', async () => {
    const networkGet = createSafeFetch({ fetchImpl: vi.fn<typeof fetch>().mockRejectedValue(new Error('offline')) });
    const timeoutGet = createSafeFetch({
      defaultTimeoutMs: 0,
      fetchImpl: vi.fn<typeof fetch>().mockImplementation(
        (_url, init) =>
          new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener('abort', () => reject(init.signal?.reason), { once: true });
          }),
      ),
    });

    await expect(networkGet('https://claude.ai/api/organizations')).rejects.toMatchObject({ name: 'NetworkError' });
    await expect(timeoutGet('https://claude.ai/api/organizations')).rejects.toMatchObject({ name: 'TimeoutError' });
  });
});
