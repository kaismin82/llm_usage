import { afterEach, describe, expect, it, vi } from 'vitest';
import { statusFromHttp } from '../src/providers/util';
import { createTabBridge, TAB_RELOAD_COOLDOWN_MS, type PageProbe, type TabBridgeApi } from '../src/core/tab-bridge';

function makeApi(result?: { status: number; headers: Record<string, string>; text: string }): TabBridgeApi {
  return {
    tabs: {
      query: vi.fn().mockResolvedValue([{ id: 42 }]),
    },
    scripting: {
      executeScript: vi.fn().mockResolvedValue(result ? [{ result }] : []),
    },
  };
}

describe('createTabBridge', () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  it('queries an origin-matched tab, fetches in the isolated world, and normalizes the result', async () => {
    const api = makeApi({ status: 200, headers: { 'X-Trace': 'yes' }, text: '{"usage":42}' });
    const bridge = createTabBridge(api);

    const result = await bridge.fetchViaTab('https://claude.ai/api/organizations', {
      headers: { Authorization: 'Bearer secret' },
    });

    expect(api.tabs.query).toHaveBeenCalledWith({ url: 'https://claude.ai/*' });
    expect(api.scripting.executeScript).toHaveBeenCalledWith(
      expect.objectContaining({
        target: { tabId: 42 },
        world: 'ISOLATED',
        args: ['https://claude.ai/api/organizations', { Authorization: 'Bearer secret' }, 15_000],
      }),
    );
    expect(result).toMatchObject({ status: 200, headers: { 'x-trace': 'yes' }, json: { usage: 42 } });
  });

  it('returns null when there is no matching tab', async () => {
    const api = makeApi();
    api.tabs.query = vi.fn().mockResolvedValue([]);

    await expect(createTabBridge(api).fetchViaTab('https://chatgpt.com/api/auth/session', {})).resolves.toBeNull();
    expect(api.scripting.executeScript).not.toHaveBeenCalled();
  });

  it('returns null when script execution fails', async () => {
    const api = makeApi();
    api.scripting.executeScript = vi.fn().mockRejectedValue(new Error('denied'));

    await expect(createTabBridge(api).fetchViaTab('https://chatgpt.com/api/auth/session', {})).resolves.toBeNull();
  });

  it('executes a bounded, uncached GET inside the matching tab', async () => {
    // Given
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response('{"usage":42}'));
    vi.stubGlobal('fetch', fetchImpl);
    const api = makeApi();
    api.scripting.executeScript = vi.fn<TabBridgeApi['scripting']['executeScript']>(
      async (injection) => [{ result: await injection.func(...injection.args) }],
    );

    // When
    const result = await createTabBridge(api).fetchViaTab('https://claude.ai/api/organizations', { timeoutMs: 1234 });

    // Then
    expect(result).toMatchObject({ status: 200, json: { usage: 42 } });
    expect(fetchImpl).toHaveBeenCalledWith('https://claude.ai/api/organizations', expect.objectContaining({
      method: 'GET', credentials: 'include', cache: 'no-store', signal: expect.any(AbortSignal),
    }));
  });

  describe('stuck tab recovery', () => {
    const URL = 'https://claude.ai/api/organizations';
    const good = { status: 200, headers: {}, text: '{"usage":1}' };
    const html = { status: 200, headers: {}, text: '<html>offline</html>' };

    const HEALTHY_PAGE: PageProbe = { readyState: 'complete', bodyLength: 200 };
    const STUCK_PAGE: PageProbe = { readyState: 'loading', bodyLength: 0 };

    function makeMulti(
      tabs: Array<{ id?: number; status?: string; discarded?: boolean }>,
      script: (tabId: number, call: number) => unknown,
      probe: PageProbe | null = HEALTHY_PAGE,
    ) {
      const calls = new Map<number, number>();
      const order: string[] = [];
      const reload = vi.fn().mockResolvedValue(undefined);
      const activate = vi.fn(async (id: number) => { order.push(`activate:${id}`); });
      const waitForComplete = vi.fn(async (id: number) => { order.push(`wait:${id}`); });
      const navigate = vi.fn(async (id: number, _url: string) => { order.push(`navigate:${id}`); });
      const probePage = vi.fn(async (id: number) => { order.push(`probe:${id}`); return probe; });
      const executeScript = vi.fn(async (injection: { target: { tabId: number } }) => {
        const id = injection.target.tabId;
        order.push(`exec:${id}`);
        const n = (calls.get(id) ?? 0) + 1;
        calls.set(id, n);
        const value = script(id, n);
        if (value instanceof Error) throw value;
        return [{ result: value }];
      });
      const api = {
        tabs: { query: vi.fn().mockResolvedValue(tabs), reload, activate, navigate, waitForComplete },
        scripting: { executeScript, probePage },
      } as unknown as TabBridgeApi;
      return { api, reload, activate, navigate, waitForComplete, executeScript, order };
    }

    it('navigates to the site root once when a reload leaves the page stuck, then succeeds', async () => {
      const { api, reload, navigate, order } = makeMulti(
        [{ id: 7, status: 'complete' }],
        (_id, n) => (n < 3 ? html : good),
        STUCK_PAGE,
      );

      const result = await createTabBridge(api).fetchViaTab(URL, {});

      expect(result).toMatchObject({ status: 200, json: { usage: 1 } });
      expect(reload).toHaveBeenCalledTimes(1);
      expect(navigate).toHaveBeenCalledTimes(1);
      expect(navigate).toHaveBeenCalledWith(7, 'https://claude.ai/');
      expect(order).toEqual(['exec:7', 'wait:7', 'exec:7', 'probe:7', 'navigate:7', 'wait:7', 'exec:7']);
    });

    it('does not navigate when the reload already recovered the page', async () => {
      const { api, navigate } = makeMulti([{ id: 7, status: 'complete' }], (_id, n) => (n === 1 ? html : good), STUCK_PAGE);

      const result = await createTabBridge(api).fetchViaTab(URL, {});

      expect(result).toMatchObject({ json: { usage: 1 } });
      expect(navigate).not.toHaveBeenCalled();
    });

    it('does not navigate a complete page that has content (a real non-JSON page)', async () => {
      const { api, navigate } = makeMulti([{ id: 7, status: 'complete' }], () => html, HEALTHY_PAGE);

      await createTabBridge(api).fetchViaTab(URL, {});

      expect(navigate).not.toHaveBeenCalled();
    });

    it('shares the cooldown between reload and navigate', async () => {
      let clock = 1_000;
      const { api, reload, navigate } = makeMulti([{ id: 7, status: 'complete' }], () => html, STUCK_PAGE);
      const bridge = createTabBridge(api, () => clock);

      await bridge.fetchViaTab(URL, {});
      clock += TAB_RELOAD_COOLDOWN_MS - 1;
      await bridge.fetchViaTab(URL, {});
      expect([reload.mock.calls.length, navigate.mock.calls.length]).toEqual([1, 1]);

      clock += 1;
      await bridge.fetchViaTab(URL, {});
      expect([reload.mock.calls.length, navigate.mock.calls.length]).toEqual([2, 2]);
    });

    it('maps a Cloudflare challenge page to the challenge status, distinct from error', async () => {
      const challenge = { status: 403, headers: { 'cf-mitigated': 'challenge' }, text: '<html>Just a moment...</html>' };
      const { api, reload, navigate } = makeMulti([{ id: 7, status: 'complete' }], () => challenge, STUCK_PAGE);

      const result = await createTabBridge(api).fetchViaTab(URL, {});

      expect(result).toMatchObject({ challenge: true });
      expect(statusFromHttp(result!)).toBe('challenge');
      expect(reload).not.toHaveBeenCalled();
      expect(navigate).not.toHaveBeenCalled();
    });

    it('activates a fully discarded tab, waits for load, then fetches', async () => {
      const { api, activate, reload, order } = makeMulti([{ id: 5, discarded: true, status: 'unloaded' }], () => good);

      const result = await createTabBridge(api).fetchViaTab(URL, {});

      expect(result).toMatchObject({ status: 200, json: { usage: 1 } });
      expect(activate).toHaveBeenCalledWith(5);
      expect(order).toEqual(['activate:5', 'wait:5', 'exec:5']);
      expect(reload).not.toHaveBeenCalled();
    });

    it('uses a healthy tab without activating a discarded one', async () => {
      const { api, activate, executeScript } = makeMulti(
        [{ id: 1, discarded: true }, { id: 2, status: 'complete' }],
        () => good,
      );

      await createTabBridge(api).fetchViaTab(URL, {});

      expect(activate).not.toHaveBeenCalled();
      expect(executeScript.mock.calls.map(([i]) => i.target.tabId)).toEqual([2]);
    });

    it('does not activate a discarded tab again within the cooldown', async () => {
      let clock = 1_000;
      const { api, activate } = makeMulti([{ id: 5, discarded: true }], () => html);
      const bridge = createTabBridge(api, () => clock);

      await bridge.fetchViaTab(URL, {});
      clock += TAB_RELOAD_COOLDOWN_MS - 1;
      await bridge.fetchViaTab(URL, {});
      expect(activate).toHaveBeenCalledTimes(1);

      clock += 1;
      await bridge.fetchViaTab(URL, {});
      expect(activate).toHaveBeenCalledTimes(2);
    });

    it('skips a stuck first tab and uses the healthy second tab without reloading', async () => {
      const { api, reload, executeScript } = makeMulti(
        [{ id: 1, status: 'complete' }, { id: 2, status: 'complete' }],
        (id) => (id === 1 ? new Error('chrome-error page') : good),
      );

      const result = await createTabBridge(api).fetchViaTab(URL, {});

      expect(result).toMatchObject({ status: 200, json: { usage: 1 } });
      expect(executeScript.mock.calls.map(([i]) => i.target.tabId)).toEqual([1, 2]);
      expect(reload).not.toHaveBeenCalled();
    });

    it('ignores discarded tabs and prefers complete tabs', async () => {
      const { api, executeScript } = makeMulti(
        [{ id: 1, status: 'loading' }, { id: 2, discarded: true, status: 'complete' }, { id: 3, status: 'complete' }],
        () => good,
      );

      await createTabBridge(api).fetchViaTab(URL, {});

      expect(executeScript.mock.calls.map(([i]) => i.target.tabId)).toEqual([3]);
    });

    it('reloads the tab once on a non-JSON 2xx, waits for load, then retries', async () => {
      const { api, reload, waitForComplete } = makeMulti([{ id: 7, status: 'complete' }], (_id, n) => (n === 1 ? html : good));

      const result = await createTabBridge(api).fetchViaTab(URL, {});

      expect(result).toMatchObject({ status: 200, json: { usage: 1 } });
      expect(reload).toHaveBeenCalledTimes(1);
      expect(reload).toHaveBeenCalledWith(7);
      expect(waitForComplete).toHaveBeenCalledWith(7, expect.any(Number));
    });

    it('reloads after executeScript fails and retries', async () => {
      const { api, reload } = makeMulti([{ id: 7, status: 'complete' }], (_id, n) => (n === 1 ? new Error('denied') : good));

      const result = await createTabBridge(api).fetchViaTab(URL, {});

      expect(result).toMatchObject({ json: { usage: 1 } });
      expect(reload).toHaveBeenCalledTimes(1);
    });

    it('does not reload again within the cooldown and falls back to the non-JSON result', async () => {
      let clock = 1_000;
      const { api, reload } = makeMulti([{ id: 7, status: 'complete' }], () => html);
      const bridge = createTabBridge(api, () => clock);

      const first = await bridge.fetchViaTab(URL, {});
      clock += TAB_RELOAD_COOLDOWN_MS - 1;
      const second = await bridge.fetchViaTab(URL, {});
      expect(reload).toHaveBeenCalledTimes(1);
      expect(first).toMatchObject({ status: 200, json: undefined });
      expect(second).toMatchObject({ status: 200, json: undefined });

      clock += 1;
      await bridge.fetchViaTab(URL, {});
      expect(reload).toHaveBeenCalledTimes(2);
    });
  });
});
