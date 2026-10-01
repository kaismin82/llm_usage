import type { HttpRequestInit, HttpResult } from '../providers/types';
import { assertAllowed } from './allowlist';
import { buildHttpResult } from './http-result';

interface TabFetchResponse {
  status: number;
  headers: Record<string, string>;
  text: string;
}

export interface TabBridgeApi {
  tabs: {
    query(queryInfo: { url: string }): Promise<Array<{ id?: number }>>;
  };
  scripting: {
    executeScript(injection: {
      target: { tabId: number };
      world: 'ISOLATED';
      func: (url: string, headers: Record<string, string>) => Promise<TabFetchResponse>;
      args: [string, Record<string, string>];
    }): Promise<Array<{ result?: TabFetchResponse }>>;
  };
}

export interface TabBridge {
  fetchViaTab(url: string, init: HttpRequestInit): Promise<HttpResult | null>;
}

function chromeApi(): TabBridgeApi {
  return {
    tabs: {
      query: (queryInfo) => chrome.tabs.query(queryInfo),
    },
    scripting: {
      executeScript: (injection) => chrome.scripting.executeScript(injection),
    },
  };
}

async function fetchFromTab(url: string, headers: Record<string, string>): Promise<TabFetchResponse> {
  const response = await fetch(url, { credentials: 'include', headers });
  const resultHeaders: Record<string, string> = {};
  response.headers.forEach((value, name) => {
    resultHeaders[name.toLowerCase()] = value;
  });
  return { status: response.status, headers: resultHeaders, text: await response.text() };
}

export function createTabBridge(api?: TabBridgeApi): TabBridge {
  return {
    async fetchViaTab(url, init) {
      try {
        const origin = assertAllowed(url, 'GET').origin;
        const bridgeApi = api ?? chromeApi();
        const tabs = await bridgeApi.tabs.query({ url: `${origin}/*` });
        const tabId = tabs.find((tab) => tab.id !== undefined)?.id;
        if (tabId === undefined) return null;

        const results = await bridgeApi.scripting.executeScript({
          target: { tabId },
          world: 'ISOLATED',
          func: fetchFromTab,
          args: [url, init.headers ?? {}],
        });
        const result = results[0]?.result;
        if (!result) return null;
        return buildHttpResult(result.status, result.headers, result.text);
      } catch {
        return null;
      }
    },
  };
}
