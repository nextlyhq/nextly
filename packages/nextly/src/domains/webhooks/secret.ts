/**
 * Webhook domain — the signing-secret lifecycle.
 *
 * `signing.ts` is pure functions over a plaintext secret and says where the
 * plaintext is meant to come from: secrets live encrypted at rest, and the CRUD
 * and delivery slices own the encrypt/decrypt boundary. This module is that
 * boundary. Delivery cannot sign without it — `decryptSecret` is an injected
 * dependency the delivery engine has no production implementation for — and
 * CRUD has nothing safe to store without it.
 *
 * Encryption reuses `utils/encryption` (AES-256-GCM, scrypt-derived key,
 * `salt.iv.authTag.ciphertext`) rather than a second scheme, so webhook secrets
 * are protected exactly as email provider credentials already are.
 *
 * @module domains/webhooks/secret
 */

import { randomBytes } from "node:crypto";

import { NextlyError } from "../../errors";
import { env } from "../../lib/env";
import { decrypt, encrypt } from "../../utils/encryption";

/**
 * Standard Webhooks secrets are `whsec_`-prefixed, base64-encoded key bytes.
 * Kept identical to the prefix `signing.ts` strips before decoding, so a secret
 * generated here is one the reference `standardwebhooks` libraries accept.
 */
export const WEBHOOK_SECRET_PREFIX = "whsec_";

/** 32 bytes: the HMAC-SHA256 block size, and what the reference tooling emits. */
const SECRET_BYTES = 32;

/**
 * Characters of the secret kept for display. Enough to tell two secrets apart
 * in a list without being enough to attack: the prefix is stored in the clear
 * and shown after the one-time reveal, so it must never narrow the key
 * meaningfully.
 */
const DISPLAY_PREFIX_LENGTH = 8;

/** A new signing secret, in the form a receiver's library expects. */
export function generateWebhookSecret(): string {
  return `${WEBHOOK_SECRET_PREFIX}${randomBytes(SECRET_BYTES).toString("base64")}`;
}

/**
 * The display-only fragment stored alongside the ciphertext.
 *
 * Taken from the front of the secret including its prefix, so the stored value
 * reads as `whsec_ab` rather than as key material. The plaintext is shown to
 * the user exactly once at creation; this is what every screen after that has
 * to identify the secret by.
 */
export function webhookSecretPrefix(secret: string): string {
  return secret.slice(0, DISPLAY_PREFIX_LENGTH);
}

/**
 * The application key webhook secrets are encrypted under.
 *
 * Exported so a caller can resolve it once and hand it to both halves, and so
 * the crypto below stays a pure function of its inputs — reading the
 * environment inside it would pull full env validation into every consumer and
 * every test that touches a secret.
 *
 * Absent, this throws rather than degrading. The email provider service stores
 * its configuration in the clear when no key is set, which is a survivable
 * trade for credentials that are already scoped to one provider — but a webhook
 * secret IS the signing key. Storing it readable would let anyone with database
 * read access forge a signature that every receiver accepts as genuine, and it
 * would do so silently. `signing.ts` already refuses to emit an unsigned
 * request for the same reason; refusing to store an unprotected secret is the
 * same posture one step earlier.
 */
export function webhookEncryptionKey(): string {
  const key = env.NEXTLY_SECRET;
  if (!key) {
    throw NextlyError.internal({
      logContext: {
        reason: "webhook-secret-no-encryption-key",
        remedy:
          "Set NEXTLY_SECRET. Webhook signing secrets are encrypted under it, " +
          "and without it the secret would be stored readable — anyone with " +
          "database access could then sign requests your receivers trust.",
      },
    });
  }
  return key;
}

/**
 * Encrypt a plaintext signing secret for storage.
 *
 * The key defaults to the application secret; passing one explicitly keeps the
 * function pure for callers that have already resolved it.
 */
export function encryptWebhookSecret(
  plaintext: string,
  key: string = webhookEncryptionKey()
): string {
  return encrypt(plaintext, key);
}

/**
 * Recover a stored signing secret.
 *
 * Throws when the key is missing or the value does not decrypt — a secret that
 * cannot be recovered cannot sign, and delivering unsigned or wrongly-signed is
 * worse than not delivering. The caller records the failed attempt so the
 * endpoint surfaces as broken rather than silently going quiet.
 */
export function decryptWebhookSecret(
  ciphertext: string,
  key: string = webhookEncryptionKey()
): string {
  return decrypt(ciphertext, key);
}
