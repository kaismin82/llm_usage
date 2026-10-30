import type { HttpRequestInit, HttpResult } from '../providers/types';
import { assertAllowed } from './allowlist';
import { buildHttpResult } from './http-result';

interface TabFetchResponse {
  status: number;
  headers: Record<string, string>;
  text: string;
}

export interface PageProbe {
  readyState: string;
  bodyLength: number;
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
    /** Same-site navigation of an existing tab: the last resort for a renderer stuck on a blank page. */
    navigate?(tabId: number, url: string): Promise<void>;
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
    /** Bounded readiness probe; null when the page cannot run the probe at all. Never rejects. */
    probePage?(tabId: number): Promise<PageProbe | null>;
  };
}

export interface TabBridge {
  fetchViaTab(url: string, init: HttpRequestInit): Promise<HttpResult | null>;
}

// One cooldown per tab covers the whole recovery chain (activate/reload, then navigate).
export const TAB_RELOAD_COOLDOWN_MS = 10 * 60_000;
const TAB_RELOAD_WAIT_MS = 30_000;
const TAB_PROBE_TIMEOUT_MS = 5_000;

function probePageInTab(): PageProbe {
  return { readyState: document.readyState, bodyLength: document.body?.innerText?.trim().length ?? 0 };
}

function chromeApi(): TabBridgeApi {
  return {
    tabs: {
      query: (queryInfo) => chrome.tabs.query(queryInfo),
      reload: (tabId) => chrome.tabs.reload(tabId),
      activate: async (tabId) => { await chrome.tabs.update(tabId, { active: true }); },
      navigate: async (tabId, url) => { await chrome.tabs.update(tabId, { url }); },
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
      probePage: async (tabId) => {
        let timer: ReturnType<typeof setTimeout> | undefined;
        try {
          const results = await Promise.race([
            chrome.scripting.executeScript({ target: { tabId }, world: 'ISOLATED', func: probePageInTab }),
            new Promise<null>((resolve) => { timer = setTimeout(() => resolve(null), TAB_PROBE_TIMEOUT_MS); }),
          ]);
          return results?.[0]?.result ?? null;
        } catch {
          return null;
        } finally {
          clearTimeout(timer);
        }
      },
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

// A page that cannot run the probe, is not complete, or has no content is a stuck renderer.
// A complete page with content that still answers non-JSON is a real page (sign-in, challenge).
async function isStuckPage(bridgeApi: TabBridgeApi, tabId: number): Promise<boolean> {
  const probe = (await bridgeApi.scripting.probePage?.(tabId)) ?? null;
  return probe === null || probe.readyState !== 'complete' || probe.bodyLength === 0;
}

export function createTabBridge(api?: TabBridgeApi, now: () => number = Date.now): TabBridge {
  const lastRecoveryAt = new Map<number, number>();

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

  function cooledDown(tabId: number): boolean {
    const last = lastRecoveryAt.get(tabId);
    return last === undefined || now() - last >= TAB_RELOAD_COOLDOWN_MS;
  }

  // Recovery chain for one tab: activate (discarded) or reload, retry; if the page is still
  // stuck, navigate to the site root once, retry. Returns the best answer, usable or not.
  async function recover(
    bridgeApi: TabBridgeApi,
    tabId: number,
    kind: 'activate' | 'reload',
    origin: string,
    url: string,
    init: HttpRequestInit,
  ): Promise<HttpResult | null> {
    lastRecoveryAt.set(tabId, now());
    let latest: HttpResult | null = null;
    try {
      if (kind === 'activate') await bridgeApi.tabs.activate?.(tabId);
      else await bridgeApi.tabs.reload?.(tabId);
      await bridgeApi.tabs.waitForComplete?.(tabId, TAB_RELOAD_WAIT_MS);
      latest = await attempt(bridgeApi, tabId, url, init);
      if (latest && isUsable(latest)) return latest;

      if (bridgeApi.tabs.navigate && (await isStuckPage(bridgeApi, tabId))) {
        await bridgeApi.tabs.navigate(tabId, `${origin}/`);
        await bridgeApi.tabs.waitForComplete?.(tabId, TAB_RELOAD_WAIT_MS);
        const navigated = await attempt(bridgeApi, tabId, url, init);
        if (navigated) latest = navigated;
      }
    } catch {
      // recovery failed; fall through to the best answer seen so far
    }
    return latest;
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

        // No healthy tab answered. A discarded tab is revived by activation; it only loads once activated.
        const revive = discardedIds[0];
        if (revive !== undefined && bridgeApi.tabs.activate && cooledDown(revive)) {
          const revived = await recover(bridgeApi, revive, 'activate', origin, url, init);
          if (revived && isUsable(revived)) return revived;
          fallback ??= revived;
        }
        if (ids.length === 0) return fallback;

        // Every candidate failed or showed a non-JSON page: reload the first one, at most once per cooldown.
        const target = ids[0];
        if (bridgeApi.tabs.reload && cooledDown(target)) {
          const reloaded = await recover(bridgeApi, target, 'reload', origin, url, init);
          if (reloaded && isUsable(reloaded)) return reloaded;
          fallback ??= reloaded;
        }
        return fallback;
      } catch {
        return null;
      }
    },
  };
}
