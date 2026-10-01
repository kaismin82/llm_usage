import { periodBounds, sumInBounds } from '../core/periods';
import { IdbPoeLedger, type PoeEntry, type PoeLedger } from '../core/poe-ledger';
import type { ProviderAdapter, ProviderContext, ProviderSnapshot, UsageWindow } from './types';
import {
  baseSnapshot,
  errorSnapshot,
  errorToSnapshot,
  isRecord,
  num,
  retryAtFromHeaders,
  statusFromHttp,
} from './util';

const BALANCE_URL = 'https://api.poe.com/usage/current_balance';
const HISTORY_URL = 'https://api.poe.com/usage/points_history?limit=100';
const MAX_HISTORY_PAGES = 50;

function headers(apiKey: string): { Authorization: string; Accept: string } {
  return { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' };
}

function schemaError(ctx: ProviderContext, message: string): ProviderSnapshot {
  return errorSnapshot('poe', ctx.now(), 'schema_changed', message, ctx.previous);
}

function parseBalance(body: unknown): number | undefined {
  if (!isRecord(body)) return undefined;
  const balance = num(body.current_point_balance);
  return balance !== undefined && Number.isInteger(balance) ? balance : undefined;
}

function parseHistoryEntry(value: unknown): PoeEntry | undefined {
  if (!isRecord(value)) throw new Error('Poe history entry is not an object');
  if (typeof value.query_id !== 'string' || value.query_id.length === 0) {
    throw new Error('Poe history entry is missing query_id');
  }
  if (typeof value.bot_name !== 'string' || typeof value.usage_type !== 'string') {
    throw new Error('Poe history entry is missing required fields');
  }
  const createdAt = num(value.creation_time);
  if (createdAt === undefined || !Number.isFinite(createdAt)) {
    throw new Error('Poe history entry has an invalid creation_time');
  }
  const points = num(value.cost_points);
  if (points === undefined || !Number.isFinite(points)) return undefined;
  return {
    queryId: value.query_id,
    time: createdAt / 1000,
    points,
    usageType: value.usage_type,
    bot: value.bot_name,
  };
}

async function syncHistory(ctx: ProviderContext, ledger: PoeLedger, apiKey: string): Promise<void> {
  let url = HISTORY_URL;
  for (let page = 0; page < MAX_HISTORY_PAGES; page += 1) {
    const response = await ctx.get(url, { headers: headers(apiKey), credentials: 'omit' });
    const status = statusFromHttp(response);
    if (status) throw new Error(`Poe history request failed: ${status}`);
    if (
      !isRecord(response.json)
      || typeof response.json.has_more !== 'boolean'
      || !Number.isInteger(response.json.length)
      || !Array.isArray(response.json.data)
    ) {
      throw new Error('Poe history response has an invalid schema');
    }

    const rawEntries = response.json.data;
    const entries: PoeEntry[] = [];
    let foundExisting = false;
    for (const rawEntry of rawEntries) {
      if (isRecord(rawEntry) && typeof rawEntry.query_id === 'string' && await ledger.has(rawEntry.query_id)) {
        foundExisting = true;
      }
      const entry = parseHistoryEntry(rawEntry);
      if (entry) entries.push(entry);
    }
    await ledger.putMany(entries);

    if (!response.json.has_more || foundExisting) break;
    const last = rawEntries.at(-1);
    if (!isRecord(last) || typeof last.query_id !== 'string' || last.query_id.length === 0) {
      throw new Error('Poe history response cannot be paginated');
    }
    url = `${HISTORY_URL}&starting_after=${encodeURIComponent(last.query_id)}`;
  }

  const meta = await ledger.getMeta();
  if (meta.coverageStart === undefined) {
    await ledger.setMeta({ coverageStart: ctx.now().getTime() - 30 * 24 * 60 * 60 * 1000 });
  }
  const retention = new Date(ctx.now());
  retention.setUTCMonth(retention.getUTCMonth() - 13);
  await ledger.prune(retention.getTime());
}

function matchesUsageType(entry: PoeEntry, filter: 'all' | 'api' | 'chat'): boolean {
  if (filter === 'api') return entry.usageType === 'API';
  if (filter === 'chat') return entry.usageType === 'Chat' || entry.usageType === 'Canvas App';
  return true;
}

async function ledgerWindows(ctx: ProviderContext, ledger: PoeLedger): Promise<UsageWindow[]> {
  const bounds = periodBounds(ctx.now(), ctx.settings.timezone, ctx.settings.weekStart);
  const starts = [bounds.day.start, bounds.week.start, bounds.month.start].map((date) => date.getTime());
  const ends = [bounds.day.end, bounds.week.end, bounds.month.end].map((date) => date.getTime());
  const entries = await ledger.range(Math.min(...starts), Math.max(...ends));
  const filter = ctx.providerSettings.usageTypeFilter ?? 'all';
  const filtered = entries.filter((entry) => matchesUsageType(entry, filter));
  const coverageStart = (await ledger.getMeta()).coverageStart;
  const window = (kind: 'day' | 'week' | 'month', label: string, period: { start: Date; end: Date }): UsageWindow => ({
    kind,
    label,
    usedAmount: sumInBounds(filtered, period),
    unit: 'points',
    periodTz: 'local',
    ...(coverageStart !== undefined && period.start.getTime() < coverageStart ? { partial: true } : {}),
  });
  return [
    window('day', '오늘', bounds.day),
    window('week', '이번주', bounds.week),
    window('month', '이번달', bounds.month),
  ];
}

export function createPoeAdapter(ledger: PoeLedger): ProviderAdapter {
  return {
    id: 'poe',
    async fetchSnapshot(ctx: ProviderContext): Promise<ProviderSnapshot> {
      const now = ctx.now();
      try {
        const apiKey = ctx.providerSettings.apiKey;
        if (!apiKey) return errorSnapshot('poe', now, 'not_configured', 'Poe API key is required', ctx.previous);

        const response = await ctx.get(BALANCE_URL, { headers: headers(apiKey), credentials: 'omit' });
        const status = statusFromHttp(response);
        if (status) {
          return errorSnapshot(
            'poe',
            now,
            status,
            'Poe balance request failed',
            ctx.previous,
            retryAtFromHeaders(response, now),
          );
        }
        const balance = parseBalance(response.json);
        if (balance === undefined) return schemaError(ctx, 'Poe balance response has an invalid schema');

        const snapshot = baseSnapshot('poe', now);
        snapshot.balance = { amount: balance, unit: 'points', label: '남은 포인트' };
        try {
          await syncHistory(ctx, ledger, apiKey);
        } catch {
        }
        try {
          snapshot.windows = await ledgerWindows(ctx, ledger);
        } catch {
        }
        return snapshot;
      } catch (error) {
        return errorToSnapshot('poe', now, error, ctx.previous);
      }
    },
  };
}

export const poeAdapter = createPoeAdapter(new IdbPoeLedger());
