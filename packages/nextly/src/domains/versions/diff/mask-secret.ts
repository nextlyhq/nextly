/**
 * Replace hashed passwords in a value about to be displayed.
 *
 * A password field is skipped at every depth, so nothing here runs for one that
 * is still declared. What this exists for is a field that WAS a password when a
 * version was captured and is not one now — deleted, or retyped as text, json or
 * code. The old snapshots still hold the bcrypt hash, the field no longer
 * declares itself a password, and the comparison would print the hash.
 *
 * Masking is applied to what is DISPLAYED and never to what is compared. Two
 * different hashes both mask to the same string, so deciding equality on the
 * masked form would report a changed password as unchanged — the lossy
 * projection reporting "same" for what it dropped. Every caller compares raw
 * values and renders masked ones.
 *
 * @module domains/versions/diff/mask-secret
 */

import { defineOwnProperty } from "../../../shared/lib/own-property";

/**
 * A stored value in bcrypt's format. Anchored, so a hash is masked only when it
 * is the WHOLE value: a substring match would let this rewrite the middle of a
 * document the reader is trying to compare.
 */
const BCRYPT_HASH = /^\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}$/;

/** What a masked value reads as. */
export const SECRET_MASK = "[protected]";

/**
 * The value with every bcrypt-hash string replaced, recursing into arrays and
 * objects: an opaque node (a removed component, or a dynamic-zone type swap
 * rendered as a whole value) can carry a hash nested several levels down.
 */
export function maskSecret(value: unknown): unknown {
  if (typeof value === "string") {
    return BCRYPT_HASH.test(value) ? SECRET_MASK : value;
  }
  if (Array.isArray(value)) return value.map(maskSecret);
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, inner] of Object.entries(value)) {
      // Defined, not assigned: a stored JSON value can carry a `__proto__` key,
      // and assigning it would silently drop it from the diff.
      defineOwnProperty(out, key, maskSecret(inner));
    }
    return out;
  }
  return value;
}
