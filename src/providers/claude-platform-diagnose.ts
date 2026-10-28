import type { ProviderContext } from './types';
import { isRecord, statusFromHttp } from './util';
import { summarizeCostBuckets, type CostSummary } from './cost-summary';

// Read-only diagnosis of the Claude Platform monthly figure: the same UTC-month cost_report the provider
// uses, grouped by description and workspace so a total can be compared with the Claude Console.
const COST_URL = 'https://api.anthropic.com/v1/organizations/cost_report';
const ANTHROPIC_VERSION = '2023-06-01';
export const DIAGNOSE_MAX_PAGES = 10;
const BUCKET_LIMIT = 31;

export interface DiagnoseParams {
  startingAt: string;
  endingAt: string;
  bucketWidth: '1d';
  limit: number;
  groupBy: string[];
}

export type DiagnoseResult =
  | {
    ok: true; params: DiagnoseParams; pages: number; hasMore: boolean; summary: CostSummary;
    /** UTC time the diagnosis ran. */
    queriedAt: string;
    /** Number of daily buckets each page returned. */
    pageSizes: number[];
    /** Top-level field names of the last response (names only, never values). */
    responseKeys: string[];
  }
  | { ok: false; message: string };

export function failureMessage(error: unknown): string {
  const name = error instanceof Error ? error.name : '';
  if (name === 'TimeoutError') return '시간 초과: api.anthropic.com 응답이 없습니다';
  if (name === 'NetworkError') return '연결 실패: 호스트 권한(api.anthropic.com)과 네트워크를 확인하세요';
  if (name === 'BlockedError') return '요청이 정책(allowlist)에 의해 차단되었습니다';
  return '조회에 실패했습니다';
}

export async function diagnoseClaudePlatform(options: {
  apiKey: string;
  now: Date;
  get: ProviderContext['get'];
}): Promise<DiagnoseResult> {
  const { now, get } = options;
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  const params: DiagnoseParams = {
    startingAt: start.toISOString(), endingAt: next.toISOString(), bucketWidth: '1d', limit: BUCKET_LIMIT,
    groupBy: ['description', 'workspace_id'],
  };
  const buckets: unknown[] = [];
  let page: string | undefined;
  let pages = 0;
  let hasMore = false;
  const pageSizes: number[] = [];
  let responseKeys: string[] = [];
  for (let request = 0; request < DIAGNOSE_MAX_PAGES; request += 1) {
    const url = COST_URL + '?starting_at=' + params.startingAt + '&ending_at=' + params.endingAt +
      '&bucket_width=' + params.bucketWidth + '&limit=' + params.limit +
      params.groupBy.map((group) => '&group_by[]=' + group).join('') +
      (page ? '&page=' + encodeURIComponent(page) : '');
    let response;
    try {
      response = await get(url, {
        headers: { 'x-api-key': options.apiKey, 'anthropic-version': ANTHROPIC_VERSION, Accept: 'application/json' },
        credentials: 'omit',
        timeoutMs: 20_000,
      });
    } catch (error) {
      return { ok: false, message: failureMessage(error) };
    }
    const status = statusFromHttp(response);
    if (status === 'auth_required') return { ok: false, message: '키가 거부되었습니다(HTTP ' + response.status + '): Admin 키 또는 조직 스코프 키인지 확인하세요' };
    if (status === 'rate_limited') return { ok: false, message: '요청 제한(HTTP 429): 잠시 후 다시 시도하세요' };
    if (status) return { ok: false, message: '조회 실패 (HTTP ' + response.status + ')' };
    if (!isRecord(response.json) || !Array.isArray(response.json.data)) {
      return { ok: false, message: '응답 형식을 읽을 수 없습니다(API 변경 가능성)' };
    }
    pages += 1;
    buckets.push(...response.json.data);
    pageSizes.push(response.json.data.length);
    responseKeys = Object.keys(response.json);
    const nextPage = typeof response.json.next_page === 'string' ? response.json.next_page : undefined;
    hasMore = response.json.has_more === true;
    if (!hasMore || !nextPage) break;
    page = nextPage;
  }
  const summary = summarizeCostBuckets(buckets);
  if (!summary) return { ok: false, message: '비용 보고서를 음수 아닌 USD 금액으로 읽을 수 없어 합계를 표시하지 않습니다' };
  return { ok: true, params, pages, hasMore, summary, queriedAt: now.toISOString(), pageSizes, responseKeys };
}
