/**
 * Verifying the webhooks a plugin receives, lent to it as
 * `ctx.security.webhooks`.
 *
 * A scheme says where a delivery's signatures and timestamp are, which bytes
 * are signed, and how one secret signs them. Core does the rest, so no scheme
 * can skip it: it refuses a delivery further from now than the tolerance,
 * either way, and compares every presented signature with every secret as
 * bytes of equal length, in constant time. More than one secret verifies
 * during a rotation. The answer is never "verified" by default: a delivery
 * with no signature, an unreadable one, or no secret to check it with is not
 * verified, with a reason for the plugin's own log.
 *
 * The common scheme is Standard Webhooks, the one core signs its own webhooks
 * with, through the same HMAC. It is core's only verifier.
 *
 * @module plugins/security/inbound-webhooks
 * @experimental
 */
import { timingSafeEqual } from "node:crypto";

import { standardWebhooksSignature } from "../../domains/webhooks/signing";
import { NextlyError } from "../../errors/nextly-error";

/** @experimental A delivery as a scheme reads it. */
export interface InboundWebhookDelivery {
  readonly headers: Headers;
  /** The body exactly as sent. */
  readonly bytes: Uint8Array;
}

/** @experimental What a scheme read from a delivery. */
export interface InboundWebhookReading {
  /** Every signature the delivery presents, decoded to bytes. */
  readonly signatures: readonly Uint8Array[];
  /** The bytes the sender signed. */
  readonly signed: Uint8Array | string;
  /**
   * When the sender signed it, in Unix seconds, or `"none"` for a scheme
   * that signs no time. Never left out: `"none"` must be said, since it
   * leaves the delivery unchecked for freshness.
   */
  readonly timestamp: number | "none";
  /** The sender's id for this delivery, when the scheme carries one. */
  readonly deliveryId?: string;
}

/**
 * @experimental A webhook signature scheme: where a delivery's signatures and
 * timestamp are, and how one secret signs.
 */
export interface InboundWebhookScheme {
  /**
   * What `delivery` presents, or `null` when it carries none of this
   * scheme's headers. Throw for a delivery that carries them malformed.
   */
  read(delivery: InboundWebhookDelivery): InboundWebhookReading | null;
  /** The signature `secret` makes over `signed`. Throw for an unusable secret. */
  sign(secret: string, signed: Uint8Array | string): Uint8Array;
}

/** @experimental How a delivery is verified. */
export interface VerifyWebhookOptions {
  readonly scheme: InboundWebhookScheme;
  /** Every secret currently valid: during a rotation, the new and the old. */
  readonly secrets: readonly string[];
  /** How far from now a delivery may have been signed, in seconds. 300 by default. */
  readonly toleranceSeconds?: number;
  /** The largest body read, in bytes. 1 MiB by default. */
  readonly maxBytes?: number;
}

/** @experimental Why a delivery was not verified, for the plugin's log. */
export type WebhookRefusal =
  | "missing"
  | "malformed"
  | "expired"
  | "mismatch"
  | "no-secret"
  | "too-large";

/** @experimental The answer to verifying a delivery. */
export type WebhookVerification =
  | {
      readonly verified: true;
      /** The verified body, as text: process this, not a second read. */
      readonly body: string;
      readonly bytes: Uint8Array;
      readonly deliveryId?: string;
      /** When it was signed, in Unix seconds; absent when unchecked. */
      readonly timestamp?: number;
      /**
       * `"unchecked"` for a scheme that signs no time: such a delivery could
       * be a replay of an old one, and nothing here can tell.
       */
      readonly freshness: "checked" | "unchecked";
    }
  | { readonly verified: false; readonly reason: WebhookRefusal };

/** @experimental Verifying the webhooks a plugin receives (`ctx.security.webhooks`). */
export interface PluginReceivedWebhooks {
  /**
   * Verify `request`, reading a copy of its body: the request stays readable,
   * though the verified `body` in the answer is the one to process.
   */
  verify(
    request: Request,
    options: VerifyWebhookOptions
  ): Promise<WebhookVerification>;
}

const DEFAULT_TOLERANCE_SECONDS = 300;
const DEFAULT_MAX_BYTES = 1024 * 1024;
const STANDARD_ID = "webhook-id";
const STANDARD_TIMESTAMP = "webhook-timestamp";
const STANDARD_SIGNATURE = "webhook-signature";
/** Whole seconds, as a header writes them: no sign, exponent or fraction. */
const WHOLE_SECONDS = /^\d{1,12}$/;
const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;

/**
 * @experimental Standard Webhooks (`webhook-id`, `webhook-timestamp`,
 * `webhook-signature: v1,<base64>`), with `whsec_` secrets: the scheme core
 * signs its own webhooks with.
 */
export const standardWebhooks: InboundWebhookScheme = {
  read({ headers, bytes }) {
    const id = headers.get(STANDARD_ID);
    const timestamp = headers.get(STANDARD_TIMESTAMP);
    const signature = headers.get(STANDARD_SIGNATURE);
    if (id === null || timestamp === null || signature === null) return null;
    if (!WHOLE_SECONDS.test(timestamp)) {
      // Caught by the verifier, which answers "malformed".
      throw NextlyError.invalidInput({
        message: "webhook-timestamp is not a whole number of seconds.",
      });
    }
    const signatures = signature
      .split(" ")
      .filter(token => token.startsWith("v1,"))
      .map(token => token.slice("v1,".length))
      .filter(token => BASE64.test(token))
      .map(token => Buffer.from(token, "base64"));
    return {
      signatures,
      // The exact bytes, not text decoded and encoded again.
      signed: Buffer.concat([Buffer.from(`${id}.${timestamp}.`), bytes]),
      timestamp: Number(timestamp),
      deliveryId: id,
    };
  },
  sign: standardWebhooksSignature,
};

