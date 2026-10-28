import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { request, type Server } from 'node:http';
import { createPhoneRelay } from '../src/phone-server/relay';
import { phonePayloadSchema, type PhonePayload } from '../src/phone-server/payload';

const readToken = 'reader-test-key-000000000000000000000';
const writeToken = 'writer-test-key-000000000000000000000';
const fixedNow = new Date('2026-10-25T10:00:00Z');
const payload: PhonePayload = {
  version: 1, sentAt: '2026-10-25T09:59:00Z',
  providers: [{
    id: 'chatgpt', name: 'ChatGPT', status: 'ok',
    fetchedAt: '2026-10-25T09:50:00Z', attemptedAt: '2026-10-25T09:50:00Z',
    windows: [{ kind: 'session_5h', label: '5h', unit: 'percent', usedPercent: 35 }],
    grants: [], grantSupport: 'unsupported',
    extraCredits: { unit: 'credits', balanceAmount: -2 },
  }],
};
let directory: string;
let writer: Server;
let reader: Server;
let writerUrl: string;
let readerUrl: string;

async function listen(server: Server): Promise<string> {
  const ready = once(server, 'listening');
  server.listen(0, '127.0.0.1');
  await ready;
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Expected TCP address');
  return `http://127.0.0.1:${address.port}`;
}
async function close(server: Server) {
  const closed = once(server, 'close');
  server.close();
  server.closeAllConnections();
  await closed;
}
function ingest(body: unknown, headers: Record<string, string> = {}) {
  return fetch(`${writerUrl}/api/ingest`, {
    method: 'POST', headers: { Authorization: `Bearer ${writeToken}`, 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
}

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'phone-relay-'));
  await writeFile(join(directory, 'index.html'), '<!doctype html><title>Phone test</title>');
  ({ reader, writer } = await createPhoneRelay({
    readToken, writeToken, webRoot: directory, snapshotPath: join(directory, 'snapshot.json'),
    readerHosts: ['example.tailnet.ts.net'], now: () => fixedNow,
  }));
  [readerUrl, writerUrl] = await Promise.all([listen(reader), listen(writer)]);
});
afterEach(async () => {
  await Promise.all([close(reader), close(writer)]);
  await rm(directory, { recursive: true, force: true });
});

