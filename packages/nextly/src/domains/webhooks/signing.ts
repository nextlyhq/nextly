/**
 * Webhook domain — Standard Webhooks signing.
 *
 * Implements the Standard Webhooks (standardwebhooks.com) symmetric signing
 * scheme so receivers can verify a delivery came from this site and was not
 * tampered with:
 *
 *   signedContent = "<id>.<timestamp>.<rawBody>"
 *   signature     = base64(HMAC_SHA256(secretBytes, signedContent))
 *   webhook-signature: "v1,<signature>"
 *
 * The signature covers the EXACT bytes that are sent, so the delivery engine
 * must sign the already-serialized body and transmit that same string. Secrets
 * are handled as a list (one active now) so key rotation is additive: a
 * delivery is signed with the primary secret, and verification accepts a match
 * against any secret in the list.
 *
 * These are pure functions over the plaintext secret. Secrets live encrypted at
 * rest (utils/encryption.ts + NEXTLY_SECRET); the CRUD and delivery slices own
 * the encrypt/decrypt boundary and pass the decrypted secret in here.
 *
 * @module domains/webhooks/signing
 */

import { createHmac, timingSafeEqual } from "node:crypto";

export const WEBHOOK_ID_HEADER = "webhook-id";
export const WEBHOOK_TIMESTAMP_HEADER = "webhook-timestamp";
export const WEBHOOK_SIGNATURE_HEADER = "webhook-signature";

/** Standard Webhooks secrets may be `whsec_`-prefixed and base64-encoded. */
const SECRET_PREFIX = "whsec_";

/**
 * Resolve a secret string to its raw key bytes. A `whsec_`-prefixed secret is
 * base64-decoded (the Standard Webhooks convention); any other string is used
 * as UTF-8 bytes, so plain shared secrets also work.
 */
function secretToKey(secret: string): Buffer {
  if (secret.startsWith(SECRET_PREFIX)) {
    return Buffer.from(secret.slice(SECRET_PREFIX.length), "base64");
  }
  return Buffer.from(secret, "utf8");
}

/** The exact content the signature is computed over. */
function signedContent(id: string, timestamp: string, body: string): string {
  return `${id}.${timestamp}.${body}`;
}

/** Base64 HMAC-SHA256 of `<id>.<timestamp>.<body>` under one secret. */
function computeSignature(
  secret: string,
  id: string,
  timestamp: string,
  body: string
): string {
  return createHmac("sha256", secretToKey(secret))
    .update(signedContent(id, timestamp, body))
    .digest("base64");
}

export interface SignInput {
  /** Envelope id; also the `webhook-id` header. */
  id: string;
  /** Unix seconds as a string; also the `webhook-timestamp` header. */
  timestamp: string;
  /** The exact serialized body bytes that will be sent. */
  body: string;
  /** Active signing secret (plaintext). */
  secret: string;
}

/** The versioned signature token, e.g. `v1,<base64>`. */
export function signPayload(input: SignInput): string {
  const sig = computeSignature(
    input.secret,
    input.id,
    input.timestamp,
    input.body
  );
  return `v1,${sig}`;
}

/**
 * The three Standard Webhooks headers for a delivery. Signed with the primary
 * (first) secret; additional secrets exist only so verification survives a
 * rotation.
 */
export function buildSignatureHeaders(
  input: SignInput
): Record<string, string> {
  return {
    [WEBHOOK_ID_HEADER]: input.id,
    [WEBHOOK_TIMESTAMP_HEADER]: input.timestamp,
    [WEBHOOK_SIGNATURE_HEADER]: signPayload(input),
  };
}

/** Constant-time equality for two base64 signature strings. */
function signaturesEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "utf8");
  const bufB = Buffer.from(b, "utf8");
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

export interface VerifyInput {
  id: string;
  timestamp: string;
  body: string;
  /** The received `webhook-signature` header (may hold multiple space-separated tokens). */
  signatureHeader: string;
  /** Every currently-valid secret (plaintext); rotation keeps more than one. */
  secrets: readonly string[];
}

/**
 * Whether `signatureHeader` contains a valid `v1` signature for `body` under
 * any of `secrets`. A verify helper for tests and for documenting the scheme;
 * receivers are pointed at the `standardwebhooks` libraries.
 */
export function verifySignature(input: VerifyInput): boolean {
  const presented = input.signatureHeader
    .split(" ")
    .filter(token => token.startsWith("v1,"))
    .map(token => token.slice("v1,".length));
  if (presented.length === 0) return false;

  for (const secret of input.secrets) {
    const expected = computeSignature(
      secret,
      input.id,
      input.timestamp,
      input.body
    );
    if (presented.some(sig => signaturesEqual(sig, expected))) return true;
  }
  return false;
}
