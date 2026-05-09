/**
 * Zero-knowledge vault crypto — PBKDF2 + AES-256-GCM via Web Crypto API.
 * Plaintext never leaves the browser.
 */

const ALGORITHM = "AES-GCM";
const KEY_LENGTH = 256;
const IV_LENGTH = 12;
const ITERATIONS = 100_000;
const VERIFICATION_PLAINTEXT = "SYNAP_VAULT_VERIFICATION_2024";

function b64(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes));
}

function deB64(s: string): Uint8Array<ArrayBuffer> {
  const binary = atob(s);
  const buf = new ArrayBuffer(binary.length);
  const view = new Uint8Array(buf);
  for (let i = 0; i < binary.length; i++) view[i] = binary.charCodeAt(i);
  return view;
}

export async function deriveVaultKey(
  password: string,
  saltB64: string,
): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveKey"],
  );
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt: deB64(saltB64), iterations: ITERATIONS, hash: "SHA-256" },
    base,
    { name: ALGORITHM, length: KEY_LENGTH },
    false,
    ["encrypt", "decrypt"],
  );
}

export async function encryptWithKey(
  data: string,
  key: CryptoKey,
): Promise<{ encryptedData: string; iv: string; authTag: string }> {
  const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));
  const ct = await crypto.subtle.encrypt(
    { name: ALGORITHM, iv },
    key,
    new TextEncoder().encode(data),
  );
  const arr = new Uint8Array(ct);
  return { encryptedData: b64(arr.slice(0, -16)), iv: b64(iv), authTag: b64(arr.slice(-16)) };
}

export async function decryptWithKey(
  encryptedData: string,
  iv: string,
  authTag: string,
  key: CryptoKey,
): Promise<string> {
  const ct = deB64(encryptedData);
  const tag = deB64(authTag);
  const payload = new Uint8Array(ct.length + tag.length);
  payload.set(ct, 0);
  payload.set(tag, ct.length);
  const pt = await crypto.subtle.decrypt({ name: ALGORITHM, iv: deB64(iv) }, key, payload);
  return new TextDecoder().decode(pt);
}

export async function generateSetupParams(password: string) {
  const saltB64 = b64(crypto.getRandomValues(new Uint8Array(32)));
  const key = await deriveVaultKey(password, saltB64);
  const { encryptedData, iv, authTag } = await encryptWithKey(VERIFICATION_PLAINTEXT, key);
  return {
    salt: saltB64,
    keyDerivationAlgorithm: "pbkdf2",
    keyDerivationParams: { N: ITERATIONS, r: 8, p: 1 },
    verificationCipher: encryptedData,
    verificationIv: iv,
    verificationTag: authTag,
    key,
  };
}

export async function tryUnlock(
  password: string,
  meta: {
    salt: string;
    verificationCipher: string;
    verificationIv: string;
    verificationTag: string;
  },
): Promise<CryptoKey | null> {
  try {
    const key = await deriveVaultKey(password, meta.salt);
    const pt = await decryptWithKey(
      meta.verificationCipher,
      meta.verificationIv,
      meta.verificationTag,
      key,
    );
    return pt === VERIFICATION_PLAINTEXT ? key : null;
  } catch {
    return null;
  }
}
