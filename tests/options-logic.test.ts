import { describe, expect, it } from 'vitest';
import {
  clampInterval,
  maskKey,
  validateProviderSettings,
  isValidTimezone,
  statusLabel,
  maskErrorMessage,
  formatLastSuccess,
  needsSessionLogin,
  needsApiKey,
  PROVIDER_ORDER,
  PROVIDER_DISPLAY,
  COMMON_TIMEZONES,
} from '../src/options/logic';
import type { ProviderSettings } from '../src/providers/types';

function ps(overrides: Partial<ProviderSettings> = {}): ProviderSettings {
  return { enabled: true, intervalMin: 3, ...overrides };
}

describe('clampInterval', () => {
  it('clamps values below 1 to 1', () => {
    expect(clampInterval(0)).toBe(1);
    expect(clampInterval(-5)).toBe(1);
    expect(clampInterval(0.3)).toBe(1);
  });

  it('clamps values above 60 to 60', () => {
    expect(clampInterval(61)).toBe(60);
    expect(clampInterval(999)).toBe(60);
  });

  it('rounds to nearest integer', () => {
    expect(clampInterval(3.7)).toBe(4);
    expect(clampInterval(10.2)).toBe(10);
  });

  it('passes through valid integers', () => {
    expect(clampInterval(1)).toBe(1);
    expect(clampInterval(30)).toBe(30);
    expect(clampInterval(60)).toBe(60);
  });

  it('returns 1 for NaN and Infinity', () => {
    expect(clampInterval(NaN)).toBe(1);
    expect(clampInterval(Infinity)).toBe(1);
    expect(clampInterval(-Infinity)).toBe(1);
  });
});

describe('maskKey', () => {
  it('returns empty string for undefined or empty', () => {
    expect(maskKey(undefined)).toBe('');
    expect(maskKey('')).toBe('');
  });

  it('fully masks short keys (<=8 chars)', () => {
    expect(maskKey('abc')).toBe('•••');
    expect(maskKey('12345678')).toBe('••••••••');
  });

  it('shows first 4 and last 4 of longer keys', () => {
    const key = 'sk-1234567890abcdef';
    const masked = maskKey(key);
    expect(masked.startsWith('sk-1')).toBe(true);
    expect(masked.endsWith('cdef')).toBe(true);
    expect(masked).not.toContain('567890ab');
    expect(masked.includes('•')).toBe(true);
  });

  it('caps the masked middle at 20 dots', () => {
    const longKey = 'abcd' + 'x'.repeat(100) + 'wxyz';
    const masked = maskKey(longKey);
    const dots = masked.split('').filter((c) => c === '•').length;
    expect(dots).toBe(20);
    expect(masked.startsWith('abcd')).toBe(true);
    expect(masked.endsWith('wxyz')).toBe(true);
  });
});

describe('validateProviderSettings', () => {
  it('returns null for claude and chatgpt (no key needed)', () => {
    expect(validateProviderSettings('claude', ps())).toBeNull();
    expect(validateProviderSettings('chatgpt', ps())).toBeNull();
  });

  it('requires API key for zai when enabled', () => {
    expect(validateProviderSettings('zai', ps())).toBe('API 키를 입력해주세요.');
    expect(validateProviderSettings('zai', ps({ apiKey: 'test' }))).toBeNull();
  });

  it('requires API key for poe when enabled', () => {
    expect(validateProviderSettings('poe', ps())).toBe('API 키를 입력해주세요.');
    expect(validateProviderSettings('poe', ps({ apiKey: 'key' }))).toBeNull();
  });

  it('requires API key for openrouter when enabled', () => {
    expect(validateProviderSettings('openrouter', ps())).toBe('API 키를 입력해주세요.');
    expect(validateProviderSettings('openrouter', ps({ apiKey: 'k' }))).toBeNull();
  });

  it('requires base URL and API key for litellm', () => {
    expect(validateProviderSettings('litellm', ps())).toBe('Base URL을 입력해주세요.');
    expect(validateProviderSettings('litellm', ps({ baseUrl: 'https://x.com' }))).toBe(
      'API 키를 입력해주세요.',
    );
    expect(
      validateProviderSettings('litellm', ps({ baseUrl: 'https://x.com', apiKey: 'k' })),
    ).toBeNull();
  });

  it('rejects invalid litellm base URL protocol', () => {
    expect(
      validateProviderSettings('litellm', ps({ baseUrl: 'ftp://x.com', apiKey: 'k' })),
    ).toBe('유효한 HTTP(S) URL을 입력해주세요.');
  });

  it('rejects unparseable litellm base URL', () => {
    expect(
      validateProviderSettings('litellm', ps({ baseUrl: 'not a url', apiKey: 'k' })),
    ).toBe('유효한 URL을 입력해주세요.');
  });

  it('skips validation when not enabled', () => {
    expect(validateProviderSettings('zai', ps({ enabled: false }))).toBeNull();
    expect(validateProviderSettings('litellm', ps({ enabled: false }))).toBeNull();
  });
});

