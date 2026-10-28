import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFile, writeFile, rename, readdir, mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { timingSafeEqual } from 'node:crypto';
import { phonePayloadSchema, receiptSchema, type PhoneReceipt } from './payload';

const MAX_BODY = 256 * 1024;
const MAIN = 'main';
const ACCOUNT_RE = /^[A-Za-z0-9_-]{1,40}$/;
const EXTENSION_ORIGIN_RE = /^chrome-extension:\/\/[a-p]{32}$/;
const assets = new Map([
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ['/index.html', ['index.html', 'text/html; charset=utf-8']],
  ['/app.js', ['app.js', 'text/javascript; charset=utf-8']],
  ['/style.css', ['style.css', 'text/css; charset=utf-8']],
  ['/manifest.webmanifest', ['manifest.webmanifest', 'application/manifest+json']],
  ['/icon.svg', ['icon.svg', 'image/svg+xml']],
]);
const CSP = "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'";

type RelayOptions = {
  readonly writeToken: string;
  readonly readToken: string;
  readonly webRoot: string;
  readonly snapshotPath: string;
  readonly readerHosts: readonly string[];
  readonly accountDir?: string;
  readonly now?: () => Date;
};

function matchesToken(header: string | undefined, token: string): boolean {
  const actual = Buffer.from(header ?? '');
  const expected = Buffer.from(`Bearer ${token}`);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

function reply(res: ServerResponse, status: number, value: unknown) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(value));
}

function missingFile(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT';
}

class BodyLimitError extends Error {}

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += bytes.length;
    if (size > MAX_BODY) throw new BodyLimitError();
    chunks.push(bytes);
  }
  return Buffer.concat(chunks).toString('utf8');
}

