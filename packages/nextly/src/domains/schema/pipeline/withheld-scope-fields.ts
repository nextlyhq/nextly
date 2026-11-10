/**
 * What the latest configuration fold held back from each type the site
 * switched off for a plugin's scope.
 *
 * Kept apart from the schema code that reads it (`kept-scope-fields.ts`) and
 * importing nothing, so the fold, which every plugin test loads, publishes it
 * without loading the schema pipeline.
 *
 * @module domains/schema/pipeline/withheld-scope-fields
 */

import type { FieldConfig } from "../../../collections/config/define-collection";

/** The kinds of type a scope reaches. */
export type ScopedKind = "collection" | "single";

/** The held-back fields, by {@link scopedTypeKey}. */
export type WithheldScopeFields = ReadonlyMap<string, readonly FieldConfig[]>;

/** The key one type's held-back fields are published under. */
export function scopedTypeKey(kind: ScopedKind, slug: string): string {
  return `${kind}:${slug}`;
}

// On `globalThis`, as the per-language storage choice is: Next.js can
// evaluate this module in more than one server module graph, and the fold
// that publishes may run in a different one from the push that reads.
const store = globalThis as unknown as {
  __nextly_withheldScopeFields?: WithheldScopeFields;
};

/**
 * Publish what the latest fold held back. Replaces what an earlier fold
 * published, so a type switched on again is no longer read as held back.
 */
export function publishWithheldScopeFields(
  withheld: WithheldScopeFields
): void {
  store.__nextly_withheldScopeFields = withheld;
}

/** The fields the latest fold held back from one type; none when it held none. */
export function withheldScopeFieldsOf(
  kind: ScopedKind,
  slug: string
): readonly FieldConfig[] {
  return (
    store.__nextly_withheldScopeFields?.get(scopedTypeKey(kind, slug)) ?? []
  );
}
