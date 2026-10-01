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

  it('uses the tab fallback only for supported challenge hosts', async () => {
    const tabBridge = { fetchViaTab: vi.fn().mockResolvedValue(null) };
    const fetchImpl = vi.fn<typeof fetch>().mockImplementation(
      async () => new Response('Just a moment...', { status: 503 }),
    );
    const get = createSafeFetch({ fetchImpl, tabBridge });

    await get('https://claude.ai/api/organizations');
    await get('https://api.poe.com/usage/current_balance');

    expect(tabBridge.fetchViaTab).toHaveBeenCalledTimes(1);
    expect(tabBridge.fetchViaTab).toHaveBeenCalledWith('https://claude.ai/api/organizations', {});
  });

  it('returns a non-null tab fallback result', async () => {
    const fallback = {
      status: 200,
      headers: {},
      text: '{"ok":true}',
      json: { ok: true },
      challenge: false,
    };
    const tabBridge = { fetchViaTab: vi.fn().mockResolvedValue(fallback) };
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response('Just a moment...', { status: 403 }));
    const get = createSafeFetch({ fetchImpl, tabBridge });

    await expect(get('https://chatgpt.com/api/auth/session')).resolves.toBe(fallback);
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
