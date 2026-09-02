import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import { and, inArray, sql } from "drizzle-orm";

import type { FieldDefinition } from "@nextly/schemas/dynamic-collections";

import type { AuthenticatedScope } from "../../../auth/authenticated-scope";
import { canReadSystemResource } from "../../../auth/resource-readable";
import { getDialectTables } from "../../../database";
import { container } from "../../../di/container";
import { NextlyError } from "../../../errors/nextly-error";
import {
  convertTimestampsToCamelCase,
  keysToCamelCase,
} from "../../../lib/case-conversion";
import { absolutizeMediaUrls } from "../../../lib/media-variant";
import { statusCondition } from "../../../lib/status-condition";
import {
  resolveStatusFilter,
  type StatusFilter,
} from "../../../lib/status-filter";
import {
  AccessControlService,
  DEFAULT_OWNER_FIELD,
} from "../../../services/access";
import {
  describeUntranslatableConstraint,
  stripNoOpConstraintMembers,
} from "../../../services/access/constraint-shape";
import type {
  CollectionFileManager,
  CompanionSchema,
} from "../../../services/collection-file-manager";
import {
  buildDrizzleCondition,
  buildLocalizedWhereExists,
  type LocalizedQueryContext,
} from "../../../services/collections/drizzle-condition";
import {
  buildWhereClause,
  type WhereFilter,
} from "../../../services/collections/query-operators";
import type {
  RelatedRowReadContext,
  TargetReadPolicy,
} from "../../../services/collections/related-row-read-context";
import {
  applyMediaTrustBound,
  boundRefuses,
  callerId,
} from "../../../services/collections/trust-bound";
import type { TrustBound } from "../../../services/collections/trust-grant";
import {
  assumedBound,
  boundReaches,
  TRUSTS_EVERY_COLLECTION,
} from "../../../services/collections/trust-grant";
import type { Logger } from "../../../services/shared";
import { BaseService } from "../../../shared/base-service";
import { detachData } from "../../../shared/lib/detach";
import {
  applyFieldReadAccess,
  runFieldHooks,
  type ReadAccessRedactions,
} from "../../../shared/lib/field-level-registry";
import {
  hasPasswordField,
  stripPasswordFieldValues,
  stripSystemOwnerField,
} from "../../../shared/lib/password-fields";
import type { RBACAccessControlService } from "../../auth/services/rbac-access-control-service";
import type { DynamicCollectionService } from "../../dynamic-collections";
import {
  NO_DECISIONS,
  type ReleaseDecisions,
} from "../../releases/release-scope";
import {
  NO_RELEASE_VISIBILITY,
  type ReleaseVisibility,
} from "../../releases/release-visibility";

import { CollectionAccessService } from "./collection-access-service";
import type { UserContext } from "./collection-types";
import { decodeJsonFieldValues } from "./collection-utils";

/**
 * System-entity columns that hold secrets and must never ride along a
 * populated relationship. System entities have no schema field list, so
 * they are stripped by column name (both snake_case as stored and the
 * camelCase form some conversions produce).
 */
const SYSTEM_ENTITY_SECRET_COLUMNS = ["passwordHash", "password_hash"] as const;

/**
 * Default depth for relationship population.
 * Default depth for relationship population.
 */
export const DEFAULT_RELATIONSHIP_DEPTH = 2;

/**
 * Maximum allowed depth to prevent performance issues.
 */
export const MAX_RELATIONSHIP_DEPTH = 5;

/** Carried across one read's nested-hook pass. */
interface NestedHookStateBase {
  /**
   * Rows already visited. Batch expansion hands the same object to every parent
   * that references it, so this is what keeps a transform from compounding
   * with the reference count; it also breaks a reference cycle.
   */
  visited: Set<Record<string, unknown>>;
  /** One schema read per collection per read, rather than per row per depth. */
  fields: Map<string, FieldDefinition[]>;
  /**
   * Label field per target, keyed by collection AND the field's declared
   * override, since two relationships can point at one collection and name
   * different labels. Resolving it costs a metadata read, and the label is
   * rebuilt for every related row.
   */
  labelFields: Map<string, Promise<string>>;
  /**
   * The values field access removed from each related row, keyed by the row
   * object, shared across the whole read. The walk applies access to each row
   * before its parent's hooks (so a hook cannot read a denied child field to copy
   * it), recording what it removed here; finalize re-applies access after every
   * hook, restoring those values as evidence and re-judging the current content,
   * so anything a hook reintroduced, mutated, or added is caught.
   */
  redactions: ReadAccessRedactions;
  /**
   * Every related row the pass reached, in visit order, with what is needed to
   * finish it. These entries drive the finalize step after every hook has run: it
   * re-applies access to each row (see `redactions`), then rebuilds labels last
   * from the values that survived.
   */
  pending: Array<{
    row: Record<string, unknown>;
    collection: string;
    field: FieldDefinition;
    /**
     * How many hops from the document the row was reached at. Expansion honours
     * the depth remaining when it reaches a row, so the SAME row reached one hop
     * in and two hops in carries different population: the nearer occurrence has
     * its own relationships expanded where the deeper one has bare ids.
     */
    depth: number;
  }>;
  /**
   * The AUTHORITATIVE version of each related row, keyed by collection and id: a
   * deep copy taken once the walk and the finalize step have fully sanitized it,
   * before any source-collection `afterRead` hook can reach it.
   *
   * The response's related rows are rebuilt from these rather than inspected for
   * tampering (see
   * {@link CollectionRelationshipService.reprojectRelatedRows}). A source hook is
   * free to clone, reshape, reorder, or write to a related row; whatever it did is
   * discarded when the row is re-derived, so no reshape has to be DETECTED to be
   * undone. A related row's presentation is its own collection's authority, so a
   * source hook cannot change it — including its allowed fields.
   *
   * Copies, never the live rows: a hook that mutates a related row in place would
   * otherwise corrupt the very version this restores from.
   */
  sanitized: Map<string, { depth: number; row: Record<string, unknown> }>;
}

/** The state the walk carries; named separately so the interface reads first. */
type NestedHookState = NestedHookStateBase;

function createNestedHookState(): NestedHookState {
  return {
    visited: new Set(),
    fields: new Map(),
    labelFields: new Map(),
    redactions: new WeakMap(),
    pending: [],
    sanitized: new Map(),
  };
}

/**
 * The collection a nested value belongs to, and the row itself.
 *
 * A polymorphic relationship is expanded as `{ relationTo, value }`, so the
 * target is knowable per VALUE even though the field declares several. The
 * discriminator is validated against what the field declares, so a stored value
 * naming a collection the field never pointed at cannot direct another
 * collection's hooks at this row.
 */
/**
 * Whether a field stores its values as the discriminated `{ relationTo, value }`
 * pair rather than as bare ids.
 *
 * Decided by the ARRAY FORM of `relationTo`, not by how many targets it names: a
 * field declaring a single target as an array (`relationTo: ["posts"]`) uses the
 * same pair a multi-target field does, because the storage shape follows how the
 * target was declared. Counting targets instead reads that pair as the row.
 *
 * Mirrors {@link declaredTargets}: a many-to-many field resolves its one target
 * from `options.target` and stores bare ids, whatever `relationTo` says.
 */
function isDiscriminatedRelationship(field: FieldDefinition): boolean {
  if (field.options?.relationType === "manyToMany" && field.options.target) {
    return false;
  }
  return Array.isArray(field.relationTo);
}

/**
 * What one relationship value actually holds.
 *
 * - `reference` — a bare id, or the pair a discriminated field stores while
 *   nothing is populated. It carries no fields, so there is nothing to sanitize
 *   and nothing to rebuild.
 * - `populated` — an expanded row, with the collection it belongs to.
 * - `unresolvable` — an expanded row whose collection cannot be established: a
 *   pair naming a collection the field never declared, or a bare row under a
 *   field naming several targets, where nothing in the value says which one it
 *   came from.
 */
type RelationshipValueShape =
  | { kind: "reference" }
  | { kind: "unresolvable" }
  | {
      kind: "populated";
      collection: string;
      row: Record<string, unknown>;
      discriminated: boolean;
    };

/**
 * Read a relationship value's shape, once, for every reader that needs it.
 *
 * The walk and the response rebuild both have to agree about which values are
 * discriminated and which collection a row belongs to. Deciding that separately
 * in each is how they drift: one treating a `{ relationTo, value }` pair as the
 * row evaluates the target's rules against an object holding neither of its
 * fields, and the other drops a relationship nothing touched.
 */
function readRelationshipValueShape(
  value: unknown,
  field: FieldDefinition
): RelationshipValueShape {
  if (value === null || value === undefined) return { kind: "reference" };
  if (typeof value !== "object" || Array.isArray(value)) {
    return { kind: "reference" };
  }
  // The same resolver expansion uses, so a Schema Builder relationship -- whose
  // target lives in `options.target` with no `relationTo` at all -- is walked
  // rather than skipped.
  const targets = declaredTargets(field);
  if (targets.length === 0) return { kind: "reference" };

  const record = value as Record<string, unknown>;
  // Only a field that DECLARES the pair shape is read as one, so a target
  // collection that legitimately defines its own string `relationTo` field is
  // not mistaken for a wrapper and skipped.
  if (
    isDiscriminatedRelationship(field) &&
    typeof record.relationTo === "string"
  ) {
    const inner = record.value;
    if (inner === null || typeof inner !== "object" || Array.isArray(inner)) {
      // The pair is still carrying an id: a reference, not an expanded row.
      return { kind: "reference" };
    }
    // Validated against what the field declares: nothing checks the stored slug
    // on the way in, so an unvalidated one would let a writer aim another
    // collection's rules and hooks at this row.
    if (!targets.includes(record.relationTo)) return { kind: "unresolvable" };
    return {
      kind: "populated",
      collection: record.relationTo,
      row: inner as Record<string, unknown>,
      discriminated: true,
    };
  }

  if (targets.length > 1) return { kind: "unresolvable" };
  return {
    kind: "populated",
    collection: targets[0],
    row: record,
    discriminated: false,
  };
}

function resolveNestedTarget(
  row: Record<string, unknown>,
  field: FieldDefinition
): { collection: string; row: Record<string, unknown> } | null {
  const shape = readRelationshipValueShape(row, field);
  return shape.kind === "populated"
    ? { collection: shape.collection, row: shape.row }
    : null;
}

/**
 * The caller a related row is redacted for.
 *
 * Carried separately from {@link RelationshipExpansionOptions} because the fetch
 * helpers need only these two of its fields, and passing the whole options bag
 * down would let a depth value leak into a redaction decision.
 */
/**
 * The caller a related row is fetched, judged and redacted for.
 *
 * The shared shape, carried unchanged by every layer that can reach a related
 * row. Kept as a local name because this service refers to it constantly and
 * "access" reads better at those call sites than the full noun.
 */
type RelatedRowAccess = RelatedRowReadContext;

/**
 * Whether this expansion may see a target's UNPUBLISHED rows.
 *
 * Deliberately not {@link trustsTarget}. Trust answers *who may read a row*;
 * draft-ness answers *whether the row is ready to be read by anyone*, and a
 * caller can be entitled to the first without the second.
 *
 * A caller that supplies `trusted` has declared it serves ONE FIXED AUDIENCE —
 * that is the only reason to bound a bypass it already holds. Such a caller
 * never inherits a widened lifecycle, even for a collection it explicitly
 * trusts, because trusting a collection says its PUBLISHED content may be
 * shown, not that its pending edits may. A public route is the case that makes
 * this concrete: it pre-renders, so a draft pulled in through a relationship is
 * written to a static artifact and outlives the row being unpublished.
 *
 * An unbounded trusted caller — the admin UI, a server task — keeps today's
 * behaviour, because it has already decided who is asking.
 */
function widensLifecycle(access: RelatedRowAccess): boolean {
  if (access.overrideAccess !== true) return false;
  return access.trusted === TRUSTS_EVERY_COLLECTION;
}

/**
 * Whether this expansion may read ONE target collection trusted.
 *
 * `overrideAccess` alone says the CALLER is trusted. It says nothing about the
 * collection a relationship happens to point at, which the caller never named
 * and may not serve to the same audience. Asking per target is what lets a
 * caller that knows its audience — a public route, say — keep the bypass for
 * what it declared and read everything else as that audience would.
 *
 * Absent predicate means unchanged behaviour, so a caller that has already
 * decided who is asking keeps today's semantics rather than being narrowed by
 * a default it never chose.
 */
function trustsTarget(
  access: RelatedRowAccess,
  targetCollection: string
): boolean {
  if (access.overrideAccess !== true) return false;
  return boundReaches(access.trusted, targetCollection);
}

/**
 * Options for relationship expansion.
 */
export interface RelationshipExpansionOptions {
  /**
   * Maximum depth to expand relationships (0-5).
   * - 0: No expansion, return IDs only
   * - 1: Expand immediate relationships
   * - 2+: Expand nested relationships recursively
   * @default 2
   */
  depth?: number;

  /**
   * Current depth level (used internally for recursion).
   * @internal
   */
  currentDepth?: number;

  /**
   * The caller a related row's field-level `access.read` rules are evaluated
   * against.
   *
   * Expansion spreads the whole related row into the parent entry, and the
   * parent entity's field registry never describes a related collection's
   * fields — so without the caller here, a field the target collection protects
   * is returned to anyone who populates the relationship. Absent means
   * anonymous, which denies any rule that inspects the user, matching how the
   * parent entry is redacted.
   */
  user?: Record<string, unknown>;

  /**
   * Trusted read: skip field-level read rules on related rows, matching
   * `applyFieldReadAccess`. Secret stripping (passwords, system columns) is NOT
   * skipped — a system caller has no reason to receive a password hash.
   */
  overrideAccess?: boolean;

  /**
   * Narrows `overrideAccess` to the collections a caller names, judged per
   * expansion TARGET. See {@link RelatedRowAccess.trusted}.
   */
  trusted?: TrustBound;

  /**
   * Opt in to evaluating the target collection's field read rules. Set by the
   * read paths that forward a real caller; see {@link RelatedRowAccess}.
   */
  enforceFieldAccess?: boolean;
  /**
   * Whose field rules related rows are judged by, when that is not the caller.
   * See {@link RelatedRowReadContext.fieldAccessUser}. Applied to the access
   * pass alone — hooks keep seeing `user`, who is who is actually asking.
   */
  fieldAccessUser?: Record<string, unknown>;

  /**
   * Evaluate the target collection's own read rules even when field redaction
   * is off. See {@link RelatedRowAccess.enforceCollectionAccess}.
   */
  enforceCollectionAccess?: boolean;

  /**
   * Defer the target's field read rules to the post-assembly pass. Only a
   * caller that runs {@link CollectionRelationshipService.applyNestedFieldHooks}
   * over the finished document may set this. See
   * {@link RelatedRowAccess.fieldAccessStage}.
   */
  fieldAccessStage?: "fetch" | "assembled";

  /**
   * Collects the ids withheld because a target collection refused the caller,
   * so a completeness check can tell a refusal from a failure.
   *
   * @internal
   */
  withheldByAccess?: Set<string>;

  /**
   * Target read policies already resolved during this expansion.
   *
   * Carried by a nested hop so the whole expansion resolves each target
   * collection's rules once. Not part of what a caller supplies.
   *
   * @internal
   */
  targetPolicies?: Map<string, Promise<TargetReadPolicy>>;

  /**
   * Companion schemas already looked up during this expansion, carried by a
   * nested hop for the same reason the policy map is.
   *
   * @internal
   */
  targetCompanions?: Map<string, Promise<CompanionSchema | null>>;

  /**
   * The caller's authenticated scope, when one applies.
   *
   * A scoped API key is judged on its OWN stamped grant rather than its
   * owner's roles, so a super-admin-owned key must not inherit the bypass its
   * owner's session would get.
   */
  authenticatedScope?: AuthenticatedScope;

  /**
   * The caller's Draft/Published intent, when they asked to see everything.
   *
   * Deliberately narrow: `"all"` is the only value that propagates into
   * expansion. It is a statement about the caller's trust — the admin sends it
   * on every read for exactly that reason — whereas a concrete `draft` or
   * `published` names the lifecycle of the collection being read and says
   * nothing about what that collection points at. Absent means a related row is
   * filtered to the published default, which is what a direct read of it would
   * do.
   */
  status?: "all";
  /**
   * The language this read resolved to, forwarded so a target collection's read
   * rule can be applied when it filters on a localized field.
   *
   * Pass the resolved locale, not the raw request parameter: see
   * {@link RelatedRowAccess.locale}.
   */
  locale?: string;
}

/**
 * Checks if a field is a relationship field.
 */
function isRelationshipField(field: FieldDefinition): boolean {
  return field.type === "relationship";
}

/**
 * Checks if a field is an upload field.
 */
function isUploadField(field: FieldDefinition): boolean {
  return field.type === "upload";
}

/**
 * Checks if a field is a repeater or group field (container with nested rows).
 */
function isRepeaterOrGroupField(field: FieldDefinition): boolean {
  return field.type === "repeater" || field.type === "group";
}

/**
 * Checks if a field is a group field (container with nested fields).
 */
function isGroupField(field: FieldDefinition): boolean {
  return field.type === "group";
}

/**
 * Gets nested fields from a repeater or group field.
 */
function getNestedFields(field: FieldDefinition): FieldDefinition[] {
  if (field.fields && Array.isArray(field.fields)) {
    return field.fields;
  }
  return [];
}

/**
 * Safely parses JSON data if it's a string, otherwise returns as-is.
 * Handles cases where repeater/group field data hasn't been deserialized yet.
 */
function parseJsonIfString(data: unknown): unknown {
  if (typeof data === "string") {
    try {
      return JSON.parse(data);
    } catch {
      return data;
    }
  }
  return data;
}

/**
 * The row objects inside a container value (a `group` object, or a `repeater`
 * array), parsing a JSON string first. Non-object entries are dropped. Used to
 * walk an original and its clone in parallel when transferring redaction evidence.
 */
function containerRowsOf(value: unknown): Record<string, unknown>[] {
  const parsed = parseJsonIfString(value);
  if (Array.isArray(parsed)) {
    return parsed.filter(
      (row): row is Record<string, unknown> =>
        row !== null && typeof row === "object"
    );
  }
  if (parsed !== null && typeof parsed === "object") {
    return [parsed as Record<string, unknown>];
  }
  return [];
}

/**
 * Extracts the ID from a relationship field value.
 * Handles both raw IDs (strings) and expanded objects ({id: "..."}).
 */
function extractRelationshipId(value: unknown): unknown {
  if (value == null) return value;
  if (typeof value === "string") return value;
  if (
    typeof value === "object" &&
    !Array.isArray(value) &&
    value !== null &&
    "id" in value
  ) {
    return (value as Record<string, unknown>).id;
  }
  return value;
}

/**
 * A resolved relationship value: which collection the row is read from, and
 * whether the stored value named that collection itself.
 *
 * `discriminated` decides what the populated row has to carry back, not where
 * it is read from — a value that named its collection has to keep saying so in
 * the response, or saving the document back loses it.
 */
