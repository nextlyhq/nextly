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
 * are handled as a list so key rotation is additive: a delivery is signed with
 * every active secret (one `v1` token per secret), and verification accepts a
 * match against any secret in the list.
 *
 * Verifying a delivery is not here: core has one verifier, for the webhooks a
 * plugin receives as for this scheme, in `plugins/security/inbound-webhooks`.
 * It signs with `standardWebhooksSignature`, so signing and verifying share
 * one HMAC.
 *
 * These are pure functions over the plaintext secret. Secrets live encrypted at
 * rest (utils/encryption.ts + NEXTLY_SECRET); the CRUD and delivery slices own
 * the encrypt/decrypt boundary and pass the decrypted secret in here.
 *
 * @module domains/webhooks/signing
 */

import { createHmac } from "node:crypto";

import { NextlyError } from "../../errors";

export const WEBHOOK_ID_HEADER = "webhook-id";
export const WEBHOOK_TIMESTAMP_HEADER = "webhook-timestamp";
export const WEBHOOK_SIGNATURE_HEADER = "webhook-signature";

/** Standard Webhooks secrets are `whsec_`-prefixed, base64-encoded key bytes. */
const SECRET_PREFIX = "whsec_";

/**
 * Resolve a secret string to its raw key bytes. Matches the `standardwebhooks`
 * reference libraries exactly: strip the optional `whsec_` prefix, then
 * base64-decode the remainder to the HMAC key. Decoding is unconditional so a
 * receiver using the same secret with those libraries computes the same HMAC.
 */
function secretToKey(secret: string): Buffer {
  const encoded = secret.startsWith(SECRET_PREFIX)
    ? secret.slice(SECRET_PREFIX.length)
    : secret;
  const key = Buffer.from(encoded, "base64");
  // A zero-length key (empty string, or a bare `whsec_`) is a broken secret:
  // it would still produce a valid-looking HMAC, so reject it rather than sign
  // or verify with no real key material.
  if (key.length === 0) {
    throw NextlyError.internal({ logContext: { reason: "empty-signing-key" } });
  }
  return key;
}

/** The exact content the signature is computed over. */
function signedContent(id: string, timestamp: string, body: string): string {
  return `${id}.${timestamp}.${body}`;
}

/**
 * The raw HMAC-SHA256 of `signed`, `<id>.<timestamp>.<body>`, under one
 * secret. Throws for a secret with no key material.
 */
export function standardWebhooksSignature(
  secret: string,
  signed: string | Uint8Array
): Buffer {
  return createHmac("sha256", secretToKey(secret)).update(signed).digest();
}

/** Base64 HMAC-SHA256 of `<id>.<timestamp>.<body>` under one secret. */
function computeSignature(
  secret: string,
  id: string,
  timestamp: string,
  body: string
): string {
  return standardWebhooksSignature(
    secret,
    signedContent(id, timestamp, body)
  ).toString("base64");
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

export interface SignHeadersInput {
  id: string;
  timestamp: string;
  body: string;
  /**
   * Active signing secrets, primary first. One `v1` signature is emitted per
   * secret so that during a rotation window a consumer holding either the new
   * or the old secret can verify.
   */
  secrets: readonly string[];
}

/**
 * The three Standard Webhooks headers for a delivery. The `webhook-signature`
 * value is the space-delimited set of `v1,<sig>` tokens — one per active
 * secret — which is how the spec expects a producer to sign through a rotation.
 */
export function buildSignatureHeaders(
  input: SignHeadersInput
): Record<string, string> {
  // A delivery must be signed. An empty secret list would otherwise produce a
  // blank webhook-signature header that every conformant receiver rejects, with
  // no signal to the caller — fail loudly instead.
  if (input.secrets.length === 0) {
    throw NextlyError.internal({
      logContext: { reason: "no-signing-secrets", webhookEventId: input.id },
    });
  }
  const signatures = input.secrets.map(
    secret =>
      `v1,${computeSignature(secret, input.id, input.timestamp, input.body)}`
  );
  return {
    [WEBHOOK_ID_HEADER]: input.id,
    [WEBHOOK_TIMESTAMP_HEADER]: input.timestamp,
    [WEBHOOK_SIGNATURE_HEADER]: signatures.join(" "),
  };
}