describe('isValidTimezone', () => {
  it('accepts valid IANA timezones', () => {
    expect(isValidTimezone('Asia/Seoul')).toBe(true);
    expect(isValidTimezone('UTC')).toBe(true);
    expect(isValidTimezone('America/New_York')).toBe(true);
  });

  it('rejects invalid strings', () => {
    expect(isValidTimezone('NotAZone')).toBe(false);
    expect(isValidTimezone('')).toBe(false);
    expect(isValidTimezone('Mars/Olympus')).toBe(false);
  });
});

describe('statusLabel', () => {
  it('maps known statuses to Korean labels', () => {
    expect(statusLabel('ok')).toBe('정상');
    expect(statusLabel('auth_required')).toBe('로그인 필요');
    expect(statusLabel('error')).toBe('오류');
    expect(statusLabel('schema_changed')).toBe('API 변경 감지');
    expect(statusLabel('not_configured')).toBe('미설정');
  });

  it('returns the raw status for unknown values', () => {
    expect(statusLabel('something_new' as 'ok')).toBe('something_new');
  });
});

describe('maskErrorMessage', () => {
  it('returns empty string for undefined', () => {
    expect(maskErrorMessage(undefined)).toBe('');
  });

  it('masks Bearer tokens', () => {
    expect(maskErrorMessage('failed with Bearer sk-abc123xyz')).toBe(
      'failed with Bearer •••',
    );
  });

  it('masks sk- prefixed keys', () => {
    expect(maskErrorMessage('key sk-abcdefgh is invalid')).toBe(
      'key sk-•••• is invalid',
    );
  });

  it('masks key= patterns', () => {
    expect(maskErrorMessage('key=secretvalue')).toBe('key=•••');
  });

  it('passes through safe messages', () => {
    expect(maskErrorMessage('timeout after 15s')).toBe('timeout after 15s');
  });
});

describe('formatLastSuccess', () => {
  it('returns 없음 for undefined or empty', () => {
    expect(formatLastSuccess(undefined)).toBe('없음');
    expect(formatLastSuccess('')).toBe('없음');
  });

  it('returns 없음 for invalid dates', () => {
    expect(formatLastSuccess('not-a-date')).toBe('없음');
  });

  it('formats a valid ISO date', () => {
    const result = formatLastSuccess('2026-10-01T12:30:00Z');
    expect(result).toBeTruthy();
    expect(result).not.toBe('없음');
  });
});

describe('needsSessionLogin', () => {
  it('returns true for claude and chatgpt', () => {
    expect(needsSessionLogin('claude')).toBe(true);
    expect(needsSessionLogin('chatgpt')).toBe(true);
  });

  it('returns false for key-based providers', () => {
    expect(needsSessionLogin('zai')).toBe(false);
    expect(needsSessionLogin('poe')).toBe(false);
    expect(needsSessionLogin('litellm')).toBe(false);
    expect(needsSessionLogin('openrouter')).toBe(false);
  });
});

describe('needsApiKey', () => {
  it('returns true for key-based providers', () => {
    expect(needsApiKey('zai')).toBe(true);
    expect(needsApiKey('poe')).toBe(true);
    expect(needsApiKey('litellm')).toBe(true);
    expect(needsApiKey('openrouter')).toBe(true);
  });

  it('returns false for session-based providers', () => {
    expect(needsApiKey('claude')).toBe(false);
    expect(needsApiKey('chatgpt')).toBe(false);
  });
});

describe('PROVIDER_ORDER', () => {
  it('lists all six providers in the correct order', () => {
    expect(PROVIDER_ORDER).toEqual([
      'claude', 'chatgpt', 'zai', 'poe', 'litellm', 'openrouter',
    ]);
  });
});

describe('PROVIDER_DISPLAY', () => {
  it('has a display name for every provider', () => {
    for (const id of PROVIDER_ORDER) {
      expect(typeof PROVIDER_DISPLAY[id]).toBe('string');
      expect(PROVIDER_DISPLAY[id].length).toBeGreaterThan(0);
    }
  });
});

describe('COMMON_TIMEZONES', () => {
  it('includes Asia/Seoul as first entry', () => {
    expect(COMMON_TIMEZONES[0]).toBe('Asia/Seoul');
  });

  it('all entries are valid IANA timezones', () => {
    for (const tz of COMMON_TIMEZONES) {
      expect(isValidTimezone(tz)).toBe(true);
    }
  });
});
