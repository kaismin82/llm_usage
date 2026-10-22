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
    const startedAt = Date.now();
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
    const sessionAuthFailure = init.credentials === 'include' && (result.status === 401 || result.status === 403);
    if (
      (result.challenge || sessionAuthFailure) &&
      (allowedUrl.hostname === 'claude.ai' || allowedUrl.hostname === 'chatgpt.com') &&
      opts.tabBridge
    ) {
      const remainingMs = timeoutMs - (Date.now() - startedAt);
      if (remainingMs > 0) {
        const fallback = await opts.tabBridge.fetchViaTab(url, { ...init, timeoutMs: remainingMs });
        if (fallback && (
          fallback.challenge ||
          (fallback.status >= 200 && fallback.status < 300 && fallback.json !== undefined) ||
          (result.challenge && fallback.status === 401)
        )) {
          return fallback;
        }
      }
    }
    return result;
  };
}
