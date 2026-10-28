import { isRecord } from './util';

// Messages usage report (GET /v1/organizations/usage_report/messages). Field names follow the official
// reference: platform.claude.com/docs/en/api/beta/organization/usage_report/retrieve_messages
export interface UsageRow {
  model: string;
  serviceTier: string;
  speed: string;
  geo: string;
  uncached: number;
  cacheRead: number;
  cache5m: number;
  cache1h: number;
  output: number;
  webSearch: number;
}
export interface UsageBucket { startingAt: string; endingAt?: string; rows: UsageRow[] }
export type UsageParse = { ok: true; buckets: UsageBucket[] } | { ok: false; message: string };

const count = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined;
const label = (value: unknown): string => (typeof value === 'string' ? value : '(null)');

function unreadable(first: unknown): UsageParse {
  const bucketKeys = isRecord(first) ? Object.keys(first) : [];
  const results = isRecord(first) && Array.isArray(first.results) ? first.results : [];
  const itemKeys = isRecord(results[0]) ? Object.keys(results[0]) : [];
  return {
    ok: false,
    message: '사용량 보고서 필드를 읽을 수 없습니다(API 변경 가능성). 버킷 필드: ' + (bucketKeys.join(', ') || '없음') +
      ' / 항목 필드: ' + (itemKeys.join(', ') || '없음'),
  };
}

/** Reads report buckets strictly; any missing or non-numeric token field fails instead of guessing. */
export function parseUsageBuckets(data: unknown): UsageParse {
  if (!Array.isArray(data)) return unreadable(undefined);
  const buckets: UsageBucket[] = [];
  for (const bucket of data) {
    if (!isRecord(bucket) || typeof bucket.starting_at !== 'string' || !Array.isArray(bucket.results)) return unreadable(bucket);
    const rows: UsageRow[] = [];
    for (const item of bucket.results) {
      if (!isRecord(item) || !isRecord(item.cache_creation)) return unreadable(bucket);
      const uncached = count(item.uncached_input_tokens);
      const cacheRead = count(item.cache_read_input_tokens);
      const output = count(item.output_tokens);
      const cache5m = count(item.cache_creation.ephemeral_5m_input_tokens);
      const cache1h = count(item.cache_creation.ephemeral_1h_input_tokens);
      const webSearch = item.server_tool_use === undefined ? 0
        : isRecord(item.server_tool_use) ? count(item.server_tool_use.web_search_requests) : undefined;
      if (uncached === undefined || cacheRead === undefined || output === undefined ||
          cache5m === undefined || cache1h === undefined || webSearch === undefined) return unreadable(bucket);
      rows.push({
        model: label(item.model), serviceTier: label(item.service_tier), speed: label(item.speed), geo: label(item.inference_geo),
        uncached, cacheRead, cache5m, cache1h, output, webSearch,
      });
    }
    buckets.push({ startingAt: bucket.starting_at, ...(typeof bucket.ending_at === 'string' ? { endingAt: bucket.ending_at } : {}), rows });
  }
  return { ok: true, buckets };
}

export const rowTokens = (row: UsageRow): number => row.uncached + row.cacheRead + row.cache5m + row.cache1h + row.output;
export const sumTokens = (buckets: UsageBucket[]): number =>
  buckets.reduce((sum, bucket) => sum + bucket.rows.reduce((inner, row) => inner + rowTokens(row), 0), 0);

export interface Price { label: string; input: number; cache5m: number; cache1h: number; cacheRead: number; output: number }
const p = (name: string, input: number, cache5m: number, cache1h: number, cacheRead: number, output: number): Price =>
  ({ label: name, input, cache5m, cache1h, cacheRead, output });

// USD per million tokens, standard tier, global inference. Source: platform.claude.com/docs/en/about-claude/pricing
// (read 2026-10-28). Model ids are derived from the listed model names, not read from the API.
// Claude Haiku 5.5 is deliberately absent: its price depends on each request's prompt length.
export const PRICES: Record<string, Price> = {
  'claude-fable-5-1': p('Claude Fable 5.1', 10, 12.5, 20, 0.25, 50),
  'claude-mythos-5-1': p('Claude Mythos 5.1', 10, 12.5, 20, 0.25, 50),
  'claude-fable-5': p('Claude Fable 5', 10, 12.5, 20, 1, 50),
  'claude-mythos-5': p('Claude Mythos 5', 10, 12.5, 20, 1, 50),
  'claude-opus-5-5': p('Claude Opus 5.5', 4, 5, 8, 0.2, 20),
  'claude-opus-5': p('Claude Opus 5', 5, 6.25, 10, 0.5, 25),
  'claude-opus-4-8': p('Claude Opus 4.8', 5, 6.25, 10, 0.5, 25),
  'claude-opus-4-7': p('Claude Opus 4.7', 5, 6.25, 10, 0.5, 25),
  'claude-opus-4-6': p('Claude Opus 4.6', 5, 6.25, 10, 0.5, 25),
  'claude-opus-4-5': p('Claude Opus 4.5', 5, 6.25, 10, 0.5, 25),
  'claude-opus-4-1': p('Claude Opus 4.1', 15, 18.75, 30, 1.5, 75),
  'claude-opus-4': p('Claude Opus 4', 15, 18.75, 30, 1.5, 75),
  'claude-sonnet-5-5': p('Claude Sonnet 5.5', 2, 2.5, 4, 0.1, 10),
  'claude-sonnet-5': p('Claude Sonnet 5', 2, 2.5, 4, 0.2, 10),
  'claude-sonnet-4-6': p('Claude Sonnet 4.6', 3, 3.75, 6, 0.3, 15),
  'claude-sonnet-4-5': p('Claude Sonnet 4.5', 3, 3.75, 6, 0.3, 15),
  'claude-sonnet-4': p('Claude Sonnet 4', 3, 3.75, 6, 0.3, 15),
  'claude-haiku-4-5': p('Claude Haiku 4.5', 1, 1.25, 2, 0.1, 5),
  'claude-haiku-3-5': p('Claude Haiku 3.5', 0.8, 1, 1.6, 0.08, 4),
};
const TIERED_MODELS = new Set(['claude-haiku-5-5']);

