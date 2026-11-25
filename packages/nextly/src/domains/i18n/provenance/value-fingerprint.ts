/**
 * The fingerprint a translated value is known by, and what a stored value is read back to for it.
 *
 * @experimental Until per-field provenance is complete.
 *
 * @module domains/i18n/provenance/value-fingerprint
 */
import { createHash } from "node:crypto";

import { canonicalJson } from "../../../shared/lib/canonical-json";

/**
 * A sha256 of a value as it was written, the same on every dialect. A write hands its values on
 * as the store will keep them, so each is read back to what it was first: a date as its ISO
 * string (canonical JSON would make every date `{}`), and, for a field whose storage is JSON
 * (`storedAsJson`), an object or array kept as text as the value it encodes (so its keys are put
 * in order, not compared as written). Any other text is the value itself: a text field holding
 * `[1, 2]` and then `[1,2]` has changed.
 */
export function valueFingerprint(value: unknown, storedAsJson = false): string {
  return createHash("sha256")
    .update(
      canonicalJson(writtenValueOf(value ?? null, storedAsJson)) ?? "",
      "utf8"
    )
    .digest("hex");
}

/** A stored value read back to the value written; see {@link valueFingerprint}. */
export function writtenValueOf(value: unknown, storedAsJson: boolean): unknown {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value.toISOString();
  }
  if (storedAsJson && typeof value === "string") {
    const text = value.trim();
    if (text.startsWith("{") || text.startsWith("[")) {
      try {
        return JSON.parse(text) as unknown;
      } catch {
        return value;
      }
    }
  }
  return value;
}
