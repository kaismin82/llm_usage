import { buildHttpResult, headersToRecord } from '../core/http-result';
import type { SnapshotStatus } from '../providers/types';
import { retryAtFromHeaders, statusFromHttp } from '../providers/util';
import { customEndpoint, validateCustomProvider } from './config';
import { mapCustomSnapshot } from './mapping';
import { CustomConfigError } from './types';
import type { CustomProviderConfig, CustomSnapshot } from './types';

type FetchOptions = {
  readonly now: () => Date;
  readonly previous?: CustomSnapshot;
  readonly fetchImpl?: typeof fetch;
};

export function customErrorSnapshot(
  config: CustomProviderConfig,
  options: FetchOptions,
  error: { readonly status: SnapshotStatus; readonly message: string; readonly retryAt?: string },
): CustomSnapshot {
  const at = options.now().toISOString();
  return {
    provider: config.id, status: error.status,
    windows: options.previous?.windows ?? [],
    ...(options.previous?.balance ? { balance: options.previous.balance } : {}),
    fetchedAt: options.previous?.fetchedAt ?? at, attemptedAt: at,
    error: { code: error.status, message: error.message, ...(error.retryAt ? { retryAt: error.retryAt } : {}) },
  };
}

export async function fetchCustomSnapshot(config: CustomProviderConfig, options: FetchOptions): Promise<CustomSnapshot> {
  const validation = validateCustomProvider(config);
  if (validation) return customErrorSnapshot(config, options, { status: 'not_configured', message: validation });
  try {
    const headers = new Headers(config.headers);
    headers.set('Accept', 'application/json');
    switch (config.authMode) {
      case 'bearer': headers.set('Authorization', `Bearer ${config.apiKey}`); break;
      case 'header': headers.set(config.headerName, config.apiKey); break;
      case 'none':
      case 'session': break;
      default: {
        const exhaustive: never = config.authMode;
        return exhaustive;
      }
    }
    customEndpoint(config.endpoint);
    const response = await (options.fetchImpl ?? fetch)(config.endpoint, {
      method: 'GET', headers: headersToRecord(headers),
      credentials: config.authMode === 'session' ? 'include' : 'omit',
      redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(15_000),
    });
    const result = buildHttpResult(response.status, headersToRecord(response.headers), await response.text());
    const status = statusFromHttp(result);
    if (status) return customErrorSnapshot(config, options, {
      status, message: `사용량 조회 실패 (HTTP ${result.status})`,
      retryAt: retryAtFromHeaders(result, options.now()),
    });
    return mapCustomSnapshot(result.json, config, options.now());
  } catch (error) {
    return customErrorSnapshot(config, options, {
      status: error instanceof CustomConfigError ? 'schema_changed' : 'error',
      message: error instanceof CustomConfigError ? error.message : '사용량 요청에 실패했습니다 (네트워크, 리다이렉트 또는 시간 초과)',
    });
  }
}
