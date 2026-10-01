import { describe, expect, it } from 'vitest';
import { decryptSecret, encryptSecret } from '../src/core/secrets';

describe('secret encryption', () => {
  it('round-trips a secret using the passphrase', async () => {
    const blob = await encryptSecret('api-key-secret', 'correct horse battery staple');
    await expect(decryptSecret(blob, 'correct horse battery staple')).resolves.toBe('api-key-secret');
  });

  it('uses fresh random salt and IV for each encryption', async () => {
    const [first, second] = await Promise.all([
      encryptSecret('api-key-secret', 'passphrase'),
      encryptSecret('api-key-secret', 'passphrase'),
    ]);
    expect(first).not.toBe(second);
  });

  it('rejects a wrong passphrase with decrypt_failed', async () => {
    const blob = await encryptSecret('api-key-secret', 'passphrase');
    await expect(decryptSecret(blob, 'different passphrase')).rejects.toThrow('decrypt_failed');
  });

  it('rejects malformed blobs with decrypt_failed', async () => {
    await expect(decryptSecret('not-an-encrypted-secret', 'passphrase')).rejects.toThrow('decrypt_failed');
  });

  it('rejects tampered ciphertext with decrypt_failed', async () => {
    const blob = await encryptSecret('api-key-secret', 'passphrase');
    const parts = blob.split('.');
    const ciphertext = parts[3] as string;
    const replacement = ciphertext[0] === 'A' ? 'B' : 'A';
    parts[3] = `${replacement}${ciphertext.slice(1)}`;
    await expect(decryptSecret(parts.join('.'), 'passphrase')).rejects.toThrow('decrypt_failed');
  });
});
