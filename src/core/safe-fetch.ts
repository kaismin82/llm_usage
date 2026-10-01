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

export function createSafeFetch(opts: SafeFetchOptions = {}): ProviderContext['get'] {
  return async (url, init = {}) => {
    const allowedUrl = assertAllowed(url, 'GET');
    const timeoutMs = init.timeoutMs ?? opts.defaultTimeoutMs ?? 15_000;
    const signal = AbortSignal.timeout(timeoutMs);
    let response: Response;

    try {
      response = await (opts.fetchImpl ?? fetch)(url, {
        method: 'GET',
        credentials: init.credentials ?? 'omit',
        headers: init.headers,
        signal,
        redirect: 'follow',
        cache: 'no-store',
      });
    } catch {
      throw signal.aborted ? namedError('TimeoutError') : namedError('NetworkError');
    }

    const result = buildHttpResult(response.status, headersToRecord(response.headers), await response.text());
    if (
      result.challenge &&
      (allowedUrl.hostname === 'claude.ai' || allowedUrl.hostname === 'chatgpt.com') &&
      opts.tabBridge
    ) {
      return (await opts.tabBridge.fetchViaTab(url, init)) ?? result;
    }
    return result;
  };
}
