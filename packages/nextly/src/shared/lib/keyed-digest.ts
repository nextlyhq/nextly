/**
 * An HMAC under a key derived from the install's secret for one named use.
 *
 * The key is derived with HKDF for the use `info` names alone, so no two uses
 * share a key, and a digest names nothing without the secret. An empty secret,
 * which only a development install has, still keys it: by a value derived from
 * nothing, the same on every instance of that install.
 *
 * @module shared/lib/keyed-digest
 */
import { createHmac, hkdfSync } from "node:crypto";

/** The hex HMAC-SHA256 of `input`, under a key derived for `info` from `secret`. */
export function keyedDigest(
  info: string,
  input: string,
  secret: string
): string {
  const derived = Buffer.from(hkdfSync("sha256", secret, "", info, 32));
  return createHmac("sha256", derived).update(input).digest("hex");
}
