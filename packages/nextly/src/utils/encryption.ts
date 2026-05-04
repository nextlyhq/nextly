/**
 * AES-256-GCM Encryption Utility
 *
 * Provides authenticated encryption for sensitive data at rest. Uses
 * AES-256-GCM with scrypt-derived keys.
 *
 * Format (current): `salt.iv.authTag.ciphertext`
 *   - 4 dot-separated hex segments.
 *   - 16-byte random salt per encryption — every ciphertext derives a
 *     fresh key from the secret, so two writes of the same plaintext
 *     produce different ciphertext and a leak of one key never trivially
 *     recovers the others.
 *
 * Format (legacy): `iv.authTag.ciphertext`
 *   - 3 dot-separated hex segments.
 *   - All ciphertexts shared the static salt `nextly-encryption-salt`,
 *     so any compromise of one derived key compromised every record
 *     ever encrypted with the same secret.
 *   - `decrypt()` still accepts this format so existing rows keep
 *     working. Callers that rewrite the row (e.g. the email-provider
 *     service on `setProvider()`) automatically migrate to the new
 *     format because `encrypt()` only emits the new shape.
 *
 * @module utils/encryption
 * @since 1.0.0
 */

import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  scryptSync,
} from "crypto";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12; // 96-bit nonce (recommended for GCM)
const KEY_LENGTH = 32; // 256-bit key
const AUTH_TAG_LENGTH = 16; // 128-bit auth tag
const SALT_LENGTH = 16; // 128-bit per-encryption salt

/**
 * ciphertexts derived their key from this
 * fixed salt. `decrypt()` still uses it as the fallback when a legacy
 * 3-part ciphertext is presented; new ciphertexts use a random salt.
 */
const LEGACY_SALT = "nextly-encryption-salt";

function deriveKey(secret: string, salt: Buffer | string): Buffer {
  return scryptSync(secret, salt, KEY_LENGTH);
}

/**
 * Encrypt plaintext using AES-256-GCM with a fresh random salt.
 *
 * @param plaintext - The string to encrypt
 * @param secret - The application secret used to derive the encryption key
 * @returns Encrypted string in format `salt.iv.authTag.ciphertext` (hex, dot-separated)
 */
export function encrypt(plaintext: string, secret: string): string {
  const salt = randomBytes(SALT_LENGTH);
  const key = deriveKey(secret, salt);
  const iv = randomBytes(IV_LENGTH);

  const cipher = createCipheriv(ALGORITHM, key, iv, {
    authTagLength: AUTH_TAG_LENGTH,
  });

  let encrypted = cipher.update(plaintext, "utf8", "hex");
  encrypted += cipher.final("hex");

  const authTag = cipher.getAuthTag();

  return `${salt.toString("hex")}.${iv.toString("hex")}.${authTag.toString("hex")}.${encrypted}`;
}

/**
 * Decrypt a string previously encrypted with `encrypt()`.
 *
 * Accepts both the current 4-part `salt.iv.authTag.ciphertext` format
 * and the legacy 3-part `iv.authTag.ciphertext` format (which derives
 * the key from `LEGACY_SALT` for backward compatibility).
 *
 * @throws {Error} If the format is unrecognised, the secret is wrong,
 *   or the ciphertext has been tampered with.
 */
export function decrypt(encrypted: string, secret: string): string {
  const parts = encrypted.split(".");

  let saltMaterial: Buffer | string;
  let ivHex: string;
  let authTagHex: string;
  let ciphertext: string;

  if (parts.length === 4) {
    const [saltHex, iv, tag, ct] = parts;
    saltMaterial = Buffer.from(saltHex, "hex");
    ivHex = iv;
    authTagHex = tag;
    ciphertext = ct;
  } else if (parts.length === 3) {
    saltMaterial = LEGACY_SALT;
    [ivHex, authTagHex, ciphertext] = parts;
  } else {
    throw new Error("Invalid encrypted data format");
  }

  const key = deriveKey(secret, saltMaterial);
  const iv = Buffer.from(ivHex, "hex");
  const authTag = Buffer.from(authTagHex, "hex");

  const decipher = createDecipheriv(ALGORITHM, key, iv, {
    authTagLength: AUTH_TAG_LENGTH,
  });
  decipher.setAuthTag(authTag);

  let decrypted = decipher.update(ciphertext, "hex", "utf8");
  decrypted += decipher.final("utf8");

  return decrypted;
}
