import { describe, expect, it, vi } from 'vitest';
import { createTabBridge, type TabBridgeApi } from '../src/core/tab-bridge';

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
        args: ['https://claude.ai/api/organizations', { Authorization: 'Bearer secret' }],
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
});
