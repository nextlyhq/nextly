/**
 * Opaque secrets core lends plugins as `ctx.security.opaque`: random values a
 * plugin stores only as a hash, such as its own session tokens, and compares
 * without leaking where two values differ.
 *
 * The hash is SHA-256 with no key. A secret of at least 256 random bits cannot
 * be recovered from its hash by trying values, so a key would add nothing, and
 * leaving it out keeps the hash the same across restarts and across a rotation
 * of the install's secret: a plugin's stored hashes never go stale.
 *
 * @module plugins/security/opaque-secrets
 */

import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

import { NextlyError } from "../../errors/nextly-error";

/**
 * @experimental Random secrets for a plugin's own records, with a stable hash
 * and a constant-time comparison (`ctx.security.opaque`).
 */
export interface OpaqueSecrets {
  /**
   * At least 32 random bytes (the default) and at most 1024, base64url;
   * `hash` is its SHA-256 in hex. Throws a validation error for any other
   * size, and issues nothing.
   */
  create(options?: { bytes?: number }): { secret: string; hash: string };
  /** The same hash `create` gave: stable across restarts and secret rotation. */
  hash(secret: string): string;
  /**
   * Time depends only on the two lengths, never on content or where they
   * differ; different lengths are unequal.
   */
  equal(a: string, b: string): boolean;
}

/** The sizes `create` accepts, in bytes. */
const BYTES = { lowest: 32, highest: 1024, default: 32 } as const;

/** SHA-256 of the secret's UTF-8 bytes, in hex. */
function hashOf(secret: string): string {
  return createHash("sha256").update(secret, "utf8").digest("hex");
}

/** Build the helper a plugin receives as `ctx.security.opaque`. */
export function createOpaqueSecrets(): OpaqueSecrets {
  return {
    create(options = {}) {
      const bytes = options.bytes ?? BYTES.default;
      if (
        !Number.isInteger(bytes) ||
        bytes < BYTES.lowest ||
        bytes > BYTES.highest
      ) {
        throw NextlyError.validation({
          errors: [
            {
              path: "bytes",
              code: "OUT_OF_RANGE",
              message: `bytes must be a whole number from ${BYTES.lowest} to ${BYTES.highest}.`,
            },
          ],
          logContext: { lowest: BYTES.lowest, highest: BYTES.highest },
        });
      }
      const secret = randomBytes(bytes).toString("base64url");
      return { secret, hash: hashOf(secret) };
    },
    hash: hashOf,
    equal(a, b) {
      // Compared as UTF-16 units, so two strings of one length are buffers of
      // one length whatever characters they hold. Different lengths answer at
      // once: the time then depends on the lengths alone, which is all it may.
      if (a.length !== b.length) return false;
      return timingSafeEqual(
        Buffer.from(a, "utf16le"),
        Buffer.from(b, "utf16le")
      );
    },
  };
}
