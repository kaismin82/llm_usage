export class BlockedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BlockedError';
  }
}

const ZAI_PATHS = [
  /^\/api\/monitor\/usage\/(quota\/limit|model-usage|tool-usage)$/,
  /^\/api\/biz\/customer-package-reset\/list$/,
];

const FIXED_HOST_PATHS: Record<string, RegExp[]> = {
  'claude.ai': [/^\/api\/organizations$/, /^\/api\/organizations\/[0-9a-zA-Z-]{8,}\/usage$/],
  'chatgpt.com': [
    /^\/api\/auth\/session$/,
    /^\/backend-api\/wham\/usage$/,
    /^\/backend-api\/wham\/rate-limit-reset-credits$/,
  ],
  'api.z.ai': ZAI_PATHS,
  'open.bigmodel.cn': ZAI_PATHS,
  'api.poe.com': [/^\/usage\/current_balance$/, /^\/usage\/points_history$/],
  'openrouter.ai': [/^\/api\/v1\/(key|keys|activity|credits)$/],
  'status.claude.com': [/^\/api\/v2\/(incidents|summary)\.json$/],
};

const LITELLM_SUFFIX =
  /\/(key\/info|v2\/key\/info|user\/info|v2\/user\/info|user\/daily\/activity(\/aggregated)?|team\/daily\/activity|spend\/logs(\/v2)?|global\/spend\/report)$/;

const DENIED_PATH = /\/(consume|redeem|reset_rate_limits)(\/|$)/i;
const DENIED_HOSTS = new Set(['api.anthropic.com']);

export function assertAllowed(rawUrl: string, method = 'GET'): URL {
  if (method.toUpperCase() !== 'GET') {
    throw new BlockedError(`blocked: only GET is allowed, got ${method}`);
  }
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new BlockedError('blocked: invalid URL');
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new BlockedError(`blocked: protocol ${url.protocol}`);
  }
  const host = url.hostname.toLowerCase();
  const path = url.pathname.length > 1 ? url.pathname.replace(/\/+$/, '') : url.pathname;
  if (DENIED_HOSTS.has(host)) throw new BlockedError(`blocked: host ${host}`);
  if (DENIED_PATH.test(path)) throw new BlockedError(`blocked: state-changing path ${path}`);
  const fixed = FIXED_HOST_PATHS[host];
  if (fixed) {
    if (url.protocol !== 'https:' || !fixed.some((re) => re.test(path))) {
      throw new BlockedError(`blocked: ${host}${path} is not in the allowlist`);
    }
    return url;
  }
  if (LITELLM_SUFFIX.test(path)) return url;
  throw new BlockedError(`blocked: ${host}${path} is not in the allowlist`);
}
