/**
 * Reading and writing the type a dynamic-zone instance announces itself under.
 *
 * ## Why this is a function and not a constant
 *
 * The storage migration renames this key inside stored JSON. Table and column names survive that
 * because `resolve-storage-names.ts` asks the CATALOG which spelling a database really uses — but
 * a key inside a row is not a catalog object. Nothing can observe it, so nothing can resolve it.
 *
 * A constant therefore does not help a reader: inlining `STORAGE_FORMAT.wireTypeKey` still yields
 * exactly one spelling, and a document written under the other one reads as untyped. An instance
 * whose type cannot be read is intact and unusable — the editor cannot render it, a diff cannot
 * tag it, and a filter on it matches nothing.
 *
 * So the contract callers need is an accessor that TRIES BOTH, in the order the migration itself
 * uses. Exporting one function also means the flip is a change here rather than a search: the
 * reason `schemas/storage-format.ts` exists, extended to the one name it cannot cover.
 *
 * ## Which order, and why it is that way round
 *
 * Read the CURRENT spelling first and fall back to the legacy one. Writes always use the current
 * spelling, never the legacy one.
 *
 * That pairing is what makes a partially rewritten database safe rather than merely survivable. A
 * migration that stops half way leaves both spellings present across different rows; every one of
 * them still reads, and any row saved afterwards is written in the current spelling, so the set of
 * legacy rows only ever shrinks. Writing the legacy spelling — which a hardcoded save path does —
 * grows it instead, behind a migration that has already reported success.
 */

import { STORAGE_FORMAT } from "../../../schemas/storage-format";
import { MIGRATION_TARGET } from "../migration/manifest";

/**
 * Every spelling this key has ever had, current first.
 *
 * Derived from the two catalogs rather than listed, so a rename that edits either one is picked up
 * here without a second edit. Deduplicated because the two are the SAME string until the flip
 * happens, and a reader should not check one spelling twice.
 */
const READ_ORDER: readonly string[] = Array.from(
  new Set([STORAGE_FORMAT.wireTypeKey, MIGRATION_TARGET.wireTypeKey])
);

/** The spelling new documents are written under. */
export const currentFieldGroupTypeKey = STORAGE_FORMAT.wireTypeKey;

/**
 * The type a dynamic-zone instance announces, or undefined when it announces none.
 *
 * Undefined is a real answer rather than an error: a single-field-group instance carries no
 * discriminator at all, and only the multi shape does. Callers already branch on that.
 */
export function readFieldGroupType(instance: unknown): string | undefined {
  if (typeof instance !== "object" || instance === null) return undefined;
  const record = instance as Record<string, unknown>;
  for (const key of READ_ORDER) {
    const value = record[key];
    // A non-string is treated as absent rather than coerced. The value is a slug the caller looks
    // up, and a number or object stringifies into something that resolves to nothing while
    // reading as though it had been found.
    if (typeof value === "string") return value;
  }
  return undefined;
}

/**
 * Stamp the type onto an instance, under the spelling this version writes.
 *
 * Mutates rather than copying, because the callers are building an object they own — a form's
 * default values, or a row being assembled. A copy would be the safer default in general; here it
 * would silently drop the assignment for every caller that does not use the return value.
 */
export function writeFieldGroupType(
  instance: Record<string, unknown>,
  type: string
): void {
  instance[currentFieldGroupTypeKey] = type;
}
