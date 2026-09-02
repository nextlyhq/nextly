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
 * and is off for a reachable password field (top-level, in a group, or in a
 * component) — a password cannot ride safely in a draft snapshot. It is also
 * off when a reachable component fails to resolve, since the draft snapshot
 * cannot represent that subtree faithfully.
 *
 * A LOCALIZED document is eligible: a working draft is keyed by locale, so each
 * language holds its own pending change.
 *
 * Component analysis is left to the caller (via `resolveComponentSchemas`) so
 * this stays a pure, synchronous, DI-free predicate that is trivially testable.
 *
 * @module domains/versions/draft-split-eligibility
 */

import type { CollectionConfig } from "../../collections/config/define-collection";
import type { FieldConfig } from "../../collections/fields/types";
import { hasPasswordField } from "../../shared/lib/password-fields";

import { resolveVersionsConfig } from "./resolve-config";
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

/** Why the split does not run for a collection that asked for it. */
export type DraftSplitDisabledReason =
  /** `versions.drafts.enabled` is on but the Draft/Published lifecycle is not. */
  | "lifecycle-disabled"
  /** A password field is reachable from the collection or one of its components. */
  | "password-field"
  /** A component the fields reference has no record in the registry. */
  | "unresolvable-component";

export interface DraftSplitEligibility {
  eligible: boolean;
  /**
   * `null` both when the split runs and when the configuration never asked for
   * it. A collection with no drafts versioning is not misconfigured, so
   * reporting a cause for it would be noise on every ordinary schema response.
   */
  reason: DraftSplitDisabledReason | null;
  /**
   * The component behind the reason, when it is a component that carries it.
   * `null` when the cause is the collection's own configuration or fields.
   */
  componentSlug: string | null;
}

const ELIGIBLE: DraftSplitEligibility = {
  eligible: true,
  reason: null,
  componentSlug: null,
};

/**
 * Whether a status-less update stores a working draft, and — when it does not
 * and the configuration asked for one — which rule refused it.
 *
 * The rules are identical to {@link isDraftSplitEligible}, which derives from
 * this; the only addition is the cause, so a developer who configured the split
 * and did not get it can find out why instead of seeing the feature simply
 * absent.
 */
export function evaluateDraftSplitEligibility(
  input: DraftSplitEligibilityInput
): DraftSplitEligibility {
  if (!input.draftsVersioningEnabled) {
    // Nothing asked for the split, so there is nothing to explain.
    return { eligible: false, reason: null, componentSlug: null };
  }
  if (!input.collectionHasStatus) {
    return {
      eligible: false,
      reason: "lifecycle-disabled",
      componentSlug: null,
    };
  }
  // A reachable password field disqualifies the whole collection: the snapshot
  // strips passwords and the promote filter drops any subtree holding one, so a
  // draft could neither carry a password change nor preserve an edit made
  // alongside it.
  if (hasPasswordField(input.fields)) {
    return { eligible: false, reason: "password-field", componentSlug: null };
  }
  const schemas = input.componentSchemas
    ? [...input.componentSchemas.entries()]
    : [];
  // An unresolved component cannot be represented faithfully in a draft
  // snapshot: its subtree would be dropped on promote, silently. A LOCALIZED
  // component is representable, because a snapshot holds exactly one locale's
  // values and the draft is keyed by that locale.
  const unresolved = schemas.find(([, schema]) => !schema.resolved);
  if (unresolved) {
    return {
      eligible: false,
      reason: "unresolvable-component",
      componentSlug: unresolved[0],
    };
  }
  const withPassword = schemas.find(([, schema]) =>
    hasPasswordField(schema.fields)
  );
  if (withPassword) {
    return {
      eligible: false,
      reason: "password-field",
      componentSlug: withPassword[0],
    };
  }
  // A FRESH object rather than the shared constant. Every eligible caller would
  // otherwise hold the same reference, so one of them mutating its verdict
  // would change every later eligible verdict for the lifetime of the process —
  // including the ones the schema and mutation paths read. Cheap here because
  // the object has three fields and this runs once per eligibility question.
  return { ...ELIGIBLE };
}

/**
 * Whether a status-less update stores a working draft (the live row untouched)
 * rather than writing the live row directly.
 */
export function isDraftSplitEligible(
  input: DraftSplitEligibilityInput
): boolean {
  return evaluateDraftSplitEligibility(input).eligible;
}

/** The draft-split fields a schema-read response carries. */
export interface DraftSplitResponseFields {
  draftsEnabled: boolean;
  draftsDisabledReason?: DraftSplitDisabledReason;
}

/**
 * The draft-split fields to spread onto a schema-read response.
 *
 * One place decides both the flag and whether a cause accompanies it, so the
 * four read paths cannot come to disagree about when a reason is reported —
 * and an entity that never asked for the split carries no phantom cause.
 */
export function draftSplitResponseFields(
  split: DraftSplitEligibility
): DraftSplitResponseFields {
  return {
    draftsEnabled: split.eligible,
    ...(split.reason === null ? {} : { draftsDisabledReason: split.reason }),
  };
}

