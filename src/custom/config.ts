import { assertAllowed, BlockedError } from '../core/allowlist';
import { isRecord } from '../providers/util';
import { AUTH_MODES, CUSTOM_UNITS, RESET_FORMATS, CustomConfigError } from './types';
import type { CustomMessage, CustomProviderConfig, CustomWindowConfig } from './types';

const BUILTIN_HOSTS = new Set([
  'claude.ai', 'chatgpt.com', 'api.z.ai', 'open.bigmodel.cn',
  'api.poe.com', 'openrouter.ai', 'status.claude.com', 'api.anthropic.com',
]);
const DENIED_PATH = /\/(consume|redeem|reset_rate_limits)(\/|$)/i;
const FIELD_PATH = /^[^.[\]\s]+(?:\[\d+\]|\.[^.[\]\s]+)*$/;

export function customEndpoint(endpoint: string): URL {
  let url: URL;
  let pathname: string;
  try {
    url = new URL(endpoint);
    pathname = decodeURIComponent(url.pathname);
  } catch (error) {
    if (error instanceof TypeError || error instanceof URIError) throw new BlockedError('유효한 HTTP(S) 사용량 URL이 필요합니다');
    throw error;
  }
  if ((url.protocol !== 'https:' && url.protocol !== 'http:') || url.username || url.password || url.hash) {
    throw new BlockedError('HTTP(S) URL만 허용하며 URL의 인증 정보와 fragment는 사용할 수 없습니다');
  }
  if (BUILTIN_HOSTS.has(url.hostname)) return assertAllowed(endpoint, 'GET');
  if (DENIED_PATH.test(pathname)) throw new BlockedError('리셋권 소모 또는 사용량 변경 경로는 사용할 수 없습니다');
  return url;
}

export function customOrigin(config: CustomProviderConfig): string {
  const url = customEndpoint(config.endpoint);
  return `${url.protocol}//${url.hostname}/*`;
}

export function isCustomWindow(value: unknown): value is CustomWindowConfig {
  return isRecord(value)
    && ['label', 'usedPath', 'limitPath', 'percentPath', 'resetPath'].every((key) => typeof value[key] === 'string')
    && CUSTOM_UNITS.some((unit) => unit === value.unit)
    && RESET_FORMATS.some((format) => format === value.resetFormat);
}

export function isCustomProvider(value: unknown): value is CustomProviderConfig {
  return isRecord(value)
    && ['id', 'name', 'endpoint', 'apiKey', 'headerName', 'balancePath'].every((key) => typeof value[key] === 'string')
    && typeof value.enabled === 'boolean'
    && typeof value.intervalMin === 'number'
    && Number.isFinite(value.intervalMin)
    && AUTH_MODES.some((mode) => mode === value.authMode)
    && (value.balanceUnit === 'usd' || value.balanceUnit === 'points')
    && isRecord(value.headers) && Object.values(value.headers).every((v) => typeof v === 'string')
    && Array.isArray(value.windows) && value.windows.every(isCustomWindow);
}

export function validateCustomProvider(config: CustomProviderConfig): string | null {
  if (!/^[a-zA-Z0-9_-]+$/.test(config.id) || !config.name.trim()) return '프로바이더 이름이 필요합니다';
  try {
    customEndpoint(config.endpoint);
    new Headers(config.headers);
  } catch (error) {
    if (error instanceof BlockedError) return error.message;
    if (error instanceof TypeError) return '추가 헤더 이름 또는 값 형식을 확인해주세요';
    throw error;
  }
  if (!Number.isInteger(config.intervalMin) || config.intervalMin < 1 || config.intervalMin > 60) {
    return '조회 주기는 1~60분으로 설정해주세요';
  }
  if ((config.authMode === 'bearer' || config.authMode === 'header') && !config.apiKey.trim()) {
    return 'API 키가 필요합니다';
  }
  if (/[\r\n]/.test(config.apiKey) || !/^[!#$%&'*+\-.^_`|~0-9a-zA-Z]+$/.test(config.headerName)) {
    return '인증 헤더명 또는 API 키 형식이 잘못되었습니다';
  }
  if (!config.windows.length && !config.balancePath.trim()) return '사용량 또는 잔액 필드 경로가 필요합니다';
  for (const window of config.windows) {
    if (!window.label.trim() || (!window.usedPath.trim() && !window.percentPath.trim())) {
      return '각 사용량 창에 이름과 사용량 또는 사용률 경로를 입력해주세요';
    }
  }
  const paths = [config.balancePath, ...config.windows.flatMap((w) => [w.usedPath, w.limitPath, w.percentPath, w.resetPath])];
  if (paths.some((p) => p !== '' && !FIELD_PATH.test(p))) return '필드 경로는 data.used 또는 data.windows[0].used 형식으로 입력해주세요';
  return null;
}

export function parseCustomHeaders(text: string): Readonly<Record<string, string>> {
  const value: unknown = JSON.parse(text || '{}');
  if (!isRecord(value) || !Object.values(value).every((v) => typeof v === 'string')) {
    throw new CustomConfigError('추가 헤더는 문자열 값으로 이루어진 JSON 객체여야 합니다');
  }
  return Object.fromEntries(Object.entries(value).map(([key, v]) => [key, String(v)]));
}

export function isCustomMessage(value: unknown): value is CustomMessage {
  if (!isRecord(value)) return false;
  switch (value.type) {
    case 'custom-refresh': return value.id === undefined || typeof value.id === 'string';
    case 'custom-settings-changed': return typeof value.id === 'string';
    default: return false;
  }
}