interface RelationshipRef {
  collection: string;
  id: string;
  discriminated: boolean;
}

/**
 * Keeps a populated multi-target value round-trippable, and keeps it out of the
 * related row's own namespace.
 *
 * The write path reduces a populated object to a bare id unless it still says
 * which collection it came from, and a bare id resolves against the field's
 * first declared target — so a document read at depth and saved back unchanged
 * would silently retarget or drop the relationship.
 *
 * The row is nested under `value` rather than carrying the discriminator beside
 * its own columns: a target collection may legitimately define a field called
 * `value` or `relationTo` (neither is reserved), and merging would overwrite
 * that field's real data, including re-adding a key that field-level access
 * had just removed. Nesting also keeps one shape at every depth — `value` is
 * the id when nothing was populated, and the row when something was.
 */
function withReferenceIdentity(
  row: Record<string, unknown>,
  ref: RelationshipRef
): Record<string, unknown> {
  if (!ref.discriminated) return row;
  return { relationTo: ref.collection, value: row };
}

/**
 * The collections a relationship field is allowed to point at.
 *
 * A many-to-many field keeps its target under `options.target`, matching how
 * {@link getTargetCollection} resolves one.
 */
function declaredTargets(field: FieldDefinition): string[] {
  if (field.options?.relationType === "manyToMany" && field.options.target) {
    return [field.options.target];
  }
  if (Array.isArray(field.relationTo)) return field.relationTo;
  if (typeof field.relationTo === "string") return [field.relationTo];
  const target = field.options?.target;
  return typeof target === "string" ? [target] : [];
}

/**
 * Reads a relationship value that carries its own target collection.
 *
 * A field declaring several targets cannot store a bare id, because the id
 * alone does not say which table it belongs to; it stores a
 * `{ relationTo, value }` pair instead. The stored collection decides which
 * table the id is read from, so it is only honoured when the field declares
 * it: nothing validates the slug on the way in, and trusting it as written
 * would let a writer name any collection and have the row read back out of it,
 * bypassing that collection's own read rules.
 *
 * Returns null for any other shape, leaving the caller on the single-target
 * path where the field's own target is the right answer.
 */
function readPolymorphicRef(
  value: unknown,
  allowedTargets: string[]
): RelationshipRef | null {
  // Dialects without a native object column hand the pair back as the JSON
  // text it was stored as. Only a value that actually parses to the pair is
  // treated as one: an ordinary id is a bare string, and a Postgres array
  // literal opens with the same brace but is not JSON, so both fall through
  // to the single-target path rather than being mistaken for a reference.
  const candidate =
    typeof value === "string" && value.startsWith("{")
      ? parseJsonObject(value)
      : value;
  if (
    candidate === null ||
    typeof candidate !== "object" ||
    Array.isArray(candidate)
  ) {
    return null;
  }
  const { relationTo, value: id } = candidate as Record<string, unknown>;
  if (typeof relationTo !== "string" || typeof id !== "string") return null;
  if (!allowedTargets.includes(relationTo)) return null;
  return { collection: relationTo, id, discriminated: true };
}

/**
 * Whether a value is stored as a `{ relationTo, value }` pair, regardless of
 * which collection it names. Distinguishes "not a pair" from "a pair naming a
 * collection this field never declared", so the second can be left alone
 * rather than treated as an id and sent to the wrong table.
 */
function isPolymorphicRefShape(value: unknown): boolean {
  const candidate =
    typeof value === "string" && value.startsWith("{")
      ? parseJsonObject(value)
      : value;
  if (
    candidate === null ||
    typeof candidate !== "object" ||
    Array.isArray(candidate)
  ) {
    return false;
  }
  const { relationTo, value: id } = candidate as Record<string, unknown>;
  return typeof relationTo === "string" && typeof id === "string";
}