/** The collection shape the schema-read paths carry, for {@link schemaDraftSplit}. */
export interface SchemaEligibilityCollection {
  status?: boolean;
  versions?: { drafts?: { enabled?: boolean } } | null;
  /** Top-level fields, in their ORIGINAL (un-enriched) form — the enriched shape
   *  drops the localized/resolved markers component eligibility needs. */
  fields: FieldConfig[];
  /** Names the entity in the warning an unresolvable component emits. */
  slug?: string;
}

/**
 * A component slug is only resolvable once the database is reachable, so an
 * unresolvable one cannot be reported when the config is first read. It is
 * reported on the first schema read that discovers it instead, once per entity
 * and component, so a request path does not repeat it on every read.
 */
const reportedUnresolvable = new Set<string>();

/** Forget which unresolvable components have been reported. Test-only. */
export function resetUnresolvableComponentReports(): void {
  reportedUnresolvable.clear();
}

function reportUnresolvableComponent(
  entity: string,
  componentSlug: string
): void {
  const key = `${entity}:${componentSlug}`;
  if (reportedUnresolvable.has(key)) return;
  reportedUnresolvable.add(key);
  console.warn(
    `[nextly] "${entity}" enables drafts but references the component ` +
      `"${componentSlug}", which has no record. Pending changes are disabled ` +
      `for it: a draft snapshot cannot represent a component it cannot read. ` +
      `Create the component or remove the field that references it.`
  );
}

/**
 * Resolve a schema-read response's draft-split state (the admin editor's
 * `draftsEnabled` flag, and why it is off), from the same predicate the
 * mutation service gates on.
 *
 * Component schemas are resolved from the registry here (async), but only once
 * the cheap disqualifiers pass — mirroring the mutation service, so a collection
 * the split can never take (no drafts, no lifecycle, top-level password) never
 * pays for a registry read. The caller owns error handling: a registry failure
 * should leave the flag off rather than fail the read.
 */
export async function schemaDraftSplit(
  collection: SchemaEligibilityCollection
): Promise<DraftSplitEligibility> {
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
  const result = evaluateDraftSplitEligibility({
    collectionHasStatus,
    draftsVersioningEnabled,
    fields: collection.fields,
    componentSchemas,
  });
  if (
    result.reason === "unresolvable-component" &&
    result.componentSlug !== null
  ) {
    reportUnresolvableComponent(
      collection.slug ?? "this entity",
      result.componentSlug
    );
  }
  return result;
}

/**
 * Whether a schema-read response should report drafts as enabled.
 *
 * Derived from {@link schemaDraftSplit} so the flag and the reason can never
 * disagree about the same collection.
 */
export async function schemaDraftsEnabled(
  collection: SchemaEligibilityCollection
): Promise<boolean> {
  return (await schemaDraftSplit(collection)).eligible;
}

/**
 * A collection as its AUTHOR wrote it, before anything resolved the shorthand.
 *
 * This is what a plugin holds. `versions` accepts the authored forms — `true`,
 * where drafts default on, and `{ drafts: true }` — rather than the resolved
 * `{ drafts: { enabled } }` shape that only exists after config load.
 *
 * PROJECTED from {@link CollectionConfig} rather than restated, so the three
 * properties this question reads carry whatever the authoring type says they
 * carry. A parallel declaration would keep compiling after `CollectionConfig`
 * widened one of them, and the collection an author can legally write would
 * then be rejected by the helper published to read it — with nothing failing,
 * because the function and its exported alias would share the stale copy.
 *
 * `slug` is the one departure and it is narrowed, not widened: a collection
 * always has one, but this only names the entity in the warning an unresolvable
 * component emits, so a caller holding a partial collection can omit it.
 */
export type AuthoredDraftSplitCollection = Pick<
  CollectionConfig,
  "status" | "versions" | "fields"
> & {
  slug?: CollectionConfig["slug"];
};

/**
 * Whether a collection stores a working draft beside its published row, asked
 * of the collection a caller actually has.
 *
 * The public form of this question. `schemaDraftSplit` beside it takes
 * `versions` already resolved, which is the shape config load produces and NOT
 * the shape anybody writes: an author writes `versions: true` or
 * `{ drafts: true }`, and handing either to the resolved form is rejected by
 * the checker — or, from untyped code, silently answers `false` for a
 * collection whose drafts are enabled, because nothing named `drafts.enabled`
 * is there to read.
 *
 * The shorthand is expanded through `resolveVersionsConfig`, which is what
 * config load itself uses. Expanding it here instead would be a second
 * implementation of what `versions: true` means, and the two would agree until
 * one of them changed.
 */
export async function collectionDraftSplit(
  collection: AuthoredDraftSplitCollection
): Promise<DraftSplitEligibility> {
  return schemaDraftSplit({
    status: collection.status,
    versions: resolveVersionsConfig(collection.versions, collection.status),
    fields: collection.fields,
    slug: collection.slug,
  });
}
