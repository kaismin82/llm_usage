import type { ProviderContext } from './types';
import { isRecord, statusFromHttp } from './util';
import { failureMessage } from './claude-platform-diagnose';
import { summarizeCostBuckets } from './cost-summary';
import { parseUsageBuckets, type UsageBucket } from './claude-platform-usage';

const USAGE_URL = 'https://api.anthropic.com/v1/organizations/usage_report/messages';
const COST_URL = 'https://api.anthropic.com/v1/organizations/cost_report';
const ANTHROPIC_VERSION = '2023-06-01';
const USAGE_MAX_PAGES = 3;
const GROUP_BY = ['model', 'service_tier', 'speed', 'inference_geo'];

export type UsageSection =
  | { ok: true; params: string; pages: number; hasMore: boolean; buckets: UsageBucket[]; responseKeys: string[] }
  | { ok: false; message: string };
export type ProbeResult =
  | { ok: true; label: string; endingAt: string; buckets: number; lastStartingAt?: string; includesToday: boolean; totalUsd: number }
  | { ok: false; label: string; endingAt: string; message: string };
export interface UsageExtras { today: string; usageToday: UsageSection; usageMonth: UsageSection; probes: ProbeResult[] }

type Get = ProviderContext['get'];
type Json = { ok: true; json: Record<string, unknown> } | { ok: false; message: string };

async function requestJson(get: Get, url: string, apiKey: string): Promise<Json> {
  let response;
  try {
    response = await get(url, {
      headers: { 'x-api-key': apiKey, 'anthropic-version': ANTHROPIC_VERSION, Accept: 'application/json' },
      credentials: 'omit',
      timeoutMs: 20_000,
    });
  } catch (error) {
    return { ok: false, message: failureMessage(error) };
  }
  const status = statusFromHttp(response);
  if (status === 'auth_required') return { ok: false, message: '키가 거부되었습니다(HTTP ' + response.status + ')' };
  if (status === 'rate_limited') return { ok: false, message: '요청 제한(HTTP 429)' };
  if (status) return { ok: false, message: '조회 실패 (HTTP ' + response.status + ')' };
  if (!isRecord(response.json) || !Array.isArray(response.json.data)) return { ok: false, message: '응답 형식을 읽을 수 없습니다(API 변경 가능성)' };
  return { ok: true, json: response.json };
}

export async function fetchUsage(get: Get, apiKey: string, query: { startingAt: string; endingAt?: string; width: '1h' | '1d'; limit: number }): Promise<UsageSection> {
  const params = 'starting_at=' + query.startingAt + (query.endingAt ? ' · ending_at=' + query.endingAt : '') +
    ' · bucket_width=' + query.width + ' · limit=' + query.limit + ' · group_by=' + GROUP_BY.join(',');
  const raw: unknown[] = [];
  let page: string | undefined;
  let pages = 0;
  let hasMore = false;
  let responseKeys: string[] = [];
  for (let request = 0; request < USAGE_MAX_PAGES; request += 1) {
    const url = USAGE_URL + '?starting_at=' + query.startingAt + (query.endingAt ? '&ending_at=' + query.endingAt : '') +
      '&bucket_width=' + query.width + '&limit=' + query.limit + GROUP_BY.map((group) => '&group_by[]=' + group).join('') +
      (page ? '&page=' + encodeURIComponent(page) : '');
    const result = await requestJson(get, url, apiKey);
    if (!result.ok) return result;
    pages += 1;
    raw.push(...(result.json.data as unknown[]));
    responseKeys = Object.keys(result.json);
    hasMore = result.json.has_more === true;
    const next = typeof result.json.next_page === 'string' ? result.json.next_page : undefined;
    if (!hasMore || !next) break;
    page = next;
  }
  const parsed = parseUsageBuckets(raw);
  if (!parsed.ok) return parsed;
  return { ok: true, params, pages, hasMore, buckets: parsed.buckets, responseKeys };
}

async function probeCostEnding(get: Get, apiKey: string, label: string, startingAt: string, endingAt: string, today: string): Promise<ProbeResult> {
  const result = await requestJson(get, COST_URL + '?starting_at=' + startingAt + '&ending_at=' + endingAt + '&limit=31', apiKey);
  if (!result.ok) return { ok: false, label, endingAt, message: result.message };
  const summary = summarizeCostBuckets(result.json.data);
  if (!summary) return { ok: false, label, endingAt, message: '비용 보고서를 음수 아닌 USD 금액으로 읽을 수 없습니다' };
  const last = summary.bucketTotals.reduce<string | undefined>((best, bucket) => (best === undefined || bucket.startingAt > best ? bucket.startingAt : best), undefined);
  return {
    ok: true, label, endingAt, buckets: summary.buckets, ...(last === undefined ? {} : { lastStartingAt: last }),
    includesToday: summary.bucketTotals.some((bucket) => bucket.startingAt.slice(0, 10) === today), totalUsd: summary.totalUsd,
  };
}

/**
 * Read-only extras for the diagnosis: today's hourly and this month's daily token usage, and the same cost report
 * requested with three different ending_at values (three calls) to see which one includes today's bucket.
 */
export async function diagnoseUsageExtras(options: { apiKey: string; now: Date; get: Get }): Promise<UsageExtras> {
  const { apiKey, now, get } = options;
  const dayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const tomorrow = new Date(dayStart.getTime() + 86_400_000);
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const nextMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  const hourFloor = new Date(Math.floor(now.getTime() / 3_600_000) * 3_600_000);
  const today = dayStart.toISOString().slice(0, 10);
  const usageToday = await fetchUsage(get, apiKey, { startingAt: dayStart.toISOString(), width: '1h', limit: 24 });
  const usageMonth = await fetchUsage(get, apiKey, { startingAt: monthStart.toISOString(), endingAt: nextMonth.toISOString(), width: '1d', limit: 31 });
  const probes: ProbeResult[] = [];
  for (const [label, ending] of [['다음 달 1일', nextMonth], ['내일 00:00Z', tomorrow], ['현재 시각(시 단위 내림)', hourFloor]] as const) {
    probes.push(await probeCostEnding(get, apiKey, label, monthStart.toISOString(), ending.toISOString(), today));
  }
  return { today, usageToday, usageMonth, probes };
}
