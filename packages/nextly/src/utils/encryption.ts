/**
 * AES-256-GCM Encryption Utility
 *
 * Provides authenticated encryption for sensitive data at rest.
 * Uses AES-256-GCM with scrypt-derived keys for maximum security.
 *
 * Format: `iv.authTag.ciphertext` (hex-encoded, dot-separated)
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

// AES-256-GCM constants
const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12; // 96-bit nonce (recommended for GCM)
const KEY_LENGTH = 32; // 256-bit key
const AUTH_TAG_LENGTH = 16; // 128-bit auth tag
const SALT = "nextly-encryption-salt"; // Static salt — key uniqueness comes from the secret

/**
 * Derive a 256-bit encryption key from a secret string using scrypt.
 *
 * @param secret - Application secret (e.g., AUTH_SECRET)
 * @returns 32-byte Buffer suitable for AES-256
 */
function deriveKey(secret: string): Buffer {
  return scryptSync(secret, SALT, KEY_LENGTH);
}

/**
 * Encrypt plaintext using AES-256-GCM.
 *
 * @param plaintext - The string to encrypt
 * @param secret - The application secret used to derive the encryption key
 * @returns Encrypted string in format `iv.authTag.ciphertext` (hex-encoded)
 *
 * @example
 * ```typescript
 * const encrypted = encrypt('my-api-key', process.env.AUTH_SECRET!);
 * // => "a1b2c3d4e5f6a1b2c3d4e5f6.0102030405060708090a0b0c0d0e0f10.deadbeef..."
 * ```
 */
export function encrypt(plaintext: string, secret: string): string {
  const key = deriveKey(secret);
  const iv = randomBytes(IV_LENGTH);

  const cipher = createCipheriv(ALGORITHM, key, iv, {
    authTagLength: AUTH_TAG_LENGTH,
  });

  let encrypted = cipher.update(plaintext, "utf8", "hex");
  encrypted += cipher.final("hex");

  const authTag = cipher.getAuthTag();

  return `${iv.toString("hex")}.${authTag.toString("hex")}.${encrypted}`;
}

/**
 * Decrypt a string previously encrypted with `encrypt()`.
 *
 * @param encrypted - Encrypted string in format `iv.authTag.ciphertext`
 * @param secret - The same application secret used during encryption
 * @returns Decrypted plaintext string
 * @throws {Error} If decryption fails (wrong secret, tampered data, or invalid format)
 *
 * @example
 * ```typescript
 * const plaintext = decrypt(encryptedString, process.env.AUTH_SECRET!);
 * // => "my-api-key"
 * ```
 */
export function decrypt(encrypted: string, secret: string): string {
  const parts = encrypted.split(".");
  if (parts.length !== 3) {
    throw new Error("Invalid encrypted data format");
  }

  const [ivHex, authTagHex, ciphertext] = parts;

  const key = deriveKey(secret);
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
