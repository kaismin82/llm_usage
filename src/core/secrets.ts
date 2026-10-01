const ITERATIONS = 210_000;
const SALT_LENGTH = 16;
const IV_LENGTH = 12;

export async function encryptSecret(plain: string, passphrase: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_LENGTH));
  const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));
  const key = await deriveKey(passphrase, salt);
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: toBuffer(iv) },
    key,
    toBuffer(new TextEncoder().encode(plain)),
  );
  return `v1.${toBase64(salt)}.${toBase64(iv)}.${toBase64(new Uint8Array(ciphertext))}`;
}

export async function decryptSecret(blob: string, passphrase: string): Promise<string> {
  try {
    const [version, saltPart, ivPart, ciphertextPart, extra] = blob.split('.');
    if (version !== 'v1' || !saltPart || !ivPart || !ciphertextPart || extra !== undefined) throw new Error();
    const salt = fromBase64(saltPart);
    const iv = fromBase64(ivPart);
    const ciphertext = fromBase64(ciphertextPart);
    if (salt.length !== SALT_LENGTH || iv.length !== IV_LENGTH || ciphertext.length === 0) throw new Error();
    const key = await deriveKey(passphrase, salt);
    const plain = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: toBuffer(iv) },
      key,
      toBuffer(ciphertext),
    );
    return new TextDecoder().decode(plain);
  } catch {
    throw new Error('decrypt_failed');
  }
}

async function deriveKey(passphrase: string, salt: Uint8Array): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey(
    'raw',
    toBuffer(new TextEncoder().encode(passphrase)),
    'PBKDF2',
    false,
    ['deriveKey'],
  );
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt: toBuffer(salt), iterations: ITERATIONS },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

function toBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function fromBase64(value: string): Uint8Array {
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(value) || value.length % 4 !== 0) throw new Error();
  const binary = atob(value);
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  if (toBase64(bytes) !== value) throw new Error();
  return bytes;
}
