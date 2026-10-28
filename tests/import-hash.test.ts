import { afterEach, describe, expect, it, vi } from 'vitest';
import { applyImportHash, decodeImportHash, validateImportPayload } from '../src/options/import-hash';

const TOKEN = 'a'.repeat(64);

function hashFor(value: unknown): string {
  const json = JSON.stringify(value);
  const b64 = btoa(json).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return '#import=' + b64;
}

function installChrome() {
  const data: Record<string, unknown> = {};
  vi.stubGlobal('chrome', {
    storage: { local: {
      get: async (key: string) => ({ [key]: structuredClone(data[key]) }),
      set: async (items: Record<string, unknown>) => { Object.assign(data, structuredClone(items)); },
    } },
  });
  return data;
}

describe('decodeImportHash', () => {
  it('round-trips base64url JSON and rejects other hashes', () => {
    expect(decodeImportHash(hashFor({ relay: { enabled: true, writeToken: TOKEN } }))).toEqual({ relay: { enabled: true, writeToken: TOKEN } });
    expect(decodeImportHash('')).toBeNull();
    expect(decodeImportHash('#other=abc')).toBeNull();
    expect(decodeImportHash('#import=not-base64!!')).toBeNull();
  });
});

describe('validateImportPayload', () => {
  it('accepts only the whitelisted fields and ignores unknown ones', () => {
    const { payload, errors } = validateImportPayload({
      relay: { enabled: true, writeToken: TOKEN, accountLabel: 'sub2' },
      secondary: { enabled: true, readToken: TOKEN },
      apiKey: 'must-be-ignored',
      settings: { providers: {} },
    });
    expect(errors).toEqual([]);
    expect(payload.relay).toEqual({ enabled: true, writeToken: TOKEN, accountLabel: 'sub2' });
    expect(payload.secondary).toEqual({ enabled: true, readToken: TOKEN });
    expect(Object.keys(payload)).toEqual(['relay', 'secondary']);
  });

  it('rejects malformed labels and short tokens without echoing values', () => {
    const bad = validateImportPayload({ relay: { enabled: true, writeToken: 'short', accountLabel: 'bad label!' } });
    expect(bad.errors.length).toBeGreaterThan(0);
    expect(bad.payload.relay).toBeUndefined();
    expect(JSON.stringify(bad)).not.toContain('bad label');
  });
});

describe('applyImportHash', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('saves configs, keeps unknown fields out, and never puts tokens in the message', async () => {
    const data = installChrome();
    const result = await applyImportHash(hashFor({ relay: { enabled: true, writeToken: TOKEN, accountLabel: 'sub2' }, secondary: { enabled: true, readToken: 'b'.repeat(64) } }));
    expect(result.ok).toBe(true);
    expect(result.message).toContain('sub2');
    expect(result.message).not.toMatch(/[ab]{20,}/);
    expect(data['phoneRelayConfig']).toEqual({ enabled: true, writeToken: TOKEN, accountLabel: 'sub2' });
    expect(data['claudeSecondaryConfig']).toEqual({ enabled: true, readToken: 'b'.repeat(64) });
  });

  it('reports invalid links as failures without saving', async () => {
    const data = installChrome();
    const result = await applyImportHash('#import=%%%%');
    expect(result.ok).toBe(false);
    expect(Object.keys(data)).toEqual([]);
  });
});

describe('manifest permissions', () => {
  it('requires only loopback host permissions and keeps broad hosts optional', async () => {
    const manifest = JSON.parse(await import('node:fs').then((fs) => fs.readFileSync('public/manifest.json', 'utf8')));
    expect(manifest.host_permissions).toEqual(['http://127.0.0.1/*']);
    expect(manifest.optional_host_permissions).toContain('https://*/*');
    expect(manifest.optional_host_permissions).not.toContain('http://127.0.0.1/*');
  });
});
