import type {
  HttpResult,
  ProviderAdapter,
  ProviderContext,
  ProviderSnapshot,
  ResetGrant,
  UsageWindow,
} from './types';
import {
  baseSnapshot,
  errorSnapshot,
  errorToSnapshot,
  hashId,
  isRecord,
  num,
  retryAtFromHeaders,
  statusFromHttp,
} from './util';

const ORGS_URL = 'https://claude.ai/api/organizations';
const ORG_CACHE_KEY = 'claude:orgId';
const ORG_CACHE_TTL = 86_400_000;
const REQUEST_INIT = {
  credentials: 'include' as const,
  headers: { Accept: 'application/json, text/plain, */*' },
};

interface Organization {
  id: string;
  record?: Record<string, unknown>;
}

function iso(value: unknown): string | null | undefined {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string') return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

function organizationId(value: Record<string, unknown>): string | undefined {
  for (const key of ['uuid', 'organization_uuid', 'id']) {
    const candidate = value[key];
    if (typeof candidate === 'string' && candidate) return candidate;
  }
  return undefined;
}

function organizationList(value: unknown): Record<string, unknown>[] | undefined {
  const items = Array.isArray(value)
    ? value
    : isRecord(value) && Array.isArray(value.organizations)
      ? value.organizations
      : undefined;
  if (!items) return undefined;
  return items.filter(isRecord);
}

function planFor(org: Record<string, unknown> | undefined): string | undefined {
  if (!org) return undefined;
  const tier = typeof org.rate_limit_tier === 'string' ? org.rate_limit_tier.toLowerCase() : '';
  if (tier.includes('max_20x')) return 'Max 20x';
  if (tier.includes('max_5x')) return 'Max 5x';
  if (tier.includes('max')) return 'Max';
  if (tier.includes('team')) return 'Team';
  if (tier.includes('enterprise')) return 'Enterprise';
  if (tier.includes('pro')) return 'Pro';
  const capabilities = Array.isArray(org.capabilities) ? org.capabilities : [];
  if (capabilities.includes('claude_max')) return 'Max';
  if (capabilities.includes('claude_pro')) return 'Pro';
  return undefined;
}

function windowFromLimit(value: unknown): UsageWindow | undefined {
  if (!isRecord(value) || typeof value.kind !== 'string') return undefined;
  const usedPercent = num(value.percent);
  const resetsAt = iso(value.resets_at);
  if (usedPercent === undefined || resetsAt === undefined) return undefined;
  if (value.kind === 'session') {
    return { kind: 'session_5h', label: '5시간', unit: 'percent', usedPercent, resetsAt, windowSeconds: 18_000 };
  }
  if (value.kind === 'weekly_all') {
    return { kind: 'weekly_7d', label: '7일', unit: 'percent', usedPercent, resetsAt, windowSeconds: 604_800 };
  }
  if (value.kind === 'weekly_scoped') {
    const scope = isRecord(value.scope) ? value.scope : undefined;
    const model = scope && isRecord(scope.model) ? scope.model : undefined;
    if (typeof model?.display_name !== 'string' || !model.display_name) return undefined;
    return {
      kind: 'weekly_model',
      label: `7일 · ${model.display_name}`,
      unit: 'percent',
      usedPercent,
      resetsAt,
      windowSeconds: 604_800,
    };
  }
  return undefined;
}

function flatWindow(value: unknown, kind: UsageWindow['kind'], label: string, windowSeconds: number): UsageWindow | undefined {
  if (value === null || !isRecord(value)) return undefined;
  const usedPercent = num(value.utilization);
  const resetsAt = iso(value.resets_at);
  if (usedPercent === undefined || resetsAt === undefined) return undefined;
  return { kind, label, unit: 'percent', usedPercent, resetsAt, windowSeconds };
}

function usageWindows(body: Record<string, unknown>): UsageWindow[] {
  const limits = Array.isArray(body.limits) ? body.limits : undefined;
  const windows = limits && limits.length > 0
    ? limits.map(windowFromLimit).filter((window): window is UsageWindow => window !== undefined)
    : [
        flatWindow(body.five_hour, 'session_5h', '5시간', 18_000),
        flatWindow(body.seven_day, 'weekly_7d', '7일', 604_800),
        flatWindow(body.seven_day_opus, 'weekly_model', '7일 · Opus', 604_800),
        flatWindow(body.seven_day_sonnet, 'weekly_model', '7일 · Sonnet', 604_800),
      ].filter((window): window is UsageWindow => window !== undefined);
  const extra = isRecord(body.extra_usage) ? body.extra_usage : undefined;
  if (extra?.is_enabled === true) {
    const usedCredits = num(extra.used_credits);
    const monthlyLimit = num(extra.monthly_limit);
    const utilization = num(extra.utilization);
    if (usedCredits !== undefined && monthlyLimit !== undefined && monthlyLimit > 0) {
      windows.push({
        kind: 'month',
        label: 'Extra usage',
        unit: 'usd',
        usedAmount: usedCredits / 100,
        limitAmount: monthlyLimit / 100,
        usedPercent: utilization ?? (usedCredits / monthlyLimit) * 100,
      });
    }
  }
  return windows;
}

function grantScope(value: unknown): ResetGrant['scope'] {
  if (!Array.isArray(value) || value.length === 0 || !value.every((item) => typeof item === 'string')) return 'all';
  if (value.every((item) => item === 'five_hour')) return 'session_5h';
  if (value.every((item) => item === 'seven_day')) return 'weekly_7d';
  return 'all';
}

async function grantsFor(body: Record<string, unknown>, now: Date): Promise<Pick<ProviderSnapshot, 'grants' | 'grantSupport'>> {
  const grants: ResetGrant[] = [];
  let supported = false;
  let notEligible = false;
  for (const [program, candidate] of Object.entries(body)) {
    if (!isRecord(candidate) || !Array.isArray(candidate.grants) || candidate.grants.length > 200) continue;
    if (typeof candidate.eligible !== 'boolean') continue;
    if (!candidate.eligible) {
      notEligible = true;
      continue;
    }
    supported = true;
    for (let index = 0; index < candidate.grants.length; index += 1) {
      const grant = candidate.grants[index];
      if (!isRecord(grant)) continue;
      const remaining = num(grant.resets_left);
      const startsAt = iso(grant.starts_at);
      const expiresAt = iso(grant.ends_at);
      if (remaining === undefined || remaining < 0 || typeof grant.paused !== 'boolean' || startsAt === undefined || expiresAt === undefined) continue;
      const startMs = startsAt === null ? undefined : new Date(startsAt).getTime();
      const expiryMs = expiresAt === null ? undefined : new Date(expiresAt).getTime();
      const rawId = typeof grant.id === 'string' || typeof grant.id === 'number' ? grant.id : `${program}:${index}`;
      grants.push({
        provider: 'claude',
        idHash: await hashId('claude', rawId),
        scope: grantScope(grant.clears),
        remaining,
        startsAt,
        expiresAt,
        title: typeof grant.label === 'string' ? grant.label : null,
        status: grant.paused
          ? 'paused'
          : startMs !== undefined && startMs > now.getTime()
            ? 'not_yet'
            : expiryMs !== undefined && expiryMs <= now.getTime()
              ? 'expired'
              : remaining === 0
                ? 'used'
                : 'available',
      });
    }
  }
  return { grants, grantSupport: supported ? 'supported' : notEligible ? 'not_eligible' : 'unsupported' };
}

async function discoverOrganization(ctx: ProviderContext, useConfiguredId: boolean): Promise<Organization | undefined> {
  if (useConfiguredId && ctx.providerSettings.orgId) return { id: ctx.providerSettings.orgId };
  const cached = await ctx.cache.get(ORG_CACHE_KEY);
  if (cached) return { id: cached };
  const response = await ctx.get(ORGS_URL, REQUEST_INIT);
  const status = statusFromHttp(response);
  if (status) throw { response, status };
  const organizations = organizationList(response.json);
  if (!organizations || organizations.length === 0) return undefined;
  const selected = organizations.find((org) => Array.isArray(org.capabilities) && org.capabilities.includes('chat')) ?? organizations[0];
  const id = organizationId(selected);
  if (!id) return undefined;
  await ctx.cache.set(ORG_CACHE_KEY, id, ORG_CACHE_TTL);
  return { id, record: selected };
}

async function getUsage(ctx: ProviderContext, orgId: string, withGrantQuery: boolean): Promise<HttpResult> {
  const suffix = withGrantQuery ? '?cedar_ember=1' : '';
  return ctx.get(`https://claude.ai/api/organizations/${orgId}/usage${suffix}`, REQUEST_INIT);
}

export const claudeAdapter: ProviderAdapter = {
  id: 'claude',
  async fetchSnapshot(ctx): Promise<ProviderSnapshot> {
    const now = ctx.now();
    try {
      let organization: Organization | undefined;
      try {
        organization = await discoverOrganization(ctx, true);
      } catch (error) {
        if (isRecord(error) && 'response' in error && 'status' in error && typeof error.status === 'string') {
          const response = error.response as HttpResult;
          return errorSnapshot('claude', now, error.status as ProviderSnapshot['status'], `Organization discovery failed (HTTP ${response.status})`, ctx.previous, retryAtFromHeaders(response, now));
        }
        throw error;
      }
      if (!organization) return errorSnapshot('claude', now, 'schema_changed', 'Organization schema changed', ctx.previous);

      let response = await getUsage(ctx, organization.id, true);
      let grantQuerySupported = true;
      if (response.status === 404) {
        await ctx.cache.set(ORG_CACHE_KEY, '');
        organization = await discoverOrganization(ctx, false);
        if (!organization) return errorSnapshot('claude', now, 'schema_changed', 'Organization schema changed', ctx.previous);
        response = await getUsage(ctx, organization.id, true);
      }
      if (!response.challenge && response.status !== 200 && response.status !== 401 && response.status !== 429) {
        response = await getUsage(ctx, organization.id, false);
        grantQuerySupported = false;
      }
      const httpStatus = statusFromHttp(response);
      if (httpStatus) return errorSnapshot('claude', now, httpStatus, 'Usage request failed', ctx.previous, retryAtFromHeaders(response, now));
      if (!isRecord(response.json)) return errorSnapshot('claude', now, 'schema_changed', 'Usage schema changed', ctx.previous);

      const snapshot = baseSnapshot('claude', now);
      snapshot.plan = planFor(organization.record);
      snapshot.account = typeof organization.record?.name === 'string' ? organization.record.name : undefined;
      snapshot.windows = usageWindows(response.json);
      if (snapshot.windows.length === 0) return errorSnapshot('claude', now, 'schema_changed', 'Usage schema changed', ctx.previous);
      const grantData = grantQuerySupported
        ? await grantsFor(response.json, now)
        : { grants: [], grantSupport: 'unsupported' as const };
      snapshot.grants = grantData.grants;
      snapshot.grantSupport = grantData.grantSupport;
      return snapshot;
    } catch (error) {
      return errorToSnapshot('claude', now, error, ctx.previous);
    }
  },
};