/** Parses JSON text to an object, or null when it is not one. */
function parseJsonObject(text: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(text);
    return parsed !== null &&
      typeof parsed === "object" &&
      !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

/**
 * Strips expanded relationship objects in a data row down to just their IDs.
 * Used when depth=0 to ensure no nested relationships are returned as full objects.
 * Recursively handles nested repeater/group fields.
 */
function stripRelationshipsToIds(
  row: Record<string, unknown>,
  fields: FieldDefinition[]
): Record<string, unknown> {
  const stripped = { ...row };

  for (const field of fields) {
    const fieldName = field.name;
    if (
      !fieldName ||
      stripped[fieldName] === undefined ||
      stripped[fieldName] === null
    )
      continue;

    if (isRelationshipField(field)) {
      const hasMany =
        field.hasMany || field.options?.relationType === "manyToMany";
      const value = stripped[fieldName];

      if (hasMany && Array.isArray(value)) {
        stripped[fieldName] = value.map(v => extractRelationshipId(v));
      } else {
        stripped[fieldName] = extractRelationshipId(value);
      }
    } else if (field.type === "repeater" || field.type === "group") {
      const nestedFields = getNestedFields(field);
      if (nestedFields.length === 0) continue;

      const rawData = stripped[fieldName];
      const parsed = parseJsonIfString(rawData);

      if (field.type === "repeater" && Array.isArray(parsed)) {
        stripped[fieldName] = parsed.map((item: Record<string, unknown>) => {
          if (item && typeof item === "object") {
            return stripRelationshipsToIds(item, nestedFields);
          }
          return item;
        });
      } else if (
        field.type === "group" &&
        parsed &&
        typeof parsed === "object" &&
        !Array.isArray(parsed)
      ) {
        stripped[fieldName] = stripRelationshipsToIds(
          parsed as Record<string, unknown>,
          nestedFields
        );
      }
    }
  }

  return stripped;
}

/**
 * Checks if a target collection name is a system entity.
 * System entities are managed tables like users, not dynamic collections.
 */
function isSystemEntity(targetName: string): boolean {
  const systemEntities = ["users", "roles", "permissions"];
  return systemEntities.includes(targetName.toLowerCase());
}

/**
 * Gets the system table schema for known system entities.
 * @param targetName - System entity name (e.g., "users")
 * @param dialect - Database dialect
 * @returns Schema or null if not a valid system entity
 */
function getSystemEntityTable(targetName: string, dialect?: string) {
  if (targetName.toLowerCase() !== "users") return null;

  const tables = getDialectTables(dialect);
  return tables.users;
}

/**
 * Gets the default label field for a system entity.
 * @param targetName - System entity name
 * @returns Default label field name
 */
function getSystemEntityLabelField(targetName: string): string {
  if (targetName.toLowerCase() === "users") {
    return "name"; // Users have a "name" field for display
  }
  return "id"; // Fallback to ID
}

/**
 * System-entity label field, honoring an explicit `targetLabelField` unless it
 * names a secret column (e.g. users `passwordHash`). The label is copied onto
 * the expanded row before row-level redaction runs, so a secret label field
 * would leak the hash via `label` even though the column itself is stripped.
 */
function resolveSystemEntityLabelField(
  targetName: string,
  targetLabelField?: string
): string {
  if (
    targetLabelField &&
    !(SYSTEM_ENTITY_SECRET_COLUMNS as readonly string[]).includes(
      targetLabelField
    )
  ) {
    return targetLabelField;
  }
  return getSystemEntityLabelField(targetName);
}

/**
 * Recursively collects all media IDs from a data object based on field definitions.
 * Handles nested upload fields inside repeater and group fields.
 *
 * @param data - The data object to extract media IDs from
 * @param fields - Field definitions
 * @returns Array of all media IDs found
 */
function collectAllMediaIds(
  data: Record<string, unknown>,
  fields: FieldDefinition[]
): string[] {
  if (!data || typeof data !== "object") return [];

  const mediaIds: string[] = [];

  for (const field of fields) {
    const fieldName = field.name;
    if (!fieldName || data[fieldName] === undefined || data[fieldName] === null)
      continue;

    if (isUploadField(field)) {
      // Upload field - collect its IDs
      const ids = normalizeToIdArray(data[fieldName]);
      mediaIds.push(...ids);
    } else if (isRepeaterOrGroupField(field)) {
      // Repeater field - recurse into each row
      // Handle both parsed arrays and JSON strings (pre-deserialization)
      const nestedFields = getNestedFields(field);
      const rawArrayData = data[fieldName];
      const arrayData = parseJsonIfString(rawArrayData);
      if (Array.isArray(arrayData)) {
        for (const row of arrayData) {
          if (row && typeof row === "object") {
            const nestedIds = collectAllMediaIds(row, nestedFields);
            mediaIds.push(...nestedIds);
          }
        }
      }
    } else if (isGroupField(field)) {
      // Group field - recurse into the group object
      // Handle both parsed objects and JSON strings (pre-deserialization)
      const nestedFields = getNestedFields(field);
      const rawGroupData = data[fieldName];
      const groupData = parseJsonIfString(rawGroupData);
      if (
        groupData &&
        typeof groupData === "object" &&
        !Array.isArray(groupData)
      ) {
        const nestedIds = collectAllMediaIds(
          groupData as Record<string, unknown>,
          nestedFields
        );
        mediaIds.push(...nestedIds);
      }
    }
  }

  return mediaIds;
}

/**
 * Recursively expands media IDs in a data object using the provided media lookup map.
 * Handles nested upload fields inside repeater and group fields.
 *
 * @param data - The data object to expand
 * @param fields - Field definitions
 * @param mediaMap - Map of media ID to full media object
 * @returns The data with expanded media objects
 */
function expandMediaInData(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- recursive data structure
  data: any,
  fields: FieldDefinition[],
  mediaMap: Map<string, Record<string, unknown>>
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- recursive data structure
): any {
  if (!data || typeof data !== "object") return data;

  const result = Array.isArray(data) ? [...data] : { ...data };

  for (const field of fields) {
    const fieldName = field.name;
    if (!fieldName || result[fieldName] === undefined) continue;

    if (isUploadField(field)) {
      // Upload field - expand IDs to full media objects
      const value = result[fieldName];
      if (value === null || value === undefined) continue;

      const hasMany = field.hasMany === true;
      const ids = normalizeToIdArray(value);

      if (ids.length === 0) {
        result[fieldName] = hasMany ? [] : null;
      } else if (hasMany) {
        // Return array of media objects, maintaining order
        result[fieldName] = ids
          .map(id => mediaMap.get(String(id)))
          .filter(Boolean);
      } else {
        // Return single media object
        result[fieldName] = mediaMap.get(String(ids[0])) || null;
      }
    } else if (isRepeaterOrGroupField(field)) {
      // Repeater field - recurse into each row
      // Handle both parsed arrays and JSON strings (pre-deserialization)
      const nestedFields = getNestedFields(field);
      const rawArrayData = result[fieldName];
      const arrayData = parseJsonIfString(rawArrayData);
      if (Array.isArray(arrayData)) {
        result[fieldName] = arrayData.map(row => {
          if (row && typeof row === "object") {
            return expandMediaInData(row, nestedFields, mediaMap);
          }
          return row;
        });
      }
    } else if (isGroupField(field)) {
      // Group field - recurse into the group object
      // Handle both parsed objects and JSON strings (pre-deserialization)
      const nestedFields = getNestedFields(field);
      const rawGroupData = result[fieldName];
      const groupData = parseJsonIfString(rawGroupData);
      if (
        groupData &&
        typeof groupData === "object" &&
        !Array.isArray(groupData)
      ) {
        result[fieldName] = expandMediaInData(
          groupData,
          nestedFields,
          mediaMap
        );
      }
    }
  }

  return result;
}

/**
 * Gets the target collection name from a relationship field.
 * For polymorphic relationships (relationTo is array), returns the first collection.
 */
function getTargetCollection(field: FieldDefinition): string | undefined {
  // A many-to-many field's junction table is created from `options.target`
  // (see generateJunctionTable), so resolve m2m targets from there FIRST. A
  // stale or legacy `relationTo` would otherwise make reads/writes derive a
  // different junction-table name than the one that physically exists.
  if (field.options?.relationType === "manyToMany" && field.options.target) {
    return field.options.target;
  }
  if (field.relationTo) {
    return Array.isArray(field.relationTo)
      ? field.relationTo[0]
      : field.relationTo;
  }
  // Other Builder-authored relationship fields may also carry the target under
  // `options.target`; fall back to it when `relationTo` is absent.
  return field.options?.target;
}

/**
 * Determines if a relationship field stores multiple values.
 * Code-first relationship fields use hasMany; UI-built collections use
 * options.relationType === "manyToMany". Either signals many-to-many.
 */
function isHasManyRelationship(field: FieldDefinition): boolean {
  if (field.options?.relationType === "manyToMany") {
    return true;
  }
  if (field.hasMany === true) {
    return true;
  }
  return false;
}

/**
 * Parses a PostgreSQL array string into a JavaScript array.
 * PostgreSQL arrays are returned as strings like: {"uuid1","uuid2"}
 */
function parsePostgresArray(value: unknown): string[] | null {
  if (typeof value !== "string") {
    return null;
  }
  // Check if it's a PostgreSQL array format: {item1,item2} or {"item1","item2"}
  if (value.startsWith("{") && value.endsWith("}")) {
    const inner = value.slice(1, -1);
    if (inner === "") return [];
    // Handle quoted values: {"uuid1","uuid2"}
    // Split by comma, but handle quoted strings
    const items: string[] = [];
    let current = "";
    let inQuotes = false;
    for (let i = 0; i < inner.length; i++) {
      const char = inner[i];
      if (char === '"' && (i === 0 || inner[i - 1] !== "\\")) {
        inQuotes = !inQuotes;
      } else if (char === "," && !inQuotes) {
        items.push(current.replace(/^"|"$/g, ""));
        current = "";
      } else {
        current += char;
      }
    }
    if (current) {
      items.push(current.replace(/^"|"$/g, ""));
    }
    return items;
  }
  return null;
}

/**
 * Returns the stored values as their original items when the field holds a
 * list, so a caller can read each one's own target collection. Null for every
 * other shape, including a Postgres array literal — that format carries bare
 * ids, which have no collection to read.
 */
function readItemArray(value: unknown): unknown[] | null {
  if (Array.isArray(value)) return value;
  if (typeof value === "string" && value.startsWith("[")) {
    try {
      const parsed: unknown = JSON.parse(value);
      if (Array.isArray(parsed)) return parsed;
    } catch {
      return null;
    }
  }
  return null;
}

/**
 * Reads a single relationship value as the collection and id it refers to.
 * Falls back to the field's own target for the ordinary single-target case,
 * where the stored value is just an id.
 */
function readRelationshipRef(
  value: unknown,
  fallbackCollection: string,
  allowedTargets: string[]
): RelationshipRef | null {
  if (value == null) return null;
  const polymorphic = readPolymorphicRef(value, allowedTargets);
  if (polymorphic) return polymorphic;
  // A pair naming an undeclared collection is not an id — reading it as one
  // would send the whole object to the loader as a bound parameter.
  if (isPolymorphicRefShape(value)) return null;
  const id = extractRelationshipId(value);
  return typeof id === "string"
    ? { collection: fallbackCollection, id, discriminated: false }
    : null;
}

/**
 * The display column a relationship field asks its target for, or "" when it
 * asks for none and the label is auto-selected.
 *
 * Read from both shapes expansion supports — a Schema Builder field keeps it
 * under `options`, and a field may carry it at its root — so the two readers
 * that need it (the label rebuild and the snapshot key) cannot disagree about
 * which column a field asked for.
 */
function declaredLabelField(field: FieldDefinition): string {
  const override =
    field.options?.targetLabelField ??
    (field as Record<string, unknown>).targetLabelField;
  return typeof override === "string" ? override : "";
}

/**
 * Identifies a related row AS ONE FIELD PRESENTS IT: the row itself, plus the
 * display column the field asked for.
 *
 * Two relationship fields can point at the same row and ask for different
 * labels, and batch expansion fetches per field — so each holds its own row
 * object carrying its own label. Keyed on the row alone, one field's sanitized
 * version would overwrite the other's and then be restored into both, giving one
 * of them the wrong label.
 */
function relatedRowSnapshotKey(
  collection: string,
  id: string,
  field: FieldDefinition
): string {
  // The same NUL separator {@link relationKey} uses, and for the same reason: it
  // cannot appear in a slug, an id, or a field name, so no two distinct triples
  // can collapse onto one key.
  return `${relationKey(collection, id)}\u0000${declaredLabelField(field)}`;
}

/**
 * Identifies a related row by collection AND id, because an id is only unique
 * within its own collection. A field naming several targets can hold the same
 * id for two of them, and a lookup keyed on the id alone would hand back
 * whichever row was fetched last.
 */
export function relationKey(collection: string, id: string): string {
  // A NUL separator cannot appear in a slug or an id, so no two distinct
  // pairs can collapse to the same key.
  return `${collection}\u0000${id}`;
}

/**
 * Pairs every id in a list-valued relationship with the collection it belongs
 * to. A multi-target field stores one `{ relationTo, value }` pair per entry,
 * and each may name a different collection, so a single target resolved from
 * the field would send most of them to the wrong table.
 *
 * Reads each id against its own item from {@link normalizeToIdArray}, which
 * maps list values one-to-one, so the id and the collection always describe
 * the same entry. Entries naming an undeclared collection are dropped, so the
 * result may be shorter than the stored list; the fetch and the lookup derive
 * it the same way, so they stay consistent.
 */
function normalizeToRelationshipRefs(
  value: unknown,
  fallbackCollection: string,
  allowedTargets: string[]
): RelationshipRef[] {
  const items = readItemArray(value);
  return normalizeToIdArray(value)
    .map((id, index) => {
      const item = items ? items[index] : undefined;
      const ref = items ? readPolymorphicRef(item, allowedTargets) : null;
      if (ref) return ref;
      // Dropped rather than resolved against the field's own target: the value
      // names a collection this field never declared, so there is no reference
      // here to honour.
      if (items && isPolymorphicRefShape(item)) return null;
      return { collection: fallbackCollection, id, discriminated: false };
    })
    .filter((ref): ref is RelationshipRef => ref !== null);
}

/**
 * Normalizes a relationship field value to an array of IDs.
 * Handles various formats:
 * - Single string ID
 * - Array of string IDs
 * - PostgreSQL array string format
 * - Objects with id property
 * - Polymorphic objects with value property
 */
function normalizeToIdArray(value: unknown): string[] {
  if (value == null) return [];

  // Already an array
  if (Array.isArray(value)) {
    return value.map(item => {
      if (typeof item === "string") return item;
      if (typeof item === "object" && item !== null) {
        return String(
          (item as Record<string, unknown>).value ||
            (item as Record<string, unknown>).id ||
            item
        );
      }
      return String(item);
    });
  }

  // PostgreSQL array string
  const parsed = parsePostgresArray(value);
  if (parsed !== null) {
    return parsed;
  }

  // JSON array string (from serialized upload fields with hasMany)
  if (typeof value === "string" && value.startsWith("[")) {
    try {
      const jsonParsed = JSON.parse(value);
      if (Array.isArray(jsonParsed)) {
        return jsonParsed.map(item => {
          if (typeof item === "string") return item;
          if (typeof item === "object" && item !== null) {
            return String(
              (item as Record<string, unknown>).value ||
                (item as Record<string, unknown>).id ||
                item
            );
          }
          return String(item);
        });
      }
    } catch {
      // Not valid JSON, fall through to single string handling
    }
  }

  // Single string ID
  if (typeof value === "string") {
    return [value];
  }

  // Object with id or value
  if (typeof value === "object" && value !== null) {
    const id =
      (value as Record<string, unknown>).value ||
      (value as Record<string, unknown>).id;
    // eslint-disable-next-line @typescript-eslint/no-base-to-string
    if (id) return [String(id)];
  }

  return [];
}

/**
 * CollectionRelationshipService handles all relationship expansion and junction table operations
 * for dynamic collections.
 *
 * Responsibilities:
 * - Expand relationships for single entries and batch operations
 * - Fetch related entries (oneToOne, manyToOne, oneToMany)
 * - Manage many-to-many relationships via junction tables
 * - Determine best label fields for display
 *
 * Uses the database adapter pattern for multi-database support (PostgreSQL, MySQL, SQLite).
 * Currently uses Drizzle queries with dynamic schemas and SQL tagged templates for complex
 * relationship queries that involve dynamic table names.
 *
 * @extends BaseService - Provides adapter access and Drizzle compatibility layer
 *
 * @example
 * ```typescript
 * const relationshipService = new CollectionRelationshipService(
 *   adapter, logger, fileManager, collectionService
 * );
 * const expanded = await relationshipService.expandRelationships(entry, 'posts', fields);
 * ```
 */
// The minimal raw-SQL surface the junction-table code needs from a database
// handle. Both the pooled `this.db` and a transaction-scoped Drizzle instance
// (from `tx.getDrizzle()`) satisfy it, so junction writes can run either on the
// pool (default) or inside a caller's transaction (when an executor is passed),
// keeping the junction write atomic with the entry write.
// Each method is optional because a given dialect's Drizzle handle exposes only
// a subset: SQLite's better-sqlite3 handle has `all`/`run` (no `execute`),
// while the Postgres/MySQL handles have `execute` (no `all`/`run`). The
// junction raw-SQL helpers below are dialect-gated, so the method they call is
// always present for the current dialect.
export type RelationshipDbExecutor = {
  all?(query: unknown): unknown[];
  run?(query: unknown): unknown;
  execute?(query: unknown): Promise<unknown>;
};

// The columns a related-row read reaches for on a target's table.
//
// A dynamic collection's Drizzle table is built at runtime from stored field
// metadata, so there is no compile-time type for it and the loader hands back
// an untyped value. Naming the two columns that are actually read keeps those
// accesses checked, and keeps the rest of the table opaque rather than
// asserting a shape it may not have: `status` is optional because a collection
// without Draft/Published has no such column, and `id` is `unknown` because it
// is only ever handed to Drizzle as a column reference, never read as a value.
type TargetTableColumns = {
  id: unknown;
  status?: unknown;
};

export class CollectionRelationshipService extends BaseService {
  /**
   * Decides whether a caller may read a TARGET collection at all.
   *
   * Built on first use rather than injected: this service is constructed before
   * the one that owns the access service, and resolving it lazily keeps that
   * ordering intact. Stateless, so a second instance costs nothing but the
   * construction.
   */
  private accessService: CollectionAccessService | null = null;
  private readonly accessControl = new AccessControlService();

  constructor(
    adapter: DrizzleAdapter,
    logger: Logger,
    private readonly fileManager: CollectionFileManager,
    private readonly collectionService: DynamicCollectionService,
    /**
     * What a due release makes visible in the TARGET collection.
     *
     * Not a trust question. `widensLifecycle` and `expansionStatusScope` decide
     * whether this CALLER may see unpublished content, and a bounded caller
     * deliberately inherits nothing. A due release is the other kind of fact:
     * the target document IS published, for everyone, so it reaches a bounded
     * caller too and that is correct rather than a leak.
     */
    private readonly releaseVisibility: ReleaseVisibility = NO_RELEASE_VISIBILITY
  ) {
    super(adapter, logger);
  }

  /**
   * The documents a due release would publish in the target collection.
   *
   * Only asked when the read is bounded to published: an unbounded expansion
   * already returns the row, so there is nothing to reveal and nothing to pay
   * for.
   */
  private async targetDecisions(
    targetCollection: string,
    statusFilter: StatusFilter | null,
    now: Date
  ): Promise<ReleaseDecisions> {
    // Only a PUBLIC read is widened by a due release. Read off the filter,
    // which carries why its set was chosen, rather than asking the values
    // again — a second answer to that question disagrees the moment a
    // workflow's public and non-public sets are not complementary.
    if (statusFilter === null || !statusFilter.isPublicRead) {
      return NO_DECISIONS;
    }
    return this.releaseVisibility.decisions({
      scopeKind: "collection",
      scopeSlug: targetCollection,
      now,
    });
  }

  private resolveAccessService(): CollectionAccessService {
    if (!this.accessService) {
      this.accessService = new CollectionAccessService(
        this.adapter,
        this.logger,
        this.collectionService,
        this.accessControl,
        // Optional, and nothing used here needs it: reading a collection's
        // stored rules and building a request context are independent of RBAC.
        // Requiring it would make every target rule fail open in a boot that
        // legitimately omits the service.
        container.has("rbacAccessControlService")
          ? container.get<RBACAccessControlService>("rbacAccessControlService")
          : undefined
      );
    }
    return this.accessService;
  }

  /**
   * Drop the rows of a target collection this caller may not read.
   *
   * A related row belongs to another collection and carries that collection's
   * own read rules. Without this, a caller refused the collection outright
   * still obtains its rows by populating a relationship that points at them.
   *
   * Judged on the fetched ROW, not on the collection alone: a rule may be
   * keyed on the document id, and one evaluated with `undefined` there both
   * hides rows a rule permits and admits rows it forbids — `id !== blocked`
   * reads as true when the id never arrives.
   *
   * Only the STORED rules are evaluated, not the RBAC permission gate. The
   * route authorized this caller for the PARENT collection, and requiring a
   * permission naming a collection they never asked for by name would refuse
   * population for every caller whose grants do not list it. Whether expansion
   * should also require a read permission on the target is left open.
   *
   * Opt-in for the same reason field-level enforcement is: an entry point that
   * has not been given the caller yet would judge everyone anonymous and hide
   * rows from entitled callers.
   */
  /**
   * Read the rows a relationship points at, as this caller may see them.
   *
   * The only place a related row is fetched. Six call sites used to repeat the
   * same five steps — resolve the schema, select by id, normalize timestamps,
   * apply the target collection's read rules, redact its protected fields — and
   * every capability a related row was missing had to be added to each of them
   * and then audited for the one that was forgotten. That audit has been run
   * three times: for the caller's scope, for the read locale, and for two
   * caches. Behind one seam each of those becomes a single change.
   *
   * System entities keep the lean path deliberately: they have no collection
   * record, so no stored rules and no hooks apply, and their secrets are
   * stripped by column name during redaction instead.
   *
   * Returns only the rows this caller may read. A refused row is simply absent —
   * one unreadable reference must not refuse the whole parent read — so callers
   * must not assume the result lines up with the ids they asked for.
   */
  /**
   * The Draft/Published predicate a read of this target resolves to, or
   * undefined when none applies.
   *
   * What propagates from the surrounding read is not a status VALUE but whether
   * the published-only default was deliberately bypassed. A concrete
   * `?status=draft` names the lifecycle of the collection being listed, not of
   * everything it points at — a draft page should still show its published
   * author — so only "read everything" travels, and it travels because it is a
   * statement about the caller's trust rather than about the query.
   *
   * System entities have no lifecycle and no collection record to ask.
   */
  private async resolveTargetStatusFilter(
    targetCollection: string,
    schema: TargetTableColumns,
    access: RelatedRowAccess
  ): Promise<StatusFilter | null> {
    if (isSystemEntity(targetCollection)) return null;
    // Guarded on the column, not only on the collection's flag: a collection
    // whose status was switched off keeps the flag until its schema is
    // reapplied, and naming a column the table lacks fails the whole read.
    if (!schema.status) return null;

    let hasStatus: boolean;
    try {
      const policy = await this.resolveTargetReadPolicy(
        targetCollection,
        this.resolveAccessService(),
        access
      );
      hasStatus = policy.hasStatus;
    } catch {
      // The lifecycle could not be established, so the safe reading is that the
      // collection has one and the caller gets the published-only default.
      hasStatus = true;
    }

    const statusFilter = resolveStatusFilter({
      collectionHasStatus: hasStatus,
      // The LIFECYCLE question, not the trust question — see widensLifecycle.
      overrideAccess: widensLifecycle(access),
      explicit: access.status,
    });
    return statusFilter;
  }

  private async readTargetRows(
    targetCollection: string,
    ids: string[],
    access: RelatedRowAccess
  ): Promise<Record<string, unknown>[]> {
    if (ids.length === 0) return [];

    const schema = isSystemEntity(targetCollection)
      ? getSystemEntityTable(targetCollection)
      : await this.fileManager.loadDynamicSchema(targetCollection);
    if (!schema) return [];

    // Draft/Published applies to a related row exactly as it applies to a direct
    // read of it. Without this, a caller who is 404'd asking for an unpublished
    // row is handed the whole thing — status column included — by populating a
    // relationship that points at it.
    const statusFilter = await this.resolveTargetStatusFilter(
      targetCollection,
      schema,
      access
    );

    const entries = (await this.db
      .select()
      .from(schema)
      .where(inArray(schema.id, ids))) as Record<string, unknown>[];

    const fetched = entries.map(entry =>
      convertTimestampsToCamelCase({ ...entry })
    );
    // Filtered here rather than in the query above so the rows this removes are
    // recorded as deliberately withheld. Narrowing the fetch would drop them
    // before anything could distinguish "exists, wrong lifecycle" from "does
    // not exist" — and a caller checking its expansion for completeness reads
    // an unexplained absence as evidence lost and refuses the whole parent.
    // A row that was never there stays unrecorded, because a dangling
    // reference is a data problem and must not be dressed up as a refusal.
    // A due release publishes the target, so a row it names is admitted even
    // though its stored status still says otherwise. Reading the author
    // directly already honours this; an expansion that did not would make the
    // same document published when asked for by name and missing when arrived
    // at by reference.
    // A due release also WITHDRAWS. Applying only the reveal half left a
    // scheduled takedown visible through every relationship that pointed at it,
    // while a direct read of the same document honoured it.
    const decisions = await this.targetDecisions(
      targetCollection,
      statusFilter,
      new Date()
    );
    const revealed = new Set(decisions.reveal);
    const hidden = new Set(decisions.hide);
    const rows = statusFilter
      ? fetched.filter(row => {
          const id = typeof row.id === "string" ? row.id : null;
          // Withdrawn wins over the stored status: the row still says
          // published, which is exactly what the release is undoing.
          if (id !== null && hidden.has(id)) return false;
          // Membership, because a read bounded to "not yet public" covers every
          // state the workflow does not publish.
          return (
            statusFilter.values.includes(row.status as string) ||
            (id !== null && revealed.has(id))
          );
        })
      : fetched;
    this.recordWithheld(targetCollection, fetched, rows, access);

    const readable = await this.filterRowsByCollectionAccess(
      targetCollection,
      rows,
      access
    );
    // Redaction runs before any caller derives a label from a row: a label
    // copies a field's value under another key, so one taken from an unredacted
    // row survives the redaction of its own source field.
    await this.redactRelatedRows(targetCollection, readable, access);
    return readable;
  }

  private async filterRowsByCollectionAccess(
    targetCollection: string,
    rows: Record<string, unknown>[],
    access: RelatedRowAccess
  ): Promise<Record<string, unknown>[]> {
    // Deliberately NOT keyed on `enforceFieldAccess`. That flag asks whether a
    // related row's FIELDS should be redacted; this asks whether the caller may
    // see the row at all, and the two have different callers. A Single's
    // authorization view populates without field redaction so its rule reads
    // real values — but if the response is going to withhold the row, the
    // preliminary view has to withhold it too, or the rule approves a document
    // on evidence the response then removes and side effects run in between.
    if (!access.enforceCollectionAccess && !access.enforceFieldAccess) {
      return rows;
    }
    if (trustsTarget(access, targetCollection)) return rows;
    if (rows.length === 0) return rows;
    if (isSystemEntity(targetCollection)) {
      // A system entity carries no stored collection rules, so the enforced
      // path below has nothing to evaluate: its secrets are stripped by name
      // during redaction and the row is returned. That is what a direct read
      // gives a caller holding no bypass, and an enforced read keeps it.
      //
      // A caller that holds a bypass and REFUSED this target asked for the
      // opposite. The bound means "read this as the caller would", and a direct
      // read of `users` requires the `read-users` grant; with no stored policy
      // to fall back on, that grant IS the whole rule. So the refusal is
      // honoured by asking whether this caller holds it — the same question the
      // refused DYNAMIC targets below are put to, rather than an assumption
      // about who is asking. A route serving the public holds no grant and its
      // refused rows stay withheld.
      if (!boundRefuses(access, targetCollection)) return rows;
      const readable = await canReadSystemResource(
        targetCollection.toLowerCase(),
        callerId(access),
        access.authenticatedScope
      );
      return readable ? rows : [];
    }

    const accessService = this.resolveAccessService();

    const user = access.user as UserContext | undefined;
    // Super-admins bypass stored rules on every other transport. A scoped API
    // key is authoritative on its OWN grant and never on its owner's roles, so
    // the bypass does not extend to one — the same carve-out the direct read
    // paths make.
    const isScopedApiKey = access.authenticatedScope?.actorType === "apiKey";
    if (!isScopedApiKey && accessService.isSuperAdmin(user)) return rows;

    let policy: TargetReadPolicy;
    try {
      policy = await this.resolveTargetReadPolicy(
        targetCollection,
        accessService,
        access
      );
    } catch {
      // A target whose rules cannot be read is not a target whose rules are
      // satisfied. Deliberately NOT recorded as withheld-by-access: a caller
      // checking its expansion for completeness must still see an unexplained
      // absence here, or a rule that tolerates absence decides on evidence a
      // failure removed.
      return [];
    }

    // Judged concurrently: a custom rule may do its own IO, and a list
    // expanding many targets would otherwise pay for each one in turn. The
    // verdicts are zipped back against the original order, so the rows keep
    // the sequence they were fetched in.
    const verdicts = await Promise.all(
      rows.map(row => this.judgeRow(row, policy, accessService, user))
    );
    const admitted = rows.filter((_, index) => verdicts[index].allowed);
    this.recordWithheld(targetCollection, rows, admitted, access);
    if (admitted.length === 0) return admitted;

    // Rows sharing a predicate are confirmed together, so the usual case of one
    // predicate for the whole collection costs one query — and a rule that
    // answers different rows differently still has each row confirmed against
    // the predicate it was actually judged by.
    const byPredicate = new Map<string, Record<string, unknown>[]>();
    const predicates = new Map<string, Record<string, unknown>>();
    const unrestricted: Record<string, unknown>[] = [];
    admitted.forEach(row => {
      const predicate = verdicts[rows.indexOf(row)].predicate;
      if (!predicate) {
        unrestricted.push(row);
        return;
      }
      const key = JSON.stringify(predicate);
      predicates.set(key, predicate);
      const group = byPredicate.get(key);
      if (group) group.push(row);
      else byPredicate.set(key, [row]);
    });

    // One query per distinct predicate, run together: the usual case is a single
    // group, and a rule answering rows differently should not pay for each group
    // in turn when the groups do not depend on one another.
    const narrowedGroups = await Promise.all(
      [...byPredicate].map(([key, group]) =>
        this.narrowByTargetPredicate(
          targetCollection,
          group,
          predicates.get(key) as Record<string, unknown>,
          access,
          policy
        )
      )
    );
    const confirmed = [...unrestricted];
    // Null means the predicate could not be applied at all. The rows stay out
    // either way, but nothing was decided about them, so they are not reported
    // as refused.
    const anyPredicateFailed = narrowedGroups.some(g => g === null);
    for (const group of narrowedGroups) {
      if (group !== null) confirmed.push(...group);
    }
    // Restored to the order they were fetched in, since the grouping above
    // reads them out by predicate. Matched on id rather than object identity:
    // narrowing re-reads the rows it admits, so what comes back describes the
    // same row but is not the same object.
    const byId = new Map(
      confirmed.map(row => [row.id as string, row] as const)
    );
    const ordered = admitted
      .map(row => byId.get(row.id as string))
      .filter((row): row is Record<string, unknown> => row !== undefined);
    if (!anyPredicateFailed)
      this.recordWithheld(targetCollection, admitted, ordered, access);
    return ordered;
  }

  /**
   * Note which rows a refusal removed, so a caller checking its expansion for
   * completeness reads them as absent on purpose rather than as evidence lost.
   *
   * Keyed by collection AND id, because an id is only unique within its own
   * collection: two targets can carry the same one, and a bare-id record would
   * let a refusal in the first excuse a genuine load failure in the second.
   */
  private recordWithheld(
    targetCollection: string,
    before: Record<string, unknown>[],
    after: Record<string, unknown>[],
    access: RelatedRowAccess
  ): void {
    if (!access.withheldByAccess || before.length === after.length) return;
    const kept = new Set(after);
    for (const row of before) {
      if (kept.has(row)) continue;
      if (typeof row.id === "string") {
        access.withheldByAccess.add(relationKey(targetCollection, row.id));
      }
    }
  }

  /**
   * The target collection's read policy, resolved once per expansion.
   *
   * Reading it costs a collection-metadata query, and a `hasMany` relationship
   * fetches one row at a time — so resolving per row turns a relationship with
   * hundreds of values into hundreds of metadata reads against the same pool
   * the row fetches need.
   */
  private resolveTargetReadPolicy(
    targetCollection: string,
    accessService: CollectionAccessService,
    access: RelatedRowAccess
  ): Promise<TargetReadPolicy> {
    const cached = access.targetPolicies?.get(targetCollection);
    if (cached) return cached;

    // The PENDING lookup is cached, not its result. A `hasMany` relationship
    // fetches its references concurrently, so every one of them reaches this
    // point before the first has anything to store — caching only the resolved
    // value leaves each of them issuing its own metadata read, which is the
    // pool pressure the cache exists to avoid.
    const pending = (async (): Promise<TargetReadPolicy> => {
      const collection =
        await this.collectionService.getCollection(targetCollection);
      return {
        rules: accessService.getAccessRules(
          collection as Record<string, unknown>
        ),
        hasStatus: (collection as { status?: boolean }).status === true,
      };
    })();
    access.targetPolicies?.set(targetCollection, pending);
    return pending;
  }

  /**
   * Keep only the rows the target's own read predicate admits.
   *
   * Asked of the database rather than compared in memory: the predicate is a
   * full filter, and a second evaluator interpreting its operators is free to
   * disagree with the one the direct read compiles — a filter that binds less
   * than the rule states is how a read widens unnoticed. The same translation
   * the read path uses is applied here, over exactly the ids already fetched,
   * so this costs one query per target collection rather than one per row.
   *
   * A predicate that cannot be translated withholds every row. It is the same
   * refusal a direct read makes, expressed as absence, because an unreadable
   * relationship must not turn into an error on the document that points at it.
   */
  private async narrowByTargetPredicate(
    targetCollection: string,
    rows: Record<string, unknown>[],
    constraint: Record<string, unknown>,
    access: RelatedRowAccess,
    policy: TargetReadPolicy
  ): Promise<Record<string, unknown>[] | null> {
    try {
      const schema = isSystemEntity(targetCollection)
        ? getSystemEntityTable(targetCollection)
        : await this.fileManager.loadDynamicSchema(targetCollection);
      if (!schema) return [];

      // The status a read of this target resolves to for this caller, asked of
      // the helper that owns that decision rather than restated here. It applies
      // to the row AND to any companion row consulted about it: constraining
      // only one of the two admits a draft row whose published translation
      // satisfies the rule.
      const statusFilter = resolveStatusFilter({
        collectionHasStatus: policy.hasStatus,
        // Same lifecycle rule as the fetch, or a companion row admits a draft
        // the row filter just excluded.
        overrideAccess: widensLifecycle(access),
        // The same intent the fetch honoured. Re-resolving without it re-applies
        // the published-only default here, so a caller who asked to read
        // everything loses a draft row that the fetch above admitted.
        explicit: access.status,
      });

      const localizedCtx = await this.buildTargetLocalizedContext(
        targetCollection,
        schema,
        access,
        constraint,
        statusFilter?.values
      );

      const untranslatable = describeUntranslatableConstraint(
        constraint,
        name => Object.prototype.hasOwnProperty.call(schema, name),
        // A localized field has no column on the main table, so it counts as
        // translatable only while a companion context is in hand. Without one
        // it is reported untranslatable and the rows are withheld, rather than
        // the member being dropped and the read running under a weaker
        // predicate than the rule states.
        name =>
          Boolean(localizedCtx?.localizedFields.some(f => f.name === name))
      );
      if (untranslatable !== null) {
        this.logger.warn(
          "Withholding related rows behind an untranslatable access constraint",
          { collection: targetCollection, reason: untranslatable }
        );
        return [];
      }

      // Members that cannot narrow anything are dropped first, so "translated
      // to nothing" below judges only what was meant to restrict.
      const restricting = stripNoOpConstraintMembers(constraint);
      if (Object.keys(restricting).length === 0) return rows;

      const condition = buildDrizzleCondition(
        buildWhereClause(restricting as WhereFilter),
        schema,
        this.adapter.dialect ?? "postgresql",
        localizedCtx,
        buildLocalizedWhereExists
      );
      // A constraint that restricts on paper and compiles to nothing would
      // admit every row. Withhold instead: the rule asked to narrow.
      if (!condition) return [];

      // A row without a string id cannot be matched against the target table.
      // Binding an absent one throws on some dialects, and the catch below then
      // withholds every row of the collection instead of just this one.
      const ids = rows
        .map(row => row.id)
        .filter((id): id is string => typeof id === "string");
      if (ids.length === 0) return [];
      // The whole row is re-read under the predicate, not just its id. Reading
      // the id alone authorizes the row as it is NOW and then returns the copy
      // fetched a moment earlier: if a predicate field changed in between — an
      // ownership or tenant reassignment that also replaced the contents — the
      // caller would be handed the version that belonged to whoever held it
      // before. Authorization and the data it admits come from one read.
      // Guarded on the column and not on the flag alone: naming a column the
      // table does not have fails the whole query, and the catch below would
      // then withhold every row of the collection.
      const lifecycleCondition = statusCondition({
        filter: statusFilter,
        statusColumn: schema.status,
        idColumn: schema.id,
        // See collection-query-service: every call site names its workflow so
        // the ones phase 2 must thread are greppable.
        decisions: await this.targetDecisions(
          targetCollection,
          statusFilter,
          new Date()
        ),
      });
      const admitted = (await this.db
        .select()
        .from(schema)
        .where(
          and(
            inArray(schema.id, ids),
            ...(lifecycleCondition ? [lifecycleCondition] : []),
            condition
          )
        )) as Record<string, unknown>[];
      const fresh = new Map(
        admitted.map(row => {
          const normalized = convertTimestampsToCamelCase({ ...row });
          return [normalized.id as string, normalized];
        })
      );
      // Ordered by the rows that came in, so the caller's sequence survives.
      return rows
        .map(row => fresh.get(row.id as string))
        .filter((row): row is Record<string, unknown> => row !== undefined);
    } catch (error) {
      this.logger.warn("Could not apply a target collection's read predicate", {
        collection: targetCollection,
        error,
      });
      // Null, not an empty list: the rows are withheld either way, but the
      // caller must not report this as a refusal — nothing was decided.
      return null;
    }
  }

  /**
   * The target collection's companion schema, looked up once per expansion.
   *
   * The PENDING lookup is cached rather than its result: references are
   * confirmed concurrently, so every one of them reaches this point before the
   * first has anything to store, and caching only the settled value leaves each
   * issuing its own metadata read.
   */
  private resolveTargetCompanion(
    targetCollection: string,
    access: RelatedRowAccess
  ): Promise<CompanionSchema | null> {
    const cached = access.targetCompanions?.get(targetCollection);
    if (cached) return cached;
    const pending = this.fileManager.loadCompanionSchema(targetCollection);
    access.targetCompanions?.set(targetCollection, pending);
    return pending;
  }

  /**
   * The companion context a predicate on a localized field of the TARGET
   * collection needs, or null when there is none to build.
   *
   * A localized field has no column on the main table — it lives in the
   * collection's `_locales` companion, one row per language — so a predicate
   * naming one can only be applied as a subquery against that table. Without
   * this the field looked like a column the target does not have, and every row
   * behind such a rule was withheld from expansion while a list read of the
   * same collection returned them.
   *
   * Null when the target is not localized, or when no locale reached this
   * expansion: a companion filter has to name one language, and the read that
   * asked for every language at once (or never said) has no single answer.
   * Withholding is the outcome then, unchanged from before.
   *
   * Also null when the constraint names only columns the target already has.
   * Looking a companion up costs a collection-metadata read, and the ordinary
   * case — an owner or tenant predicate on a plain column — has nothing to
   * resolve there, so a localized application would pay for every target it
   * populates without a companion filter ever being built.
   */
  private async buildTargetLocalizedContext(
    targetCollection: string,
    schema: TargetTableColumns,
    access: RelatedRowAccess,
    constraint: Record<string, unknown>,
    /** The status a read of this target resolves to, or undefined for none. */
    statusValues: readonly string[] | undefined
  ): Promise<LocalizedQueryContext | null> {
    if (!access.locale || isSystemEntity(targetCollection)) return null;
    // Judged on the raw constraint keys, which is what the untranslatable check
    // inspects: a member naming something the table does not have is either a
    // localized field or a mistake, and both have to reach that check with the
    // same information it would otherwise be missing.
    const namesNonColumn = Object.keys(constraint).some(
      field => !Object.prototype.hasOwnProperty.call(schema, field)
    );
    if (!namesNonColumn) return null;

    const companion = await this.resolveTargetCompanion(
      targetCollection,
      access
    );
    if (!companion || companion.localizedFields.length === 0) return null;

    return {
      companionTableName: companion.companionTableName,
      localizedFields: companion.localizedFields,
      // The same table object the confirming query selects FROM, so the
      // companion's `_parent` correlates against the row being judged.
      mainIdColumn: schema.id,
      locale: access.locale,
      // A companion row in another state must not satisfy the filter: a draft
      // translation holding the permitted value would otherwise admit a row the
      // target's own list read, filtering on the same status, excludes. Gated on
      // the companion having the column, matching the read path.
      statusValues: companion.hasStatus ? statusValues : undefined,
    };
  }

  /**
   * Whether one fetched row survives the target collection's read policy.
   *
   * Only verdicts are decided here. An owner-only rule answers a read with a
   * predicate, and it travels the same route every other predicate does — the
   * database applies it — so there is no comparison in this process for any
   * rule shape, and nothing that could read an operator differently from the
   * query the direct read compiles.
   */
  private async judgeRow(
    row: Record<string, unknown>,
    policy: TargetReadPolicy,
    accessService: CollectionAccessService,
    user: UserContext | undefined
  ): Promise<{ allowed: boolean; predicate: Record<string, unknown> | null }> {
    const result = await this.accessControl.evaluateAccess(
      policy.rules,
      "read",
      accessService.buildRequestContext(user),
      row.id as string | undefined,
      // The id is supplied and the document is not, which is exactly what a
      // direct read of this target evaluates with. Handing the row over here
      // instead would let a rule written as `data?.tenant === req.user.tenant`
      // admit through a relationship what the target's own endpoint refuses,
      // making population the more permissive way in.
      undefined,
      // Collections stamp the owner into the `created_by` system column.
      DEFAULT_OWNER_FIELD
    );

    // The predicate travels with the verdict that produced it. A rule may vary
    // by document id and answer a concrete row with a narrower predicate than
    // it answers an id-less question with, so resolving the narrowing
    // separately would apply the weaker one to rows judged by the stronger.
    return {
      allowed: result.allowed,
      predicate: result.query ?? null,
    };
  }

  /**
   * Run a SELECT-style raw SQL tag and return its rows in a normalized
   * `{ rows: [...] }` shape regardless of dialect.
   *
   * Drizzle's raw-execute result shape differs across drivers:
   *   - Postgres (node-postgres): `db.execute(sqlTag)` → `{ rows: [...] }`
   *   - MySQL (mysql2): `db.execute(sqlTag)` → a `[rows, fieldPackets]` tuple
   *     (or a flat rows array), NOT `{ rows }`
   *   - SQLite (better-sqlite3): `db.all(sqlTag)` → `unknown[]` (no execute())
   *
   * Without this helper, the junction-table code paths blow up at runtime on
   * SQLite (`this.db.execute is not a function`) and on MySQL (reading
   * `.rows` off the tuple yields undefined). The MySQL normalization mirrors
   * the defensive handling in schema/pipeline/classifier/count-helpers.ts.
   */
  private async selectRawSql(
    query: unknown,
    // Run on the caller's transaction handle when provided, else the pool.
    db: RelationshipDbExecutor = this.db
  ): Promise<{ rows: unknown[] }> {
    if (this.dialect === "sqlite") {
      // SQLite's handle exposes all(); the dialect gate guarantees it here.
      const rows = db.all!(query);
      return { rows };
    }
    // Postgres/MySQL handles expose execute().
    const result: unknown = await db.execute!(query);
    if (this.dialect === "mysql" && Array.isArray(result)) {
      // Tuple form `[rows, fieldPackets]` -> take rows; a flat rows array (first
      // element is a row object, not an array) is already the rows.
      const first = result[0];
      return { rows: Array.isArray(first) ? (first as unknown[]) : result };
    }
    return result as { rows: unknown[] };
  }

  /**
   * Run an INSERT / UPDATE / DELETE / DDL raw SQL tag, dialect-aware.
   * Same rationale as `selectRawSql`. Returns void since callers don't
   * inspect the mutation result here. Accepts an optional handle for the same
   * reason as `selectRawSql` (defaults to the pool).
   */
  private async mutateRawSql(
    query: unknown,
    db: RelationshipDbExecutor = this.db
  ): Promise<void> {
    if (this.dialect === "sqlite") {
      // SQLite's handle exposes run(); the dialect gate guarantees it here.
      db.run!(query);
      return;
    }
    // Postgres/MySQL handles expose execute().
    await db.execute!(query);
  }

  /**
   * Determine the best label field for a collection.
   * Tries to find a meaningful text field, not just ID.
   *
   * @param collectionName - Name of the collection or system entity
   * @param targetLabelField - Optional explicitly specified label field
   * @returns The best field name to use as a label
   */
  async getBestLabelField(
    collectionName: string,
    targetLabelField?: string
  ): Promise<string> {
    try {
      // Check if this is a system entity first. Never surface a secret column
      // as a label (see resolveSystemEntityLabelField).
      if (isSystemEntity(collectionName)) {
        return resolveSystemEntityLabelField(collectionName, targetLabelField);
      }

      const collection =
        await this.collectionService.getCollection(collectionName);
      const fields = ((
        (collection as Record<string, unknown>).schemaDefinition as
          | Record<string, unknown>
          | undefined
      )?.fields ||
        (collection as Record<string, unknown>).fields ||
        []) as FieldDefinition[];

      // If targetLabelField is provided, validate it exists in the collection.
      // A `password` field is excluded: it must never become the label, or its
      // hash would ride along in `label` past the row-level redaction.
      if (targetLabelField) {
        const fieldExists = fields.some(
          f =>
            f.name === targetLabelField &&
            f.type !== "relationship" &&
            f.type !== "password"
        );

        if (fieldExists) {
          console.log(
            `[LabelField] Using specified targetLabelField "${targetLabelField}" for collection "${collectionName}"`
          );
          return targetLabelField;
        } else {
          console.warn(
            `[LabelField] Specified targetLabelField "${targetLabelField}" not found in collection "${collectionName}", falling back to auto-detection`
          );
        }
      }

      // Priority order for label fields
      const labelPriority = [
        "name",
        "title",
        "label",
        "email",
        "slug",
        "username",
      ];

      // First try priority fields. A `password` field named like a priority
      // label (e.g. "email") must never be chosen — its hash would be copied
      // into `label` and survive the row-level password redaction.
      for (const labelField of labelPriority) {
        if (
          fields.some(
            f =>
              f.name === labelField &&
              f.type !== "relationship" &&
              f.type !== "password"
          )
        ) {
          console.log(
            `[LabelField] Using priority field "${labelField}" for collection "${collectionName}"`
          );
          return labelField;
        }
      }

      // Fallback: find first text-like field (not ID, not relationship,
      // never a password).
      const textField = fields.find(
        f =>
          f.name !== "id" &&
          f.type !== "relationship" &&
          f.type !== "password" &&
          (f.type === "text" || f.type === "email")
      );

      if (textField) {
        console.log(
          `[LabelField] Using first text field "${textField.name}" for collection "${collectionName}"`
        );
        return textField.name;
      }

      // Last resort: use id
      console.warn(
        `[LabelField] No suitable label field found for "${collectionName}", falling back to ID`
      );
      return "id";
    } catch (error) {
      console.error(
        `[LabelField] Error getting label field for "${collectionName}":`,
        error
      );
      return "id";
    }
  }

  /**
   * Batch expand relationships for multiple entries (optimized for N+1 prevention).
   * Groups queries by relationship type to minimize database round trips.
   *
   * Supports depth parameter:
   * - depth=0: No expansion, return entries as-is
   * - depth=1+: Expand relationships (note: batch expansion only does 1 level for performance)
   *
   * For deeper nested expansion, use expandRelationships() on individual entries.
   *
   * @param entries - Array of entries to expand
   * @param collectionName - Name of the collection
   * @param fields - Field definitions for the collection
   * @param options - Expansion options including depth control
   * @returns Entries with expanded relationship data
   */
  async batchExpandRelationships(
    entries: Record<string, unknown>[],
    collectionName: string,
    fields: FieldDefinition[],
    options: RelationshipExpansionOptions = {}
  ): Promise<Record<string, unknown>[]> {
    const { depth = DEFAULT_RELATIONSHIP_DEPTH } = options;
    // The caller travels with every fetch below so each related row is judged
    // by its own collection's field rules.
    const access: RelatedRowAccess = {
      enforceFieldAccess: options.enforceFieldAccess,
      enforceCollectionAccess: options.enforceCollectionAccess,
      fieldAccessStage: options.fieldAccessStage,
      user: options.user,
      // Carried BESIDE `user`, never folded into it. A preview judges a related
      // row's fields as the sharer while every hook goes on seeing the
      // anonymous bearer; dropping it here silently restores the anonymous
      // reading for the whole expansion, which is the direction that leaks.
      fieldAccessUser: options.fieldAccessUser,
      overrideAccess: options.overrideAccess,
      trusted: assumedBound(options.trusted),
      authenticatedScope: options.authenticatedScope,
      locale: options.locale,
      status: options.status,
      withheldByAccess: options.withheldByAccess,
      // One per expansion, so a relationship holding many references reads its
      // target's rules once rather than once per value. A nested hop inherits
      // the map rather than starting its own: several children populating the
      // same collection would otherwise each resolve its policy again, which
      // is the repetition this cache exists to remove. Created fresh only for
      // the outermost call, because a collection's rules can change between
      // requests.
      targetPolicies: options.targetPolicies ?? new Map(),
      // Shared and inherited exactly as the policy map is, for the same reason:
      // a nested hop starting its own would re-read the metadata of a collection
      // an ancestor already looked up.
      targetCompanions: options.targetCompanions ?? new Map(),
    };

    // Clamp depth to valid range
    const effectiveDepth = Math.min(Math.max(depth, 0), MAX_RELATIONSHIP_DEPTH);

    // If depth is 0, don't expand relationships but still normalize
    // repeater/group fields to strip any embedded relationship objects to IDs.
    // This is needed because the save flow may store full relationship objects
    // inside repeater/group JSON data.
    if (effectiveDepth === 0) {
      return entries.map(entry => {
        const normalized = { ...entry };
        for (const field of fields) {
          if (
            (field.type === "repeater" || field.type === "group") &&
            normalized[field.name] != null
          ) {
            const nestedFields = getNestedFields(field);
            if (nestedFields.length === 0) continue;
            const hasNestedRelations = nestedFields.some(
              f =>
                isRelationshipField(f) ||
                f.type === "repeater" ||
                f.type === "group"
            );
            if (!hasNestedRelations) continue;

            const rawData = normalized[field.name];
            const parsed = parseJsonIfString(rawData);

            if (field.type === "repeater" && Array.isArray(parsed)) {
              normalized[field.name] = parsed.map(
                (row: Record<string, unknown>) =>
                  row && typeof row === "object"
                    ? stripRelationshipsToIds(row, nestedFields)
                    : row
              );
            } else if (
              field.type === "group" &&
              parsed &&
              typeof parsed === "object" &&
              !Array.isArray(parsed)
            ) {
              normalized[field.name] = stripRelationshipsToIds(
                parsed as Record<string, unknown>,
                nestedFields
              );
            }
          } else if (isRelationshipField(field)) {
            // Strip top-level relationship fields to IDs too
            const hasMany =
              field.hasMany || field.options?.relationType === "manyToMany";
            const value = normalized[field.name];
            if (value != null) {
              if (hasMany && Array.isArray(value)) {
                normalized[field.name] = value.map((v: unknown) =>
                  extractRelationshipId(v)
                );
              } else {
                normalized[field.name] = extractRelationshipId(value);
              }
            }
          }
        }
        return normalized;
      });
    }

    if (entries.length === 0) return [];

    // Filter for relationship fields.
    const relationFields = fields.filter(f => isRelationshipField(f));

    // Check if there are any fields that could contain media (upload, array, or group)
    // Array and group fields might contain nested upload fields
    const hasMediaFields = fields.some(
      f =>
        isUploadField(f) ||
        isRepeaterOrGroupField(f) ||
        isGroupField(f) ||
        isRelationshipField(f)
    );

    // If no relationship fields AND no fields that could contain media, return entries as-is
    if (!hasMediaFields) {
      return entries;
    }

    // Build lookup maps for each relation field
    const relationDataMaps: Record<
      string,
      Map<string, Record<string, unknown> | Record<string, unknown>[]>
    > = {};

    for (const field of relationFields) {
      const relationType = field.options?.relationType || "manyToOne";
      const targetCollection = getTargetCollection(field);
      const hasMany = isHasManyRelationship(field);
      const fieldTargets = declaredTargets(field);

      if (!targetCollection) continue;

      // Check field-level maxDepth - if 0, skip this field entirely
      const fieldMaxDepth =
        field.options?.maxDepth ?? field.maxDepth ?? MAX_RELATIONSHIP_DEPTH;
      if (fieldMaxDepth === 0) continue;

      if (relationType === "manyToMany") {
        // Batch fetch all manyToMany relations for all entries
        const entryIds = entries.map(e => e.id) as string[];
        const dataMap = await this.batchFetchManyToManyRelations(
          collectionName,
          entryIds,
          field,
          access
        );
        relationDataMaps[field.name] = dataMap;
      } else if (hasMany) {
        // Handle hasMany relationships (arrays of IDs stored directly)
        // Collect all references from all entries, handling PostgreSQL array
        // format. Each carries its own collection when the field declares
        // several targets.
        const allRefs = entries.flatMap(entry =>
          normalizeToRelationshipRefs(
            entry[field.name],
            targetCollection,
            fieldTargets
          )
        );
        relationDataMaps[field.name] = await this.batchFetchRefs(
          allRefs,
          field,
          access
        );
      } else {
        // Batch fetch all referenced IDs for oneToOne/manyToOne/oneToMany
        const relatedRefs = entries
          .map(e =>
            readRelationshipRef(e[field.name], targetCollection, fieldTargets)
          )
          .filter((ref): ref is RelationshipRef => ref !== null);

        relationDataMaps[field.name] = await this.batchFetchRefs(
          relatedRefs,
          field,
          access
        );
      }
    }

    // ============================================================
    // UPLOAD FIELDS: Batch expand media references (including nested)
    // ============================================================

    // Collect all media IDs from all entries, including nested fields in arrays/groups
    const uploadDataMap: Map<string, Record<string, unknown>> = new Map();
    const allMediaIds: string[] = [];

    for (const entry of entries) {
      // Use recursive function to collect all media IDs at any nesting depth
      const entryMediaIds = collectAllMediaIds(entry, fields);
      allMediaIds.push(...entryMediaIds);
    }

    // Batch fetch all media records at once
    if (allMediaIds.length > 0) {
      const uniqueMediaIds = [...new Set(allMediaIds)];
      const mediaRecords = await applyMediaTrustBound(
        await this.fetchMediaByIds(uniqueMediaIds),
        access
      );

      // Build lookup map for O(1) access
      for (const media of mediaRecords) {
        uploadDataMap.set(String(media.id), media);
      }
    }

    // Apply the fetched data to each entry
    return Promise.all(
      entries.map(async entry => {
        const expandedEntry = { ...entry };

        for (const field of relationFields) {
          const relationType = field.options?.relationType || "manyToOne";
          const hasMany = isHasManyRelationship(field);
          const dataMap = relationDataMaps[field.name];

          if (!dataMap) continue;

          if (relationType === "manyToMany") {
            expandedEntry[field.name] = dataMap.get(entry.id as string) || [];
            continue;
          }

          // Resolved the same way the fetch above resolved it, so a value that
          // names its own collection is looked up under that collection.
          const fieldTarget = getTargetCollection(field);
          if (!fieldTarget) continue;

          if (hasMany) {
            // Handle hasMany relationships - expand array of IDs
            const refs = normalizeToRelationshipRefs(
              entry[field.name],
              fieldTarget,
              declaredTargets(field)
            );
            expandedEntry[field.name] = refs
              .map(ref => {
                const row = dataMap.get(relationKey(ref.collection, ref.id));
                return row && !Array.isArray(row)
                  ? withReferenceIdentity(row, ref)
                  : row;
              })
              .filter(Boolean);
          } else {
            const ref = readRelationshipRef(
              entry[field.name],
              fieldTarget,
              declaredTargets(field)
            );
            const row = ref && dataMap.get(relationKey(ref.collection, ref.id));
            if (row) {
              expandedEntry[field.name] =
                ref && !Array.isArray(row)
                  ? withReferenceIdentity(row, ref)
                  : row;
            }
          }
        }

        // Expand relationship fields nested inside repeater/group fields
        for (const field of fields) {
          const fieldName = field.name;
          if (
            !fieldName ||
            expandedEntry[fieldName] === undefined ||
            expandedEntry[fieldName] === null
          )
            continue;

          if (isRelationshipField(field)) continue;

          const nestedFields = getNestedFields(field);
          if (nestedFields.length === 0) continue;

          const hasNestedRelations = nestedFields.some(
            f =>
              isRelationshipField(f) ||
              isUploadField(f) ||
              f.type === "repeater" ||
              f.type === "group"
          );
          if (!hasNestedRelations) continue;

          if (field.type === "repeater") {
            const rawData = expandedEntry[fieldName];
            const arrayData = parseJsonIfString(rawData);
            if (Array.isArray(arrayData)) {
              expandedEntry[fieldName] = await Promise.all(
                arrayData.map(async (row: Record<string, unknown>) => {
                  if (row && typeof row === "object") {
                    return this.expandRelationships(
                      row,
                      collectionName,
                      nestedFields,
                      { depth: effectiveDepth, currentDepth: 0, ...access }
                    );
                  }
                  return row;
                })
              );
            }
          } else if (field.type === "group") {
            const rawData = expandedEntry[fieldName];
            const groupData = parseJsonIfString(rawData);
            if (
              groupData &&
              typeof groupData === "object" &&
              !Array.isArray(groupData)
            ) {
              expandedEntry[fieldName] = await this.expandRelationships(
                groupData as Record<string, unknown>,
                collectionName,
                nestedFields,
                { depth: effectiveDepth, currentDepth: 0, ...access }
              );
            }
          }
        }

        // Expand upload fields (media references) - including nested fields in arrays/groups
        // Use recursive function to expand media at any nesting depth
        const fullyExpandedEntry = expandMediaInData(
          expandedEntry,
          fields,
          uploadDataMap
        );

        return fullyExpandedEntry;
      })
    );
  }

  /**
   * Batch fetch references that may span several collections, one query per
   * collection. A field declaring several targets holds values from more than
   * one of them, so a single fetch against the field's first target would miss
   * every value pointing anywhere else.
   *
   * Keys the result by collection and id together, since the caller resolves a
   * row from the reference it started with and an id alone does not identify
   * one across collections.
   *
   * @param refs - References to load, duplicates allowed
   * @param field - Field definition, for label resolution
   * @returns Map of {@link relationKey} to expanded entry data
   */
  private async batchFetchRefs(
    refs: RelationshipRef[],
    field: FieldDefinition,
    access: RelatedRowAccess
  ): Promise<Map<string, Record<string, unknown>>> {
    const idsByCollection = new Map<string, Set<string>>();
    for (const { collection, id } of refs) {
      const ids = idsByCollection.get(collection);
      if (ids) {
        ids.add(id);
      } else {
        idsByCollection.set(collection, new Set([id]));
      }
    }

    const merged = new Map<string, Record<string, unknown>>();
    for (const [collection, ids] of idsByCollection) {
      const dataMap = await this.batchFetchRelatedEntries(
        collection,
        [...ids],
        field,
        access
      );
      for (const [id, row] of dataMap) {
        merged.set(relationKey(collection, id), row);
      }
    }
    return merged;
  }

  /**
   * Batch fetch related entries for oneToOne/manyToOne/oneToMany relations.
   * Returns a Map of ID -> { id, label }.
   * Uses Drizzle's inArray for clean, type-safe queries.
   *
   * @param targetCollection - Name of the target collection or system entity
   * @param relatedIds - Array of IDs to fetch
   * @param field - Field definition
   * @returns Map of ID to expanded entry data
   */
  async batchFetchRelatedEntries(
    targetCollection: string,
    relatedIds: string[],
    field: FieldDefinition,
    access: RelatedRowAccess = { trusted: TRUSTS_EVERY_COLLECTION }
  ): Promise<Map<string, Record<string, unknown>>> {
    const resultMap = new Map<string, Record<string, unknown>>();

    if (relatedIds.length === 0) return resultMap;

    try {
      // Check if this is a system entity (like "users")
      if (isSystemEntity(targetCollection)) {
        const targetSchema = getSystemEntityTable(targetCollection);
        if (!targetSchema) {
          console.warn(`Unknown system entity: ${targetCollection}`);
          return resultMap;
        }

        // Guard against a secret column being used as the label — the hash
        // would be copied into `label` before row redaction (see
        // resolveSystemEntityLabelField).
        const labelField = resolveSystemEntityLabelField(
          targetCollection,
          field.options?.targetLabelField
        );

        const readable = await this.readTargetRows(
          targetCollection,
          relatedIds,
          access
        );
        for (const row of readable) {
          resultMap.set(row.id as string, {
            ...row,
            label: row[labelField] || row.id,
          });
        }
      } else {
        // Handle dynamic collections
        const labelField = await this.getBestLabelField(
          targetCollection,
          field.options?.targetLabelField
        );

        const readable = await this.readTargetRows(
          targetCollection,
          relatedIds,
          access
        );
        for (const row of readable) {
          resultMap.set(row.id as string, {
            ...row,
            // Falls back to the id when the label's source field did not
            // survive redaction, so a related row stays identifiable.
            label: row[labelField] || row.id,
          });
        }
      }
    } catch (error) {
      console.error(
        `Failed to batch fetch entries for ${targetCollection}:`,
        error
      );
    }

    return resultMap;
  }

  /**
   * Batch fetch manyToMany relations for multiple source entries.
   * Returns a Map of sourceEntryId -> Array<{ id, label }>.
   *
   * @param sourceCollectionName - Name of the source collection
   * @param sourceEntryIds - Array of source entry IDs
   * @param field - Field definition
   * @returns Map of source ID to array of related entries
   */
  async batchFetchManyToManyRelations(
    sourceCollectionName: string,
    sourceEntryIds: string[],
    field: FieldDefinition,
    access: RelatedRowAccess = { trusted: TRUSTS_EVERY_COLLECTION }
  ): Promise<Map<string, Record<string, unknown>[]>> {
    const resultMap = new Map<string, Record<string, unknown>[]>();

    if (sourceEntryIds.length === 0) return resultMap;

    // Use the dual-aware helper instead of `field.options!.target!`. Code-first
    // collections (defined via `relationship({ relationTo, hasMany })`) put
    // the target on `field.relationTo`; UI-built collections put it under
    // `field.options.target`. Hard-asserting only the UI shape means
    // code-first inserts crash with "Cannot read properties of undefined".
    const targetCollectionName = getTargetCollection(field);
    if (!targetCollectionName) {
      console.error(
        `[CollectionRelationshipService] Cannot determine target collection for field "${field.name}" - check that either field.relationTo or field.options.target is set.`
      );
      return resultMap;
    }
    const junctionTableName = this.getJunctionTableName(
      sourceCollectionName,
      targetCollectionName,
      field
    );

    try {
      const sourceIdCol = sql.identifier(sourceCollectionName + "_id");
      const targetIdCol = sql.identifier(targetCollectionName + "_id");

      // Batch query junction table for all source entries
      // Build MySQL-compatible IN clause with proper parameterization
      const sourcePlaceholders = sql.join(
        sourceEntryIds.map(id => sql`${id}`),
        sql.raw(", ")
      );

      const junctionQuery = sql`
        SELECT ${sourceIdCol} as source_id, ${targetIdCol} as target_id
        FROM ${sql.identifier(junctionTableName)}
        WHERE ${sourceIdCol} IN (${sourcePlaceholders})
      `;

      const junctionResults = (await this.selectRawSql(junctionQuery)) as {
        rows: Array<{ source_id: string; target_id: string }>;
      };

      // Group by source_id
      const groupedRelations: Record<string, string[]> = {};
      for (const row of junctionResults.rows) {
        if (!groupedRelations[row.source_id]) {
          groupedRelations[row.source_id] = [];
        }
        groupedRelations[row.source_id].push(row.target_id);
      }

      // Get all unique target IDs
      const allTargetIds = [...new Set(Object.values(groupedRelations).flat())];

      if (allTargetIds.length === 0) {
        // Initialize empty arrays for all source entries
        for (const sourceId of sourceEntryIds) {
          resultMap.set(sourceId, []);
        }
        return resultMap;
      }

      const labelField = await this.getBestLabelField(
        targetCollectionName,
        field.options?.targetLabelField
      );
      const readableTargetRows = await this.readTargetRows(
        targetCollectionName,
        allTargetIds,
        access
      );

      // Build target entry map
      const targetEntryMap = new Map(
        readableTargetRows.map((row: Record<string, unknown>) => {
          // Falls back to the id when the label's source field did not survive
          // redaction.
          const label = row[labelField] || row.id;
          return [row.id, { ...row, label }];
        })
      );

      // Map results back to source entries
      for (const sourceId of sourceEntryIds) {
        const targetIds = groupedRelations[sourceId] || [];
        resultMap.set(
          sourceId,
          targetIds.map(id => targetEntryMap.get(id)).filter(Boolean) as Record<
            string,
            unknown
          >[]
        );
      }
    } catch (error) {
      console.error("Failed to batch fetch manyToMany relations:", error);
      // Initialize empty arrays for all source entries on error
      for (const sourceId of sourceEntryIds) {
        resultMap.set(sourceId, []);
      }
    }

    return resultMap;
  }

  /**
   * Expand relationship data for a single entry with depth control.
   *
   * Supports depth parameter:
   * - depth=0: No expansion, return IDs only
   * - depth=1: Expand immediate relationships
   * - depth=2+: Expand nested relationships recursively
   *
   * Also respects field-level `maxDepth` configuration to prevent
   * over-fetching on specific relationship fields.
   *
   * @param entry - Entry to expand
   * @param collectionName - Name of the collection
   * @param fields - Field definitions
   * @param options - Expansion options including depth control
   * @returns Entry with expanded relationship data
   */
  async expandRelationships(
    entry: Record<string, unknown>,
    collectionName: string,
    fields: FieldDefinition[],
    options: RelationshipExpansionOptions = {}
  ): Promise<Record<string, unknown>> {
    const { depth = DEFAULT_RELATIONSHIP_DEPTH, currentDepth = 0 } = options;
    // Travels with every nested expansion and row fetch, so a related row at
    // any depth is judged by its own collection's field rules.
    const access: RelatedRowAccess = {
      enforceFieldAccess: options.enforceFieldAccess,
      enforceCollectionAccess: options.enforceCollectionAccess,
      fieldAccessStage: options.fieldAccessStage,
      user: options.user,
      // Carried BESIDE `user`, never folded into it. A preview judges a related
      // row's fields as the sharer while every hook goes on seeing the
      // anonymous bearer; dropping it here silently restores the anonymous
      // reading for the whole expansion, which is the direction that leaks.
      fieldAccessUser: options.fieldAccessUser,
      overrideAccess: options.overrideAccess,
      trusted: assumedBound(options.trusted),
      authenticatedScope: options.authenticatedScope,
      locale: options.locale,
      status: options.status,
      withheldByAccess: options.withheldByAccess,
      // One per expansion, so a relationship holding many references reads its
      // target's rules once rather than once per value. A nested hop inherits
      // the map rather than starting its own: several children populating the
      // same collection would otherwise each resolve its policy again, which
      // is the repetition this cache exists to remove. Created fresh only for
      // the outermost call, because a collection's rules can change between
      // requests.
      targetPolicies: options.targetPolicies ?? new Map(),
      // Shared and inherited exactly as the policy map is, for the same reason:
      // a nested hop starting its own would re-read the metadata of a collection
      // an ancestor already looked up.
      targetCompanions: options.targetCompanions ?? new Map(),
    };

    // Clamp depth to valid range
    const effectiveDepth = Math.min(Math.max(depth, 0), MAX_RELATIONSHIP_DEPTH);

    // If we've reached the requested depth, don't expand further
    // but still normalize repeater/group fields to strip embedded relationship objects
    if (currentDepth >= effectiveDepth) {
      return stripRelationshipsToIds(entry, fields);
    }

    const expandedEntry = { ...entry };

    // Filter for relationship fields.
    const relationFields = fields.filter(f => isRelationshipField(f));

    for (const field of relationFields) {
      const relationType = field.options?.relationType || "manyToOne";
      const targetCollection = getTargetCollection(field);
      const hasMany = isHasManyRelationship(field);

      if (!targetCollection) {
        continue;
      }
      // A many-to-many field has no parent-row value (its links live in the
      // junction table, keyed by entry.id), so the `entry[field.name]` guard
      // would wrongly skip it on single-entry reads. Only non-m2m fields read
      // their FK id(s) off the row, so gate on the row value for those.
      if (relationType !== "manyToMany" && !entry[field.name]) {
        continue;
      }

      // Check field-level maxDepth (from relationship field config)
      // Field maxDepth limits how deep this specific field can be populated
      const fieldMaxDepth =
        field.options?.maxDepth ?? field.maxDepth ?? MAX_RELATIONSHIP_DEPTH;
      if (currentDepth >= fieldMaxDepth) {
        // Don't expand this field, keep the ID(s)
        continue;
      }

      // Get targetLabelField from either options or root level
      const targetLabelField =
        field.options?.targetLabelField ||
        ((field as Record<string, unknown>).targetLabelField as
          | string
          | undefined);

      try {
        if (relationType === "manyToMany") {
          // Fetch related entries through junction table
          const relatedEntries = await this.fetchManyToManyRelations(
            collectionName,
            entry.id as string,
            field,
            undefined,
            access
          );

          const labelField = await this.getBestLabelField(
            targetCollection,
            targetLabelField
          );

          // Expand nested relationships if depth allows
          const expandedRelated = await Promise.all(
            relatedEntries.map(async (rel: Record<string, unknown>) => {
              const baseExpanded = {
                id: rel.id,
                label: rel[labelField] || rel.id,
                ...rel, // Include all fields from related entry
              };

              // Recursively expand nested relationships if we have depth remaining
              if (currentDepth + 1 < effectiveDepth) {
                const targetFields =
                  await this.getCollectionFields(targetCollection);
                if (targetFields.length > 0) {
                  return this.expandRelationships(
                    baseExpanded,
                    targetCollection,
                    targetFields,
                    {
                      depth: effectiveDepth,
                      currentDepth: currentDepth + 1,
                      ...access,
                    }
                  );
                }
              }
              return baseExpanded;
            })
          );

          expandedEntry[field.name] = expandedRelated;
        } else if (hasMany) {
          // Handle hasMany relationships - array of IDs stored directly.
          // Each entry carries its own collection when the field declares
          // several targets, so they are resolved per value rather than once
          // for the whole field.
          const refs = normalizeToRelationshipRefs(
            entry[field.name],
            targetCollection,
            declaredTargets(field)
          );

          if (refs.length > 0) {
            // Two values in the same field can come from different
            // collections, and each names its own label field — so the lookup
            // is per collection, resolved once each rather than once per row.
            const labelFields = new Map<string, Promise<string>>();
            const labelFieldFor = (collection: string): Promise<string> => {
              const cached = labelFields.get(collection);
              if (cached) return cached;
              const pending = this.getBestLabelField(
                collection,
                targetLabelField
              );
              labelFields.set(collection, pending);
              return pending;
            };

            // Fetch all related entries
            const expandedRelated = await Promise.all(
              refs.map(async ref => {
                const { collection: relatedCollection, id } = ref;
                const relatedEntry = await this.fetchRelatedEntry(
                  relatedCollection,
                  id,
                  access
                );

                if (!relatedEntry) return null;

                const labelField = await labelFieldFor(relatedCollection);

                let baseExpanded: Record<string, unknown> = {
                  id: relatedEntry.id,
                  label: relatedEntry[labelField] || relatedEntry.id,
                  ...relatedEntry,
                };

                // Recursively expand nested relationships if we have depth remaining
                if (currentDepth + 1 < effectiveDepth) {
                  const targetFields =
                    await this.getCollectionFields(relatedCollection);
                  if (targetFields.length > 0) {
                    baseExpanded = await this.expandRelationships(
                      baseExpanded,
                      relatedCollection,
                      targetFields,
                      {
                        depth: effectiveDepth,
                        currentDepth: currentDepth + 1,
                        ...access,
                      }
                    );
                  }
                }

                return withReferenceIdentity(baseExpanded, ref);
              })
            );

            expandedEntry[field.name] = expandedRelated.filter(Boolean);
          } else {
            expandedEntry[field.name] = [];
          }
        } else {
          // oneToOne, manyToOne, oneToMany - already have the ID
          const storedValue = entry[field.name];
          // A multi-target field stores the collection next to the id. Passing
          // the whole pair to the row loader binds an object where the driver
          // expects a string, so the query throws and the value never expands.
          const polymorphicRef = readPolymorphicRef(
            storedValue,
            declaredTargets(field)
          );
          // A pair naming a collection the field never declared is left as it
          // is stored: reading it as an id would send the object to the loader,
          // and honouring the collection would read a row out of a table this
          // field was never allowed to reach.
          if (!polymorphicRef && isPolymorphicRefShape(storedValue)) continue;
          const relatedCollection =
            polymorphicRef?.collection ?? targetCollection;
          const relatedId = polymorphicRef
            ? polymorphicRef.id
            : (storedValue as string);

          if (relatedId) {
            const relatedEntry = await this.fetchRelatedEntry(
              relatedCollection,
              relatedId,
              access
            );

            if (relatedEntry) {
              const labelField = await this.getBestLabelField(
                relatedCollection,
                targetLabelField
              );

              let expandedRelated: Record<string, unknown> = {
                id: relatedEntry.id,
                label: relatedEntry[labelField] || relatedEntry.id,
                ...relatedEntry, // Include all fields from related entry
              };

              // Recursively expand nested relationships if we have depth remaining
              if (currentDepth + 1 < effectiveDepth) {
                // The row came from the collection the value named, so its own
                // fields are the ones to walk for the next hop.
                const targetFields =
                  await this.getCollectionFields(relatedCollection);
                if (targetFields.length > 0) {
                  expandedRelated = await this.expandRelationships(
                    expandedRelated,
                    relatedCollection,
                    targetFields,
                    {
                      depth: effectiveDepth,
                      currentDepth: currentDepth + 1,
                      ...access,
                    }
                  );
                }
              }

              expandedEntry[field.name] = polymorphicRef
                ? withReferenceIdentity(expandedRelated, polymorphicRef)
                : expandedRelated;
            }
          }
        }
      } catch (error) {
        // If expansion fails, keep the original value
        console.error(`Failed to expand relation ${field.name}:`, error);
      }
    }

    // Expand relationship fields nested inside repeater/group fields
    for (const field of fields) {
      const fieldName = field.name;
      if (
        !fieldName ||
        expandedEntry[fieldName] === undefined ||
        expandedEntry[fieldName] === null
      )
        continue;

      // Skip fields already processed as top-level relationships
      if (isRelationshipField(field)) continue;

      const nestedFields = getNestedFields(field);
      if (nestedFields.length === 0) continue;

      // Only recurse if nested fields contain relationships or further nesting
      const hasNestedRelations = nestedFields.some(
        f =>
          isRelationshipField(f) ||
          isUploadField(f) ||
          f.type === "repeater" ||
          f.type === "group"
      );
      if (!hasNestedRelations) continue;

      if (field.type === "repeater") {
        const rawData = expandedEntry[fieldName];
        const arrayData = parseJsonIfString(rawData);
        if (Array.isArray(arrayData)) {
          expandedEntry[fieldName] = await Promise.all(
            arrayData.map(async (row: Record<string, unknown>) => {
              if (row && typeof row === "object") {
                return this.expandRelationships(
                  row,
                  collectionName,
                  nestedFields,
                  { depth: effectiveDepth, currentDepth, ...access }
                );
              }
              return row;
            })
          );
        }
      } else if (field.type === "group") {
        const rawData = expandedEntry[fieldName];
        const groupData = parseJsonIfString(rawData);
        if (
          groupData &&
          typeof groupData === "object" &&
          !Array.isArray(groupData)
        ) {
          expandedEntry[fieldName] = await this.expandRelationships(
            groupData as Record<string, unknown>,
            collectionName,
            nestedFields,
            { depth: effectiveDepth, currentDepth, ...access }
          );
        }
      }
    }

    // Expand upload fields (media references) - including nested fields in arrays/groups
    // Collect all media IDs recursively from the entry
    const allMediaIds = collectAllMediaIds(expandedEntry, fields);

    if (allMediaIds.length > 0) {
      // Not wrapped in a catch that returns the entry unexpanded: doing so put
      // the raw ids on the wire, which reads to a caller exactly like media
      // that is absent, and is what kept a broken media fetch invisible until
      // images appeared to vanish. The batch path above does not swallow here
      // either, so both expansions in this service fail the same way.
      const uniqueMediaIds = [...new Set(allMediaIds)];
      const mediaRecords = await applyMediaTrustBound(
        await this.fetchMediaByIds(uniqueMediaIds),
        access
      );

      // Build lookup map for O(1) access
      const mediaMap = new Map<string, Record<string, unknown>>();
      for (const media of mediaRecords) {
        mediaMap.set(String(media.id), media);
      }

      // Use recursive function to expand media at any nesting depth
      return expandMediaInData(expandedEntry, fields, mediaMap);
    }

    return expandedEntry;
  }

  /**
   * Fetch media records by IDs.
   * Uses the media table to retrieve full media objects.
   *
   * @param ids - Array of media IDs
   * @returns Array of media records
   */
  private async fetchMediaByIds(
    ids: string[]
  ): Promise<Record<string, unknown>[]> {
    if (ids.length === 0) return [];

    try {
      // Resolve the dialect-specific media schema from the adapter's tables.
      // Using Drizzle's typed query builder (rather than raw sql.execute) keeps
      // this dialect-agnostic — better-sqlite3 doesn't expose `.execute()` on
      // Drizzle, and hand-rolled SQL routing per dialect is fragile. The same
      // pattern is used by batchFetchRelatedEntries for the "users" entity.
      const dialect = this.adapter.getCapabilities().dialect;
      const tables = getDialectTables(dialect);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dialect table schemas are dialect-specific Drizzle types
      const mediaTable = (tables as Record<string, any>).media;

      if (!mediaTable) {
        throw NextlyError.internal({
          logContext: {
            op: "fetchMediaByIds",
            detail: "media table schema not registered for dialect",
            dialect,
          },
        });
      }

      const rows = (await this.db
        .select()
        .from(mediaTable)
        .where(inArray(mediaTable.id, ids))) as Record<string, unknown>[];

      // Recursively convert snake_case fields to camelCase for API response
      // Database may return snake_case columns (thumbnail_url, mime_type, etc.)
      // This handles nested objects and arrays within media records
      return rows.map(row => {
        const camel = keysToCamelCase(row) as Record<string, unknown>;
        // Local storage adapter stores relative URLs (`/uploads/...`); cloud
        // adapters store absolute URLs. absolutizeMediaUrls leaves absolute
        // URLs untouched and prefixes relative ones with NEXT_PUBLIC_APP_URL
        // so populated media in entry responses is reachable by external
        // clients.
        return absolutizeMediaUrls(camel);
      });
    } catch (error) {
      // Raised, not swallowed — same contract as the Singles read path. An
      // empty list here degrades a failed fetch into upload fields that read
      // back as null, which the caller cannot tell apart from an entry that
      // references no media, so a broken fetch looks like vanished images.
      throw NextlyError.internal({
        cause: error instanceof Error ? error : undefined,
        logContext: {
          op: "fetchMediaByIds",
          dialect: this.adapter.getCapabilities().dialect,
          mediaIds: ids.length,
        },
      });
    }
  }

  /**
   * Get field definitions for a collection.
   * Helper method for recursive relationship expansion.
   *
   * @param collectionName - Name of the collection
   * @returns Field definitions or empty array if not found
   */
  private async getCollectionFields(
    collectionName: string
  ): Promise<FieldDefinition[]> {
    try {
      // System entities don't have field definitions
      if (isSystemEntity(collectionName)) {
        return [];
      }

      const collection =
        await this.collectionService.getCollection(collectionName);
      // Both shapes, the same way `getRedactionFields` reads them: a
      // Builder-created collection carries `schemaDefinition`, while
      // `getCollection` returns the raw row for a code-first one and its fields
      // sit at the top level. Reading only the first resolved a code-first
      // target to nothing, and the caller's `targetFields.length > 0` guard
      // then skipped the nested hop entirely — silently, at any depth.
      const fields =
        (
          (collection as Record<string, unknown>).schemaDefinition as
            | Record<string, unknown>
            | undefined
        )?.fields ?? (collection as Record<string, unknown>).fields;
      return Array.isArray(fields) ? (fields as FieldDefinition[]) : [];
    } catch {
      return [];
    }
  }

  /**
   * Strip values the caller may not see from related rows before they are
   * merged into a response. Relationship expansion spreads the entire related
   * row into the parent entry, so without this a related collection's password
   * fields (or the users entity's password hash) would be returned to any
   * caller that populates the relationship. Called once per fetch with the row
   * set, so the target schema is loaded at most once per relation, not per row.
   *
   * Two independent passes, because they answer different questions:
   * secrets are stripped for everyone, while field-level `access.read` is
   * evaluated against the caller. The parent entry's own redaction cannot cover
   * either one: it runs against the SOURCE collection's field registry, which
   * never describes a related collection's fields.
   */
  private async redactRelatedRows(
    targetCollection: string,
    rows: Record<string, unknown>[],
    access: RelatedRowAccess = { trusted: TRUSTS_EVERY_COLLECTION }
  ): Promise<void> {
    if (rows.length === 0) return;
    // The system owner column must never ride along a populated relationship:
    // a collection readable by non-creators would otherwise leak a related
    // row's creator user id through the nested payload. Strip it from every
    // related row up front (it's a reserved system column, so this can't touch
    // a user field) — this runs at each expansion level, so nested relations
    // are covered too.
    for (const row of rows) {
      stripSystemOwnerField(row);
    }
    // System entities expose secret columns that are not schema fields, so
    // strip them by name. They carry no user-defined field rules, so there is
    // nothing for the access pass below to evaluate.
    if (isSystemEntity(targetCollection)) {
      for (const row of rows) {
        for (const col of SYSTEM_ENTITY_SECRET_COLUMNS) delete row[col];
      }
      return;
    }
    // Dynamic collections: drop password-type field values using the TARGET
    // collection's schema — the source collection's fields never describe a
    // related row. If the schema can't be resolved we cannot tell which
    // fields are secret, so fail closed: strip every non-identity field
    // rather than risk returning a row that carries a password hash.
    const targetFields = await this.getRedactionFields(targetCollection);
    if (targetFields === null) {
      for (const row of rows) {
        for (const key of Object.keys(row)) {
          if (key !== "id" && key !== "label") delete row[key];
        }
        // Defense in depth: the label is normally a display field (never a
        // password — a password can't be configured as a label), but a row
        // migrated from before that guard could carry a bcrypt hash here, so
        // drop a hash-shaped label rather than surface it.
        if (typeof row.label === "string" && row.label.startsWith("$2")) {
          delete row.label;
        }
      }
      // Nothing but id/label survives, so there is no field left to judge.
      return;
    }
    // Secrets first, and for every caller: a trusted read has no more use for a
    // password hash than an anonymous one.
    if (hasPasswordField(targetFields)) {
      for (const row of rows) {
        stripPasswordFieldValues(row, targetFields);
      }
    }
    // Secrets above are unconditional and stay here. The target's FIELD rules
    // are the caller's to place: a read that finishes with the post-assembly
    // pass defers them there so the row's own masking hooks are judged on a
    // whole row, which is the order a direct read uses. Every other caller
    // applies them now, because nothing later will.
    if (access.fieldAccessStage !== "assembled") {
      await this.applyRelatedRowReadAccess(targetCollection, rows, access);
    }
  }

  /**
   * Apply each nested related row's OWN collection field `afterRead` hooks,
   * once the document is fully assembled.
   *
   * A field hook is the transforming half of a field's read protections -- the
   * half that masks a value on the way out. Running it at fetch time would be
   * wrong: related rows are read BEFORE the recursion that expands their own
   * relationships, so a hook masking on `data.organization.classification`
   * would see a raw id. A direct read expands first and runs field hooks last,
   * and expansion may be stricter than the target's own endpoint but never
   * looser.
   *
   * So this runs once, from the read path, over the finished document.
   *
   * `state` is shared across every entry in one read. Batch expansion hands the
   * SAME row object to every parent that references it, so a per-entry
   * traversal would run that row's hooks once per reference and compound any
   * transform that is not idempotent. It also carries the schema cache: without
   * it a hundred-row listing re-reads the same two collections' fields on every
   * row, one metadata query at a time.
   */
  /** A state a caller can share across every entry in one read. */
  createNestedHookState(): NestedHookState {
    return createNestedHookState();
  }

  async applyNestedFieldHooks(
    entry: Record<string, unknown>,
    collectionName: string,
    access: RelatedRowAccess,
    state?: NestedHookState
  ): Promise<void> {
    // Only a real read applies these. A caller clearing the flag is assembling
    // the evidence a document-dependent rule is judged on and wants the row
    // unredacted -- the same reason the access pass is gated on it.
    if (!access.enforceFieldAccess) return;

    // A caller that shares a state across a listing finishes the rows itself,
    // once every entry has been walked. One that does not is a single document,
    // so its walk is already complete here.
    const shared = state ?? createNestedHookState();
    await this.walkNestedRows(entry, collectionName, access, shared, 0);
    if (!state) await this.finalizeRelatedRows(shared, access);
  }

  /**
   * Re-apply each related row's field access, then rebuild the labels.
   *
   * The walk already applied access to each row (before its parent's hooks, so a
   * parent hook cannot read a denied child field to copy it). This runs it again
   * because a hook can REINTRODUCE a denied field onto an already-redacted row
   * (assigning `data.child.secret` to mask or derive a value), mutate a row in
   * place, or add/replace/reorder rows -- and without a pass after the hooks that
   * would be returned. It re-judges the current content (a cached verdict cannot
   * be trusted once a hook may have changed what a rule reads), restoring from the
   * shared `redactions` what a prior pass removed from each row so a rule reading
   * a now-denied sibling as evidence still sees it -- keeping an unchanged verdict
   * stable, as a direct read's single pass would, while judging everything a hook
   * touched afresh.
   *
   * Called more than once per read, and safe to repeat: once after the related
   * rows' OWN field hooks (so the source collection's hooks are handed already
   * sanitized rows), and again after the SOURCE collection's code and stored
   * afterRead hooks. Those hooks receive the whole assembled document and can
   * write a denied field straight back onto a related row (`entry.author.secret`);
   * the root-level read-access pass evaluates only the source collection's schema
   * and never descends into a related row, so without a pass here after them the
   * reintroduced value is returned. It leaves `pending` in place for exactly that
   * repeat; the state is scoped to one read and discarded when it finishes.
   *
   * Labels come last of all, from the values that survived: a label copies a
   * field under another key, so one rebuilt earlier would outlive the removal of
   * its own source field.
   */
  async finalizeRelatedRows(
    state: NestedHookState,
    access: RelatedRowAccess
  ): Promise<void> {
    if (!access.enforceFieldAccess) return;
    for (const { row, collection } of state.pending) {
      await this.applyRelatedRowReadAccess(
        collection,
        [row],
        access,
        state.redactions
      );
    }
    for (const { row, collection, field } of state.pending) {
      await this.refreshRelatedRowLabel(row, field, { collection }, state);
    }
    // Last, once every related row is fully sanitized and no source hook has run
    // yet: keep a copy of each as the authoritative version the response is
    // rebuilt from. Taken here rather than during the walk because a row is not
    // final until the loops above have re-judged it — a sibling parent's hooks,
    // in a listing that shares one row object between entries, run before this.
    for (const { row, collection, field, depth } of state.pending) {
      if (typeof row.id !== "string") continue;
      const key = relatedRowSnapshotKey(collection, row.id, field);
      // The NEAREST occurrence wins. A row reached deeper in the document was
      // expanded with less depth remaining, so restoring that version into a
      // shallower field would strip a level of expansion the response had — and
      // which no hook touched. Occurrences at equal depth expanded alike, so the
      // first is as good as the last.
      const recorded = state.sanitized.get(key);
      if (recorded && recorded.depth <= depth) continue;
      state.sanitized.set(key, {
        depth,
        row: detachData<Record<string, unknown>>(row),
      });
    }
  }

  /**
   * Rebuild the ASSEMBLED response's related rows from the authoritative versions
   * the walk produced, discarding whatever a source-collection `afterRead` hook —
   * code, stored, or field-level — did to them.
   *
   * A source hook receives the whole assembled document, and the root read-access
   * pass evaluates only the SOURCE collection's schema and never descends into a
   * related row. So a hook can write a denied target field back onto one, clone or
   * reshape one, append or reorder nested rows inside one, or return a rebuilt
   * document whose related rows are objects the walk never held. Detecting each of
   * those and undoing it is unbounded work: every reshape variant has to be
   * modelled, and a rule that reads a value the reshape moved falls open on the
   * copy.
   *
   * Rebuilding instead makes the question moot. Each populated related row in the
   * response is replaced by a copy of the sanitized version recorded in
   * `state.sanitized`, matched on the collection and id the response itself names.
   * No tampering has to be found, because none of it survives. A related row the
   * walk never sanitized — one a hook fabricated — has no authoritative version, so
   * it is reduced to the bare reference rather than returned with unjudged fields.
   *
   * Runs after EVERY source hook phase, not only the last: a hook in one phase can
   * copy a value off a related row it just contaminated onto a SOURCE field, which
   * the next phase would then read. Restoring between phases means every phase is
   * handed clean related rows. It costs no query — the versions are already in hand.
   *
   * Runs before selection projects rows to slices, so the response holds whole,
   * consistent related rows at the point selection reads them.
   */
  async reprojectRelatedRows(
    entries: Record<string, unknown>[],
    collectionName: string,
    access: RelatedRowAccess,
    state: NestedHookState
  ): Promise<void> {
    // NOT gated on `overrideAccess`. A trusted read skips the field RULES, but
    // password and system-secret stripping is unconditional even for trusted
    // reads, so the recorded versions are stripped either way and restoring them
    // is what removes a secret a source hook wrote back.
    if (!access.enforceFieldAccess) return;
    const fields = await this.fieldsForNestedWalk(collectionName, state);
    // Rows rebuilt during THIS pass, so a row several parents reference stays ONE
    // object across the response — the sharing batch expansion produced — instead
    // of becoming a separate copy per reference.
    const rebuilt = new Map<string, Record<string, unknown>>();
    for (const entry of entries) {
      this.reprojectFields(entry, fields, state, rebuilt);
    }
  }

  /**
   * Rebuild every relationship value held at one level of the response, and
   * descend through `group`/`repeater` containers to reach the ones nested inside
   * them.
   *
   * Container rows belong to the SOURCE collection, so they carry no authoritative
   * version of their own and are descended into rather than replaced. Only a
   * relationship value names another collection's row.
   */
  private reprojectFields(
    holder: Record<string, unknown>,
    fields: FieldDefinition[],
    state: NestedHookState,
    rebuilt: Map<string, Record<string, unknown>>
  ): void {
    for (const field of fields) {
      if (!field.name) continue;
      // A hook can hand a container or a populated hasMany back as the JSON string
      // storage keeps it as; left a string there is no value here to rebuild.
      this.decodeJsonBackedFieldInPlace(holder, field);
      const value = holder[field.name];
      if (value === null || value === undefined) continue;

      if (isRepeaterOrGroupField(field)) {
        const nested = getNestedFields(field);
        if (nested.length === 0) continue;
        for (const row of containerRowsOf(value)) {
          this.reprojectFields(row, nested, state, rebuilt);
        }
        continue;
      }
      // An upload points at the built-in media entity, which registers no field
      // rules and is never sanitized as a related row.
      if (!isRelationshipField(field) || isUploadField(field)) continue;

      holder[field.name] = this.reprojectRelationshipValue(
        value,
        field,
        state,
        rebuilt
      );
    }
  }

  /** Rebuild one relationship field's value, mapping a list one entry at a time so
   *  each entry is matched against its OWN target collection. */
  private reprojectRelationshipValue(
    value: unknown,
    field: FieldDefinition,
    state: NestedHookState,
    rebuilt: Map<string, Record<string, unknown>>
  ): unknown {
    const items = readItemArray(value);
    if (items) {
      // An entry whose identity cannot be read has no reference left to keep, and
      // a list must not carry a hole where it stood: expansion drops an entry it
      // cannot resolve rather than leaving a gap between the ones it did.
      return items
        .map(item =>
          this.reprojectRelationshipItem(item, field, state, rebuilt)
        )
        .filter(item => item !== null && item !== undefined);
    }
    return this.reprojectRelationshipItem(value, field, state, rebuilt);
  }

  /**
   * Rebuild one relationship entry from its authoritative version.
   *
   * A value that is still a bare reference is returned untouched: it carries no
   * fields, so there is nothing that could have been tampered with. A POPULATED row
   * is replaced by a copy of the sanitized version recorded for the collection and
   * id it names — and reduced to that bare reference when no such version exists,
   * because a populated row the walk never judged is one no rule has been applied
   * to. A row whose identity cannot be read at all (a clone a hook stripped the id
   * from) has no reference left to keep, so it is dropped.
   */
  private reprojectRelationshipItem(
    item: unknown,
    field: FieldDefinition,
    state: NestedHookState,
    rebuilt: Map<string, Record<string, unknown>>
  ): unknown {
    const shape = readRelationshipValueShape(item, field);
    // A reference carries no fields, so there is nothing here to rebuild — and
    // replacing it would drop a relationship no hook ever touched.
    if (shape.kind === "reference") return item;
    if (shape.kind === "unresolvable") return null;

    const id = extractRelationshipId(shape.row);
    if (typeof id !== "string") return null;
    const ref: RelationshipRef = {
      collection: shape.collection,
      id,
      discriminated: shape.discriminated,
    };
    const key = relatedRowSnapshotKey(ref.collection, ref.id, field);

    const already = rebuilt.get(key);
    if (already) return withReferenceIdentity(already, ref);

    const authoritative = state.sanitized.get(key)?.row;
    if (!authoritative) {
      return ref.discriminated
        ? { relationTo: ref.collection, value: ref.id }
        : ref.id;
    }
    // A copy per pass: the recorded version is restored again after the next
    // source hook phase, and handing out the recorded object itself would let a
    // hook mutate the very thing that pass restores from.
    const copy = detachData<Record<string, unknown>>(authoritative);
    rebuilt.set(key, copy);
    return withReferenceIdentity(copy, ref);
  }

  /**
   * The collection's fields, read once per collection per read.
   *
   * A target whose schema will not load runs no hooks, and the read continues.
   *
   * That is weaker than a read protection deserves, and it is the only answer
   * the registry supports: it reports "this is not a registered collection" and
   * "the lookup failed" the same way, so a relationship pointing at a built-in
   * entity is indistinguishable from a real failure. Refusing on it would deny
   * ordinary reads. The failure is logged rather than swallowed.
   *
   * Refusing becomes correct once the registry can answer whether a slug IS a
   * collection separately from what its fields are.
   */
  private async fieldsForNestedWalk(
    collectionName: string,
    state: NestedHookState
  ): Promise<FieldDefinition[]> {
    const cached = state.fields.get(collectionName);
    if (cached) return cached;

    // A system entity has no dynamic-collection record and registers no field
    // hooks, so there is nothing to look up.
    if (isSystemEntity(collectionName)) {
      state.fields.set(collectionName, []);
      return [];
    }

    let fields: FieldDefinition[] = [];
    try {
      const collection =
        await this.collectionService.getCollection(collectionName);
      const raw =
        (
          (collection as Record<string, unknown>).schemaDefinition as
            | Record<string, unknown>
            | undefined
        )?.fields ?? (collection as Record<string, unknown>).fields;
      fields = Array.isArray(raw) ? (raw as FieldDefinition[]) : [];
    } catch (error: unknown) {
      // A relationship can point at something that is not a registered
      // collection -- `users` behind an author field -- and the lookup reports
      // that as an untyped "not found", the same shape a genuine failure takes.
      // Since the two cannot be told apart here, refusing would deny ordinary
      // reads, so this logs and leaves the target's hooks unrun.
      console.error(
        `Nested field hooks skipped for "${collectionName}": its schema could not be read.`,
        error
      );
    }

    state.fields.set(collectionName, fields);
    return fields;
  }

  /**
   * Decode a JSON-backed field held as a string into its objects, in place, so the
   * walk can descend into the relationships inside or behind it.
   *
   * A source `afterRead` hook can return a value as the storage string SQLite keeps
   * it as (the normal read decodes these before this walk; a hook that reshapes the
   * document can hand one back as a string). Two field kinds are JSON-backed:
   * `group`/`repeater` containers, and a POPULATED `hasMany` or polymorphic
   * relationship, which serializes to a JSON array (`[...]`) or object
   * (`{"relationTo":...}`). Left a string, {@link walkFieldValue} derives no rows
   * from it and a denied target field inside would reach the response.
   *
   * A relationship is decoded only when the string opens with `[` or `{`: a bare id
   * is left alone (parsing `"12"` would coerce it to a number), and a Postgres
   * array literal (`{id,...}`) is not JSON so {@link parseJsonIfString} returns it
   * unchanged. Writing the decoded value back matches the shape a normal read
   * returns.
   */
  private decodeJsonBackedFieldInPlace(
    holder: Record<string, unknown>,
    field: FieldDefinition
  ): void {
    const value = holder[field.name];
    if (typeof value !== "string") return;
    if (isRepeaterOrGroupField(field)) {
      holder[field.name] = parseJsonIfString(value);
    } else if (isRelationshipField(field)) {
      // A populated `hasMany`/polymorphic relationship serializes to a JSON array
      // (`[...]`) or object (`{"relationTo":...}`). Detect it by the first
      // NON-WHITESPACE character, so a hook that hands back pretty-printed JSON
      // (a leading newline or spaces) is still decoded rather than left a string
      // the walk cannot descend — otherwise a denied field inside would reach the
      // response. A bare id or a Postgres array literal is left alone:
      // parseJsonIfString only replaces the value when JSON.parse succeeds, and
      // neither is valid JSON.
      const start = value.trimStart();
      if (start.startsWith("[") || start.startsWith("{")) {
        holder[field.name] = parseJsonIfString(value);
      }
    }
  }

  /**
   * Re-apply field access to the related rows already sanitized beneath `entry`,
   * after `entry`'s own field hooks ran (first walk only).
   *
   * The post-hook re-descent walks NEW children a hook added but skips ones already
   * visited. A field hook can instead reintroduce a denied field on an EXISTING
   * child in place; that child would stay contaminated while `entry` unwinds to its
   * PARENT, whose hooks could copy the value onto an allowed key the later
   * sanitization no longer looks at. Re-applying the existing children's access here
   * — without re-running their hooks — re-strips such reintroductions before `entry`
   * returns to its parent. The re-walk of the assembled response covers reshaped
   * rows separately.
   */
  private async reapplyDescendantAccess(
    entry: Record<string, unknown>,
    collectionName: string,
    access: RelatedRowAccess,
    state: NestedHookState,
    depth: number
  ): Promise<void> {
    if (depth > MAX_RELATIONSHIP_DEPTH) return;
    const fields = await this.fieldsForNestedWalk(collectionName, state);
    for (const field of fields) {
      await this.reapplyFieldValueAccess(
        entry[field.name],
        field,
        access,
        state,
        depth
      );
    }
  }

  /** Reach the related rows inside one field value — a relationship directly, or one
   *  nested in a group/repeater — and re-apply access to each already-visited row,
   *  recursing into its own relations. See {@link reapplyDescendantAccess}. */
  private async reapplyFieldValueAccess(
    value: unknown,
    field: FieldDefinition,
    access: RelatedRowAccess,
    state: NestedHookState,
    depth: number
  ): Promise<void> {
    if (value === null || value === undefined) return;
    const rows = (Array.isArray(value) ? value : [value]).filter(
      (row): row is Record<string, unknown> =>
        typeof row === "object" && row !== null
    );
    if (rows.length === 0) return;

    const nested = getNestedFields(field);
    if (nested.length > 0) {
      // A container: its rows belong to THIS collection; descend to reach any
      // relationship inside them.
      for (const row of rows) {
        for (const inner of nested) {
          await this.reapplyFieldValueAccess(
            row[inner.name],
            inner,
            access,
            state,
            depth
          );
        }
      }
      return;
    }
    // An upload points at the built-in media entity, which registers no field rules.
    if (isUploadField(field)) return;

    for (const row of rows) {
      const resolved = resolveNestedTarget(row, field);
      if (!resolved) continue;
      // Only ALREADY-VISITED children: a new one is handled by the re-descent that
      // runs the hooks path, and re-applying to it here would be redundant.
      if (!state.visited.has(resolved.row)) continue;
      // Deepest first, so a reintroduction nested under this child is re-stripped
      // before this child's own access re-runs.
      await this.reapplyDescendantAccess(
        resolved.row,
        resolved.collection,
        access,
        state,
        depth + 1
      );
      await this.applyRelatedRowReadAccess(
        resolved.collection,
        [resolved.row],
        access,
        state.redactions
      );
      // Secrets a hook could reintroduce, stripped for the same reason the walk
      // strips them: unconditional, override included.
      const targetFields = await this.fieldsForNestedWalk(
        resolved.collection,
        state
      );
      if (hasPasswordField(targetFields)) {
        stripPasswordFieldValues(resolved.row, targetFields);
      }
      if (isSystemEntity(resolved.collection)) {
        for (const col of SYSTEM_ENTITY_SECRET_COLUMNS) {
          delete resolved.row[col];
        }
      }
      stripSystemOwnerField(resolved.row);
      // Rebuild the label from what survived, as the walk does before returning to a
      // parent: a field hook can mutate an existing child so its label field flips
      // from allowed to denied, and this access pass removes the field but leaves the
      // synthetic `label` built earlier — which a parent hook could copy off
      // `child.label` before the finalize pass rebuilds labels.
      await this.refreshRelatedRowLabel(
        resolved.row,
        field,
        { collection: resolved.collection },
        state
      );
    }
  }

  /**
   * One level of {@link applyNestedFieldHooks}.
   *
   * Rows are claimed in {@link walkFieldValue} rather than here, so the claim
   * covers running a row's hooks as well as descending into it. The depth cap
   * mirrors the expansion's own maximum.
   */
  private async walkNestedRows(
    entry: Record<string, unknown>,
    collectionName: string,
    access: RelatedRowAccess,
    state: NestedHookState,
    depth: number
  ): Promise<void> {
    if (depth > MAX_RELATIONSHIP_DEPTH) return;

    const fields = await this.fieldsForNestedWalk(collectionName, state);
    for (const field of fields) {
      this.decodeJsonBackedFieldInPlace(entry, field);
      await this.walkFieldValue(entry[field.name], field, access, state, depth);
    }
  }

  /**
   * Visit one field's value, whatever shape it takes.
   *
   * A relationship can sit directly on the collection or inside a `group` or
   * `repeater`, and `expandRelationships` populates it either way, so a walk
   * that only looked at top-level `relationTo` fields left everything inside a
   * container unmasked.
   */
  private async walkFieldValue(
    value: unknown,
    field: FieldDefinition,
    access: RelatedRowAccess,
    state: NestedHookState,
    depth: number
  ): Promise<void> {
    if (value === null || value === undefined) return;

    const rows = (Array.isArray(value) ? value : [value]).filter(
      (row): row is Record<string, unknown> =>
        typeof row === "object" && row !== null
    );
    if (rows.length === 0) return;

    const nested = getNestedFields(field);
    if (nested.length > 0) {
      // A container: its rows belong to THIS collection, so they carry no
      // hooks of their own -- only the relationships inside them do.
      for (const row of rows) {
        for (const inner of nested) {
          this.decodeJsonBackedFieldInPlace(row, inner);
          await this.walkFieldValue(
            row[inner.name],
            inner,
            access,
            state,
            depth
          );
        }
      }
      return;
    }

    // An upload points at the built-in media entity, which is not a registered
    // collection and registers no field hooks. Resolving it would spend a
    // metadata query per row to be told so, and log the failure, on reads that
    // are otherwise fine -- and uploads are close to universal.
    if (isUploadField(field)) return;

    for (const row of rows) {
      // A discriminated value names its own collection, so a polymorphic
      // relationship is knowable per value rather than unknowable per field.
      const resolved = resolveNestedTarget(row, field);
      if (!resolved) continue;

      // Claimed before anything runs, and the claim covers the hooks as well as
      // the descent. Guarding only the descent still let a row shared by
      // several parents be transformed once per parent, which compounds any
      // transform that is not idempotent.
      if (state.visited.has(resolved.row)) continue;
      state.visited.add(resolved.row);

      await this.walkNestedRows(
        resolved.row,
        resolved.collection,
        access,
        state,
        depth + 1
      );
      // Decoded with the TARGET's schema. The read path decodes using the
      // source collection's fields, which say nothing about a related row's
      // own JSON columns, so on SQLite a hook inspecting one would be handed
      // the storage string.
      decodeJsonFieldValues(
        [resolved.row],
        await this.fieldsForNestedWalk(resolved.collection, state)
      );
      // The target's OWN field access, BEFORE its own field hooks. A hook belongs
      // to one field but is handed the whole row, so given an unredacted one a
      // hook on an allowed field can read a denied field beside it and return it
      // as its own value — where the pass after the hooks, which judges each field
      // by its own rule, has no reason to remove it. A direct read of the
      // collection applies access before its field hooks for exactly this reason,
      // and a row reached through a relationship may be redacted more strictly
      // than the target's own endpoint but never more loosely. What this removes
      // is recorded in the shared `redactions`, so the pass after the hooks
      // restores it as evidence and re-judges the row against its current content.
      await this.applyRelatedRowReadAccess(
        resolved.collection,
        [resolved.row],
        access,
        state.redactions
      );
      // Deepest first, so a hook reading into its own relations sees them
      // already transformed rather than half-processed.
      await runFieldHooks({
        kind: "collection",
        slug: resolved.collection,
        phase: "afterRead",
        data: resolved.row,
        operation: "read",
        user: access.user,
      });
      // A field hook may have ADDED or REPLACED one of this row's own populated
      // relationships. That child missed the descent above, so descend again:
      // a genuinely new child is walked — its denied fields stripped and it
      // queued — before this row returns to its parent, whose hooks (and the
      // source collection's) run next and could otherwise read a denied value
      // off the still-unsanitized child and copy it onto an allowed key the
      // later pass no longer looks at. Rows already claimed in `visited` are
      // skipped, so only new children are re-walked.
      await this.walkNestedRows(
        resolved.row,
        resolved.collection,
        access,
        state,
        depth + 1
      );
      // Re-apply access to this row's ALREADY-VISITED related descendants. A
      // field hook above can reintroduce a denied field on an existing child in
      // place; the re-descent skips it (visited), so without this it stays visible
      // while this row unwinds to its PARENT, whose hooks could copy it onto an
      // allowed key the later sanitization no longer looks at.
      await this.reapplyDescendantAccess(
        resolved.row,
        resolved.collection,
        access,
        state,
        depth + 1
      );

      // Apply THIS row's field access now, before returning to its parent —
      // whose afterRead hooks run next up the stack. Deferring it (as this once
      // did) let a parent hook read a child field the caller may not see, and
      // copy it under an allowed parent key where it outlived the child's own
      // redaction. The row's own hooks above already ran against its complete
      // values, and a direct read redacts a nested row before the parent
      // collection's field hooks for the same reason, so applying it here keeps
      // the nested path consistent with the direct one. Under `overrideAccess`
      // this is a no-op, leaving trusted assembly untouched. What it removes is
      // recorded in the shared `redactions` so `finalizeRelatedRows` can restore
      // it as evidence and re-judge the row after every hook has run.
      await this.applyRelatedRowReadAccess(
        resolved.collection,
        [resolved.row],
        access,
        state.redactions
      );

      // Rebuild the label from what survived the access pass, NOW, before the
      // parent's hooks run next up the stack. The fetch derives a row's `label`
      // from a target field, so a label built from a caller-denied field still
      // carries that value after the field itself is stripped; a parent hook
      // reading `data.child.label` would copy the denied value under an allowed
      // key. The finalize pass rebuilds labels again for hook mutations, but that
      // runs after the parent hooks and cannot remove a copy they already made.
      await this.refreshRelatedRowLabel(
        resolved.row,
        field,
        { collection: resolved.collection },
        state
      );

      // Queued for the finalize step, which re-applies access after every hook
      // (restoring the removed evidence and re-judging the current content so a
      // reintroduced or hook-mutated denied field is caught) and rebuilds labels
      // last, from the values that survived.
      state.pending.push({
        row: resolved.row,
        collection: resolved.collection,
        field,
        depth,
      });

      // Secrets are stripped from a related row when it is fetched, but a hook
      // on a sibling field can write one back -- deliberately or by copying the
      // row -- and the response-level defenses sanitize only the ROOT row,
      // using the source collection's schema, so they would never look at this
      // one. Stripped again here for the same reason a direct read strips after
      // its own hooks.
      const targetFields = await this.fieldsForNestedWalk(
        resolved.collection,
        state
      );
      if (hasPasswordField(targetFields)) {
        stripPasswordFieldValues(resolved.row, targetFields);
      }
      // A system entity (users) has no field registry, so the password strip above
      // — which reads the registry — never sees its secret columns. They are
      // stripped by name at fetch, but a source hook can reintroduce one onto the
      // populated row afterward, so re-strip them on every walk, override included.
      if (isSystemEntity(resolved.collection)) {
        for (const col of SYSTEM_ENTITY_SECRET_COLUMNS) {
          delete resolved.row[col];
        }
      }
      stripSystemOwnerField(resolved.row);
    }
  }

  /**
   * Rebuild a related row's display label from the fields that survived.
   *
   * The label copies a field's value under another key, so one derived at fetch
   * outlives the removal of its own source field: a caller denied `internalName`
   * would still read it as `label`. Rebuilt here, after the hooks and the field
   * rules, it can only be made of values this caller may see.
   *
   * Falls back to the id, which is what the fetch-time derivation does when the
   * source field is absent, so a row stays identifiable rather than losing its
   * label entirely.
   *
   * Only rows that carry a label are touched. Expansion attaches one; a row
   * reached some other way has no label to keep honest.
   */
  private async refreshRelatedRowLabel(
    row: Record<string, unknown>,
    field: FieldDefinition,
    resolved: { collection: string },
    state: NestedHookState
  ): Promise<void> {
    if (!("label" in row)) return;

    // Read from both shapes expansion supports, through the same reader the
    // snapshot key uses. A relationship storing the override at the field root
    // would otherwise have its label rebuilt from an auto-selected field, so the
    // same row came back labelled differently only because this pass ran.
    const declared = declaredLabelField(field);
    const cacheKey = `${resolved.collection}:${declared}`;
    let pending = state.labelFields.get(cacheKey);
    if (!pending) {
      pending = isSystemEntity(resolved.collection)
        ? Promise.resolve(
            resolveSystemEntityLabelField(resolved.collection, declared)
          )
        : this.getBestLabelField(resolved.collection, declared || undefined);
      state.labelFields.set(cacheKey, pending);
    }

    const labelField = await pending;
    row.label = row[labelField] || row.id;
  }

  /**
   * Evaluate the TARGET collection's field-level `access.read` against the
   * caller, per related row.
   *
   * Kept separate from secret stripping so it cannot be skipped by that pass's
   * early exits: a target collection with no password field is the common case,
   * and returning early on it would leave every access rule unevaluated.
   *
   * Rules are the target collection's own, so this is the same decision the
   * related row would get if it were read directly.
   */
  private async applyRelatedRowReadAccess(
    targetCollection: string,
    rows: Record<string, unknown>[],
    access: RelatedRowAccess,
    redactions?: ReadAccessRedactions
  ): Promise<void> {
    if (!access.enforceFieldAccess || trustsTarget(access, targetCollection))
      return;
    // Share `redactions` across the passes the walk makes over one row: a later
    // one restores what an earlier removed as evidence and re-judges the current
    // content, so a denied field a hook reintroduced or a row it changed is
    // caught while an unchanged verdict stays put.
    for (const row of rows) {
      await applyFieldReadAccess(
        {
          kind: "collection",
          slug: targetCollection,
          entry: row,
          // The field-access identity, never the hook one: a preview judges a
          // related row's fields as the sharer while every hook goes on seeing
          // the anonymous bearer who is actually asking.
          user: access.fieldAccessUser ?? access.user,
          overrideAccess: false,
        },
        redactions
      );
    }
  }

  /**
   * Resolve a collection's fields for redaction. Uses the same
   * `schemaDefinition.fields` (API shape) OR `collection.fields` (raw DB row)
   * fallback the rest of this service uses — `getCollection` returns the raw
   * row, whose fields live at the top level, so a `schemaDefinition`-only
   * lookup silently resolves to nothing and skips stripping. Returns null
   * when the schema cannot be resolved so the caller fails closed.
   */
  private async getRedactionFields(
    collectionName: string
  ): Promise<FieldDefinition[] | null> {
    try {
      const collection =
        await this.collectionService.getCollection(collectionName);
      const fields =
        (
          (collection as Record<string, unknown>).schemaDefinition as
            | Record<string, unknown>
            | undefined
        )?.fields || (collection as Record<string, unknown>).fields;
      return Array.isArray(fields) ? (fields as FieldDefinition[]) : null;
    } catch {
      return null;
    }
  }

  /**
   * Fetch a single related entry from a collection or system entity.
   * Supports both dynamic collections and system entities (like "users").
   *
   * @param collectionName - Name of the collection or system entity
   * @param entryId - ID of the entry to fetch
   * @returns The entry or null if not found
   */
  async fetchRelatedEntry(
    collectionName: string,
    entryId: string,
    access: RelatedRowAccess = { trusted: TRUSTS_EVERY_COLLECTION }
  ): Promise<Record<string, unknown> | null> {
    try {
      const [readable] = await this.readTargetRows(
        collectionName,
        [entryId],
        access
      );
      // Reads as absent rather than as an error: one unreadable reference must
      // not refuse the whole parent read, and the caller learns no more than a
      // reference pointing at nothing would tell them.
      return readable ?? null;
    } catch {
      return null;
    }
  }

  /**
   * Read ONLY the related target ids from the junction table, on the supplied
   * executor. Unlike {@link fetchManyToManyRelations}, it does not materialize
   * the target rows through the pool — so a caller building a snapshot inside a
   * write transaction sees a target created earlier in that same transaction
   * (whose row is not yet visible on a pooled connection), and a single-
   * connection pool never stalls waiting for a second connection. The ids are
   * exactly what the junction stores, so nothing about the targets is needed.
   *
   * @param sourceCollectionName - Name of the source collection
   * @param sourceEntryId - ID of the source entry
   * @param field - Field definition
   * @param executor - Transaction-bound executor to read the junction on
   * @returns The related target ids (empty on any read failure — the caller that
   *   requires completeness fails the write itself)
   */
  async fetchManyToManyTargetIds(
    sourceCollectionName: string,
    sourceEntryId: string,
    field: FieldDefinition,
    executor?: RelationshipDbExecutor
  ): Promise<string[]> {
    const targetCollectionName = getTargetCollection(field);
    if (!targetCollectionName) {
      console.error(
        `[CollectionRelationshipService] fetchManyToManyTargetIds: cannot determine target for field "${field.name}".`
      );
      return [];
    }
    const junctionTableName = this.getJunctionTableName(
      sourceCollectionName,
      targetCollectionName,
      field
    );
    const sourceIdCol = sql.identifier(sourceCollectionName + "_id");
    const targetIdCol = sql.identifier(targetCollectionName + "_id");
    const junctionQuery = sql`
      SELECT ${targetIdCol} as target_id
      FROM ${sql.identifier(junctionTableName)}
      WHERE ${sourceIdCol} = ${sourceEntryId}
    `;
    const junctionResults = (await this.selectRawSql(
      junctionQuery,
      executor
    )) as { rows: Array<{ target_id: string }> };
    return junctionResults.rows.map(row => row.target_id);
  }

  /**
   * Fetch many-to-many related entries.
   * Optimized with MySQL-compatible IN clause.
   *
   * @param sourceCollectionName - Name of the source collection
   * @param sourceEntryId - ID of the source entry
   * @param field - Field definition
   * @returns Array of related entries
   */
  async fetchManyToManyRelations(
    sourceCollectionName: string,
    sourceEntryId: string,
    field: FieldDefinition,
    // Optional transaction-bound executor. When supplied, the junction lookup
    // runs on the transaction's connection (read-your-writes, #226) so a version
    // snapshot captured inside the write transaction sees the junction rows just
    // written in it. The target-entry fetch stays on the pool: related rows live
    // in another (already-committed) collection, so they need no tx visibility.
    executor?: RelationshipDbExecutor,
    access: RelatedRowAccess = { trusted: TRUSTS_EVERY_COLLECTION }
  ): Promise<Record<string, unknown>[]> {
    // Same dual-aware target lookup as fetchManyToManyRelationsBatch above.
    // See that comment for the code-first vs UI-built shape rationale.
    const targetCollectionName = getTargetCollection(field);
    if (!targetCollectionName) {
      console.error(
        `[CollectionRelationshipService] fetchManyToManyRelations: cannot determine target for field "${field.name}".`
      );
      return [];
    }
    const junctionTableName = this.getJunctionTableName(
      sourceCollectionName,
      targetCollectionName,
      field
    );

    try {
      // Query junction table to get related IDs using sql tagged template
      const sourceIdCol = sql.identifier(sourceCollectionName + "_id");
      const targetIdCol = sql.identifier(targetCollectionName + "_id");

      const junctionQuery = sql`
        SELECT ${targetIdCol} as target_id
        FROM ${sql.identifier(junctionTableName)}
        WHERE ${sourceIdCol} = ${sourceEntryId}
      `;

      const junctionResults = (await this.selectRawSql(
        junctionQuery,
        executor
      )) as {
        rows: Array<{ target_id: string }>;
      };
      const relatedIds = junctionResults.rows.map(row => row.target_id);

      if (relatedIds.length === 0) {
        return [];
      }

      // Through the shared reader, which binds the id list with Drizzle's
      // `inArray` rather than assembling the IN clause by hand. The sibling
      // many-to-many batch path has always used `inArray` and passes on MySQL,
      // so the hand-built list this replaces was not buying compatibility.
      return await this.readTargetRows(
        targetCollectionName,
        relatedIds,
        access
      );
    } catch (error) {
      console.error("Failed to fetch many-to-many relations:", error);
      return [];
    }
  }

  /**
   * Insert many-to-many relationships into junction table.
   * Uses individual inserts for reliability (still fast with proper indexing).
   *
   * @param sourceCollectionName - Name of the source collection
   * @param sourceEntryId - ID of the source entry
   * @param field - Field definition
   * @param relatedIds - Array of related entry IDs to link
   * @param executor - Optional transaction-scoped Drizzle handle (from
   *   `tx.getDrizzle()`); when provided, the junction existence check and
   *   inserts run inside the caller's transaction so they commit atomically
   *   with the entry write instead of always hitting the pool.
   */
  async insertManyToManyRelations(
    sourceCollectionName: string,
    sourceEntryId: string,
    field: FieldDefinition,
    relatedIds: string[],
    executor?: RelationshipDbExecutor
  ): Promise<void> {
    if (relatedIds.length === 0) return;

    // Same dual-aware target lookup as fetchManyToManyRelationsBatch above.
    // See that comment for the code-first vs UI-built shape rationale.
    const targetCollectionName = getTargetCollection(field);
    if (!targetCollectionName) {
      console.error(
        `[CollectionRelationshipService] insertManyToManyRelations: cannot determine target for field "${field.name}".`
      );
      return;
    }
    const junctionTableName = this.getJunctionTableName(
      sourceCollectionName,
      targetCollectionName,
      field
    );

    console.log(
      `[ManyToMany] Inserting into junction table: ${junctionTableName}`
    );
    console.log(
      `[ManyToMany] Source: ${sourceCollectionName}, Target: ${targetCollectionName}`
    );
    console.log(
      `[ManyToMany] Field: ${field.name}, IDs: ${relatedIds.join(", ")}`
    );

    // Check if junction table exists. Each dialect has its own catalog
    // table for this: `information_schema` is PG/MySQL only, SQLite uses
    // `sqlite_master`. Skipping the dialect branching here would fail on
    // SQLite with `near "FROM": syntax error`.
    try {
      let checkQuery;
      if (this.dialect === "sqlite") {
        checkQuery = sql`
          SELECT EXISTS (
            SELECT 1 FROM sqlite_master
            WHERE type = 'table' AND name = ${junctionTableName}
          ) as table_exists
        `;
      } else if (this.dialect === "mysql") {
        checkQuery = sql`
          SELECT EXISTS (
            SELECT 1 FROM information_schema.tables
            WHERE table_schema = DATABASE()
            AND table_name = ${junctionTableName}
          ) as table_exists
        `;
      } else {
        checkQuery = sql`
          SELECT EXISTS (
            SELECT 1 FROM information_schema.tables
            WHERE table_schema = 'public'
            AND table_name = ${junctionTableName}
          ) as table_exists
        `;
      }
      const result = (await this.selectRawSql(checkQuery, executor)) as {
        rows: Array<{ table_exists: boolean | number }>;
      };
      const exists = Boolean(result.rows[0]?.table_exists);

      if (!exists) {
        throw new Error(
          `Junction table "${junctionTableName}" does not exist. ` +
            `Did you restart the app after creating the manyToMany field? ` +
            `Check migration files in src/db/migrations/dynamic/`
        );
      }
      console.log(`[ManyToMany] ✓ Junction table exists: ${junctionTableName}`);
    } catch (error: unknown) {
      console.error(`[ManyToMany] Junction table check failed:`, error);
      throw error;
    }

    const sourceIdCol = sql.identifier(sourceCollectionName + "_id");
    const targetIdCol = sql.identifier(targetCollectionName + "_id");

    // Insert each relationship. A genuine failure (for example a foreign-key
    // violation from a bad target id) is allowed to propagate: junction writes
    // run inside the caller's transaction via `executor`, so throwing rolls the
    // whole write back instead of committing a partial set of junction rows.
    // Duplicate (source,target) pairs never throw here (the dialect conflict
    // clause below ignores them).
    for (const targetId of relatedIds) {
      const id = this.collectionService.generateId();
      // This raw sql`` template binds straight to the driver, bypassing
      // Drizzle's per-column serialization. better-sqlite3 only accepts
      // numbers/strings/bigints/buffers/null, so a Date throws; the junction
      // created_at column is `integer` epoch-seconds on SQLite (see
      // generateJunctionTable), so bind that. PG/MySQL drivers accept a Date.
      const createdAt =
        this.dialect === "sqlite" ? Math.floor(Date.now() / 1000) : new Date();

      // "Insert, ignore an existing (source,target) pair" is spelled
      // differently per dialect: MySQL has no ON CONFLICT (it errors with
      // ER_PARSE_ERROR). Use ON DUPLICATE KEY UPDATE with a no-op assignment
      // rather than INSERT IGNORE, so only a duplicate-key conflict is
      // swallowed while other errors (e.g. a foreign-key violation from a
      // bad target id) still surface, matching the Postgres/SQLite
      // ON CONFLICT DO NOTHING behaviour against the unique pair index.
      const idCol = sql.identifier("id");
      const conflictClause =
        this.dialect === "mysql"
          ? sql`ON DUPLICATE KEY UPDATE ${idCol} = ${idCol}`
          : sql`ON CONFLICT DO NOTHING`;

      const query = sql`
        INSERT INTO ${sql.identifier(junctionTableName)}
        (id, ${sourceIdCol}, ${targetIdCol}, created_at)
        VALUES (${id}, ${sourceEntryId}, ${targetId}, ${createdAt})
        ${conflictClause}
      `;

      await this.mutateRawSql(query, executor);
    }
  }

  /**
   * Delete many-to-many relationships from junction table.
   * Uses Drizzle's sql tagged template for type safety and MySQL compatibility.
   *
   * @param sourceCollectionName - Name of the source collection
   * @param sourceEntryId - ID of the source entry
   * @param field - Field definition
   * @param executor - Optional transaction-scoped Drizzle handle; when
   *   provided, the delete runs inside the caller's transaction instead of the
   *   pool (see `insertManyToManyRelations` for the rationale).
   */
  async deleteManyToManyRelations(
    sourceCollectionName: string,
    sourceEntryId: string,
    field: FieldDefinition,
    executor?: RelationshipDbExecutor
  ): Promise<void> {
    // Same dual-aware target lookup as fetchManyToManyRelationsBatch above.
    // See that comment for the code-first vs UI-built shape rationale.
    const targetCollectionName = getTargetCollection(field);
    if (!targetCollectionName) {
      console.error(
        `[CollectionRelationshipService] deleteManyToManyRelations: cannot determine target for field "${field.name}".`
      );
      return;
    }
    const junctionTableName = this.getJunctionTableName(
      sourceCollectionName,
      targetCollectionName,
      field
    );

    const sourceIdCol = sql.identifier(sourceCollectionName + "_id");
    const query = sql`
      DELETE FROM ${sql.identifier(junctionTableName)}
      WHERE ${sourceIdCol} = ${sourceEntryId}
    `;

    await this.mutateRawSql(query, executor);
  }

  /**
   * Get junction table name for many-to-many relationship.
   *
   * @param sourceCollectionName - Name of the source collection
   * @param targetCollectionName - Name of the target collection
   * @param field - Field definition
   * @returns Junction table name
   */
  getJunctionTableName(
    sourceCollectionName: string,
    targetCollectionName: string,
    field: FieldDefinition
  ): string {
    if (field.options?.junctionTable) {
      return field.options.junctionTable;
    }

    // Auto-generate junction table name (same logic as in dynamic-collections.ts)
    const sourceTableName = `dc_${sourceCollectionName}`;
    const targetTableName = `dc_${targetCollectionName}`;
    const tables = [sourceTableName, targetTableName].sort();
    return `${tables[0]}_${tables[1]}_${field.name}`;
  }
}
