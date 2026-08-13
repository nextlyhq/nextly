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
const FIELD_GROUP_TYPE_KEY_NAMES = [
  STORAGE_FORMAT.wireTypeKey,
  MIGRATION_TARGET.wireTypeKey,
  ...HISTORICAL_WIRE_TYPE_KEYS,
] as const;

export const fieldGroupTypeKeys: readonly string[] = Array.from(
  new Set(FIELD_GROUP_TYPE_KEY_NAMES)
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
/**
 * The type a given instance is allowed to be told it is.
 *
 * 🔴 A generated field group declares its discriminator as a LITERAL — the generator emits
 * `_componentType: "hero"` — so a signature taking any `string` lets `writeFieldGroupType(hero,
 * "cta")` compile, mutate the value at runtime, and leave TypeScript still narrowing it as a hero.
 * Every discriminated-union branch downstream then routes cta data through hero-only code, and the
 * compiler agrees with the wrong answer.
 *
 * So a declared discriminator constrains the argument to itself, and anything else — a plain
 * record, a deserialised payload — keeps the unconstrained `string` it needs.
 */
type UnionToIntersection<U> = (
  U extends unknown ? (x: U) => void : never
) extends (x: infer I) => void
  ? I
  : never;

/**
 * Every spelling a declared discriminator may use, as TYPES.
 *
 * 🔴 Derived from the SAME list the runtime read order is built from, and that is the whole point.
 * Restating the two catalogs here reproduces, in the type system, the convergence bug the comment
 * on `HISTORICAL_WIRE_TYPE_KEYS` describes: once the current catalog is flipped to the target
 * spelling the two names coincide, the historical one is absent from the restated union, and a
 * legacy-generated interface falls through to `string` — re-admitting exactly the retagging these
 * helpers exist to reject, in the release where nearly every stored document is still legacy.
 * Deriving makes the two answer for one world rather than two that drift apart on a flip.
 */
type FieldGroupTypeKeyName = (typeof FIELD_GROUP_TYPE_KEY_NAMES)[number];

/** The literal a value declares its type as, under whichever spelling it uses. */
type DeclaredFieldGroupType<T> = T[Extract<keyof T, FieldGroupTypeKeyName>];

/** Whether `T` is a union of more than one member. */
type IsUnion<T> = [T] extends [UnionToIntersection<T>] ? false : true;

type WritableFieldGroupType<T> = [DeclaredFieldGroupType<T>] extends [never]
  ? string
  : [DeclaredFieldGroupType<T>] extends [string]
    ? // 🔴 A union of tagged instances is REJECTED rather than offered every member's tag. A
      // dynamic zone is generated as `Hero | Cta`, and a distributive conditional would produce
      // `"hero" | "cta"` — so retagging a hero as a cta would compile, change only the
      // discriminator, and leave hero-shaped data sitting behind a cta type. Narrow the value
      // first; there is no correct tag to write onto a value whose type is still undecided.
      IsUnion<T> extends true
      ? never
      : DeclaredFieldGroupType<T>
    : string;

/**
 * Whether an instance is of a given field group, narrowing it when it is.
 *
 * The reader alone cannot narrow: it returns `string | undefined`, which has no relationship to
 * the value, so `switch (readFieldGroupType(block))` leaves a generated `Hero | Cta` union exactly
 * as wide as it was and every member-specific property inaccessible inside the matching branch.
 * That pushes callers back to reading the raw key, which is the one thing this module exists to
 * stop.
 *
 * `Extract` falls back to `T` when it matches nothing, so a caller holding a single concrete type,
 * or a plain record, keeps what it had instead of being narrowed to `never`.
 */
export function isFieldGroupType<T, K extends string>(
  instance: T,
  type: K
): instance is NarrowedFieldGroup<T, K> {
  return readFieldGroupType(instance) === type;
}

type NarrowedFieldGroup<T, K extends string> = [
  Extract<T, Record<Extract<keyof T, FieldGroupTypeKeyName>, K>>,
] extends [never]
  ? T
  : Extract<T, Record<Extract<keyof T, FieldGroupTypeKeyName>, K>>;

/** The spellings this version no longer writes, but still reads. */
type SupersededFieldGroupTypeKey = Exclude<
  FieldGroupTypeKeyName,
  typeof currentFieldGroupTypeKey
>;

/** The literal a value declares under a spelling this version has moved past. */
type DeclaredUnderSupersededKey<T> = T[Extract<
  keyof T,
  SupersededFieldGroupTypeKey
>];

/**
 * Marks a value this function would leave describing itself incorrectly.
 *
 * 🔴 The refusal is the honest answer rather than a conservative one. Canonicalising DELETES every
 * other spelling, so a value whose declared type requires a superseded key emerges without a
 * property its own type still promises: reading it back type-checks as the literal and is
 * `undefined` at runtime, and no narrowing downstream can catch that because the compiler agrees
 * with the stale shape. Neither alternative works — writing the superseded spelling instead grows
 * the legacy set behind a migration that has reported success, and mutating in place cannot be
 * reflected back to the caller's binding.
 *
 * What this rejects is a value typed by a GENERATOR that ran against a different storage format,
 * which is a stale artefact rather than a legitimate shape, and the fix is to regenerate. Reading
 * such a value is untouched: `readFieldGroupType` and `isFieldGroupType` handle every spelling,
 * which is where compatibility with an unmigrated database actually has to live.
 *
 * A property carries the explanation because a bare `never` parameter renders as "type 'string' is
 * not assignable to type 'never'", which names neither the cause nor the remedy.
 */
type SupersededSpellingRefusal = {
  readonly __nextlyRegenerateTypes: "this value declares its field-group type under a superseded key, which writing would delete; regenerate the types for this version";
};

/**
 * Nothing, or the refusal, depending on what the value declares.
 *
 * The `never` arm is checked first: `Extract` yields `never` for a value declaring no superseded
 * key, `T[never]` is `never`, and `never extends string` is TRUE — so testing assignability alone
 * would refuse every well-formed value.
 *
 * Applied as `T & SupersededRefusal<T>` rather than as a conditional in the parameter's own
 * position, because `T` is not inferable from a conditional type and would silently fall back to
 * its constraint, taking the retagging check down with it. Intersecting keeps `T` inferable from
 * the argument, and `T & unknown` is `T`, so the permitted case is unchanged.
 */
type SupersededRefusal<T> = [DeclaredUnderSupersededKey<T>] extends [never]
  ? unknown
  : [DeclaredUnderSupersededKey<T>] extends [string]
    ? SupersededSpellingRefusal
    : unknown;

export function writeFieldGroupType<T extends object>(
  instance: T & SupersededRefusal<T>,
  type: WritableFieldGroupType<T>
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
