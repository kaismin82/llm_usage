import { mkdir, writeFile } from 'node:fs/promises';
import { MemoryPoeLedger } from '../src/core/poe-ledger';
import { createSafeFetch } from '../src/core/safe-fetch';
import { defaultSettings } from '../src/core/settings';
import { formatPoints, formatRelative, formatUsd } from '../src/popup/format';
import { chatgptAdapter } from '../src/providers/chatgpt';
import { claudeAdapter } from '../src/providers/claude';
import { litellmAdapter } from '../src/providers/litellm';
import { openrouterAdapter } from '../src/providers/openrouter';
import { createPoeAdapter } from '../src/providers/poe';
import type {
  ProviderAdapter,
  ProviderContext,
  ProviderId,
  ProviderSettings,
  ProviderSnapshot,
  UsageWindow,
} from '../src/providers/types';
import { PROVIDER_IDS } from '../src/providers/types';
import { zaiAdapter } from '../src/providers/zai';

interface Plan {
  settings: Partial<ProviderSettings>;
  missing: string[];
  cookie?: string;
  cache?: Record<string, string>;
}

const USAGE = `Usage: npm run probe -- [provider ...] [--dump <dir>] [--json]

Runs the real provider adapters against the live APIs using keys from environment variables.
Providers: ${PROVIDER_IDS.join(', ')} (default: every provider whose variables are set)

Environment variables:
  zai         ZAI_API_KEY              [ZAI_REGION=global|china]
  poe         POE_API_KEY
  openrouter  OPENROUTER_API_KEY       [OPENROUTER_MODE=key|management]
  litellm     LITELLM_BASE_URL  LITELLM_API_KEY  [LITELLM_MODE=user|admin] [LITELLM_HEADER=Authorization]
  claude      CLAUDE_SESSION_KEY       (value of the claude.ai 'sessionKey' cookie; Cloudflare often blocks non-browser clients)
  chatgpt     CHATGPT_ACCESS_TOKEN     [CHATGPT_ACCOUNT_ID]  (Bearer token from https://chatgpt.com/api/auth/session)

Flags:
  --dump <dir>  write every raw response body to <dir> (contains your account data; do not share)
  --json        print the full snapshot JSON for each provider

Only GET requests to allowlisted endpoints are sent; reset-credit consume/redeem endpoints are never called.`;

function planFor(id: ProviderId, env: NodeJS.ProcessEnv): Plan {
  const need = (...names: string[]): string[] => names.filter((name) => !env[name]);
  switch (id) {
    case 'zai':
      return {
        missing: need('ZAI_API_KEY'),
        settings: { apiKey: env.ZAI_API_KEY, region: env.ZAI_REGION === 'china' ? 'china' : 'global' },
      };
    case 'poe':
      return { missing: need('POE_API_KEY'), settings: { apiKey: env.POE_API_KEY } };
    case 'openrouter':
      return {
        missing: need('OPENROUTER_API_KEY'),
        settings: { apiKey: env.OPENROUTER_API_KEY, mode: env.OPENROUTER_MODE === 'management' ? 'management' : 'key' },
      };
    case 'litellm':
      return {
        missing: need('LITELLM_BASE_URL', 'LITELLM_API_KEY'),
        settings: {
          baseUrl: env.LITELLM_BASE_URL,
          apiKey: env.LITELLM_API_KEY,
          mode: env.LITELLM_MODE === 'admin' ? 'admin' : 'user',
          headerName: env.LITELLM_HEADER,
        },
      };
    case 'claude':
      return {
        missing: need('CLAUDE_SESSION_KEY'),
        settings: {},
        cookie: env.CLAUDE_SESSION_KEY ? `sessionKey=${env.CLAUDE_SESSION_KEY}` : undefined,
      };
    case 'chatgpt':
      return {
        missing: need('CHATGPT_ACCESS_TOKEN'),
        settings: { accountId: env.CHATGPT_ACCOUNT_ID },
        cache: env.CHATGPT_ACCESS_TOKEN ? { 'chatgpt:token': env.CHATGPT_ACCESS_TOKEN } : undefined,
      };
  }
}

function adapterFor(id: ProviderId): ProviderAdapter {
  switch (id) {
    case 'claude':
      return claudeAdapter;
    case 'chatgpt':
      return chatgptAdapter;
    case 'zai':
      return zaiAdapter;
    case 'poe':
      return createPoeAdapter(new MemoryPoeLedger());
    case 'litellm':
      return litellmAdapter;
    case 'openrouter':
      return openrouterAdapter;
  }
}