describe('phone relay HTTP boundary', () => {
  it('serves a real received snapshot without changing collection time or credit units', async () => {
    expect((await ingest(payload)).status).toBe(200);
    const response = await fetch(`${readerUrl}/api/snapshot`, { headers: { Authorization: `Bearer ${readToken}` } });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ receivedAt: fixedNow.toISOString(), data: payload });
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(JSON.parse(await readFile(join(directory, 'snapshot.json'), 'utf8'))).toEqual({
      receivedAt: fixedNow.toISOString(), data: payload,
    });
  });
  it('reports no data before the extension has sent a snapshot', async () => {
    const response = await fetch(`${readerUrl}/api/snapshot`, { headers: { Authorization: `Bearer ${readToken}` } });
    expect(await response.json()).toEqual({ receivedAt: null, data: null });
  });
  it('rejects write credentials on the read endpoint', async () => {
    const response = await fetch(`${readerUrl}/api/snapshot`, { headers: { Authorization: `Bearer ${writeToken}` } });
    expect(response.status).toBe(401);
  });
  it('rejects reader credentials on the ingestion endpoint', async () => {
    expect((await ingest(payload, { Authorization: `Bearer ${readToken}` })).status).toBe(401);
  });
  it('rejects unauthenticated snapshot reads', async () => {
    expect((await fetch(`${readerUrl}/api/snapshot`)).status).toBe(401);
  });
  it('rejects provider secrets rather than persisting unexpected fields', async () => {
    const response = await ingest({ ...payload, apiKey: 'must-not-persist' });
    expect(response.status).toBe(400);
    await expect(readFile(join(directory, 'snapshot.json'))).rejects.toMatchObject({ code: 'ENOENT' });
  });
  it('rejects nested account data and unexpected custom configuration', async () => {
    expect(phonePayloadSchema.safeParse({
      ...payload, providers: payload.providers.map((provider) => ({ ...provider, account: 'private-account' })),
    }).success).toBe(false);
  });
  it('rejects website-origin ingestion even with valid credentials', async () => {
    expect((await ingest(payload, { Origin: 'https://untrusted.example' })).status).toBe(403);
  });
  it('never exposes ingestion through the remote reader server', async () => {
    const response = await fetch(`${readerUrl}/api/ingest`, {
      method: 'POST', headers: { Authorization: `Bearer ${writeToken}` }, body: JSON.stringify(payload),
    });
    expect(response.status).toBe(405);
  });
  it('rejects oversized bodies before parsing', async () => {
    const response = await ingest({ large: 'x'.repeat(256 * 1024) });
    expect(response.status).toBe(413);
  });
  it('does not serve arbitrary local files', async () => {
    expect((await fetch(`${readerUrl}/snapshot.json`)).status).toBe(404);
  });
  it('rejects a rebinding Host header', async () => {
    const status = await new Promise<number | undefined>((resolve, reject) => {
      const req = request(readerUrl, { headers: { Host: 'attacker.example' } }, (res) => {
        res.resume();
        resolve(res.statusCode);
      });
      req.once('error', reject);
      req.end();
    });
    expect(status).toBe(403);
  });
  it('serves the phone page with CSP and no cross-origin API permission', async () => {
    const response = await fetch(readerUrl);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-security-policy')).toContain("frame-ancestors 'none'");
    expect(response.headers.get('access-control-allow-origin')).toBeNull();
  });
  it('stores labeled accounts in separate slots and merges suffixed ids for readers', async () => {
    expect((await ingest(payload)).status).toBe(200);
    const labeled = { ...payload, account: 'sub2', providers: [payload.providers[0]] };
    expect((await ingest(labeled)).status).toBe(200);
    const response = await fetch(readerUrl + '/api/snapshot', { headers: { Authorization: 'Bearer ' + readToken } });
    const merged = await response.json();
    const ids = merged.data.providers.map((provider: { id: string }) => provider.id);
    expect(ids).toContain('chatgpt');
    expect(ids).toContain('chatgpt#sub2');
    const suffixed = merged.data.providers.find((provider: { id: string; name: string }) => provider.id === 'chatgpt#sub2');
    expect(suffixed.name).toBe('ChatGPT · sub2');
    expect(await readFile(join(directory, 'accounts', 'main.json'), 'utf8')).toContain('ChatGPT');
    expect(await readFile(join(directory, 'accounts', 'sub2.json'), 'utf8')).toContain('sub2');
  });

  it('keeps one claude_platform card when main and labeled slots both report it', async () => {
    const platform = {
      id: 'claude_platform', name: 'Claude Platform (API)', status: 'ok',
      fetchedAt: '2026-10-25T09:50:00Z', attemptedAt: '2026-10-25T09:50:00Z',
      windows: [{ kind: 'month', label: '이번달', unit: 'usd', usedAmount: 18.09, limitAmount: 200 }],
      grants: [],
    };
    const claude = { ...payload.providers[0], id: 'claude', name: 'Claude', extraCredits: undefined };
    expect((await ingest({ ...payload, providers: [claude, platform] })).status).toBe(200);
    expect((await ingest({ ...payload, account: 'sub2', providers: [claude, platform] })).status).toBe(200);
    const response = await fetch(readerUrl + '/api/snapshot', { headers: { Authorization: 'Bearer ' + readToken } });
    const ids = (await response.json()).data.providers.map((provider: { id: string }) => provider.id);
    expect(ids.filter((id: string) => id === 'claude_platform')).toHaveLength(1);
    expect(ids).toContain('claude#sub2');
    expect(ids).not.toContain('claude_platform#sub2');
  });

  it('answers extension-origin CORS preflights without credentials', async () => {
    const origin = 'chrome-extension://' + 'a'.repeat(32);
    const preflight = await fetch(readerUrl + '/api/snapshot', {
      method: 'OPTIONS',
      headers: { Origin: origin, 'Access-Control-Request-Method': 'GET', 'Access-Control-Request-Headers': 'authorization' },
    });
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get('access-control-allow-origin')).toBe(origin);
    expect(preflight.headers.get('access-control-allow-headers')).toContain('Authorization');
  });

  it('does not grant CORS to non-extension origins', async () => {
    const response = await fetch(readerUrl + '/api/snapshot', { headers: { Origin: 'https://untrusted.example' } });
    expect(response.status).toBe(401);
    expect(response.headers.get('access-control-allow-origin')).toBeNull();
  });

  it('rejects malformed account labels', async () => {
    expect((await ingest({ ...payload, account: 'bad label!' })).status).toBe(400);
  });
  it('rejects duplicate provider IDs', () => {
    expect(phonePayloadSchema.safeParse({ ...payload, providers: [...payload.providers, ...payload.providers] }).success).toBe(false);
  });
});
