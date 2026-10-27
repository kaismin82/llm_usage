import type { ProviderContext } from '../providers/types';
import { assertAllowed } from './allowlist';
import { buildHttpResult, headersToRecord } from './http-result';
import type { TabBridge } from './tab-bridge';

export interface SafeFetchOptions {
  fetchImpl?: typeof fetch;
  tabBridge?: TabBridge | null;
  defaultTimeoutMs?: number;
}

function namedError(name: string): Error {
  const error = new Error(name);
  error.name = name;
  return error;
}

// Cookie-carrying requests to these hosts must originate from a signed-in page
// of the same site. A service-worker request with the user's session cookies
// looks like a bot to the site's WAF and can rotate or invalidate the session.
const SESSION_HOSTS = new Set(['claude.ai', 'chatgpt.com']);

export function createSafeFetch(opts: SafeFetchOptions = {}): ProviderContext['get'] {
  return async (url, init = {}) => {
    const allowedUrl = assertAllowed(url, 'GET');
    const timeoutMs = init.timeoutMs ?? opts.defaultTimeoutMs ?? 15_000;

    if (init.credentials === 'include' && SESSION_HOSTS.has(allowedUrl.hostname)) {
      const viaTab = opts.tabBridge ? await opts.tabBridge.fetchViaTab(url, { ...init, timeoutMs }) : null;
      if (!viaTab) throw namedError('NoSessionTab');
      // A 2xx non-JSON body is a sign-in page, not usage data.
      if (viaTab.status >= 200 && viaTab.status < 300 && viaTab.json === undefined && !viaTab.challenge) {
        return { ...viaTab, status: 401 };
      }
      return viaTab;
    }

    const signal = AbortSignal.timeout(timeoutMs);
    let response: Response;
    try {
      response = await (opts.fetchImpl ?? fetch)(url, {
        method: 'GET',
        credentials: 'omit',
        headers: init.headers,
        signal,
        redirect: 'follow',
        cache: 'no-store',
      });
    } catch {
      throw signal.aborted ? namedError('TimeoutError') : namedError('NetworkError');
    }
    return buildHttpResult(response.status, headersToRecord(response.headers), await response.text());
  };
}
