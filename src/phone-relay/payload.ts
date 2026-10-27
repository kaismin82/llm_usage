import type { SnapshotMap } from '../core/store';
import type { CustomProviderConfig, CustomSnapshot } from '../custom/types';
import { PROVIDER_IDS, type AppSettings, type ProviderSnapshot } from '../providers/types';

export type PhonePayload = {
  version: 1;
  sentAt: string;
  providers: Array<{
    id: string;
    name: string;
    status: string;
    fetchedAt: string;
    attemptedAt: string;
    windows: Array<{
      kind: string; label: string; unit: string;
      usedPercent?: number; usedAmount?: number; limitAmount?: number;
      resetsAt?: string | null; windowSeconds?: number; periodTz?: string; partial?: boolean;
    }>;
    grants: Array<{
      scope: string; remaining: number; status: string;
      startsAt?: string | null; expiresAt?: string | null; countOnly?: boolean;
    }>;
    grantSupport?: string;
    extraCredits?: {
      unit: 'usd' | 'credits'; balanceAmount?: number; unlimited?: boolean; isEnabled?: boolean;
    };
    balance?: {
      amount: number; unit: 'usd' | 'points'; limit?: number; label?: string; resetsAt?: string | null;
    };
  }>;
};

const NAMES = {
  claude: 'Claude', chatgpt: 'ChatGPT', zai: 'Z.ai', poe: 'Poe', litellm: 'LiteLLM', openrouter: 'OpenRouter',
};

function phoneProvider(id: string, name: string, snapshot: ProviderSnapshot | CustomSnapshot): PhonePayload['providers'][number] {
  return {
    id, name, status: snapshot.status, fetchedAt: snapshot.fetchedAt, attemptedAt: snapshot.attemptedAt,
    windows: snapshot.windows.map((w) => ({
      kind: w.kind, label: w.label, unit: w.unit,
      usedPercent: w.usedPercent, usedAmount: w.usedAmount, limitAmount: w.limitAmount,
      resetsAt: w.resetsAt, windowSeconds: w.windowSeconds, periodTz: w.periodTz, partial: w.partial,
    })),
    grants: 'grants' in snapshot ? snapshot.grants.map((g) => ({
      scope: g.scope, remaining: g.remaining, status: g.status,
      startsAt: g.startsAt, expiresAt: g.expiresAt, countOnly: g.countOnly,
    })) : [],
    grantSupport: 'grantSupport' in snapshot ? snapshot.grantSupport : undefined,
    extraCredits: snapshot.extraCredits === undefined ? undefined : {
      unit: snapshot.extraCredits.unit, balanceAmount: snapshot.extraCredits.balanceAmount,
      unlimited: snapshot.extraCredits.unlimited, isEnabled: snapshot.extraCredits.isEnabled,
    },
    balance: snapshot.balance === undefined ? undefined : {
      amount: snapshot.balance.amount, unit: snapshot.balance.unit, limit: snapshot.balance.limit,
      label: snapshot.balance.label, resetsAt: snapshot.balance.resetsAt,
    },
  };
}

export function buildPhonePayload(
  settings: AppSettings,
  snapshots: SnapshotMap,
  custom: readonly CustomProviderConfig[],
  customSnapshots: Record<string, CustomSnapshot>,
  now: Date,
): PhonePayload {
  const providers: PhonePayload['providers'] = [];
  for (const id of PROVIDER_IDS) {
    const snapshot = snapshots[id];
    if (settings.providers[id].enabled && snapshot) providers.push(phoneProvider(id, NAMES[id], snapshot));
  }
  for (const config of custom) {
    const snapshot = customSnapshots[config.id];
    if (config.enabled && snapshot) providers.push(phoneProvider(config.id, config.name, snapshot));
  }
  return { version: 1, sentAt: now.toISOString(), providers };
}
