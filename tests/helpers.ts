import { assertAllowed } from '../src/core/allowlist';
import { defaultSettings } from '../src/core/settings';
import type {
  AppSettings,
  HttpRequestInit,
  HttpResult,
  ProviderContext,
  ProviderId,
  ProviderSettings,
  ProviderSnapshot,
} from '../src/providers/types';

export interface RouteReply {
  status?: number;
  headers?: Record<string, string>;
  json?: unknown;
  text?: string;
  challenge?: boolean;
}

export interface Route {
  match: string | RegExp;
  reply: RouteReply | ((url: string, init?: HttpRequestInit) => RouteReply);
}

export interface TestContext extends ProviderContext {
  calls: { url: string; init?: HttpRequestInit }[];
}

export interface MakeCtxOptions {
  provider: ProviderId;
  routes: Route[];
  providerSettings?: Partial<ProviderSettings>;
  settings?: Partial<AppSettings>;
  now?: Date;
  previous?: ProviderSnapshot;
}

function matches(route: Route, url: string): boolean {
  return typeof route.match === 'string' ? url.includes(route.match) : route.match.test(url);
}

export function makeCtx(opts: MakeCtxOptions): TestContext {
  const base = defaultSettings();
  const settings: AppSettings = { ...base, ...(opts.settings ?? {}) };
  const providerSettings: ProviderSettings = {
    ...settings.providers[opts.provider],
    enabled: true,
    ...(opts.providerSettings ?? {}),
  };
  settings.providers = { ...settings.providers, [opts.provider]: providerSettings };
  const store = new Map<string, string>();
  const calls: TestContext['calls'] = [];
  return {
    calls,
    now: () => opts.now ?? new Date('2026-10-01T12:00:00Z'),
    settings,
    providerSettings,
    previous: opts.previous,
    cache: {
      get: async (key) => store.get(key) || undefined,
      set: async (key, value) => {
        store.set(key, value);
      },
    },
    get: async (url, init) => {
      assertAllowed(url, 'GET');
      calls.push({ url, init });
      const route = opts.routes.find((r) => matches(r, url));
      if (!route) return toResult({ status: 404 });
      const reply = typeof route.reply === 'function' ? route.reply(url, init) : route.reply;
      return toResult(reply);
    },
  };
}

function toResult(reply: RouteReply): HttpResult {
  const text = reply.text ?? (reply.json === undefined ? '' : JSON.stringify(reply.json));
  return {
    status: reply.status ?? 200,
    headers: reply.headers ?? {},
    text,
    json: reply.json,
    challenge: reply.challenge ?? false,
  };
}
