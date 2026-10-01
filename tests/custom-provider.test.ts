import { describe, expect, it, vi } from 'vitest';
import { assertAllowed } from '../src/core/allowlist';
import { fetchCustomSnapshot } from '../src/custom/fetch';
import { customOrigin, validateCustomProvider } from '../src/custom/config';
import type { CustomProviderConfig } from '../src/custom/types';

const NOW = new Date('2026-10-01T12:00:00Z');

function provider(patch: Partial<CustomProviderConfig> = {}): CustomProviderConfig {
  return {
    id: 'example', name: 'Example', enabled: true, intervalMin: 10,
    endpoint: 'https://usage.example.com/account/quota', authMode: 'bearer',
    apiKey: 'fixture-key', headerName: 'X-API-Key', headers: {},
    balancePath: 'data.balance', balanceUnit: 'usd',
    windows: [{
      label: 'Monthly', unit: 'tokens', usedPath: 'data.windows[0].used',
      limitPath: 'data.windows[0].limit', percentPath: '', resetPath: 'data.reset',
      resetFormat: 'seconds',
    }],
    ...patch,
  };
}

function response(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers });
}

describe('custom provider', () => {
  it('maps configured usage, limit, reset and balance fields', async () => {
    // Given
    const config = provider();
    const fetchImpl = vi.fn(async () => response({
      data: { windows: [{ used: '250', limit: 1000 }], balance: 12.5, reset: 1790942400 },
    }));
    // When
    const snapshot = await fetchCustomSnapshot(config, { now: () => NOW, fetchImpl });
    // Then
    expect(snapshot.status).toBe('ok');
    expect(snapshot.windows).toEqual([{
      kind: 'budget', label: 'Monthly', unit: 'tokens', usedAmount: 250,
      limitAmount: 1000, usedPercent: 25, resetsAt: '2026-10-02T12:00:00.000Z',
    }]);
    expect(snapshot.balance?.amount).toBe(12.5);
    expect(fetchImpl).toHaveBeenCalledWith(config.endpoint, expect.objectContaining({
      method: 'GET', redirect: 'error', credentials: 'omit',
      headers: expect.objectContaining({ authorization: 'Bearer fixture-key' }),
    }));
  });

  it('uses raw API key headers without a bearer prefix', async () => {
    // Given
    const config = provider({ authMode: 'header', headers: { 'X-Organization': 'team' } });
    const fetchImpl = vi.fn(async () => response({
      data: { windows: [{ used: 0, limit: 1000 }], balance: 0, reset: 1790942400 },
    }));
    // When
    const snapshot = await fetchCustomSnapshot(config, { now: () => NOW, fetchImpl });
    // Then
    expect(snapshot.status).toBe('ok');
    expect(snapshot.windows[0].usedAmount).toBe(0);
    expect(fetchImpl).toHaveBeenCalledWith(config.endpoint, expect.objectContaining({
      headers: expect.objectContaining({ 'x-api-key': 'fixture-key', 'x-organization': 'team' }),
    }));
  });

  it('includes session credentials only when explicitly configured', async () => {
    // Given
    const config = provider({ authMode: 'session', windows: [], balancePath: 'balance' });
    const fetchImpl = vi.fn(async () => response({ balance: 0 }));
    // When
    await fetchCustomSnapshot(config, { now: () => NOW, fetchImpl });
    // Then
    expect(fetchImpl).toHaveBeenCalledWith(config.endpoint, expect.objectContaining({
      credentials: 'include',
    }));
  });

  it.each([null, {}, { data: { balance: 10, windows: [{ used: 'wrong', limit: 10 }] } }])(
    'keeps previous values when configured fields are missing or invalid: %j',
    async (body) => {
      // Given
      const config = provider();
      const previous = await fetchCustomSnapshot(config, {
        now: () => NOW,
        fetchImpl: async () => response({ data: { windows: [{ used: 1, limit: 2 }], balance: 5, reset: 1790942400 } }),
      });
      // When
      const snapshot = await fetchCustomSnapshot(config, {
        now: () => new Date('2026-10-01T12:10:00Z'), previous, fetchImpl: async () => response(body),
      });
      // Then
      expect(snapshot.status).toBe('schema_changed');
      expect(snapshot.windows).toEqual(previous.windows);
      expect(snapshot.balance).toEqual(previous.balance);
      expect(snapshot.fetchedAt).toBe(previous.fetchedAt);
      expect(snapshot.attemptedAt).toBe('2026-10-01T12:10:00.000Z');
    },
  );

  it.each([[401, 'auth_required'], [429, 'rate_limited'], [500, 'error']] as const)(
    'reports HTTP %i as %s without treating it as fresh usage',
    async (status, expected) => {
      // Given
      const config = provider();
      // When
      const snapshot = await fetchCustomSnapshot(config, {
        now: () => NOW, fetchImpl: async () => response({}, status, { 'retry-after': '60' }),
      });
      // Then
      expect(snapshot.status).toBe(expected);
      if (status === 429) expect(snapshot.error?.retryAt).toBe('2026-10-01T12:01:00.000Z');
    },
  );

  it('supports explicit percentages and millisecond reset timestamps', async () => {
    // Given
    const config = provider({
      balancePath: '',
      windows: [{
        label: 'Quota', unit: 'percent', usedPath: '', limitPath: '', percentPath: 'percent',
        resetPath: 'reset', resetFormat: 'milliseconds',
      }],
    });
    // When
    const snapshot = await fetchCustomSnapshot(config, {
      now: () => NOW, fetchImpl: async () => response({ percent: 40, reset: 1790942400000 }),
    });
    // Then
    expect(snapshot.windows[0].usedPercent).toBe(40);
    expect(snapshot.windows[0].resetsAt).toBe('2026-10-02T12:00:00.000Z');
  });

  it.each([
    'https://usage.example.com/quota/consume',
    'https://usage.example.com/quota/redeem',
    'https://usage.example.com/quota/%63onsume',
    'https://usage.example.com/quota/%zz',
    'https://api.anthropic.com/api/oauth/usage',
    'https://chatgpt.com/backend-api/wham/rate-limit-reset-credits/consume',
    'ftp://usage.example.com/quota',
    'https://name:secret@usage.example.com/quota',
  ])('rejects unsafe configured endpoints before any request: %s', async (endpoint) => {
    // Given
    const fetchImpl = vi.fn(async () => response({}));
    // When
    const snapshot = await fetchCustomSnapshot(provider({ endpoint }), { now: () => NOW, fetchImpl });
    // Then
    expect(snapshot.status).toBe('not_configured');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('does not widen the built-in request allowlist', () => {
    // Given / When / Then
    expect(validateCustomProvider(provider())).toBeNull();
    expect(() => assertAllowed(provider().endpoint)).toThrow();
  });

  it('creates a valid Chrome host pattern without a URL port or path', () => {
    // Given / When / Then
    expect(customOrigin(provider({ endpoint: 'http://localhost:43123/quota?account=1' }))).toBe('http://localhost/*');
  });

  it('rejects providers with no mapped numeric data', () => {
    // Given / When / Then
    expect(validateCustomProvider(provider({ windows: [], balancePath: '' }))).not.toBeNull();
  });
});
