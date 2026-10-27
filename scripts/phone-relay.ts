import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { homedir } from 'node:os';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { createPhoneRelay } from '../src/phone-server/relay';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const stateDir = process.env['LLM_PHONE_STATE_DIR'] ??
  join(process.env['LOCALAPPDATA'] ?? homedir(), 'LLMUsagePhone');
await mkdir(stateDir, { recursive: true, mode: 0o700 });
const credentialPath = join(stateDir, 'credentials.json');
const credentialsSchema = z.strictObject({
  readToken: z.string().min(32), writeToken: z.string().min(32),
});
let credentials;
try {
  credentials = credentialsSchema.parse(JSON.parse(await readFile(credentialPath, 'utf8')));
} catch (error) {
  if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error;
  credentials = { readToken: randomBytes(32).toString('hex'), writeToken: randomBytes(32).toString('hex') };
  await writeFile(credentialPath, JSON.stringify(credentials), { flag: 'wx', mode: 0o600 });
}
const hostList: string = process.env['LLM_PHONE_HOSTS'] ?? '';
const hosts = hostList.split(',').map((host) => host.trim().toLowerCase()).filter(Boolean);
const { reader, writer } = await createPhoneRelay({
  ...credentials, webRoot: join(root, 'phone', 'web'),
  snapshotPath: join(stateDir, 'snapshot.json'), readerHosts: hosts,
});
writer.once('error', (error) => { console.error('Ingest listener:', error.message); process.exit(1); });
reader.once('error', (error) => { console.error('Reader listener:', error.message); process.exit(1); });
const ingestPort = Number(process.env['LLM_PHONE_INGEST_PORT'] ?? 8770);
const readerPort = Number(process.env['LLM_PHONE_READER_PORT'] ?? 8771);
writer.listen(ingestPort, '127.0.0.1', () => console.log(`PHONE_INGEST_READY 127.0.0.1:${ingestPort}`));
reader.listen(readerPort, '127.0.0.1', () => {
  console.log(`PHONE_READER_READY http://127.0.0.1:${readerPort}`);
  console.log(`Credentials are stored locally in ${credentialPath}; do not share the write token.`);
});
const stop = () => { writer.close(); reader.close(); };
process.once('SIGINT', stop);
process.once('SIGTERM', stop);
