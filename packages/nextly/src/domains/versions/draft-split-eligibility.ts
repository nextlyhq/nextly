/**
 * Whether the draft/published working-draft split will run for a collection.
 *
 * This is the single source of truth for the split's eligibility. The mutation
 * service gates a status-less update on it (whether to store a working draft
 * instead of writing the live row), and the schema-read paths expose it to the
 * admin as `draftsEnabled` so the editor offers the matching affordances. Any
 * divergence would make the editor present a status-less save as a pending draft
 * while the server writes the live row (or the reverse), so all three call sites
 * MUST derive it here.
 *
 * The split needs the Draft/Published lifecycle and drafts-enabled versioning,
 * and is off for a localized document and for a reachable password field
 * (top-level, in a group, or in a component) — a password cannot ride safely in
 * a draft snapshot. It is also off when any reachable component is localized or
 * fails to resolve, since the draft snapshot cannot represent those faithfully.
 *
 * Component analysis is left to the caller (via `resolveComponentSchemas`) so
 * this stays a pure, synchronous, DI-free predicate that is trivially testable.
 *
 * @module domains/versions/draft-split-eligibility
 */

import type { FieldConfig } from "../../collections/fields/types";
import { hasPasswordField } from "../../shared/lib/password-fields";

import type { ComponentSchemas } from "./restore-snapshot";
import { resolveComponentSchemas } from "./restore-version";

export interface DraftSplitEligibilityInput {
  /** `collection.status === true` — the Draft/Published lifecycle is enabled. */
  collectionHasStatus: boolean;
  /** `collection.versions?.drafts?.enabled === true`. */
  draftsVersioningEnabled: boolean;
  /** The collection's top-level fields, for the reachable-password check. */
  fields: FieldConfig[];
  /**
   * The collection's reachable component schemas, from
   * `resolveComponentSchemas(fields)`. May be `null` when a caller skipped
   * resolution because a cheaper disqualifier already forces the result false
   * (the mutation service's optimization); the cheap checks below run first, so
   * a `null` map is never reached while still eligible.
   */
  componentSchemas: ComponentSchemas | null;
}

/**
 * Whether a status-less update stores a working draft (the live row untouched)
 * rather than writing the live row directly.
 */
export function isDraftSplitEligible(
  input: DraftSplitEligibilityInput
): boolean {
  if (!input.collectionHasStatus || !input.draftsVersioningEnabled) {
    return false;
  }
  // A reachable password field disqualifies the whole collection: the snapshot
  // strips passwords and the promote filter drops any subtree holding one, so a
  // draft could neither carry a password change nor preserve an edit made
  // alongside it.
  if (hasPasswordField(input.fields)) {
    return false;
  }
  const schemas = input.componentSchemas
    ? [...input.componentSchemas.values()]
    : [];
  // An unresolved component cannot be represented faithfully in a draft
  // snapshot: its subtree would be dropped on promote, silently. A LOCALIZED
  // component is representable, because a snapshot holds exactly one locale's
  // values and the draft is keyed by that locale.
  if (schemas.some(schema => !schema.resolved)) {
    return false;
  }
  if (schemas.some(schema => hasPasswordField(schema.fields))) {
    return false;
  }
  return true;
}

/** The collection shape the schema-read paths carry, for {@link schemaDraftsEnabled}. */
export interface SchemaEligibilityCollection {
  status?: boolean;
  versions?: { drafts?: { enabled?: boolean } } | null;
  localized?: boolean;
  /** Top-level fields, in their ORIGINAL (un-enriched) form — the enriched shape
   *  drops the localized/resolved markers component eligibility needs. */
  fields: FieldConfig[];
}

/**
 * Resolve `draftsEnabled` for a schema-read response (the admin editor's flag),
 * from the same predicate the mutation service gates on.
 *
 * Component schemas are resolved from the registry here (async), but only once
 * the cheap disqualifiers pass — mirroring the mutation service, so a collection
 * the split can never take (localized, no drafts, top-level password) never pays
 * for a registry read. The caller owns error handling: a registry failure should
 * leave the flag off rather than fail the read.
 */
export async function schemaDraftsEnabled(
  collection: SchemaEligibilityCollection
): Promise<boolean> {
  const collectionHasStatus = collection.status === true;
  const draftsVersioningEnabled = collection.versions?.drafts?.enabled === true;
  // Resolved for a localized collection too: a localized component is
  // representable now, but an UNRESOLVED one still is not, and skipping the
  // registry read here would let it through unchecked.
  const componentSchemas =
    collectionHasStatus &&
    draftsVersioningEnabled &&
    !hasPasswordField(collection.fields)
      ? await resolveComponentSchemas(collection.fields)
      : null;
  return isDraftSplitEligible({
    collectionHasStatus,
    draftsVersioningEnabled,
    fields: collection.fields,
    componentSchemas,
  });
}