function applyCors(req: IncomingMessage, res: ServerResponse): void {
  const origin = req.headers.origin;
  if (typeof origin === 'string' && EXTENSION_ORIGIN_RE.test(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  }
}

// Multi-account merge: entries from labeled (non-main) slots are exposed with
// `<id>#<label>` and a display-name suffix so the merged payload keeps unique ids.
function mergedReceipt(slots: Map<string, PhoneReceipt>): PhoneReceipt | null {
  if (slots.size === 0) return null;
  const labels = [...slots.keys()].sort((a, b) => (a === MAIN ? -1 : b === MAIN ? 1 : a.localeCompare(b)));
  const providers: PhoneReceipt['data']['providers'] = [];
  let receivedAt = '';
  let sentAt = '';
  for (const label of labels) {
    const receipt = slots.get(label);
    if (!receipt) continue;
    if (receipt.receivedAt > receivedAt) receivedAt = receipt.receivedAt;
    if (receipt.data.sentAt > sentAt) sentAt = receipt.data.sentAt;
    for (const provider of receipt.data.providers) {
      // Labeled (non-main) slots exist to show a second Claude subscription. Their other providers
      // (unconfigured ChatGPT/Z.ai, shared-key API providers, the organization-wide claude_platform)
      // duplicate the main slot or carry no setup, so only the Claude subscription is merged.
      // The slot file keeps the full payload.
      if (label !== MAIN && provider.id !== 'claude') continue;
      providers.push(label === MAIN ? provider : { ...provider, id: `${provider.id}#${label}`, name: `${provider.name} · ${label}` });
    }
  }
  return { receivedAt, data: { version: 1, sentAt, providers } };
}

export async function createPhoneRelay(options: RelayOptions) {
  if (options.readToken.length < 32 || options.writeToken.length < 32 ||
      options.readToken === options.writeToken) {
    throw new Error('Relay requires distinct read/write credentials of at least 32 characters.');
  }
  const accountDir = options.accountDir ?? join(dirname(options.snapshotPath), 'accounts');
  await mkdir(accountDir, { recursive: true });
  const slots = new Map<string, PhoneReceipt>();
  try {
    for (const file of (await readdir(accountDir)).filter((name) => name.endsWith('.json')).sort()) {
      const parsed = receiptSchema.safeParse(JSON.parse(await readFile(join(accountDir, file), 'utf8')));
      if (parsed.success) slots.set(file.slice(0, -'.json'.length), parsed.data);
    }
  } catch (error) {
    if (!missingFile(error)) throw error;
  }
  if (slots.size === 0) {
    // Migrate a pre-multi-account snapshot file into the main slot.
    try {
      const legacy = receiptSchema.parse(JSON.parse(await readFile(options.snapshotPath, 'utf8')));
      slots.set(MAIN, legacy);
      await persistSlot(MAIN, legacy);
    } catch (error) {
      if (!missingFile(error)) throw error;
    }
  }
  let writing = false;
  const now = options.now ?? (() => new Date());

  async function persistSlot(label: string, receipt: PhoneReceipt): Promise<void> {
    await writeFile(join(accountDir, `${label}.json`), JSON.stringify(receipt), { mode: 0o600 });
  }
  async function persistMerged(): Promise<void> {
    const merged = mergedReceipt(slots);
    if (!merged) return;
    await writeFile(`${options.snapshotPath}.tmp`, JSON.stringify(merged), { mode: 0o600 });
    await rename(`${options.snapshotPath}.tmp`, options.snapshotPath);
  }

  const handler = (mode: 'reader' | 'writer') => async (req: IncomingMessage, res: ServerResponse) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Content-Security-Policy', CSP);
    res.setHeader('X-Frame-Options', 'DENY');
    applyCors(req, res);
    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }
    try {
      const url = new URL(req.url ?? '/', 'http://127.0.0.1');
      const host = new URL(`http://${req.headers.host ?? ''}`).hostname.toLowerCase();
      const localHost = host === '127.0.0.1' || host === 'localhost';
      if (!localHost && (mode === 'writer' || !options.readerHosts.includes(host))) {
        reply(res, 403, { error: 'host_not_allowed' }); return;
      }
      if (mode === 'writer') {
        if (url.pathname !== '/api/ingest') { reply(res, 404, { error: 'not_found' }); return; }
        if (req.method !== 'POST') { reply(res, 405, { error: 'method_not_allowed' }); return; }
        const origin = req.headers.origin;
        if (origin && !EXTENSION_ORIGIN_RE.test(origin)) {
          reply(res, 403, { error: 'origin_not_allowed' }); return;
        }
        if (!matchesToken(req.headers.authorization, options.writeToken)) {
          reply(res, 401, { error: 'unauthorized' }); return;
        }
        if (req.headers['content-type']?.split(';')[0]?.trim() !== 'application/json') {
          reply(res, 415, { error: 'json_required' }); return;
        }
        if (Number(req.headers['content-length'] ?? 0) > MAX_BODY) {
          reply(res, 413, { error: 'payload_too_large' }); return;
        }
        const parsed = phonePayloadSchema.safeParse(JSON.parse(await readBody(req)));
        if (!parsed.success) { reply(res, 400, { error: 'invalid_payload' }); return; }
        const label = parsed.data.account ?? MAIN;
        if (!ACCOUNT_RE.test(label)) { reply(res, 400, { error: 'invalid_account' }); return; }
        if (writing) { reply(res, 409, { error: 'write_in_progress' }); return; }
        writing = true;
        try {
          const next: PhoneReceipt = { receivedAt: now().toISOString(), data: parsed.data };
          slots.set(label, next);
          await persistSlot(label, next);
          await persistMerged();
        } finally {
          writing = false;
        }
        reply(res, 200, { ok: true }); return;
      }
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        reply(res, 405, { error: 'method_not_allowed' }); return;
      }
      if (url.pathname === '/api/snapshot') {
        if (!matchesToken(req.headers.authorization, options.readToken)) {
          reply(res, 401, { error: 'unauthorized' }); return;
        }
        reply(res, 200, mergedReceipt(slots) ?? { receivedAt: null, data: null }); return;
      }
      const asset = assets.get(url.pathname);
      if (!asset) { reply(res, 404, { error: 'not_found' }); return; }
      const [file, mime] = asset;
      if (!file || !mime) throw new Error('Invalid asset definition');
      const data = await readFile(join(options.webRoot, file));
      res.writeHead(200, { 'Content-Type': mime });
      res.end(req.method === 'HEAD' ? undefined : data);
    } catch (error) {
      if (error instanceof BodyLimitError) reply(res, 413, { error: 'payload_too_large' });
      else if (error instanceof SyntaxError || error instanceof TypeError) reply(res, 400, { error: 'invalid_request' });
      else {
        // Do not log requests, tokens or payloads.
        console.error('Phone relay request failed:', error instanceof Error ? error.name : 'UnknownError');
        reply(res, 500, { error: 'relay_error' });
      }
    }
  };
  return {
    writer: createServer({ requestTimeout: 10_000, headersTimeout: 10_000 }, handler('writer')),
    reader: createServer({ requestTimeout: 10_000, headersTimeout: 10_000 }, handler('reader')),
  };
}
