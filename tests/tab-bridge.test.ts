import { afterEach, describe, expect, it, vi } from 'vitest';
import { createTabBridge, TAB_RELOAD_COOLDOWN_MS, type TabBridgeApi } from '../src/core/tab-bridge';

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

    function makeMulti(tabs: Array<{ id?: number; status?: string; discarded?: boolean }>, script: (tabId: number, call: number) => unknown) {
      const calls = new Map<number, number>();
      const reload = vi.fn().mockResolvedValue(undefined);
      const waitForComplete = vi.fn().mockResolvedValue(undefined);
      const executeScript = vi.fn(async (injection: { target: { tabId: number } }) => {
        const id = injection.target.tabId;
        const n = (calls.get(id) ?? 0) + 1;
        calls.set(id, n);
        const value = script(id, n);
        if (value instanceof Error) throw value;
        return [{ result: value }];
      });
      const api = {
        tabs: { query: vi.fn().mockResolvedValue(tabs), reload, waitForComplete },
        scripting: { executeScript },
      } as unknown as TabBridgeApi;
      return { api, reload, waitForComplete, executeScript };
    }

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