function describeWindow(window: UsageWindow, now: Date): string {
  const used =
    window.usedPercent !== undefined
      ? `${Math.round(window.usedPercent * 10) / 10}%`
      : window.unit === 'usd'
        ? formatUsd(window.usedAmount ?? 0)
        : window.unit === 'points'
          ? `${formatPoints(window.usedAmount ?? 0)} pt`
          : `${window.usedAmount ?? 0} ${window.unit}`;
  const limit = window.limitAmount !== undefined ? ` / ${window.limitAmount}` : '';
  const reset = window.resetsAt ? `  resets ${window.resetsAt} (${formatRelative(window.resetsAt, now)})` : '';
  const flags = `${window.periodTz ? `  [${window.periodTz}]` : ''}${window.partial ? '  [partial]' : ''}`;
  return `  ${window.label.padEnd(16)} ${used}${limit}${reset}${flags}`;
}

function printSnapshot(snapshot: ProviderSnapshot, now: Date, asJson: boolean): void {
  console.log(`[${snapshot.provider}] status=${snapshot.status}${snapshot.plan ? ` plan=${snapshot.plan}` : ''}${snapshot.account ? ` account=${snapshot.account}` : ''}`);
  if (snapshot.error) console.log(`  error: ${snapshot.error.code} - ${snapshot.error.message}`);
  for (const window of snapshot.windows) console.log(describeWindow(window, now));
  if (snapshot.balance) console.log(`  balance          ${snapshot.balance.amount} ${snapshot.balance.unit}`);
  const available = snapshot.grants.filter((grant) => grant.status === 'available');
  if (snapshot.grantSupport !== 'n/a') {
    console.log(`  reset grants     ${available.length} available / ${snapshot.grants.length} listed (${snapshot.grantSupport})`);
    for (const grant of available) console.log(`    - scope=${grant.scope} remaining=${grant.remaining} expires=${grant.expiresAt ?? 'never'}`);
  }
  if (asJson) console.log(JSON.stringify(snapshot, null, 2));
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2).filter((arg) => arg !== '--');
  if (argv.includes('--help') || argv.includes('-h')) {
    console.log(USAGE);
    return;
  }
  const dumpIndex = argv.indexOf('--dump');
  const dumpDir = dumpIndex >= 0 ? argv[dumpIndex + 1] : undefined;
  const asJson = argv.includes('--json');
  const requested = argv.filter((arg, index) => !arg.startsWith('--') && !(dumpIndex >= 0 && index === dumpIndex + 1));
  const unknown = requested.filter((arg) => !PROVIDER_IDS.includes(arg as ProviderId));
  if (unknown.length > 0) {
    console.error(`Unknown provider: ${unknown.join(', ')}\n\n${USAGE}`);
    process.exitCode = 2;
    return;
  }

  const ids = (requested.length > 0 ? requested : PROVIDER_IDS) as ProviderId[];
  if (dumpDir) await mkdir(dumpDir, { recursive: true });

  let ran = 0;
  let failed = 0;
  for (const id of ids) {
    const plan = planFor(id, process.env);
    if (plan.missing.length > 0) {
      if (requested.length > 0) console.log(`[${id}] skipped - set ${plan.missing.join(', ')}`);
      continue;
    }
    ran += 1;
    const settings = defaultSettings();
    const providerSettings: ProviderSettings = { ...settings.providers[id], enabled: true, ...plan.settings };
    settings.providers[id] = providerSettings;
    const cache = new Map<string, string>(Object.entries(plan.cache ?? {}));
    const safeGet = createSafeFetch();
    let requestCount = 0;
    const get: ProviderContext['get'] = async (url, init) => {
      const headers = { ...(init?.headers ?? {}) };
      if (plan.cookie && new URL(url).hostname === 'claude.ai') headers.Cookie = plan.cookie;
      const response = await safeGet(url, { ...init, headers });
      requestCount += 1;
      console.log(`  GET ${url} -> ${response.status}${response.challenge ? ' (Cloudflare challenge)' : ''}`);
      if (dumpDir) await writeFile(`${dumpDir}/${id}-${requestCount}.json`, response.text);
      return response;
    };
    const now = new Date();
    const context: ProviderContext = {
      now: () => now,
      settings,
      providerSettings,
      get,
      cache: {
        get: async (key) => cache.get(key) || undefined,
        set: async (key, value) => {
          cache.set(key, value);
        },
      },
    };
    const snapshot = await adapterFor(id).fetchSnapshot(context);
    printSnapshot(snapshot, now, asJson);
    if (snapshot.status !== 'ok') failed += 1;
  }

  if (ran === 0) {
    console.log(`No provider configured.\n\n${USAGE}`);
    process.exitCode = 2;
    return;
  }
  process.exitCode = failed > 0 ? 1 : 0;
}

void main();
