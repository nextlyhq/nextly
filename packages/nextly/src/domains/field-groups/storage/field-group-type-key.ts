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
import { MIGRATION_TARGET } from "../migration/target";

/**
 * Spellings this key has carried in a RELEASED version, pinned as literals.
 *
 * 🔴 Deliberately not derived, and this is the one place in this file where a hardcoded storage
 * spelling is correct.
 *
 * Deriving the read order from the two catalogs looks like the tidy answer and is wrong in one
 * specific release: the moment `STORAGE_FORMAT.wireTypeKey` is flipped to the target spelling, the
 * two catalogs hold the SAME string, a derived set collapses to one entry, and the legacy spelling
 * stops being read — in exactly the release where almost every stored document still uses it. The
 * dual read would disappear at the instant it started to matter.
 *
 * A historical spelling has no source once the catalog has moved past it. Nothing but a literal
 * can hold it, so it is held here, next to the reader that needs it, rather than left to be
 * reconstructed from constants that converge.
 */
const HISTORICAL_WIRE_TYPE_KEYS = ["_componentType"] as const;

/**
 * Every spelling this key can appear under, most current first.
 *
 * The two catalogs still contribute, so a future rename is picked up without editing this list;
 * the pinned history is what survives their convergence. Deduplicated because before the flip the
 * catalogs differ and after it they do not, and a reader should not check one spelling twice.
 *
 * Exported because several callers need the SET rather than a single answer — building a set of
 * metadata property names, removing the discriminator however it is spelled. Everything else in
 * this file is derived from it rather than restating it, so the spellings are enumerated once.
 *
 * Order is significant and is the read order: a document carrying two spellings resolves to the
 * most current one. Callers wanting a single spelling want `currentFieldGroupTypeKey`, which says
 * so; indexing this is the same bug as hardcoding.
 */
export const fieldGroupTypeKeys: readonly string[] = Array.from(
  new Set([
    STORAGE_FORMAT.wireTypeKey,
    MIGRATION_TARGET.wireTypeKey,
    ...HISTORICAL_WIRE_TYPE_KEYS,
  ])
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
  for (const key of fieldGroupTypeKeys) {
    const value = record[key];
    // A non-string is treated as absent rather than coerced. The value is a slug the caller looks
    // up, and a number or object stringifies into something that resolves to nothing while
    // reading as though it had been found.
    if (typeof value === "string") return value;
  }
  return undefined;
}

/**
 * Whether a property name is one of this key's spellings.
 *
 * Asked by code that walks a document key by key rather than looking the value up — pruning a
 * restore payload, deciding whether a row carries anything but metadata, stripping the marker
 * before storage. Those places cannot use `readFieldGroupType` because they hold a KEY, not an
 * instance, and matching one spelling there drops or keeps the wrong half of a document.
 */
export function isFieldGroupTypeKey(key: string): boolean {
  return fieldGroupTypeKeys.includes(key);
}

/**
 * Remove the discriminator from an instance, under every spelling it may carry.
 *
 * Deleting only the current spelling leaves a legacy-spelled document still carrying its type,
 * which matters because the callers are producing a value defined by that absence — a payload
 * stripped back to the fields a schema names, so that a later restore prunes it against the
 * component the field names now. A surviving discriminator makes that "stripped" object one the
 * next reader still sees a type on, and the two halves of the round trip stop being inverses.
 */
export function clearFieldGroupType(instance: Record<string, unknown>): void {
  for (const key of fieldGroupTypeKeys) {
    delete instance[key];
  }
}

/**
 * Stamp the type onto an instance, under the spelling this version writes.
 *
 * Mutates rather than copying, because the callers are building an object they own — a form's
 * default values, or a row being assembled. A copy would be the safer default in general; here it
 * would silently drop the assignment for every caller that does not use the return value.
 */
export function writeFieldGroupType<T extends object>(
  instance: T,
  type: string
): void {
  // Every other spelling goes first, so an instance that arrived carrying the old key leaves
  // carrying only the new one. Assigning without clearing emits BOTH on any instance read back
  // from storage before the rewrite reached it — the read still resolves, but the document is now
  // one a later reader must disambiguate, and the legacy set stops shrinking as writes happen.
  // Canonicalising on write is what makes the migration finish by ordinary use rather than only by
  // the rewrite pass.
  // Widened to a record for the mutation only. The parameter is `T extends object` because the
  // generated field-group interfaces are interfaces without an index signature, so requiring
  // `Record<string, unknown>` made the published writer reject Nextly's own generated types and
  // forced every caller into a cast — the cast belongs here once, not at every call site.
  const record = instance as Record<string, unknown>;
  clearFieldGroupType(record);
  record[currentFieldGroupTypeKey] = type;
}
