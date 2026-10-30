import type { HttpRequestInit, HttpResult } from '../providers/types';
import { assertAllowed } from './allowlist';
import { buildHttpResult } from './http-result';

interface TabFetchResponse {
  status: number;
  headers: Record<string, string>;
  text: string;
}

interface TabInfo {
  id?: number;
  status?: string;
  discarded?: boolean;
}

export interface TabBridgeApi {
  tabs: {
    query(queryInfo: { url: string }): Promise<TabInfo[]>;
    reload?(tabId: number): Promise<void>;
    /** Activating a discarded tab makes Chromium load it; a reload alone is deferred until activation. */
    activate?(tabId: number): Promise<void>;
    /** Resolves once the tab finished loading or the bound elapsed; never rejects. */
    waitForComplete?(tabId: number, timeoutMs: number): Promise<void>;
  };
  scripting: {
    executeScript(injection: {
      target: { tabId: number };
      world: 'ISOLATED';
      func: (url: string, headers: Record<string, string>, timeoutMs: number) => Promise<TabFetchResponse>;
      args: [string, Record<string, string>, number];
    }): Promise<Array<{ result?: TabFetchResponse }>>;
  };
}

export interface TabBridge {
  fetchViaTab(url: string, init: HttpRequestInit): Promise<HttpResult | null>;
}

export const TAB_RELOAD_COOLDOWN_MS = 10 * 60_000;
const TAB_RELOAD_WAIT_MS = 30_000;

function chromeApi(): TabBridgeApi {
  return {
    tabs: {
      query: (queryInfo) => chrome.tabs.query(queryInfo),
      reload: (tabId) => chrome.tabs.reload(tabId),
      activate: async (tabId) => { await chrome.tabs.update(tabId, { active: true }); },
      waitForComplete: (tabId, timeoutMs) => new Promise<void>((resolve) => {
        const finish = () => {
          clearTimeout(timer);
          chrome.tabs.onUpdated.removeListener(listener);
          resolve();
        };
        const listener = (updatedId: number, change: { status?: string }) => {
          if (updatedId === tabId && change.status === 'complete') finish();
        };
        const timer = setTimeout(finish, timeoutMs);
        chrome.tabs.onUpdated.addListener(listener);
      }),
    },
    scripting: {
      executeScript: (injection) => chrome.scripting.executeScript(injection),
    },
  };
}

async function fetchFromTab(url: string, headers: Record<string, string>, timeoutMs: number): Promise<TabFetchResponse> {
  const response = await fetch(url, {
    method: 'GET', credentials: 'include', headers, cache: 'no-store', signal: AbortSignal.timeout(timeoutMs),
  });
  const resultHeaders: Record<string, string> = {};
  response.headers.forEach((value, name) => {
    resultHeaders[name.toLowerCase()] = value;
  });
  return { status: response.status, headers: resultHeaders, text: await response.text() };
}

// A usable answer is JSON, a challenge (the circuit breaker needs it), or a
// non-2xx status. A 2xx non-JSON body means the tab shows an error or sign-in page.
function isUsable(result: HttpResult): boolean {
  const ok = result.status >= 200 && result.status < 300;
  return result.json !== undefined || result.challenge || !ok;
}

export function createTabBridge(api?: TabBridgeApi, now: () => number = Date.now): TabBridge {
  const lastReloadAt = new Map<number, number>();

  async function attempt(bridgeApi: TabBridgeApi, tabId: number, url: string, init: HttpRequestInit): Promise<HttpResult | null> {
    try {
      const results = await bridgeApi.scripting.executeScript({
        target: { tabId },
        world: 'ISOLATED',
        func: fetchFromTab,
        args: [url, init.headers ?? {}, init.timeoutMs ?? 15_000],
      });
      const result = results[0]?.result;
      return result ? buildHttpResult(result.status, result.headers, result.text) : null;
    } catch {
      return null;
    }
  }

  return {
    async fetchViaTab(url, init) {
      try {
        const origin = assertAllowed(url, 'GET').origin;
        const bridgeApi = api ?? chromeApi();
        const tabs = await bridgeApi.tabs.query({ url: `${origin}/*` });
        const ids: number[] = [];
        const discardedIds: number[] = [];
        for (const tab of tabs) {
          if (tab.id !== undefined && tab.discarded && !discardedIds.includes(tab.id)) discardedIds.push(tab.id);
        }
        for (const wantComplete of [true, false]) {
          for (const tab of tabs) {
            if (tab.id === undefined || tab.discarded || ids.includes(tab.id)) continue;
            if ((tab.status === 'complete') === wantComplete) ids.push(tab.id);
          }
        }
        if (ids.length === 0 && discardedIds.length === 0) return null;

        let fallback: HttpResult | null = null;
        for (const tabId of ids) {
          const result = await attempt(bridgeApi, tabId, url, init);
          if (!result) continue;
          if (isUsable(result)) return result;
          fallback ??= result;
        }

        // No healthy tab answered. A discarded tab is revived by activation (the reload cooldown is
        // shared, so this never repeats within the cooldown); it only loads once activated.
        const revive = discardedIds[0];
        if (revive !== undefined && bridgeApi.tabs.activate) {
          const lastRevive = lastReloadAt.get(revive);
          if (lastRevive === undefined || now() - lastRevive >= TAB_RELOAD_COOLDOWN_MS) {
            lastReloadAt.set(revive, now());
            try {
              await bridgeApi.tabs.activate(revive);
              await bridgeApi.tabs.waitForComplete?.(revive, TAB_RELOAD_WAIT_MS);
              const revived = await attempt(bridgeApi, revive, url, init);
              if (revived && isUsable(revived)) return revived;
              fallback ??= revived;
            } catch {
              // activation failed; fall through to the existing behavior
            }
          }
        }
        if (ids.length === 0) return fallback;

        // Every candidate failed or showed a non-JSON page: reload the first one, at most once per cooldown.
        const target = ids[0];
        const last = lastReloadAt.get(target);
        if (bridgeApi.tabs.reload && (last === undefined || now() - last >= TAB_RELOAD_COOLDOWN_MS)) {
          lastReloadAt.set(target, now());
          try {
            await bridgeApi.tabs.reload(target);
            await bridgeApi.tabs.waitForComplete?.(target, TAB_RELOAD_WAIT_MS);
            const retried = await attempt(bridgeApi, target, url, init);
            if (retried && isUsable(retried)) return retried;
            fallback ??= retried;
          } catch {
            // reload failed; fall through to the existing behavior
          }
        }
        return fallback;
      } catch {
        return null;
      }
    },
  };
}
