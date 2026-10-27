import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFile, writeFile, rename } from 'node:fs/promises';
import { join } from 'node:path';
import { timingSafeEqual } from 'node:crypto';
import { phonePayloadSchema, receiptSchema, type PhoneReceipt } from './payload';

const MAX_BODY = 256 * 1024;
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

export async function createPhoneRelay(options: RelayOptions) {
  if (options.readToken.length < 32 || options.writeToken.length < 32 ||
      options.readToken === options.writeToken) {
    throw new Error('Relay requires distinct read/write credentials of at least 32 characters.');
  }
  let receipt: PhoneReceipt | null = null;
  try {
    receipt = receiptSchema.parse(JSON.parse(await readFile(options.snapshotPath, 'utf8')));
  } catch (error) {
    if (!missingFile(error)) throw error;
  }
  let writing = false;
  const now = options.now ?? (() => new Date());

  const handler = (mode: 'reader' | 'writer') => async (req: IncomingMessage, res: ServerResponse) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Content-Security-Policy', CSP);
    res.setHeader('X-Frame-Options', 'DENY');
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
        if (origin && !/^chrome-extension:\/\/[a-p]{32}$/.test(origin)) {
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
        if (writing) { reply(res, 409, { error: 'write_in_progress' }); return; }
        writing = true;
        try {
          const next = { receivedAt: now().toISOString(), data: parsed.data };
          await writeFile(`${options.snapshotPath}.tmp`, JSON.stringify(next), { mode: 0o600 });
          await rename(`${options.snapshotPath}.tmp`, options.snapshotPath);
          receipt = next;
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
        reply(res, 200, receipt ?? { receivedAt: null, data: null }); return;
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