/** `value`, checked to be a finite number of `what` no less than `least`. */
function finiteAtLeast(value: number, least: number, name: string): number {
  if (!Number.isFinite(value) || value < least) {
    throw NextlyError.invalidInput({
      message: `${name} must be a finite number, ${least} or more.`,
      logContext: { [name]: value },
    });
  }
  return value;
}

/** What `scheme` reads from `delivery`, or why it read nothing usable. */
function readDelivery(
  scheme: InboundWebhookScheme,
  delivery: InboundWebhookDelivery
): InboundWebhookReading | WebhookRefusal {
  let reading: InboundWebhookReading | null;
  try {
    reading = scheme.read(delivery);
  } catch {
    // The scheme's own word that the delivery is malformed.
    return "malformed";
  }
  if (reading === null) return "missing";
  const { timestamp, signatures } = reading;
  const timed =
    timestamp === "none" ||
    (typeof timestamp === "number" && Number.isSafeInteger(timestamp));
  if (!timed || !Array.isArray(signatures) || signatures.length === 0) {
    return "malformed";
  }
  return reading;
}

/** Whether any of `presented` is the signature one of `secrets` makes. */
function anySecretSigned(
  scheme: InboundWebhookScheme,
  reading: InboundWebhookReading,
  secrets: readonly string[]
): boolean {
  for (const secret of secrets) {
    let expected: Uint8Array;
    try {
      expected = scheme.sign(secret, reading.signed);
    } catch {
      // A secret the scheme cannot use signs nothing: the others may.
      continue;
    }
    // A signing that gives nothing proves nothing: two empty values are
    // equal, and an empty signature is easy to send.
    if (expected.length === 0) continue;
    for (const presented of reading.signatures) {
      // Lengths first: `timingSafeEqual` throws on unequal ones, and a
      // signature's length is no secret.
      if (
        presented.length === expected.length &&
        timingSafeEqual(presented, expected)
      ) {
        return true;
      }
    }
  }
  return false;
}

/**
 * Verify `delivery` with `options` at `now`.
 *
 * @throws NextlyError.invalidInput for a tolerance or size bound that is not
 *   a finite number: a plugin's mistake, which must not turn freshness off.
 */
export function verifyWebhookDelivery(
  delivery: InboundWebhookDelivery,
  options: VerifyWebhookOptions,
  now: Date = new Date()
): WebhookVerification {
  const tolerance = finiteAtLeast(
    options.toleranceSeconds ?? DEFAULT_TOLERANCE_SECONDS,
    0,
    "toleranceSeconds"
  );
  const maxBytes = finiteAtLeast(
    options.maxBytes ?? DEFAULT_MAX_BYTES,
    1,
    "maxBytes"
  );
  if (delivery.bytes.length > maxBytes) {
    return { verified: false, reason: "too-large" };
  }
  const reading = readDelivery(options.scheme, delivery);
  if (typeof reading === "string") return { verified: false, reason: reading };
  const secrets = options.secrets.filter(secret => secret.length > 0);
  if (secrets.length === 0) return { verified: false, reason: "no-secret" };
  // Freshness before any HMAC: an old delivery costs no signing.
  if (reading.timestamp !== "none") {
    const nowSeconds = Math.floor(now.getTime() / 1000);
    if (!(Math.abs(nowSeconds - reading.timestamp) <= tolerance)) {
      return { verified: false, reason: "expired" };
    }
  }
  if (!anySecretSigned(options.scheme, reading, secrets)) {
    return { verified: false, reason: "mismatch" };
  }
  return {
    verified: true,
    body: new TextDecoder().decode(delivery.bytes),
    bytes: delivery.bytes,
    ...(reading.deliveryId !== undefined
      ? { deliveryId: reading.deliveryId }
      : {}),
    ...(reading.timestamp === "none"
      ? { freshness: "unchecked" as const }
      : { timestamp: reading.timestamp, freshness: "checked" as const }),
  };
}

/**
 * `request`'s body, from a copy, or `null` when it is longer than `maxBytes`:
 * reading stops at the chunk that passes the bound.
 */
async function readBounded(
  request: Request,
  maxBytes: number
): Promise<Uint8Array | null> {
  const body = request.clone().body;
  if (body === null) return new Uint8Array();
  const chunks: Uint8Array[] = [];
  let length = 0;
  const reader = body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.length;
    if (length > maxBytes) {
      // Not awaited: a copy's cancel settles only once the original is read
      // or cancelled too, which is the handler's to do.
      reader.cancel().catch(() => undefined);
      return null;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}

/** `ctx.security.webhooks`, telling time by `now`. */
export function createPluginReceivedWebhooks(
  clock: { now: () => Date } = { now: () => new Date() }
): PluginReceivedWebhooks {
  return {
    async verify(request, options) {
      const maxBytes = finiteAtLeast(
        options.maxBytes ?? DEFAULT_MAX_BYTES,
        1,
        "maxBytes"
      );
      const bytes = await readBounded(request, maxBytes);
      if (bytes === null) return { verified: false, reason: "too-large" };
      return verifyWebhookDelivery(
        { headers: request.headers, bytes },
        options,
        clock.now()
      );
    },
  };
}