export const normalizeModelId = (model: string): string => model.toLowerCase().replace(/-latest$/, '').replace(/-\d{8}$/, '');

export interface Tokens { uncached: number; cacheRead: number; cache5m: number; cache1h: number; output: number; webSearch: number }
export type EstimateLine =
  | { kind: 'estimated'; model: string; priceLabel: string; tokens: Tokens; usd: number; formula: string }
  | { kind: 'unknown' | 'excluded'; model: string; tokens: Tokens; reason: string };
export interface UsageEstimate {
  lines: EstimateLine[];
  totalUsd: number;
  /** Web search requests seen in the same rows. They are not token costs and are never priced here. */
  webSearchRequests: number;
}

const empty = (): Tokens => ({ uncached: 0, cacheRead: 0, cache5m: 0, cache1h: 0, output: 0, webSearch: 0 });
function addTokens(target: Tokens, row: UsageRow): void {
  target.uncached += row.uncached; target.cacheRead += row.cacheRead; target.cache5m += row.cache5m;
  target.cache1h += row.cache1h; target.output += row.output; target.webSearch += row.webSearch;
}
const isStandard = (row: UsageRow): boolean =>
  row.serviceTier === 'standard' && row.speed === 'standard' && (row.geo === 'global' || row.geo === 'not_available');
const amount = (value: number): string => value.toLocaleString('en-US');

/**
 * Estimates what the tokens would cost at the published standard prices. Only standard-tier, standard-speed,
 * global rows are priced; other rows (batch, priority, fast, US-only, ...) carry different multipliers and are listed
 * as excluded. Models without a known price are listed as unknown, never priced.
 */
export function estimateUsageCost(buckets: UsageBucket[]): UsageEstimate {
  const priced = new Map<string, Tokens>();
  const other = new Map<string, { model: string; reason: string; tokens: Tokens }>();
  for (const bucket of buckets) {
    for (const row of bucket.rows) {
      if (isStandard(row)) {
        const tokens = priced.get(row.model) ?? empty();
        addTokens(tokens, row);
        priced.set(row.model, tokens);
      } else {
        const reason = 'service_tier=' + row.serviceTier + ', speed=' + row.speed + ', inference_geo=' + row.geo + ' 은(는) 표준 단가가 아니라 추정에서 제외';
        const key = row.model + '|' + reason;
        const entry = other.get(key) ?? { model: row.model, reason, tokens: empty() };
        addTokens(entry.tokens, row);
        other.set(key, entry);
      }
    }
  }
  const lines: EstimateLine[] = [];
  let totalUsd = 0;
  let webSearchRequests = 0;
  for (const bucket of buckets) for (const row of bucket.rows) webSearchRequests += row.webSearch;
  for (const [model, tokens] of priced) {
    const id = normalizeModelId(model);
    const price = PRICES[id];
    if (!price) {
      lines.push({ kind: 'unknown', model, tokens, reason: TIERED_MODELS.has(id) ? '단가 미확인: 프롬프트 길이별 단가(100k 기준)라 합계 버킷으로 계산할 수 없음' : '단가 미확인' });
      continue;
    }
    const parts: Array<[string, number, number]> = [
      ['uncached 입력', tokens.uncached, price.input], ['캐시 읽기', tokens.cacheRead, price.cacheRead],
      ['캐시 쓰기 5m', tokens.cache5m, price.cache5m], ['캐시 쓰기 1h', tokens.cache1h, price.cache1h], ['출력', tokens.output, price.output],
    ];
    let usd = 0;
    const terms: string[] = [];
    for (const [name, tokenCount, perMTok] of parts) {
      if (tokenCount <= 0) continue;
      usd += (tokenCount / 1_000_000) * perMTok;
      terms.push(name + ' ' + amount(tokenCount) + ' × $' + perMTok + '/MTok');
    }
    totalUsd += usd;
    lines.push({ kind: 'estimated', model, priceLabel: price.label, tokens, usd, formula: (terms.join(' + ') || '토큰 0') + ' = $' + usd.toFixed(4) });
  }
  for (const entry of other.values()) lines.push({ kind: 'excluded', model: entry.model, tokens: entry.tokens, reason: entry.reason });
  return { lines, totalUsd, webSearchRequests };
}

/** One-line verdict comparing today's tokens with today's cost bucket. */
export function judgeToday(todayTokens: number | undefined, costBucket: { usd: number } | undefined): string {
  if (todayTokens === undefined) return '오늘 토큰을 조회하지 못해 판정할 수 없습니다';
  if (todayTokens === 0) return '오늘 토큰 0개: 오늘 사용이 없거나 사용량 보고서도 아직 반영하지 않았습니다';
  const tokens = amount(todayTokens);
  if (costBucket === undefined) {
    return '오늘 토큰 ' + tokens + '개 있음 / 비용 버킷 없음 = 비용 보고서가 아직 오늘 분을 반영하지 않음 (원인은 문서로 확정되지 않음: 일 단위 확정 후 반영일 수 있음)';
  }
  if (costBucket.usd > 0) return '오늘 토큰 ' + tokens + '개 있음 / 비용 버킷에 $' + costBucket.usd.toFixed(2) + ' 포함 = 비용도 반영됨';
  return '오늘 토큰 ' + tokens + '개 있음 / 비용 버킷은 있으나 $0 = 비용 반영 지연 신호';
}
