/**
 * CollectionMutationService — Write/mutation operations for collection entries.
 *
 * Extracted from CollectionEntryService (6,490-line god file) to handle all
 * create, update, and delete operations with hooks, validation, and relationships.
 *
 * Responsibilities:
 * - Create new entries with hooks, validation, relationships
 * - Update existing entries with hooks, validation
 * - Delete entries with hooks and cascading
 * - Transaction-aware variants of all CRUD operations
 * - Field uniqueness checking for stored hook validation
 * - Single-entry transaction helpers for batch operations
 */

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import type { TransactionContext } from "@nextlyhq/adapter-drizzle/types";
import { eq, ne, and, like, ilike } from "drizzle-orm";

// `OperationType` was removed during the PR 4 migration — this module no longer
// references it, so we import only `BeforeOperationArgs`.
import type { BeforeOperationArgs } from "@nextly/hooks/types";
import type { FieldDefinition } from "@nextly/schemas/dynamic-collections";

import { isComponentField } from "../../../collections/fields/guards";
import type { FieldConfig } from "../../../collections/fields/types";
// PR 4 migration: switched from mapDbErrorToServiceError to NextlyError.
import { toDbError } from "../../../database/errors";
// The public CollectionServiceResult shape is preserved because the legacy
// CollectionEntryService facade and CollectionBulkService still consume it;
// only the internal error mapping changed. fromDatabaseError keeps driver
// text out of the wire and routes identifying detail to logContext (§13.8).
import { NextlyError } from "../../../errors";
import type { ValidationPublicData } from "../../../errors/public-data";
import { emitDocumentEvent } from "../../../events/domain-events";
import { getEventBus } from "../../../events/event-bus";
import { toSnakeCase } from "../../../lib/case-conversion";
import type { ResolvedVersionsConfig } from "../../../schemas/versions/types";
import type { CollectionFileManager } from "../../../services/collection-file-manager";
import type {
  CollectionRelationshipService,
  RelationshipDbExecutor,
} from "../../../services/collections/collection-relationship-service";
import type { ComponentDataService } from "../../../services/components/component-data-service";
import type { Logger } from "../../../services/shared";
import { BaseService } from "../../../shared/base-service";
import { validateEntryData } from "../../../shared/lib/entry-validation";
import {
  applyFieldReadAccess,
  applyFieldWriteAccess,
  attachFieldValidators,
  runFieldHooks,
} from "../../../shared/lib/field-level-registry";
import { coerceDateFieldsToDate } from "../../../shared/lib/field-transform";
import {
  hashPasswordFieldValues,
  stripPasswordFieldValues,
  stripSystemOwnerField,
} from "../../../shared/lib/password-fields";
import type { SupportedDialect } from "../../../types/database";
import type { DynamicCollectionService } from "../../dynamic-collections";
import type { SanitizedLocalizationConfig } from "../../i18n/config/types";
import { resolveRequestedLocale } from "../../i18n/resolve-locale";
import { captureInTx } from "../../versions/capture-in-tx";
import { VersionCaptureService } from "../../versions/version-capture-service";
import { withVersionConflictRetry } from "../../versions/version-conflict";

import type { CollectionAccessService } from "./collection-access-service";
import type {
  CollectionHookService,
  QueryDatabaseParams,
} from "./collection-hook-service";
import type { CollectionServiceResult, UserContext } from "./collection-types";
import {
  toCamelCase,
  isJsonFieldType,
  isRelationshipField,
  normalizeRelationshipValue,
  normalizeNestedRelationships,
  normalizeUploadFields,
  getTableName,
  generateSlug,
} from "./collection-utils";

/**
 * Emit a post-commit `collection.<slug>.<action>` event (D8/D51). Observe-only,
 * best-effort: fired after the operation's transaction has committed and its
 * after* hooks have run, and wrapped so a missing/erroring bus can never break
 * the mutation. Use a hook (in-transaction) to modify/abort; use this to react.
 */
function emitCollectionEvent(
  action: "created" | "updated" | "deleted",
  collection: string,
  data: Record<string, unknown>,
  user: unknown
): void {
  try {
    getEventBus().emit(`collection.${collection}.${action}`, {
      collection,
      id: (data as { id?: unknown }).id,
      data,
      user,
    });
  } catch {
    // Best-effort — never surface event-dispatch failures to the caller.
  }
}

/**
 * Convert any thrown error into the legacy CollectionServiceResult shape.
 *
 * - NextlyError instances pass through (publicMessage / statusCode preserved).
 * - DbErrors map via NextlyError.fromDatabaseError so driver text never reaches
 *   the wire; status & generic message come from §8.2 mapping.
 * - Anything else falls back to the caller-supplied default (status 500 unless
 *   overridden) without leaking error.message in cases the spec disallows it.
 *
 * Identifier-bearing detail in `logContext` is dropped from the result shape
 * because that shape is publicly surfaced — callers reading `result.message`
 * must only ever see §13.8-compliant generic strings.
 */
function errorToServiceResult<T = unknown>(
  error: unknown,
  fallback: { statusCode?: number; defaultMessage: string },
  dialect: SupportedDialect
): CollectionServiceResult<T> {
  if (NextlyError.is(error)) {
    // Preserve per-field validation issues: the dispatcher and Direct API
    // rebuild the canonical envelope from this result, and without the
    // errors array the admin cannot map failures onto form fields.
    const validationErrors =
      error.code === "VALIDATION_ERROR"
        ? (error.publicData as ValidationPublicData | undefined)?.errors
        : undefined;
    return {
      success: false,
      statusCode: error.statusCode,
      message: error.publicMessage,
      data: null,
      ...(validationErrors ? { errors: validationErrors } : {}),
    };
  }
  // Free helper takes dialect explicitly (no `this`) so callers pass
  // `this.dialect` from BaseService. Normalising raw driver errors first
  // is what keeps unique/fk violations from collapsing to INTERNAL_ERROR.
  const mapped = NextlyError.fromDatabaseError(toDbError(dialect, error));
  if (mapped.code === "INTERNAL_ERROR") {
    return {
      success: false,
      statusCode: fallback.statusCode ?? 500,
      message: error instanceof Error ? error.message : fallback.defaultMessage,
      data: null,
    };
  }
  return {
    success: false,
    statusCode: mapped.statusCode,
    message: mapped.publicMessage,
    data: null,
  };
}

/**
 * System columns a client must never write: the primary key, the timestamps,
 * and the owner stamp (both the snake_case column name and the camelCase form a
 * client might send). They are not declared fields, so field validation passes
 * them through. Stripping them on BOTH create and update means the service
 * remains authoritative: on create the generated id / stamped `created_by` /
 * timestamps win (a stray `createdBy` alias can't survive the snake-case pass
 * and overwrite the stamp with an attacker-chosen owner), and on update an
 * authorized updater can't transfer a row to another user, forge `created_at`,
 * duplicate `updated_at`, or reassign `id`.
 */
const IMMUTABLE_SYSTEM_FIELDS = new Set([
  "id",
  "created_at",
  "createdAt",
  "updated_at",
  "updatedAt",
  "created_by",
  "createdBy",
]);

function stripImmutableSystemFields(
  data: Record<string, unknown>
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data)) {
    if (!IMMUTABLE_SYSTEM_FIELDS.has(key)) out[key] = value;
  }
  return out;
}

export class CollectionMutationService extends BaseService {
  constructor(
    adapter: DrizzleAdapter,
    logger: Logger,
    private readonly fileManager: CollectionFileManager,
    private readonly collectionService: DynamicCollectionService,
    private readonly relationshipService: CollectionRelationshipService,
    private readonly accessService: CollectionAccessService,
    private readonly hookService: CollectionHookService,
    private readonly componentDataService?: ComponentDataService,
    /**
     * Normalized localization config (i18n M5). When set and a collection is localized, writes
     * route translatable field values to the companion `_locales` row for the write's locale.
     * Absent → non-localized behavior (unchanged).
     */
    private readonly localization?: SanitizedLocalizationConfig
  ) {
    super(adapter, logger);
  }

  /**
   * Stateless version-capture service. Records a durable version snapshot
   * inside the write transaction when the collection opts into versioning, so
   * the version commits atomically with the content write.
   */
  private readonly versionCapture = new VersionCaptureService();

  /**
   * Emit the document-level status events for one transition (post-commit).
   *
   * Fires the general `statusTransition` event (the seam workflows/item 9 build
   * on) plus the specific `statusChanged` / `published` events existing
   * subscribers already listen on, so current behavior is preserved. Create as
   * `published` has no prior status to change from, so it passes
   * `emitStatusChanged: false` to keep emitting only `published` (and now the
   * general transition), never `statusChanged`.
   */
  private transitionStatus(args: {
    collection: string;
    id: unknown;
    data: Record<string, unknown>;
    user?: UserContext;
    previousStatus: string | null;
    status: string;
    emitStatusChanged: boolean;
  }): void {
    const docBase = { id: args.id, data: args.data, user: args.user };
    emitDocumentEvent("statusTransition", args.collection, {
      ...docBase,
      previousStatus: args.previousStatus,
      status: args.status,
    });
    if (args.emitStatusChanged) {
      emitDocumentEvent("statusChanged", args.collection, {
        ...docBase,
        previousStatus: args.previousStatus,
        status: args.status,
      });
    }
    if (args.status === "published" && args.previousStatus !== "published") {
      emitDocumentEvent("published", args.collection, docBase);
    }
  }

  /**
   * Build the locale-aware inputs for {@link validateEntryData} on a localized-collection write
   * (i18n M5b). `required` on a localized field is enforced only for the default-language row so the
   * "publish default now, translate later" workflow proceeds; shared required fields are always
   * enforced. For a non-localized collection this yields an empty set and enforce=true, so the
   * canonical validator behaves exactly as it does elsewhere. Localized field names come from the
   * companion schema, so a localized collection that has not been migrated yet (localized columns
   * still on the main table) treats no field as localized, matching the pre-migration behavior.
   */
  private async localizedRequiredContext(
    collectionName: string,
    locale: string | undefined
  ): Promise<{
    localizedFieldNames: ReadonlySet<string>;
    enforceLocalizedRequired: boolean;
  }> {
    const companion =
      await this.fileManager.loadCompanionSchema(collectionName);
    const localizedFieldNames = new Set(
      (companion?.localizedFields ?? []).map(f => f.name)
    );
    const enforceLocalizedRequired =
      !this.localization ||
      resolveRequestedLocale(this.localization, locale) ===
        this.localization.defaultLocale;
    return { localizedFieldNames, enforceLocalizedRequired };
  }

  /**
   * Upsert the companion `_locales` row for `(parentId, locale)` with the provided localized
   * columns (i18n M5, updateEntry). Only the provided columns are written — an existing row for
   * another locale, or other localized fields on this locale's row, are left untouched. Uses the
   * PK `(_parent, _locale)` conflict target. Runs inside the caller's transaction via `tx.execute`.
   */
  private async upsertCompanionRow(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- adapter tx surface
    tx: any,
    companionTableName: string,
    parentId: string,
    locale: string,
    companionData: Record<string, unknown>
  ): Promise<void> {
    const cols = Object.keys(companionData);
    if (cols.length === 0) return;
    const isMysql = this.dialect === "mysql";
    const q = (id: string) => (isMysql ? `\`${id}\`` : `"${id}"`);
    const params: unknown[] = [];
    const ph = () =>
      this.dialect === "postgresql" ? `$${params.length}` : "?";

    const allCols = ["_parent", "_locale", ...cols];
    const valuePlaceholders = allCols
      .map(c => {
        params.push(
          c === "_parent"
            ? parentId
            : c === "_locale"
              ? locale
              : companionData[c]
        );
        return ph();
      })
      .join(", ");

    const conflict = isMysql
      ? `ON DUPLICATE KEY UPDATE ${cols.map(c => `${q(c)} = VALUES(${q(c)})`).join(", ")}`
      : `ON CONFLICT (${q("_parent")}, ${q("_locale")}) DO UPDATE SET ${cols
          .map(c => `${q(c)} = excluded.${q(c)}`)
          .join(", ")}`;

    await tx.execute(
      `INSERT INTO ${q(companionTableName)} (${allCols.map(q).join(", ")}) ` +
        `VALUES (${valuePlaceholders}) ${conflict}`,
      params
    );
  }

  /** Whether the companion `_locales` table physically exists (migration has run). */
  private async companionTableExists(
    companionTableName: string
  ): Promise<boolean> {
    const q =
      this.adapter.dialect === "mysql"
        ? `\`${companionTableName}\``
        : `"${companionTableName}"`;
    try {
      await this.adapter.executeQuery(`SELECT 1 FROM ${q} LIMIT 0`);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Split `entryData` (snake_case keys) into main-table data and companion data for a localized
   * collection: localized columns move to `companionData` and are removed from `mainData` (the
   * migrated main table no longer has them). Returns `null` when the collection isn't localized
   * or the companion table doesn't exist yet (dev/unmigrated → localized cols stay on main).
   */
  private async splitLocalizedWriteData(
    collectionName: string,
    entryData: Record<string, unknown>,
    locale: string | undefined,
    isCreate: boolean
  ): Promise<{
    companionTableName: string;
    writeLocale: string;
    companionData: Record<string, unknown>;
    // The same written localized values, keyed by FIELD NAME (companionData is
    // keyed by snake_case column). A version snapshot merges these onto the
    // parent so the read-shape snapshot carries this locale's translatable
    // values instead of dropping them.
    localizedFieldValues: Record<string, unknown>;
  } | null> {
    if (!this.localization) return null;
    const companion =
      await this.fileManager.loadCompanionSchema(collectionName);
    if (!companion) return null;

    // Route to the companion ONLY when it physically exists (the migration has run). Before
    // `migrate`, the dev auto-sync leaves localized columns on the MAIN table (Option B), so
    // writes must go there — return null and let the localized values flow to main as today.
    if (!(await this.companionTableExists(companion.companionTableName))) {
      return null;
    }

    const writeLocale = resolveRequestedLocale(this.localization, locale);
    const companionData: Record<string, unknown> = {};
    const localizedFieldValues: Record<string, unknown> = {};
    for (const field of companion.localizedFields) {
      // createEntry passes snake_case keys (already converted); updateEntry passes camelCase
      // field names. Accept either; always store under the snake_case companion column.
      const key = Object.prototype.hasOwnProperty.call(entryData, field.column)
        ? field.column
        : Object.prototype.hasOwnProperty.call(entryData, field.name)
          ? field.name
          : null;
      if (key !== null) {
        companionData[field.column] = entryData[key];
        // Keep a field-name-keyed copy for the version snapshot (read shape).
        localizedFieldValues[field.name] = entryData[key];
        delete entryData[key]; // migrated main table has no localized columns
      }
    }

    // i18n M6: per-locale draft/publish. The companion `_status` for the write's locale comes
    // from the write's status value. On create it defaults to 'draft'; on update it changes
    // ONLY when `status` is explicitly in the patch (so editing German content doesn't
    // un-publish German). The main table keeps its own `status` column unchanged.
    if (companion.hasStatus) {
      const statusVal = entryData.status;
      if (typeof statusVal === "string") {
        companionData._status = statusVal;
      } else if (isCreate) {
        companionData._status = "draft";
      }
      if (!isCreate) {
        // Per-locale draft/publish lives on the companion row's `_status`; a
        // single-locale update must not rewrite the main table's own status
        // column (that global publish is publishAllLocales' job), so drop the
        // status from the main update payload. Create still seeds the main row.
        delete entryData.status;
      }
    }

    return {
      companionTableName: companion.companionTableName,
      writeLocale,
      companionData,
      localizedFieldValues,
    };
  }

  /**
   * Return a shallow copy of `row` with JSON-backed field values (richtext,
   * blocks, array, group, json) parsed from their stored string form, matching
   * the read shape so a version snapshot equals a normal read. Non-JSON and
   * already-parsed values pass through; a parse failure keeps the raw string.
   * Never mutates the input.
   */
  private deserializeJsonFieldsForSnapshot(
    row: Record<string, unknown>,
    fields: FieldDefinition[]
  ): Record<string, unknown> {
    const out = { ...row };
    for (const field of fields) {
      const value = out[field.name];
      if (
        isJsonFieldType(field.type, field) &&
        typeof value === "string" &&
        value
      ) {
        try {
          out[field.name] = JSON.parse(value);
        } catch {
          // Not valid JSON — keep the raw string.
        }
      }
    }
    return out;
  }

  /**
   * Build the COMPLETE component-subtree and many-to-many id maps for an entry's
   * version snapshot. A partial update only carries the fields present in the
   * request, so the written maps cover just those; unchanged component/relation
   * fields are read from the current committed state and overlaid, so a
   * scalar-only edit does not drop existing components or relations from the
   * snapshot (which a later restore would otherwise lose). Reads run on the
   * pooled connection — unchanged fields are untouched by the in-flight write,
   * so their committed value is correct — and written values always win.
   */
  private async buildFullSnapshotRelations(
    entryId: string,
    collectionName: string,
    parentTable: string,
    fields: FieldDefinition[],
    manyToManyFields: FieldDefinition[],
    writtenComponents: Record<string, unknown>,
    writtenM2M: Record<string, string[]>
  ): Promise<{
    components: Record<string, unknown>;
    manyToMany: Record<string, string[]>;
  }> {
    const components: Record<string, unknown> = {};
    if (this.componentDataService) {
      const componentFields = fields.filter(isComponentField);
      // Only read when a component field was omitted from the write (else the
      // written map is already complete).
      const hasOmitted = componentFields.some(
        f => writtenComponents[f.name] === undefined
      );
      if (hasOmitted) {
        try {
          const populated =
            await this.componentDataService.populateComponentData({
              entry: { id: entryId },
              // Use the resolved parent table (custom `dbName` collections do not
              // match getTableName(slug)); it must equal the table the component
              // rows were written under, or the read finds nothing.
              parentTable,
              fields: fields as unknown as FieldConfig[],
            });
          for (const f of componentFields) {
            if (populated[f.name] !== undefined) {
              components[f.name] = populated[f.name];
            }
          }
        } catch {
          // Best-effort: a read failure just omits those fields from the snapshot.
        }
      }
    }
    // Written component values win over the read-back.
    Object.assign(components, writtenComponents);

    const manyToMany: Record<string, string[]> = {};
    const hasOmittedM2M = manyToManyFields.some(
      f => writtenM2M[f.name] === undefined
    );
    if (hasOmittedM2M) {
      for (const field of manyToManyFields) {
        if (writtenM2M[field.name] !== undefined) continue;
        try {
          const relatedRows =
            await this.relationshipService.fetchManyToManyRelations(
              collectionName,
              entryId,
              field
            );
          manyToMany[field.name] = relatedRows.map(
            r => (r as { id: string }).id
          );
        } catch {
          // Best-effort: skip on read failure.
        }
      }
    }
    Object.assign(manyToMany, writtenM2M);

    return { components, manyToMany };
  }

  /**
   * Serialize hasMany relationship arrays to JSON strings before insert/update.
   *
   * Code-first `relationship({ hasMany: true })` fields are stored as a JSON
   * column on the parent table (see runtime-schema-generator's `case "json"`).
   * SQLite uses a plain `text` column for JSON, so the caller must stringify;
   * PostgreSQL `jsonb` and MySQL `json` accept either a JS array or a string.
   * Unconditional stringification keeps all three dialects on the same path.
   *
   * Mutates `finalData` in place. Idempotent: arrays become strings; existing
   * strings (e.g. when the caller pre-serialized) are not double-encoded.
   */
  private serializeHasManyRelationships(
    finalData: Record<string, unknown>,
    fields: { type: string; name: string; hasMany?: boolean }[]
  ): void {
    for (const field of fields) {
      if (
        isRelationshipField(field.type) &&
        field.hasMany &&
        Array.isArray(finalData[field.name])
      ) {
        finalData[field.name] = JSON.stringify(finalData[field.name]);
      }
    }
  }

  /**
   * Redact a persisted entry before it is returned to the client. Drops
   * write-only password hashes and any field the caller may write but not
   * read (`access.read`). The query path already applies both, so every
   * mutation response must run the same redaction or a create/update could
   * echo back a value the reader is denied — the write and read rules are
   * independent, so a field can be writable yet read-denied.
   *
   * `overrideAccess` normally skips read redaction (a trusted server-context
   * caller asked for the full document). The REST dispatcher, however, sets
   * `overrideAccess` only to skip the collection-level re-check after route
   * auth — it is NOT a trusted read context, so `routeAuthorized` forces the
   * response to still be redacted to what the authenticated user may read,
   * matching the query path for the same caller.
   */
  private async redactResponseFields(
    entry: Record<string, unknown>,
    fields: FieldDefinition[],
    params: {
      user?: Record<string, unknown>;
      overrideAccess?: boolean;
      routeAuthorized?: boolean;
    },
    slug: string
  ): Promise<void> {
    // Deserialize JSON-stored containers (group/repeater/json/chips/hasMany)
    // before redaction so the read-access walker descends into them — SQLite
    // returns these as JSON strings, and a read-denied field nested in a
    // still-serialized container would otherwise be echoed. The single
    // create/update paths already deserialize upstream; this makes the
    // transaction/bulk variants safe too (a second pass is a no-op).
    for (const field of fields) {
      if (
        isJsonFieldType(field.type, field) &&
        typeof entry[field.name] === "string" &&
        entry[field.name]
      ) {
        try {
          entry[field.name] = JSON.parse(entry[field.name] as string);
        } catch {
          // If parsing fails, keep the raw string.
        }
      }
    }
    stripPasswordFieldValues(entry, fields);
    // Strip the system owner column so a mutation response (e.g. an admin or
    // role-based updater) does not echo the row creator's user id. Owner-only
    // access reads it from SQL, never from the returned row.
    stripSystemOwnerField(entry);
    await applyFieldReadAccess({
      kind: "collection",
      slug,
      entry,
      user: params.user,
      overrideAccess: params.overrideAccess && !params.routeAuthorized,
    });
  }

  /** Resolve the physical table for a collection, honoring `dbName` overrides. */
  private resolveTableName(collection: unknown, slug: string): string {
    return (
      ((collection as Record<string, unknown>)?.tableName as string) ||
      getTableName(slug)
    );
  }

  /**
   * Wrapper around checkFieldUniqueness that matches the QueryDatabaseParams
   * signature expected by CollectionHookService.buildPrebuiltHookContext.
   */
  private readonly queryDatabaseFn = async (
    params: QueryDatabaseParams
  ): Promise<boolean> => {
    return this.checkFieldUniqueness(
      params.collection,
      params.field,
      params.value,
      params.caseInsensitive || false,
      params.excludeId
    );
  };

  // ============================================================
  // Field Uniqueness Check
  // ============================================================

  /**
   * Check if a field value already exists in a collection.
   *
   * Used by stored hooks for uniqueness validation. Can optionally exclude a specific document
   * (useful for update operations where we want to exclude the current document).
   *
   * @param collectionName - Name of the collection to query
   * @param field - Field name to check for uniqueness
   * @param value - Value to check for duplicates
   * @param caseInsensitive - Whether to perform case-insensitive comparison
   * @param excludeId - Optional document ID to exclude from the check (for updates)
   * @returns Promise<boolean> - true if a duplicate exists, false otherwise
   */
  async checkFieldUniqueness(
    collectionName: string,
    field: string,
    value: unknown,
    caseInsensitive: boolean = false,
    excludeId?: string
  ): Promise<boolean> {
    try {
      // Load the schema for this collection
      const schema = await this.fileManager.loadDynamicSchema(collectionName);

      // Check if the field exists in the schema
      if (!schema[field]) {
        this.logger.warn(
          `Field ${field} does not exist in collection ${collectionName}`
        );
        return false;
      }

      // Build the query

      let query = this.db.select().from(schema);

      // Build the WHERE condition
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Drizzle SQL condition accumulator
      const conditions: any[] = [];

      // Add field value condition (case-sensitive or case-insensitive)
      if (caseInsensitive && typeof value === "string") {
        // Use ILIKE for PostgreSQL, LIKE for others (MySQL/SQLite are case-insensitive by default)
        const dialect = this.adapter?.dialect || "postgresql";
        if (dialect === "postgresql") {
          conditions.push(ilike(schema[field], value));
        } else {
          conditions.push(like(schema[field], value));
        }
      } else {
        // Case-sensitive comparison
        conditions.push(eq(schema[field], value));
      }

      // Exclude the current document ID if provided (for update operations)
      if (excludeId && schema.id) {
        conditions.push(ne(schema.id, excludeId));
      }

      // Apply all conditions
      if (conditions.length > 0) {
        query = query.where(and(...conditions));
      }

      // Limit to 1 result since we only need to know if any match exists
      query = query.limit(1);

      // Execute the query
      const results = await query;

      // Return true if any matching document exists
      return results.length > 0;
    } catch (error: unknown) {
      this.logger.error(
        `Error checking field uniqueness for ${field} in ${collectionName}`,
        {
          error: error instanceof Error ? error.message : String(error),
          field,
          collectionName,
        }
      );
      // On error, return false to allow the operation to proceed
      // The actual validation error will be caught elsewhere
      return false;
    }
  }

  // ============================================================
  // Public CRUD Methods
  // ============================================================

  /**
   * Fill the auto-injected `slug` and `title` columns on a create payload.
   *
   * defineCollection injects a required, unique `slug` and a NOT NULL `title`
   * into every collection. When the caller omits them we derive them here: the
   * slug from the title (or name, or a unique fallback token), the title from
   * the name or the slug.
   *
   * A GENERATED slug is deduped so a repeated title auto-increments (`hello`,
   * `hello-2`, …) — the WordPress/Ghost convention. An EXPLICITLY provided slug
   * is only sanitized and kept as-is: the caller asserted a canonical value, so
   * a collision surfaces as the normal unique-constraint conflict rather than a
   * silent rename. `isSlugTaken` is supplied by the caller so the uniqueness
   * check runs on the correct executor — the shared connection for a plain
   * create, or the enclosing transaction (which sees its own pending rows) for
   * a transactional create. Runs before field-level write access so a caller
   * denied `title`/`slug` write does not have them reintroduced. Mutates
   * `finalData`.
   */
  private async applyGeneratedSlugAndTitle(
    finalData: Record<string, unknown>,
    isSlugTaken: (slug: string) => Promise<boolean>
  ): Promise<void> {
    const provided =
      typeof finalData.slug === "string" && finalData.slug.trim() !== "";
    if (provided) {
      // Explicit slug: sanitize only, never dedupe — respect the caller's value.
      const sanitized = generateSlug(finalData.slug as string);
      // generateSlug strips everything outside [\w-], so an explicit slug of
      // only non-ASCII/punctuation (e.g. "你好") sanitizes to empty. Treat that
      // as unset and derive a valid, unique slug instead of persisting "".
      finalData.slug =
        sanitized !== ""
          ? sanitized
          : await this.deriveSlug(finalData, isSlugTaken);
    } else {
      finalData.slug = await this.deriveSlug(finalData, isSlugTaken);
    }

    // The `title` column is NOT NULL: fall back to the name, then the slug.
    if (typeof finalData.title !== "string" || finalData.title.trim() === "") {
      const nameValue = finalData.name;
      finalData.title =
        typeof nameValue === "string" && nameValue.trim()
          ? nameValue.trim()
          : finalData.slug;
    }
  }

  /**
   * Derive a unique slug from the title (or name), falling back to a
   * collision-proof token. `generateSlug` strips everything outside [\w-], so a
   * CJK/emoji/punctuation-only title (or a missing one) yields an empty base;
   * the `entry-<ts>-<rand>` fallback keeps the required, unique `slug` column
   * populated instead of failing required-field validation.
   */
  private async deriveSlug(
    finalData: Record<string, unknown>,
    isSlugTaken: (slug: string) => Promise<boolean>
  ): Promise<string> {
    const titleValue = finalData.title ?? finalData.name ?? "";
    const derived =
      typeof titleValue === "string" && titleValue.trim()
        ? generateSlug(titleValue)
        : "";
    const baseSlug =
      derived !== ""
        ? derived
        : `entry-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
    return this.dedupeSlug(baseSlug, isSlugTaken);
  }

  /**
   * Re-sanitize `slug` after field-level beforeValidate hooks run. Those hooks
   * execute after slug generation, so a hook that sets `slug` (for example from
   * the title) could introduce an unsanitized value that would otherwise be
   * validated and stored verbatim. Normalizing here keeps the stored slug
   * URL-safe; it is idempotent for an already-clean slug. When the hook value
   * sanitizes to empty (a CJK/emoji/punctuation-only string), it derives a
   * valid slug from the title just like `applyGeneratedSlugAndTitle` does for
   * an explicit slug that sanitizes away, rather than leaving the un-sanitized
   * value to be stored verbatim.
   */
  private async reSanitizeSlug(
    finalData: Record<string, unknown>,
    isSlugTaken: (slug: string) => Promise<boolean>
  ): Promise<void> {
    // Respect an ABSENT slug. Field-level write access deletes the key when it
    // denies the write, so `undefined` means "stripped by access" (or never
    // set): leave it so access control holds and required validation applies —
    // deriving would smuggle a slug back past access. Slug generation for a
    // create with no user-supplied slug already ran in applyGeneratedSlugAndTitle
    // (before write access), so a legitimately-absent-here slug is intentional.
    if (finalData.slug === undefined) return;
    // The field is PRESENT (a user provided it and passed access, or a hook set
    // it). Normalize a string; a non-string or empty/non-URL-safe value (e.g.
    // "你好", "   ", null) sanitizes to "" and is derived from the title rather
    // than persisting an invalid slug — required validation permits empty
    // strings, so it would not catch it, and this mirrors the empty fallback in
    // applyGeneratedSlugAndTitle.
    const current = finalData.slug;
    const sanitized = typeof current === "string" ? generateSlug(current) : "";
    finalData.slug =
      sanitized !== ""
        ? sanitized
        : await this.deriveSlug(finalData, isSlugTaken);
  }

  /**
   * Return a slug that is free, appending `-2`, `-3`, … until `isSlugTaken`
   * reports it available. Bounded so a pathological data set can't spin
   * forever; the final fallback appends a timestamp that is effectively
   * collision-proof. The unique constraint on the column remains the ultimate
   * guard against a concurrent race between the check and the insert.
   */
  private async dedupeSlug(
    baseSlug: string,
    isSlugTaken: (slug: string) => Promise<boolean>
  ): Promise<string> {
    let candidate = baseSlug;
    for (let suffix = 2; suffix <= 51; suffix++) {
      if (!(await isSlugTaken(candidate))) return candidate;
      candidate = `${baseSlug}-${suffix}`;
    }
    // Check the last generated candidate (`baseSlug-51`) before the fallback.
    if (!(await isSlugTaken(candidate))) return candidate;
    return `${baseSlug}-${Date.now()}`;
  }

  /**
   * Create a new entry.
   * Applies collection-level access control and hooks.
   *
   * Security checks are applied in order:
   * 1. Collection-level access (AccessControlService)
   *
   * @param params - Collection name and optional user context
   * @param body - Entry data to create
   * @returns Created entry or error
   */
  async createEntry(
    params: {
      collectionName: string;
      user?: UserContext;
      overrideAccess?: boolean;
      /** Write locale (i18n M5): translatable values are stored for this language. */
      locale?: string;
      // Set by the REST dispatcher: route-level authorization already ran, so
      // the collection re-check is skipped, but the response is still redacted
      // to what this user may read (this is not a trusted-server read).
      routeAuthorized?: boolean;
      context?: Record<string, unknown>;
    },
    body: Record<string, unknown>,
    depth?: number
  ): Promise<CollectionServiceResult> {
    try {
      const accessUser = params.overrideAccess ? undefined : params.user;

      // 1. Check collection-level access FIRST
      const accessDenied = await this.accessService.checkCollectionAccess(
        params.collectionName,
        "create",
        accessUser,
        undefined,
        undefined,
        params.overrideAccess,
        params.routeAuthorized
      );
      if (accessDenied) {
        return accessDenied;
      }

      // Get collection metadata to identify relation fields and hooks
      // Note: For create operations, we use the adapter directly with the table name,
      // so we don't need the Drizzle schema. The fields metadata from the collection
      // is sufficient for data processing (JSON serialization, date conversion, etc.)
      const collection = await this.collectionService.getCollection(
        params.collectionName
      );
      const fields =
        ((
          (collection as Record<string, unknown>).schemaDefinition as
            | Record<string, unknown>
            | undefined
        )?.fields as FieldDefinition[]) ||
        ((collection as Record<string, unknown>).fields as FieldDefinition[]) ||
        [];
      const storedHooks = this.hookService.getStoredHooks(
        collection as Record<string, unknown>
      );

      const tableName = this.resolveTableName(
        collection,
        params.collectionName
      );

      // Shared context between all hooks in this request
      const sharedContext: Record<string, unknown> = { ...params.context };

      // Execute beforeOperation hooks FIRST (before operation-specific hooks)
      // Can modify operation arguments or throw to abort
      const beforeOpArgs =
        await this.hookService.hookRegistry.executeBeforeOperation({
          collection: params.collectionName,
          operation: "create",
          args: { data: body },
          user: params.user
            ? { id: params.user.id, email: params.user.email }
            : undefined,
          context: sharedContext,
        });

      // Use modified data if returned by beforeOperation
      const currentData = (beforeOpArgs as BeforeOperationArgs)?.data ?? body;

      // Execute beforeCreate hooks (code-registered)
      // Hooks run before validation and can modify the incoming data
      const beforeContext = this.hookService.buildHookContext({
        collection: params.collectionName,
        operation: "create" as const,
        data: currentData,
        user: params.user,
        context: sharedContext,
      });

      const modifiedData = await this.hookService.hookRegistry.execute(
        "beforeCreate",
        beforeContext
      );
      const dataAfterCodeHooks = (modifiedData ?? currentData) as Record<
        string,
        unknown
      >;

      // Execute stored beforeCreate hooks (UI-configured)
      // Runs after code hooks, can further modify data
      const storedBeforeResult =
        await this.hookService.storedHookExecutor.execute(
          "beforeCreate",
          storedHooks,
          this.hookService.buildPrebuiltHookContext(
            params.collectionName,
            "create",
            dataAfterCodeHooks,
            this.queryDatabaseFn,
            params.user,
            sharedContext
          )
        );
      const finalData = (storedBeforeResult.data ??
        dataAfterCodeHooks) as Record<string, unknown>;

      // Password fields store bcrypt hashes, never the submitted value.
      // Runs after hooks (so hooks see the plaintext they may validate
      // against) and before any serialization touches the column value.
      // Enforce the schema's declared rules on the server. Every writer
      // (admin, REST, Direct API, bulk, forms) funnels through this path,
      // so this is where required/min/max/pattern/options are guaranteed;
      // runs on the post-hook data and before hashing so password rules
      // see the plaintext length, not the hash's.
      // Generate the auto-injected `slug`/`title` BEFORE field-level write
      // access and validation. defineCollection injects a required, unique
      // `slug` and a NOT NULL `title`; deriving them here (slug from title,
      // deduped for uniqueness) lets `create({ data: { title } })` succeed
      // without a manual slug. Running before write access means a field the
      // caller may not create is not reintroduced; the uniqueness check uses
      // the shared connection (a plain, non-transactional create).
      const isSlugTaken = (slug: string) =>
        this.checkFieldUniqueness(params.collectionName, "slug", slug);
      await this.applyGeneratedSlugAndTitle(finalData, isSlugTaken);

      // Field-level access: fields the caller may not create are stripped
      // silently (Payload parity); overrideAccess bypasses.
      await applyFieldWriteAccess({
        kind: "collection",
        slug: params.collectionName,
        data: finalData,
        operation: "create",
        user: params.user,
        overrideAccess: params.overrideAccess,
      });

      // Field-level beforeValidate hooks transform values ahead of the
      // validation gate (functions resolved via the field-level registry).
      await runFieldHooks({
        kind: "collection",
        slug: params.collectionName,
        phase: "beforeValidate",
        data: finalData,
        operation: "create",
        user: params.user,
      });

      // A beforeValidate hook can set `slug` after generation ran; re-sanitize
      // so the validated and stored value stays URL-safe.
      await this.reSanitizeSlug(finalData, isSlugTaken);

      {
        // i18n M5b: `required` on a localized field is enforced only for the default-locale write;
        // other locales fall back, so the canonical validator gets the localized-field set and
        // whether this write's locale must enforce them.
        const localeCtx = await this.localizedRequiredContext(
          params.collectionName,
          params.locale
        );
        const validationIssues = await validateEntryData(
          finalData,
          attachFieldValidators("collection", params.collectionName, fields),
          {
            mode: "create",
            req: params.user ? { user: params.user } : {},
            ...localeCtx,
          }
        );
        if (validationIssues.length > 0) {
          throw NextlyError.validation({ errors: validationIssues });
        }
      }

      // Field-level beforeChange hooks transform the final stored value
      // (runs after validation, before hashing/serialization).
      await runFieldHooks({
        kind: "collection",
        slug: params.collectionName,
        phase: "beforeChange",
        data: finalData,
        operation: "create",
        user: params.user,
      });

      // A beforeChange hook runs after validation and can also set `slug`;
      // re-sanitize once more so the stored value stays URL-safe.
      await this.reSanitizeSlug(finalData, isSlugTaken);

      await hashPasswordFieldValues(finalData, fields);

      // Normalize relationship field values (extract IDs from objects with display properties)
      // This must happen before many-to-many extraction and JSON serialization
      fields.forEach(field => {
        if (isRelationshipField(field.type) && finalData[field.name] != null) {
          const isPolymorphic =
            Array.isArray(field.options?.target) ||
            Array.isArray(field.relationTo);
          const hasMany =
            field.hasMany === true ||
            field.options?.relationType === "manyToMany";

          let normalized = normalizeRelationshipValue(
            finalData[field.name],
            isPolymorphic
          );

          // Single relationships: unwrap arrays to a single value
          if (!hasMany && Array.isArray(normalized)) {
            normalized = normalized.length > 0 ? normalized[0] : null;
          }

          finalData[field.name] = normalized;
        }
      });

      // Normalize upload field values (extract IDs from populated media objects)
      normalizeUploadFields(finalData, fields);

      // Separate regular fields from many-to-many relations
      const manyToManyFields = fields.filter(
        f =>
          f.type === "relationship" &&
          // Only UI-built manyToMany routes through a junction table.
          // Code-first `hasMany: true` is stored as a JSON array on the
          // parent column (see field-column-descriptor.ts kind="json")
          // and is serialized later in the same finalData pass.
          f.options?.relationType === "manyToMany"
      );
      const manyToManyData: Record<string, string[]> = {};

      // Extract many-to-many data from finalData (after hooks)
      manyToManyFields.forEach(field => {
        if (finalData[field.name]) {
          manyToManyData[field.name] = Array.isArray(finalData[field.name])
            ? (finalData[field.name] as string[])
            : [finalData[field.name] as string];
          delete finalData[field.name]; // Remove from main insert
        }
      });

      // Extract component field data (stored in separate comp_{slug} tables)
      // Component fields should not be stored in the collection table
      // Extract component field data for separate storage in comp_{slug} tables
      const componentFieldData: Record<string, unknown> = {};
      fields.forEach(field => {
        if (isComponentField(field) && finalData[field.name] !== undefined) {
          componentFieldData[field.name] = finalData[field.name];
          delete finalData[field.name]; // Remove from main insert
        }
      });

      this.serializeHasManyRelationships(finalData, fields);

      // Normalize relationship data inside repeater/group fields before serialization.
      // The admin panel may send full relationship objects ({id, title, slug, ...})
      // inside repeater rows — strip these down to just IDs to prevent bloated JSON.
      fields.forEach(field => {
        if (
          (field.type === "repeater" || field.type === "group") &&
          finalData[field.name] != null &&
          typeof finalData[field.name] === "object"
        ) {
          const nestedFields = field.fields || [];
          if (
            nestedFields.some(
              f =>
                isRelationshipField(f.type) ||
                f.type === "repeater" ||
                f.type === "group"
            )
          ) {
            if (
              field.type === "repeater" &&
              Array.isArray(finalData[field.name])
            ) {
              finalData[field.name] = (finalData[field.name] as unknown[]).map(
                (row: unknown) =>
                  row && typeof row === "object" && !Array.isArray(row)
                    ? normalizeNestedRelationships(
                        row as Record<string, unknown>,
                        nestedFields
                      )
                    : row
              );
            } else if (
              field.type === "group" &&
              !Array.isArray(finalData[field.name])
            ) {
              finalData[field.name] = normalizeNestedRelationships(
                finalData[field.name] as Record<string, unknown>,
                nestedFields
              );
            }
          }
        }
      });

      // Serialize JSON fields (richtext, blocks, array, group, json)
      fields.forEach(field => {
        if (
          isJsonFieldType(field.type, field) &&
          finalData[field.name] != null
        ) {
          const value = finalData[field.name];
          // Only stringify if it's an object/array and not already a string
          if (typeof value === "object") {
            finalData[field.name] = JSON.stringify(value);
          } else if (typeof value === "string") {
            // Already a string - check if it's valid JSON to avoid double-serialization
            try {
              JSON.parse(value);
              // It's already valid JSON string, keep as-is
            } catch {
              // Not valid JSON string - this is unusual for JSON fields
              console.warn(
                `[createEntry] Field "${field.name}" (type: ${field.type}) is a string but not valid JSON`
              );
            }
          }
        }
      });

      // Convert date-field strings into `Date` objects so Drizzle can bind
      // them to `timestamp` columns. See `coerceDateFieldsToDate` for the
      // failure mode this guards against.
      coerceDateFieldsToDate(finalData, fields);

      // slug/title are generated before validation (applyGeneratedSlugAndTitle).

      // Final safety pass: ensure upload field values are IDs, not populated objects.
      fields.forEach(field => {
        if (field.type === "upload" && finalData[field.name] != null) {
          const val = finalData[field.name];
          if (typeof val === "object" && val !== null && !Array.isArray(val)) {
            finalData[field.name] =
              "id" in val &&
              typeof (val as Record<string, unknown>).id === "string"
                ? (val as Record<string, unknown>).id
                : null;
          } else if (Array.isArray(val)) {
            finalData[field.name] = val.map((item: unknown) =>
              typeof item === "string"
                ? item
                : typeof item === "object" && item !== null && "id" in item
                  ? (item as Record<string, unknown>).id
                  : item
            );
          }
        }
      });

      // Prepare entry data (excluding many-to-many fields)
      // Convert camelCase field names to snake_case column names for the database.
      // The adapter uses data keys directly as column names in SQL, so they must
      // match the actual database column naming convention (snake_case).
      // Store timestamps as Date objects. Drizzle handles conversion per dialect:
      // - PostgreSQL: timestamp with timezone
      // - MySQL: datetime
      // - SQLite: integer (unix timestamp via mode:"timestamp")
      // Using Date objects (not ISO strings) because SQLite's integer mode
      // calls .getTime() which fails on strings.

      const now = new Date();
      const rawEntryData = {
        id: this.collectionService.generateId(),
        // Strip client-supplied system columns (id / timestamps / created_by,
        // both snake and camel) so the generated id, stamped owner, and
        // timestamps below are authoritative — a stray `createdBy` alias can't
        // survive to overwrite the owner stamp.
        ...stripImmutableSystemFields(finalData),
        created_at: now,
        updated_at: now,
        // Stamp the row owner with the creating user's id so owner-only access
        // works zero-config. Null for system/seed creates (no user context).
        created_by: params.user?.id ?? null,
      };
      const entryData: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(rawEntryData)) {
        entryData[toSnakeCase(key)] = value;
      }

      // i18n M5: for a localized collection, pull translatable columns out of the main insert
      // (the migrated main table no longer has them) so they can be written to the companion
      // row for the write's locale, inside the same transaction. `null` = not localized /
      // companion not migrated yet (localized cols stay on main — dev path, unchanged).
      const localizedWrite = await this.splitLocalizedWriteData(
        params.collectionName,
        entryData,
        params.locale,
        true
      );

      // Wrap entry insert and component data save in a transaction so that
      // a component save failure rolls back the entry — no partial state.
      // Resolved versioning config persisted on the collection (or null when
      // unversioned); read once so the in-tx capture below can skip cheaply.
      const versionsConfig = (collection as Record<string, unknown>)
        .versions as ResolvedVersionsConfig | null | undefined;

      const entry: Record<string, unknown> = {};
      await this.adapter.transaction(async tx => {
        const rawEntry = await tx.insert<unknown>(tableName, entryData, {
          returning: "*",
        });

        // Convert snake_case keys from DB response back to camelCase field names
        // so hooks and the API response use the original field names.
        for (const [key, value] of Object.entries(
          rawEntry as Record<string, unknown>
        )) {
          entry[toCamelCase(key)] = value;
        }

        // i18n M5: write the translatable values to the companion `_locales` row for the
        // write's locale (same transaction → rolls back with the main insert).
        if (localizedWrite) {
          await tx.insert(
            localizedWrite.companionTableName,
            {
              _parent: entry.id,
              _locale: localizedWrite.writeLocale,
              ...localizedWrite.companionData,
            },
            {}
          );
          // The localized values were split out of the main insert, so the
          // returned main row lacks them. Merge them back (camelCase keys) so
          // afterCreate hooks, events, and the response include them. `_status`
          // is a companion-only column, not an entry field.
          for (const [column, value] of Object.entries(
            localizedWrite.companionData
          )) {
            if (column === "_status") continue;
            entry[toCamelCase(column)] = value;
          }
        }

        // Save component field data to separate comp_{slug} tables
        if (
          this.componentDataService &&
          Object.keys(componentFieldData).length > 0
        ) {
          await this.componentDataService.saveComponentDataInTransaction(tx, {
            parentId: entry.id as string,
            parentTable: tableName,
            fields: fields as unknown as FieldConfig[],
            data: componentFieldData,
          });
        }

        // Write many-to-many junction rows inside the transaction so a junction
        // failure rolls back the entry (atomic write). The tx-scoped Drizzle
        // handle binds the junction writes to this transaction's connection.
        const txExecutor = tx.getDrizzle<RelationshipDbExecutor>();
        for (const field of manyToManyFields) {
          const relatedIds = manyToManyData[field.name];
          if (relatedIds && relatedIds.length > 0) {
            await this.relationshipService.insertManyToManyRelations(
              params.collectionName,
              entry.id as string,
              field,
              relatedIds,
              txExecutor
            );
          }
        }

        // Record a durable version snapshot atomically with the write when the
        // collection opts into versioning. Runs after components + m2m so the
        // snapshot is the full assembled document (the read-shape). History-only
        // here: the entry's status maps to a VersionStatus inside captureInTx.
        // A create provides all field values, so componentFieldData/
        // manyToManyData are already complete; only the parent needs read-shape
        // normalization (parse JSON-backed fields; strip password hashes so they
        // never enter durable history). `entry` is reused after the tx for hooks
        // and the response, so snapshot a copy.
        if (versionsConfig?.enabled) {
          const snapshotParent = this.deserializeJsonFieldsForSnapshot(
            entry,
            fields
          );
          stripPasswordFieldValues(snapshotParent, fields);
          // Strip the system owner column (created_by) too: normal reads/
          // responses redact it, so history must not durably retain a stable
          // owner id or let a restore overwrite ownership from old history.
          stripSystemOwnerField(snapshotParent);
          await captureInTx(tx, this.versionCapture, {
            ref: {
              scopeKind: "collection",
              scopeSlug: params.collectionName,
              entryId: entry.id as string,
            },
            contentStatus: (entry as { status?: unknown }).status,
            parts: {
              parentRow: snapshotParent,
              components: componentFieldData,
              manyToMany: manyToManyData,
            },
            createdBy: params.user?.id ?? null,
          });
        }
      });

      // Execute afterCreate hooks (code-registered)
      // Hooks run after database insert completes (for side effects)
      const afterContext = this.hookService.buildHookContext({
        collection: params.collectionName,
        operation: "create" as const,
        data: entry,
        user: params.user,
        context: sharedContext, // Pass shared context from beforeCreate
      });

      await this.hookService.hookRegistry.execute("afterCreate", afterContext);

      // Execute stored afterCreate hooks (UI-configured)
      await this.hookService.storedHookExecutor.execute(
        "afterCreate",
        storedHooks,
        this.hookService.buildPrebuiltHookContext(
          params.collectionName,
          "create",
          entry,
          this.queryDatabaseFn,
          params.user,
          sharedContext
        )
      );

      // Post-commit reaction event (D8/D51).
      emitCollectionEvent("created", params.collectionName, entry, params.user);

      // D69: a document created directly as `published` is a publish event too.
      // (No statusChanged on create — there is no prior status to transition from.)
      const createdStatus = (entry as { status?: unknown }).status;
      if (createdStatus === "published") {
        this.transitionStatus({
          collection: params.collectionName,
          id: (entry as { id?: unknown }).id,
          data: { ...entry },
          user: params.user,
          previousStatus: null,
          status: "published",
          emitStatusChanged: false,
        });
      }

      // Deserialize JSON fields (richtext, blocks, array, group, json) for response
      fields.forEach(field => {
        if (
          isJsonFieldType(field.type, field) &&
          entry[field.name] &&
          typeof entry[field.name] === "string"
        ) {
          try {
            entry[field.name] = JSON.parse(entry[field.name] as string);
          } catch {
            // If parsing fails, keep as string
          }
        }
      });

      // Field-level afterChange hooks observe the PERSISTED values — run
      // before response expansion so hooks see stored IDs, not the
      // populated relationship objects the response returns.
      await runFieldHooks({
        kind: "collection",
        slug: params.collectionName,
        phase: "afterChange",
        data: entry,
        operation: "create",
        user: params.user,
      });

      // Expand relationships in response if depth is specified
      let responseEntry = entry;
      if (depth !== undefined && depth > 0) {
        try {
          responseEntry = await this.relationshipService.expandRelationships(
            entry,
            params.collectionName,
            fields,
            { depth }
          );
        } catch (expansionError) {
          // If expansion fails, return the entry without expanded relationships
          console.warn(
            "Failed to expand relationships in createEntry response:",
            expansionError
          );
        }
      }

      // Redact the response: drop write-only password hashes and any field
      // the caller may write but not read (parity with the query path).
      await this.redactResponseFields(
        responseEntry,
        fields,
        {
          user: params.user,
          overrideAccess: params.overrideAccess,
          routeAuthorized: params.routeAuthorized,
        },
        params.collectionName
      );

      return {
        success: true,
        statusCode: 201,
        message: "Entry created successfully",
        data: responseEntry,
      };
    } catch (error: unknown) {
      // Legacy per-kind override messages ("Duplicate value: ...",
      // "Missing required field", etc.) are dropped: the new mapping uses
      // the §13.8-compliant generic strings from fromDatabaseError so the
      // wire never reveals which constraint or column failed. The original
      // DbError is preserved on the NextlyError as `cause` for log lines.
      // Pass dialect explicitly so the helper can normalise raw driver errors.
      return errorToServiceResult(
        error,
        { defaultMessage: "Failed to create entry" },
        this.dialect
      );
    }
  }

  /**
   * Update an existing entry.
   * Applies collection-level access control and hooks.
   *
   * Security checks are applied in order:
   * 1. Collection-level access (AccessControlService)
   *
   * @param params - Collection name, entry ID, and optional user context
   * @param body - Update data
   * @returns Updated entry or error
   */
  /**
   * Publish ALL languages of an entry at once (i18n M7, spec §10). Atomically sets the main
   * `status` to 'published' and — when the collection has per-locale status (M6) — every companion
   * row's `_status` to 'published', in a single transaction. For a non-localized / no-status
   * collection it is a plain publish of the single row. Only touches status columns (no field
   * values), so it needs none of the localized-write machinery.
   */
  async publishAllLocales(params: {
    collectionName: string;
    entryId: string;
    user?: UserContext;
    overrideAccess?: boolean;
  }): Promise<CollectionServiceResult> {
    try {
      const accessUser = params.overrideAccess ? undefined : params.user;
      const schema = await this.fileManager.loadDynamicSchema(
        params.collectionName
      );

      const [existingEntry] = await this.db
        .select()
        .from(schema)
        .where(eq(schema.id, params.entryId))
        .limit(1);
      if (!existingEntry) {
        return {
          success: false,
          statusCode: 404,
          message: "Entry not found",
          data: null,
        };
      }

      const accessDenied = await this.accessService.checkCollectionAccess(
        params.collectionName,
        "update",
        accessUser,
        params.entryId,
        existingEntry,
        params.overrideAccess
      );
      if (accessDenied) return accessDenied;

      const hasMainStatus = "status" in schema;
      const companion = await this.fileManager.loadCompanionSchema(
        params.collectionName
      );
      const companionPublishable =
        !!companion &&
        companion.hasStatus &&
        (await this.companionTableExists(companion.companionTableName));

      if (!hasMainStatus && !companionPublishable) {
        // Nothing to publish — the collection has no status concept.
        return {
          success: true,
          statusCode: 200,
          message: "Nothing to publish (collection has no status).",
          data: { id: params.entryId },
        };
      }

      const isMysql = this.dialect === "mysql";
      const q = (id: string) => (isMysql ? `\`${id}\`` : `"${id}"`);
      const ph = (i: number) => (this.dialect === "postgresql" ? `$${i}` : "?");
      // Resolve through the collection so a custom tableName/dbName override is
      // honored, matching every other mutation; getTableName would hardcode the
      // default dc_<slug> and target the wrong table for a renamed collection.
      const publishCollection = await this.collectionService.getCollection(
        params.collectionName
      );
      const tableName = this.resolveTableName(
        publishCollection,
        params.collectionName
      );

      await this.adapter.transaction(async tx => {
        if (hasMainStatus) {
          await tx.execute(
            `UPDATE ${q(tableName)} SET ${q("status")} = ${ph(1)} WHERE ${q("id")} = ${ph(2)}`,
            ["published", params.entryId]
          );
        }
        if (companion && companionPublishable) {
          await tx.execute(
            `UPDATE ${q(companion.companionTableName)} SET ${q("_status")} = ${ph(1)} WHERE ${q("_parent")} = ${ph(2)}`,
            ["published", params.entryId]
          );
        }
      });

      return {
        success: true,
        statusCode: 200,
        message: "All languages published.",
        data: { id: params.entryId, status: "published" },
      };
    } catch (error) {
      return {
        success: false,
        statusCode: 500,
        message:
          error instanceof Error
            ? error.message
            : "Failed to publish all languages",
        data: null,
      };
    }
  }

  async updateEntry(
    params: {
      collectionName: string;
      entryId: string;
      user?: UserContext;
      overrideAccess?: boolean;
      /** Write locale (i18n M5): translatable values are updated for this language only. */
      locale?: string;
      // Set by the REST dispatcher: route-level authorization already ran, so
      // the collection re-check is skipped, but the response is still redacted
      // to what this user may read (this is not a trusted-server read).
      routeAuthorized?: boolean;
      context?: Record<string, unknown>;
    },
    body: Record<string, unknown>,
    depth?: number
  ): Promise<CollectionServiceResult> {
    try {
      const accessUser = params.overrideAccess ? undefined : params.user;

      const schema = await this.fileManager.loadDynamicSchema(
        params.collectionName
      );

      // Fetch the existing entry first (needed for access control and hooks)

      const [existingEntry] = await this.db
        .select()
        .from(schema)
        .where(eq(schema.id, params.entryId))
        .limit(1);

      if (!existingEntry) {
        return {
          success: false,
          statusCode: 404,
          message: "Entry not found",
          data: null,
        };
      }

      // 1. Check collection-level access FIRST (with document for owner checks)
      const accessDenied = await this.accessService.checkCollectionAccess(
        params.collectionName,
        "update",
        accessUser,
        params.entryId,
        existingEntry,
        params.overrideAccess,
        params.routeAuthorized
      );
      if (accessDenied) {
        return accessDenied;
      }

      // Get collection metadata to identify relation fields and hooks
      const collection = await this.collectionService.getCollection(
        params.collectionName
      );
      const fields =
        ((
          (collection as Record<string, unknown>).schemaDefinition as
            | Record<string, unknown>
            | undefined
        )?.fields as FieldDefinition[]) ||
        ((collection as Record<string, unknown>).fields as FieldDefinition[]) ||
        [];
      const storedHooks = this.hookService.getStoredHooks(
        collection as Record<string, unknown>
      );

      const tableName = this.resolveTableName(
        collection,
        params.collectionName
      );

      // Shared context between all hooks in this request
      const sharedContext: Record<string, unknown> = { ...params.context };

      // Execute beforeOperation hooks FIRST (before operation-specific hooks)
      // Can modify operation arguments (id, data) or throw to abort
      const beforeOpArgs =
        await this.hookService.hookRegistry.executeBeforeOperation({
          collection: params.collectionName,
          operation: "update",
          args: { id: params.entryId, data: body },
          user: params.user
            ? { id: params.user.id, email: params.user.email }
            : undefined,
          context: sharedContext,
        });

      // Use modified data if returned by beforeOperation
      const currentData = (beforeOpArgs as BeforeOperationArgs)?.data ?? body;

      // Execute beforeUpdate hooks (code-registered)
      // Hooks run before validation and can modify the incoming data
      const beforeContext = this.hookService.buildHookContext({
        collection: params.collectionName,
        operation: "update" as const,
        data: currentData,
        originalData: existingEntry,
        user: params.user,
        context: sharedContext,
      });

      const modifiedData = await this.hookService.hookRegistry.execute(
        "beforeUpdate",
        beforeContext
      );
      const dataAfterCodeHooks = (modifiedData ?? currentData) as Record<
        string,
        unknown
      >;

      // Execute stored beforeUpdate hooks (UI-configured)
      // Runs after code hooks, can further modify data
      const storedBeforeResult =
        await this.hookService.storedHookExecutor.execute(
          "beforeUpdate",
          storedHooks,
          this.hookService.buildPrebuiltHookContext(
            params.collectionName,
            "update",
            dataAfterCodeHooks,
            this.queryDatabaseFn,
            params.user,
            sharedContext
          )
        );
      const finalData = (storedBeforeResult.data ??
        dataAfterCodeHooks) as Record<string, unknown>;

      // Password fields store bcrypt hashes, never the submitted value.
      // Runs after hooks (so hooks see the plaintext they may validate
      // against) and before any serialization touches the column value.
      // Enforce the schema's declared rules on the server. Every writer
      // (admin, REST, Direct API, bulk, forms) funnels through this path,
      // so this is where required/min/max/pattern/options are guaranteed;
      // runs on the post-hook data and before hashing so password rules
      // see the plaintext length, not the hash's.
      // Field-level access: fields the caller may not update are stripped
      // silently (Payload parity); overrideAccess bypasses. The document id
      // is passed so owner/record-aware access rules can evaluate.
      await applyFieldWriteAccess({
        kind: "collection",
        slug: params.collectionName,
        data: finalData,
        operation: "update",
        user: params.user,
        overrideAccess: params.overrideAccess,
        id: params.entryId,
      });

      // Field-level beforeValidate hooks transform values ahead of the
      // validation gate (functions resolved via the field-level registry).
      await runFieldHooks({
        kind: "collection",
        slug: params.collectionName,
        phase: "beforeValidate",
        data: finalData,
        operation: "update",
        user: params.user,
      });

      {
        // i18n M5b: on update only fields present in the patch are checked (required cannot be
        // blanked). `required` on a localized field is enforced only for the default-locale write;
        // other locales fall back, so the canonical validator gets the localized-field context.
        const localeCtx = await this.localizedRequiredContext(
          params.collectionName,
          params.locale
        );
        const validationIssues = await validateEntryData(
          finalData,
          attachFieldValidators("collection", params.collectionName, fields),
          {
            mode: "update",
            req: params.user ? { user: params.user } : {},
            ...localeCtx,
          }
        );
        if (validationIssues.length > 0) {
          throw NextlyError.validation({ errors: validationIssues });
        }
      }

      // Field-level beforeChange hooks transform the final stored value
      // (runs after validation, before hashing/serialization).
      await runFieldHooks({
        kind: "collection",
        slug: params.collectionName,
        phase: "beforeChange",
        data: finalData,
        operation: "update",
        user: params.user,
      });

      await hashPasswordFieldValues(finalData, fields);

      // Normalize relationship field values (extract IDs from objects with display properties)
      // This must happen before many-to-many extraction and JSON serialization
      fields.forEach(field => {
        if (isRelationshipField(field.type) && finalData[field.name] != null) {
          const isPolymorphic =
            Array.isArray(field.options?.target) ||
            Array.isArray(field.relationTo);
          const hasMany =
            field.hasMany === true ||
            field.options?.relationType === "manyToMany";

          let normalized = normalizeRelationshipValue(
            finalData[field.name],
            isPolymorphic
          );

          // Single relationships: unwrap arrays to a single value
          if (!hasMany && Array.isArray(normalized)) {
            normalized = normalized.length > 0 ? normalized[0] : null;
          }

          finalData[field.name] = normalized;
        }
      });

      // Normalize upload field values (extract IDs from populated media objects)
      normalizeUploadFields(finalData, fields);

      // Separate regular fields from many-to-many relations
      const manyToManyFields = fields.filter(
        f =>
          f.type === "relationship" &&
          // Only UI-built manyToMany routes through a junction table.
          // Code-first `hasMany: true` is stored as a JSON array on the
          // parent column (see field-column-descriptor.ts kind="json")
          // and is serialized later in the same finalData pass.
          f.options?.relationType === "manyToMany"
      );
      const manyToManyData: Record<string, string[]> = {};

      // Extract many-to-many data from finalData (after hooks)
      manyToManyFields.forEach(field => {
        if (finalData[field.name] !== undefined) {
          manyToManyData[field.name] = Array.isArray(finalData[field.name])
            ? (finalData[field.name] as string[])
            : finalData[field.name] === null
              ? []
              : [finalData[field.name] as string];
          delete finalData[field.name]; // Remove from main update
        }
      });

      // Extract component field data (stored in separate comp_{slug} tables)
      // Component fields should not be stored in the collection table
      const componentFieldData: Record<string, unknown> = {};
      fields.forEach(field => {
        if (isComponentField(field) && finalData[field.name] !== undefined) {
          componentFieldData[field.name] = finalData[field.name];
          delete finalData[field.name]; // Remove from main update
        }
      });

      // Normalize relationship data inside repeater/group fields before serialization.
      // The admin panel may send full relationship objects ({id, title, slug, ...})
      // inside repeater rows — strip these down to just IDs to prevent bloated JSON.
      fields.forEach(field => {
        if (
          (field.type === "repeater" || field.type === "group") &&
          finalData[field.name] != null &&
          typeof finalData[field.name] === "object"
        ) {
          const nestedFields = field.fields || [];
          if (
            nestedFields.some(
              f =>
                isRelationshipField(f.type) ||
                f.type === "repeater" ||
                f.type === "group"
            )
          ) {
            if (
              field.type === "repeater" &&
              Array.isArray(finalData[field.name])
            ) {
              finalData[field.name] = (finalData[field.name] as unknown[]).map(
                (row: unknown) =>
                  row && typeof row === "object" && !Array.isArray(row)
                    ? normalizeNestedRelationships(
                        row as Record<string, unknown>,
                        nestedFields
                      )
                    : row
              );
            } else if (
              field.type === "group" &&
              !Array.isArray(finalData[field.name])
            ) {
              finalData[field.name] = normalizeNestedRelationships(
                finalData[field.name] as Record<string, unknown>,
                nestedFields
              );
            }
          }
        }
      });

      // Serialize JSON fields (richtext, blocks, array, group, json)
      fields.forEach(field => {
        if (
          isJsonFieldType(field.type, field) &&
          finalData[field.name] != null
        ) {
          const value = finalData[field.name];
          // Only stringify if it's an object/array and not already a string
          if (typeof value === "object") {
            finalData[field.name] = JSON.stringify(value);
          } else if (typeof value === "string") {
            // Already a string - check if it's valid JSON to avoid double-serialization
            try {
              JSON.parse(value);
              // It's already valid JSON string, keep as-is
            } catch {
              // Not valid JSON string - this is unusual for JSON fields
              console.warn(
                `[updateEntry] Field "${field.name}" (type: ${field.type}) is a string but not valid JSON`
              );
            }
          }
        }
      });

      this.serializeHasManyRelationships(finalData, fields);

      // Convert date-field strings into `Date` objects so Drizzle can bind
      // them to `timestamp` columns. See `coerceDateFieldsToDate` for the
      // failure mode this guards against.
      coerceDateFieldsToDate(finalData, fields);

      // Sanitize slug if provided in update
      // - Dynamic collections (UI-created) always have a slug column
      // - Plugin collections (isPlugin: true) only have slug if explicitly defined
      const isPluginCollection =
        (
          (collection as Record<string, unknown>).admin as
            | Record<string, unknown>
            | undefined
        )?.isPlugin === true;
      const hasSlugField = fields.some(f => f.name === "slug");
      const shouldHandleSlug = isPluginCollection ? hasSlugField : true;

      if (shouldHandleSlug && finalData.slug !== undefined) {
        if (typeof finalData.slug === "string" && finalData.slug.trim()) {
          finalData.slug = generateSlug(finalData.slug);
        } else {
          // If slug is empty/null, remove it from update to keep existing value
          delete finalData.slug;
        }
      }

      // Final safety pass: ensure upload field values are IDs, not populated objects.
      fields.forEach(field => {
        if (field.type === "upload" && finalData[field.name] != null) {
          const val = finalData[field.name];
          if (typeof val === "object" && val !== null && !Array.isArray(val)) {
            finalData[field.name] =
              "id" in val &&
              typeof (val as Record<string, unknown>).id === "string"
                ? (val as Record<string, unknown>).id
                : null;
          } else if (Array.isArray(val)) {
            finalData[field.name] = val.map((item: unknown) =>
              typeof item === "string"
                ? item
                : typeof item === "object" && item !== null && "id" in item
                  ? (item as Record<string, unknown>).id
                  : item
            );
          }
        }
      });

      // Update main entry
      // Use Date object (not .toISOString() string) because Drizzle's timestamp()
      // column without mode:'string' expects Date objects and calls .toISOString()
      // internally during serialization. Passing a string causes
      // "value.toISOString is not a function".

      // Phase 4 follow-up (post-merge): when updateEntry hits a SQLite
      // "Too few parameter values were provided" error, this debug log
      // is the only way to see what finalData looks like at the bind
      // boundary. Set DEBUG_ENTRY_UPDATE=1 to enable. Logs keys and
      // value types only (never values) so user data never leaks to
      // operator logs even with the flag on.
      // eslint-disable-next-line turbo/no-undeclared-env-vars
      if (process.env.DEBUG_ENTRY_UPDATE === "1") {
        const keyTypes = Object.fromEntries(
          Object.entries(finalData).map(([k, v]) => [
            k,
            v === null
              ? "null"
              : v === undefined
                ? "undefined"
                : Array.isArray(v)
                  ? `array(len=${v.length})`
                  : typeof v === "object"
                    ? `object(keys=${Object.keys(v).length})`
                    : typeof v,
          ])
        );
        console.log(
          "[updateEntry debug]",
          JSON.stringify({
            collectionName: params.collectionName,
            entryId: params.entryId,
            finalDataKeys: Object.keys(finalData),
            finalDataKeyTypes: keyTypes,
            schemaColumns: Object.keys(schema as unknown as object),
          })
        );
      }

      // i18n M5/M6: pull translatable values out of the main update (finalData uses camelCase field
      // keys) so they update the companion `_locales` row for the write's locale instead. `null` =
      // not localized / companion not migrated yet (values stay on main — dev path, unchanged).
      const localizedUpdate = await this.splitLocalizedWriteData(
        params.collectionName,
        finalData,
        params.locale,
        false
      );

      // Wrap main update and component data save in a transaction so that
      // a component save failure rolls back the entry update — no partial state.
      // tx.execute() is used for the UPDATE so it runs on the same DB client
      // as the transaction (unlike tx.update() which delegates to the pool).
      // Resolved versioning config persisted on the collection (or null when
      // unversioned); read once so the in-tx capture below can skip cheaply.
      const versionsConfig = (collection as Record<string, unknown>)
        .versions as ResolvedVersionsConfig | null | undefined;

      // Retry the whole content+capture transaction on a version_no allocation
      // race (concurrent updates to the same doc); the re-run re-reads the max.
      // The content UPDATE is a deterministic SET, so re-applying it is safe.
      // Committed pre-update status, refreshed each attempt: under a retry a
      // concurrent winner may have changed the status, so the D69 status event
      // below must report that as `previousStatus`, not the stale pre-tx value.
      let committedPreviousStatus: string | null | undefined;
      await withVersionConflictRetry(() =>
        this.adapter.transaction(async tx => {
          const updatePayload = {
            ...stripImmutableSystemFields(finalData),
            updatedAt: new Date(),
          };

          // Read the committed status before this attempt's UPDATE so the status
          // event uses the true prior value even after a conflict retry. Only
          // needed for versioned collections (the only ones that can retry).
          if (versionsConfig?.enabled) {
            const [preStatusRow] = await this.db
              .select()
              .from(schema)
              .where(eq(schema.id, params.entryId))
              .limit(1);
            committedPreviousStatus = (
              preStatusRow as { status?: unknown } | undefined
            )?.status as string | null | undefined;
          }

          // Dialect-aware identifier quoting and placeholder syntax.
          // PostgreSQL: "col" = $1   MySQL: `col` = ?   SQLite: "col" = $1 (convertPlaceholders handles →?)
          const isMysql = this.dialect === "mysql";
          const quoteId = (id: string) => (isMysql ? `\`${id}\`` : `"${id}"`);
          const sqlParams: unknown[] = [];
          const makePlaceholder = () =>
            this.dialect === "postgresql"
              ? `$${sqlParams.length}` // length already incremented by push below
              : "?";

          const setClauses = Object.entries(updatePayload)
            .map(([key, val]) => {
              sqlParams.push(val);
              return `${quoteId(toSnakeCase(key))} = ${makePlaceholder()}`;
            })
            .join(", ");
          sqlParams.push(params.entryId);
          await tx.execute(
            `UPDATE ${quoteId(tableName)} SET ${setClauses} WHERE ${quoteId("id")} = ${makePlaceholder()}`,
            sqlParams as (string | number | boolean | Date | null | undefined)[]
          );

          // i18n M5: upsert the translatable values into the companion row for the write's locale
          // (same transaction). Only the provided localized columns are touched.
          if (
            localizedUpdate &&
            Object.keys(localizedUpdate.companionData).length > 0
          ) {
            await this.upsertCompanionRow(
              tx,
              localizedUpdate.companionTableName,
              params.entryId,
              localizedUpdate.writeLocale,
              localizedUpdate.companionData
            );
          }

          // Clone per attempt: saveComponentDataInTransaction mutates the
          // component data in place (hashing password fields, assigning row
          // ids), so a conflict retry must start from the user's original
          // values — not a previously-hashed copy — and the snapshot below uses
          // this same post-save copy (ids populated) rather than the raw input.
          const attemptComponentData = structuredClone(componentFieldData);

          // Save component field data to separate comp_{slug} tables
          if (
            this.componentDataService &&
            Object.keys(attemptComponentData).length > 0
          ) {
            await this.componentDataService.saveComponentDataInTransaction(tx, {
              parentId: params.entryId,
              parentTable: tableName,
              fields: fields as unknown as FieldConfig[],
              data: attemptComponentData,
            });
          }

          // Replace many-to-many junction rows inside the transaction so a
          // junction failure rolls back the update (atomic write). The entry is
          // already known to exist (validated before the transaction). The
          // tx-scoped Drizzle handle binds the junction writes to this tx.
          const txExecutor = tx.getDrizzle<RelationshipDbExecutor>();
          for (const field of manyToManyFields) {
            if (manyToManyData[field.name] !== undefined) {
              await this.relationshipService.deleteManyToManyRelations(
                params.collectionName,
                params.entryId,
                field,
                txExecutor
              );
              const relatedIds = manyToManyData[field.name];
              if (relatedIds.length > 0) {
                await this.relationshipService.insertManyToManyRelations(
                  params.collectionName,
                  params.entryId,
                  field,
                  relatedIds,
                  txExecutor
                );
              }
            }
          }

          // Capture a version snapshot of the post-update document atomically
          // with the write when the collection opts into versioning. The parent
          // is re-read fresh here (not the pre-transaction `existingEntry`) so a
          // conflict retry — which re-runs this closure — picks up a concurrent
          // winner's committed columns instead of recording a stale pre-image;
          // the current row is then overlaid with this write's changed values,
          // this locale's translatable values, JSON-backed fields are parsed to
          // the read shape, and password hashes are stripped. Components and m2m
          // are completed from current state so a scalar-only edit does not drop
          // existing relations. Status prefers the new value, else the prior one.
          if (versionsConfig?.enabled) {
            const freshRows = await this.db
              .select()
              .from(schema)
              .where(eq(schema.id, params.entryId))
              .limit(1);
            const currentRow = (freshRows[0] ?? existingEntry) as Record<
              string,
              unknown
            >;
            const preImage: Record<string, unknown> = {};
            for (const [key, value] of Object.entries(currentRow)) {
              preImage[toCamelCase(key)] = value;
            }
            // Overlay `updatePayload` (not raw `finalData`): it carries the
            // `updatedAt` the write commits and has immutable system keys
            // (id/createdAt/createdBy) stripped, so the snapshot records the new
            // timestamp and cannot persist forged system values — `preImage`
            // keeps the real committed system columns.
            const companionStatus = localizedUpdate?.companionData?._status;
            const parentRow = this.deserializeJsonFieldsForSnapshot(
              {
                ...preImage,
                ...updatePayload,
                ...(localizedUpdate?.localizedFieldValues ?? {}),
              },
              fields
            );
            stripPasswordFieldValues(parentRow, fields);
            // Strip the system owner column (created_by) — see create path.
            stripSystemOwnerField(parentRow);
            const { components: snapshotComponents, manyToMany: snapshotM2M } =
              await this.buildFullSnapshotRelations(
                params.entryId,
                params.collectionName,
                tableName,
                fields,
                manyToManyFields,
                attemptComponentData,
                manyToManyData
              );
            await captureInTx(tx, this.versionCapture, {
              ref: {
                scopeKind: "collection",
                scopeSlug: params.collectionName,
                entryId: params.entryId,
              },
              // Prefer the written status; for a localized status change it is
              // moved to the companion `_status`, so fall back to that before the
              // prior main-row status.
              contentStatus:
                (updatePayload as { status?: unknown }).status ??
                companionStatus ??
                (preImage as { status?: unknown }).status,
              parts: {
                parentRow,
                components: snapshotComponents,
                manyToMany: snapshotM2M,
              },
              createdBy: params.user?.id ?? null,
            });
          }
        })
      );

      // Fetch the updated entry to return it and use in hooks
      const [updated] = await this.db
        .select()
        .from(schema)
        .where(eq(schema.id, params.entryId))
        .limit(1);

      if (!updated) {
        return {
          success: false,
          statusCode: 404,
          message: "Entry not found",
          data: null,
        };
      }

      // The localized values were split out of the main update, so the re-fetched
      // main row lacks them. Merge the written values back (camelCase keys) so
      // afterUpdate hooks, events, and the response reflect them. `_status` is a
      // companion-only column, not an entry field.
      if (localizedUpdate) {
        const updatedRow = updated as Record<string, unknown>;
        for (const [column, value] of Object.entries(
          localizedUpdate.companionData
        )) {
          if (column === "_status") continue;
          updatedRow[toCamelCase(column)] = value;
        }
      }

      // Execute afterUpdate hooks (code-registered)
      // Hooks run after database update completes (for side effects)
      const afterContext = this.hookService.buildHookContext({
        collection: params.collectionName,
        operation: "update" as const,
        data: updated,
        originalData: existingEntry,
        user: params.user,
        context: sharedContext, // Pass shared context from beforeUpdate
      });

      await this.hookService.hookRegistry.execute("afterUpdate", afterContext);

      // Execute stored afterUpdate hooks (UI-configured)
      await this.hookService.storedHookExecutor.execute(
        "afterUpdate",
        storedHooks,
        this.hookService.buildPrebuiltHookContext(
          params.collectionName,
          "update",
          updated,
          this.queryDatabaseFn,
          params.user,
          sharedContext
        )
      );

      // Post-commit reaction event (D8/D51).
      emitCollectionEvent(
        "updated",
        params.collectionName,
        updated,
        params.user
      );

      // D69 document-level status events. Status is a user-defined field;
      // emit only when a `status` field value actually changed on update.
      // `data` is shallow-snapshotted so async subscribers aren't exposed to the
      // in-place JSON-field deserialization that happens below for the response.
      // Prefer the status re-read inside the transaction (fresh across retries)
      // over the pre-transaction `existingEntry`, which a concurrent winner may
      // have superseded.
      const previousStatus =
        committedPreviousStatus ??
        ((existingEntry as Record<string, unknown>).status as
          | string
          | undefined) ??
        null;
      const nextStatus = (updated as { status?: unknown }).status;
      if (typeof nextStatus === "string" && nextStatus !== previousStatus) {
        this.transitionStatus({
          collection: params.collectionName,
          id: (updated as { id?: unknown }).id,
          data: { ...(updated as Record<string, unknown>) },
          user: params.user,
          previousStatus,
          status: nextStatus,
          emitStatusChanged: true,
        });
      }

      // Deserialize JSON fields (richtext, blocks, array, group, json) for response
      fields.forEach(field => {
        if (
          isJsonFieldType(field.type, field) &&
          updated[field.name] &&
          typeof updated[field.name] === "string"
        ) {
          try {
            updated[field.name] = JSON.parse(updated[field.name] as string);
          } catch {
            // If parsing fails, keep as string
          }
        }
      });

      // Field-level afterChange hooks observe the PERSISTED values — run
      // before response expansion so hooks see stored IDs, not the
      // populated relationship objects the response returns.
      await runFieldHooks({
        kind: "collection",
        slug: params.collectionName,
        phase: "afterChange",
        data: updated as Record<string, unknown>,
        operation: "update",
        user: params.user,
      });

      // Expand relationships in response if depth is specified
      let responseEntry = updated;
      if (depth !== undefined && depth > 0) {
        try {
          responseEntry = await this.relationshipService.expandRelationships(
            updated,
            params.collectionName,
            fields,
            { depth }
          );
        } catch (expansionError) {
          // If expansion fails, return the entry without expanded relationships
          console.warn(
            "Failed to expand relationships in updateEntry response:",
            expansionError
          );
        }
      }

      // Redact the response: drop write-only password hashes and any field
      // the caller may write but not read (parity with the query path).
      await this.redactResponseFields(
        responseEntry as Record<string, unknown>,
        fields,
        {
          user: params.user,
          overrideAccess: params.overrideAccess,
          routeAuthorized: params.routeAuthorized,
        },
        params.collectionName
      );

      return {
        success: true,
        statusCode: 200,
        message: "Entry updated successfully",
        data: responseEntry,
      };
    } catch (error: unknown) {
      // See createEntry's catch — legacy override messages are dropped in
      // favour of fromDatabaseError's spec-compliant generic strings.
      // Pass dialect explicitly so the helper can normalise raw driver errors.
      return errorToServiceResult(
        error,
        { defaultMessage: "Failed to update entry" },
        this.dialect
      );
    }
  }

  /**
   * Delete an entry.
   * Applies collection-level access control and hooks.
   *
   * Security checks are applied in order:
   * 1. Collection-level access (AccessControlService)
   *
   * @param params - Collection name, entry ID, and optional user context
   * @returns Deletion result or error
   */
  async deleteEntry(params: {
    collectionName: string;
    entryId: string;
    user?: UserContext;
    /** When true, bypass all access control checks */
    overrideAccess?: boolean;
    /** When true, the route middleware already ran the RBAC gate; stored rules
     * are still enforced. See CollectionAccessService.checkCollectionAccess. */
    routeAuthorized?: boolean;
    /** Arbitrary data passed to hooks via context */
    context?: Record<string, unknown>;
  }): Promise<CollectionServiceResult> {
    try {
      const accessUser = params.overrideAccess ? undefined : params.user;

      const schema = await this.fileManager.loadDynamicSchema(
        params.collectionName
      );

      // Fetch the entry first (needed for access control and hooks)

      const [entry] = await this.db
        .select()
        .from(schema)
        .where(eq(schema.id, params.entryId))
        .limit(1);

      if (!entry) {
        return {
          success: false,
          statusCode: 404,
          message: "Entry not found",
          data: null,
        };
      }

      // 1. Check collection-level access FIRST (with document for owner checks)
      const accessDenied = await this.accessService.checkCollectionAccess(
        params.collectionName,
        "delete",
        accessUser,
        params.entryId,
        entry,
        params.overrideAccess,
        params.routeAuthorized
      );
      if (accessDenied) {
        return accessDenied;
      }

      // Get collection metadata for stored hooks
      const collection = await this.collectionService.getCollection(
        params.collectionName
      );
      const storedHooks = this.hookService.getStoredHooks(
        collection as Record<string, unknown>
      );

      const tableName = this.resolveTableName(
        collection,
        params.collectionName
      );

      // Shared context between all hooks in this request
      const sharedContext: Record<string, unknown> = { ...params.context };

      // Execute beforeOperation hooks FIRST (before operation-specific hooks)
      // Can modify operation arguments (id) or throw to abort
      await this.hookService.hookRegistry.executeBeforeOperation({
        collection: params.collectionName,
        operation: "delete",
        args: { id: params.entryId },
        user: params.user
          ? { id: params.user.id, email: params.user.email }
          : undefined,
        context: sharedContext,
      });

      // Note: For delete, we don't use modified id since we already fetched the entry
      // and checked access. The hook can throw to abort if needed.

      // Execute beforeDelete hooks (code-registered)
      // Hooks run before deletion and can prevent deletion by throwing error
      const beforeContext = this.hookService.buildHookContext({
        collection: params.collectionName,
        operation: "delete" as const,
        data: entry,
        user: params.user,
        context: sharedContext,
      });

      await this.hookService.hookRegistry.execute(
        "beforeDelete",
        beforeContext
      );

      // Execute stored beforeDelete hooks (UI-configured)
      await this.hookService.storedHookExecutor.execute(
        "beforeDelete",
        storedHooks,
        this.hookService.buildPrebuiltHookContext(
          params.collectionName,
          "delete",
          entry,
          this.queryDatabaseFn,
          params.user,
          sharedContext
        )
      );

      // Cascade delete component data before deleting the main entry
      if (this.componentDataService) {
        const collectionFields = (collection.schemaDefinition?.fields ||
          collection.fields ||
          []) as FieldConfig[];
        await this.componentDataService.deleteComponentData({
          parentId: params.entryId,
          parentTable: tableName,
          fields: collectionFields,
        });
      }

      await this.db.delete(schema).where(eq(schema.id, params.entryId));
      // .returning();

      const deleted = entry;

      if (!deleted) {
        return {
          success: false,
          statusCode: 404,
          message: "Entry not found",
          data: null,
        };
      }

      // Execute afterDelete hooks (code-registered)
      // Hooks run after deletion completes (for cleanup)
      const afterContext = this.hookService.buildHookContext({
        collection: params.collectionName,
        operation: "delete" as const,
        data: deleted,
        user: params.user,
        context: sharedContext, // Pass shared context from beforeDelete
      });

      await this.hookService.hookRegistry.execute("afterDelete", afterContext);

      // Execute stored afterDelete hooks (UI-configured)
      await this.hookService.storedHookExecutor.execute(
        "afterDelete",
        storedHooks,
        this.hookService.buildPrebuiltHookContext(
          params.collectionName,
          "delete",
          deleted,
          this.queryDatabaseFn,
          params.user,
          sharedContext
        )
      );

      // Post-commit reaction event (D8/D51).
      emitCollectionEvent(
        "deleted",
        params.collectionName,
        deleted,
        params.user
      );

      return {
        success: true,
        statusCode: 200,
        message: "Entry deleted successfully",
        data: { deleted: true },
      };
    } catch (error: unknown) {
      return {
        success: false,
        statusCode: 500,
        message:
          error instanceof Error ? error.message : "Failed to delete entry",
        data: null,
      };
    }
  }

  // ============================================================
  // Transaction-aware methods
  // ============================================================

  /**
   * Create a new entry within an existing transaction.
   *
   * @param tx - Transaction context from adapter
   * @param params - Collection name and optional user context
   * @param body - Entry data to create
   * @returns Created entry or error
   * @throws Error if transaction operations fail
   *
   * @example
   * ```typescript
   * await adapter.transaction(async (tx) => {
   *   const entry = await entryService.createEntryInTransaction(tx, params, data);
   *   // Other operations in the same transaction...
   * });
   * ```
   */
  async createEntryInTransaction(
    tx: TransactionContext,
    params: {
      collectionName: string;
      user?: UserContext;
      overrideAccess?: boolean;
      // See createEntry: route-authorized REST responses stay redacted.
      routeAuthorized?: boolean;
    },
    body: Record<string, unknown>
  ): Promise<CollectionServiceResult<unknown>> {
    try {
      // 1. Check collection-level access FIRST
      const accessDenied = await this.accessService.checkCollectionAccess(
        params.collectionName,
        "create",
        params.user
      );
      if (accessDenied) {
        return accessDenied;
      }

      // Get collection metadata to identify relation fields and hooks
      const collection = await this.collectionService.getCollection(
        params.collectionName
      );
      const fields =
        ((
          (collection as Record<string, unknown>).schemaDefinition as
            | Record<string, unknown>
            | undefined
        )?.fields as FieldDefinition[]) ||
        ((collection as Record<string, unknown>).fields as FieldDefinition[]) ||
        [];
      const storedHooks = this.hookService.getStoredHooks(
        collection as Record<string, unknown>
      );

      const tableName = this.resolveTableName(
        collection,
        params.collectionName
      );

      // Shared context between all hooks in this request
      const sharedContext: Record<string, unknown> = {};

      // Execute beforeOperation hooks FIRST (before operation-specific hooks)
      // Can modify operation arguments or throw to abort
      const beforeOpArgs =
        await this.hookService.hookRegistry.executeBeforeOperation({
          collection: params.collectionName,
          operation: "create",
          args: { data: body },
          user: params.user
            ? { id: params.user.id, email: params.user.email }
            : undefined,
          context: sharedContext,
        });

      // Use modified data if returned by beforeOperation
      const currentData = (beforeOpArgs as BeforeOperationArgs)?.data ?? body;

      // Execute beforeCreate hooks (code-registered)
      const beforeContext = this.hookService.buildHookContext({
        collection: params.collectionName,
        operation: "create" as const,
        data: currentData,
        user: params.user,
        context: sharedContext,
      });

      const modifiedData = await this.hookService.hookRegistry.execute(
        "beforeCreate",
        beforeContext
      );
      const dataAfterCodeHooks = (modifiedData ?? currentData) as Record<
        string,
        unknown
      >;

      // Execute stored beforeCreate hooks (UI-configured)
      const storedBeforeResult =
        await this.hookService.storedHookExecutor.execute(
          "beforeCreate",
          storedHooks,
          this.hookService.buildPrebuiltHookContext(
            params.collectionName,
            "create",
            dataAfterCodeHooks,
            this.queryDatabaseFn,
            params.user,
            sharedContext
          )
        );
      const finalData = (storedBeforeResult.data ??
        dataAfterCodeHooks) as Record<string, unknown>;

      // Password fields store bcrypt hashes, never the submitted value.
      // Runs after hooks (so hooks see the plaintext they may validate
      // against) and before any serialization touches the column value.
      // Enforce the schema's declared rules on the server. Every writer
      // (admin, REST, Direct API, bulk, forms) funnels through this path,
      // so this is where required/min/max/pattern/options are guaranteed;
      // runs on the post-hook data and before hashing so password rules
      // see the plaintext length, not the hash's.

      // Generate the auto-injected `slug`/`title` before write access +
      // validation (see createEntry). The uniqueness check runs on the
      // transaction so same-title creates within one uncommitted tx still
      // dedupe — the tx sees its own pending rows.
      const isSlugTaken = async (slug: string) => {
        const existing = await tx.selectOne<Record<string, unknown>>(
          tableName,
          {
            where: this.whereEq("slug", slug),
          }
        );
        return existing != null;
      };
      await this.applyGeneratedSlugAndTitle(finalData, isSlugTaken);

      // Field-level write access: fields the caller may not create are
      // stripped (Payload parity); a system write (no user) or an
      // explicit override bypasses.
      await applyFieldWriteAccess({
        kind: "collection",
        slug: params.collectionName,
        data: finalData,
        operation: "create",
        user: params.user,
        overrideAccess: params.overrideAccess,
      });

      // Field-level beforeValidate hooks transform values ahead of the
      // validation gate (functions resolved via the field-level registry).
      await runFieldHooks({
        kind: "collection",
        slug: params.collectionName,
        phase: "beforeValidate",
        data: finalData,
        operation: "create",
        user: params.user,
      });

      // A beforeValidate hook can set `slug` after generation ran; re-sanitize
      // so the validated and stored value stays URL-safe.
      await this.reSanitizeSlug(finalData, isSlugTaken);

      {
        const validationIssues = await validateEntryData(
          finalData,
          attachFieldValidators("collection", params.collectionName, fields),
          {
            mode: "create",
            req: params.user ? { user: params.user } : {},
          }
        );
        if (validationIssues.length > 0) {
          throw NextlyError.validation({ errors: validationIssues });
        }
      }

      // Field-level beforeChange hooks transform the final stored value
      // (runs after validation, before hashing/serialization).
      await runFieldHooks({
        kind: "collection",
        slug: params.collectionName,
        phase: "beforeChange",
        data: finalData,
        operation: "create",
        user: params.user,
      });

      // A beforeChange hook runs after validation and can also set `slug`;
      // re-sanitize once more so the stored value stays URL-safe.
      await this.reSanitizeSlug(finalData, isSlugTaken);

      await hashPasswordFieldValues(finalData, fields);

      // Normalize relationship field values (extract IDs from objects with display properties)
      // This must happen before many-to-many extraction and JSON serialization
      fields.forEach(field => {
        if (isRelationshipField(field.type) && finalData[field.name] != null) {
          const isPolymorphic =
            Array.isArray(field.options?.target) ||
            Array.isArray(field.relationTo);
          const hasMany =
            field.hasMany === true ||
            field.options?.relationType === "manyToMany";

          let normalized = normalizeRelationshipValue(
            finalData[field.name],
            isPolymorphic
          );

          // Single relationships: unwrap arrays to a single value
          if (!hasMany && Array.isArray(normalized)) {
            normalized = normalized.length > 0 ? normalized[0] : null;
          }

          finalData[field.name] = normalized;
        }
      });

      // Normalize upload field values (extract IDs from populated media objects)
      normalizeUploadFields(finalData, fields);

      // Separate regular fields from many-to-many relations
      const manyToManyFields = fields.filter(
        f =>
          f.type === "relationship" &&
          // Only UI-built manyToMany routes through a junction table.
          // Code-first `hasMany: true` is stored as a JSON array on the
          // parent column (see field-column-descriptor.ts kind="json")
          // and is serialized later in the same finalData pass.
          f.options?.relationType === "manyToMany"
      );
      const manyToManyData: Record<string, string[]> = {};

      manyToManyFields.forEach(field => {
        if (finalData[field.name]) {
          manyToManyData[field.name] = Array.isArray(finalData[field.name])
            ? (finalData[field.name] as string[])
            : [finalData[field.name] as string];
          delete finalData[field.name];
        }
      });

      this.serializeHasManyRelationships(finalData, fields);

      // Convert date-field strings into `Date` objects so Drizzle can bind
      // them to `timestamp` columns. See `coerceDateFieldsToDate` for the
      // failure mode this guards against.
      coerceDateFieldsToDate(finalData, fields);

      // Prepare entry data
      const nowForTxCreate = new Date();
      const entryData = {
        id: this.collectionService.generateId(),
        // Strip client-supplied system columns (id / timestamps / created_by,
        // both snake and camel) so the generated id, stamped owner, and
        // timestamps below are authoritative — a stray `createdBy` alias can't
        // survive to overwrite the owner stamp.
        ...stripImmutableSystemFields(finalData),
        // Snake_case keys: the runtime Drizzle schema names these columns
        // created_at / updated_at / created_by, and the adapter maps by column
        // name. (The prior camelCase createdAt/updatedAt keys here were ignored
        // by Drizzle and only "worked" via the columns' DB defaults — but a
        // strict driver like better-sqlite3 rejects the whole insert once any
        // unknown key is present, so bulk create needs the real column names.)
        created_at: nowForTxCreate,
        updated_at: nowForTxCreate,
        // Stamp the row owner with the creating user's id so owner-only access
        // works zero-config. Null for system/seed creates (no user context).
        created_by: params.user?.id ?? null,
      };

      // Insert using transaction context
      const entry = await tx.insert<unknown>(tableName, entryData, {
        returning: "*",
      });

      // Handle many-to-many relationships on the caller's transaction so the
      // junction writes commit atomically with the entry.
      const txExecutor = tx.getDrizzle<RelationshipDbExecutor>();
      for (const field of manyToManyFields) {
        const relatedIds = manyToManyData[field.name];
        if (relatedIds && relatedIds.length > 0) {
          await this.relationshipService.insertManyToManyRelations(
            params.collectionName,
            (entry as Record<string, unknown>).id as string,
            field,
            relatedIds,
            txExecutor
          );
        }
      }

      // Execute afterCreate hooks (code-registered)
      const afterContext = this.hookService.buildHookContext({
        collection: params.collectionName,
        operation: "create" as const,
        data: entry,
        user: params.user,
        context: sharedContext,
      });

      await this.hookService.hookRegistry.execute("afterCreate", afterContext);

      // Execute stored afterCreate hooks (UI-configured)
      await this.hookService.storedHookExecutor.execute(
        "afterCreate",
        storedHooks,
        this.hookService.buildPrebuiltHookContext(
          params.collectionName,
          "create",
          entry,
          this.queryDatabaseFn,
          params.user,
          sharedContext
        )
      );

      // Stored password hashes are write-only; the response never carries
      // them back to the client.
      // Field-level afterChange hooks observe the saved values (before the
      // password strip so they can see the full stored row).
      await runFieldHooks({
        kind: "collection",
        slug: params.collectionName,
        phase: "afterChange",
        data: entry as Record<string, unknown>,
        operation: "create",
        user: params.user,
      });

      await this.redactResponseFields(
        entry as Record<string, unknown>,
        fields,
        {
          user: params.user,
          overrideAccess: params.overrideAccess,
          routeAuthorized: params.routeAuthorized,
        },
        params.collectionName
      );

      return {
        success: true,
        statusCode: 201,
        message: "Entry created successfully",
        data: entry,
      };
    } catch (error: unknown) {
      // Pass dialect explicitly so the helper can normalise raw driver errors.
      return errorToServiceResult(
        error,
        { defaultMessage: "Failed to create entry in transaction" },
        this.dialect
      );
    }
  }

  /**
   * Update an entry within an existing transaction.
   *
   * @param tx - Transaction context from adapter
   * @param params - Collection name, entry ID, and optional user context
   * @param body - Update data
   * @returns Updated entry or error
   * @throws Error if transaction operations fail
   */
  async updateEntryInTransaction(
    tx: TransactionContext,
    params: {
      collectionName: string;
      entryId: string;
      user?: UserContext;
      overrideAccess?: boolean;
      // See createEntry: route-authorized REST responses stay redacted.
      routeAuthorized?: boolean;
    },
    body: Record<string, unknown>
  ): Promise<CollectionServiceResult<unknown>> {
    try {
      // Get collection metadata and hooks first
      const collection = await this.collectionService.getCollection(
        params.collectionName
      );
      const fields =
        ((
          (collection as Record<string, unknown>).schemaDefinition as
            | Record<string, unknown>
            | undefined
        )?.fields as FieldDefinition[]) ||
        ((collection as Record<string, unknown>).fields as FieldDefinition[]) ||
        [];
      const storedHooks = this.hookService.getStoredHooks(
        collection as Record<string, unknown>
      );

      const tableName = this.resolveTableName(
        collection,
        params.collectionName
      );

      // Fetch existing entry first (needed for access control)
      const existingEntry = await tx.selectOne<Record<string, unknown>>(
        tableName,
        {
          where: this.whereEq("id", params.entryId),
        }
      );

      if (!existingEntry) {
        return {
          success: false,
          statusCode: 404,
          message: "Entry not found",
          data: null,
        };
      }

      // 1. Check collection-level access FIRST (with document for owner checks)
      const accessDenied = await this.accessService.checkCollectionAccess(
        params.collectionName,
        "update",
        params.user,
        params.entryId,
        existingEntry
      );
      if (accessDenied) {
        return accessDenied;
      }

      // Shared context between all hooks in this request
      const sharedContext: Record<string, unknown> = {};

      // Execute beforeOperation hooks FIRST (before operation-specific hooks)
      // Can modify operation arguments (id, data) or throw to abort
      const beforeOpArgs =
        await this.hookService.hookRegistry.executeBeforeOperation({
          collection: params.collectionName,
          operation: "update",
          args: { id: params.entryId, data: body },
          user: params.user
            ? { id: params.user.id, email: params.user.email }
            : undefined,
          context: sharedContext,
        });

      // Use modified data if returned by beforeOperation
      const currentData = (beforeOpArgs as BeforeOperationArgs)?.data ?? body;

      // Execute beforeUpdate hooks (code-registered)
      const beforeContext = this.hookService.buildHookContext({
        collection: params.collectionName,
        operation: "update" as const,
        data: currentData,
        originalData: existingEntry,
        user: params.user,
        context: sharedContext,
      });

      const modifiedData = await this.hookService.hookRegistry.execute(
        "beforeUpdate",
        beforeContext
      );
      const dataAfterCodeHooks = (modifiedData ?? currentData) as Record<
        string,
        unknown
      >;

      // Execute stored beforeUpdate hooks (UI-configured)
      const storedBeforeResult =
        await this.hookService.storedHookExecutor.execute(
          "beforeUpdate",
          storedHooks,
          this.hookService.buildPrebuiltHookContext(
            params.collectionName,
            "update",
            dataAfterCodeHooks,
            this.queryDatabaseFn,
            params.user,
            sharedContext
          )
        );
      const finalData = (storedBeforeResult.data ??
        dataAfterCodeHooks) as Record<string, unknown>;

      // Password fields store bcrypt hashes, never the submitted value.
      // Runs after hooks (so hooks see the plaintext they may validate
      // against) and before any serialization touches the column value.
      // Enforce the schema's declared rules on the server. Every writer
      // (admin, REST, Direct API, bulk, forms) funnels through this path,
      // so this is where required/min/max/pattern/options are guaranteed;
      // runs on the post-hook data and before hashing so password rules
      // see the plaintext length, not the hash's.
      // Field-level write access: fields the caller may not update are
      // stripped (Payload parity); a system write (no user) or an
      // explicit override bypasses.
      await applyFieldWriteAccess({
        kind: "collection",
        slug: params.collectionName,
        data: finalData,
        operation: "update",
        user: params.user,
        overrideAccess: params.overrideAccess,
        id: params.entryId,
      });

      // Field-level beforeValidate hooks transform values ahead of the
      // validation gate (functions resolved via the field-level registry).
      await runFieldHooks({
        kind: "collection",
        slug: params.collectionName,
        phase: "beforeValidate",
        data: finalData,
        operation: "update",
        user: params.user,
      });

      {
        const validationIssues = await validateEntryData(
          finalData,
          attachFieldValidators("collection", params.collectionName, fields),
          {
            mode: "update",
            req: params.user ? { user: params.user } : {},
          }
        );
        if (validationIssues.length > 0) {
          throw NextlyError.validation({ errors: validationIssues });
        }
      }

      // Field-level beforeChange hooks transform the final stored value
      // (runs after validation, before hashing/serialization).
      await runFieldHooks({
        kind: "collection",
        slug: params.collectionName,
        phase: "beforeChange",
        data: finalData,
        operation: "update",
        user: params.user,
      });

      await hashPasswordFieldValues(finalData, fields);

      // Normalize relationship field values (extract IDs from objects with display properties)
      // This must happen before many-to-many extraction and JSON serialization
      fields.forEach(field => {
        if (isRelationshipField(field.type) && finalData[field.name] != null) {
          const isPolymorphic =
            Array.isArray(field.options?.target) ||
            Array.isArray(field.relationTo);
          const hasMany =
            field.hasMany === true ||
            field.options?.relationType === "manyToMany";

          let normalized = normalizeRelationshipValue(
            finalData[field.name],
            isPolymorphic
          );

          // Single relationships: unwrap arrays to a single value
          if (!hasMany && Array.isArray(normalized)) {
            normalized = normalized.length > 0 ? normalized[0] : null;
          }

          finalData[field.name] = normalized;
        }
      });

      // Normalize upload field values (extract IDs from populated media objects)
      normalizeUploadFields(finalData, fields);

      // Separate many-to-many relations
      const manyToManyFields = fields.filter(
        f =>
          f.type === "relationship" &&
          // Only UI-built manyToMany routes through a junction table.
          // Code-first `hasMany: true` is stored as a JSON array on the
          // parent column (see field-column-descriptor.ts kind="json")
          // and is serialized later in the same finalData pass.
          f.options?.relationType === "manyToMany"
      );
      const manyToManyData: Record<string, string[]> = {};

      manyToManyFields.forEach(field => {
        if (finalData[field.name] !== undefined) {
          manyToManyData[field.name] = Array.isArray(finalData[field.name])
            ? (finalData[field.name] as string[])
            : finalData[field.name] === null
              ? []
              : [finalData[field.name] as string];
          delete finalData[field.name];
        }
      });

      this.serializeHasManyRelationships(finalData, fields);

      // Convert date-field strings into `Date` objects so Drizzle can bind
      // them to `timestamp` columns. See `coerceDateFieldsToDate` for the
      // failure mode this guards against.
      coerceDateFieldsToDate(finalData, fields);

      // Update using transaction context
      // IMPORTANT: Use UTC ISO string for updatedAt to ensure consistent timezone handling
      const [updated] = await tx.update<unknown>(
        tableName,
        {
          ...stripImmutableSystemFields(finalData),
          updatedAt: new Date(),
        },
        this.whereEq("id", params.entryId),
        { returning: "*" }
      );

      if (!updated) {
        return {
          success: false,
          statusCode: 404,
          message: "Entry not found",
          data: null,
        };
      }

      // Handle many-to-many relationships on the caller's transaction so the
      // junction writes commit atomically with the update.
      const txExecutor = tx.getDrizzle<RelationshipDbExecutor>();
      for (const field of manyToManyFields) {
        if (manyToManyData[field.name] !== undefined) {
          await this.relationshipService.deleteManyToManyRelations(
            params.collectionName,
            params.entryId,
            field,
            txExecutor
          );

          const relatedIds = manyToManyData[field.name];
          if (relatedIds.length > 0) {
            await this.relationshipService.insertManyToManyRelations(
              params.collectionName,
              params.entryId,
              field,
              relatedIds,
              txExecutor
            );
          }
        }
      }

      // Execute afterUpdate hooks (code-registered)
      const afterContext = this.hookService.buildHookContext({
        collection: params.collectionName,
        operation: "update" as const,
        data: updated,
        originalData: existingEntry,
        user: params.user,
        context: sharedContext,
      });

      await this.hookService.hookRegistry.execute("afterUpdate", afterContext);

      // Execute stored afterUpdate hooks (UI-configured)
      await this.hookService.storedHookExecutor.execute(
        "afterUpdate",
        storedHooks,
        this.hookService.buildPrebuiltHookContext(
          params.collectionName,
          "update",
          updated,
          this.queryDatabaseFn,
          params.user,
          sharedContext
        )
      );

      // Stored password hashes are write-only; the response never carries
      // them back to the client.
      // Field-level afterChange hooks observe the saved values (before the
      // password strip so they can see the full stored row).
      await runFieldHooks({
        kind: "collection",
        slug: params.collectionName,
        phase: "afterChange",
        data: updated as Record<string, unknown>,
        operation: "update",
        user: params.user,
      });

      await this.redactResponseFields(
        updated as Record<string, unknown>,
        fields,
        {
          user: params.user,
          overrideAccess: params.overrideAccess,
          routeAuthorized: params.routeAuthorized,
        },
        params.collectionName
      );

      return {
        success: true,
        statusCode: 200,
        message: "Entry updated successfully",
        data: updated,
      };
    } catch (error: unknown) {
      // Pass dialect explicitly so the helper can normalise raw driver errors.
      return errorToServiceResult(
        error,
        { defaultMessage: "Failed to update entry in transaction" },
        this.dialect
      );
    }
  }

  /**
   * Delete an entry within an existing transaction.
   *
   * @param tx - Transaction context from adapter
   * @param params - Collection name, entry ID, and optional user context
   * @returns Deletion result or error
   * @throws Error if transaction operations fail
   */
  async deleteEntryInTransaction(
    tx: TransactionContext,
    params: {
      collectionName: string;
      entryId: string;
      user?: UserContext;
    }
  ): Promise<CollectionServiceResult<{ deleted: boolean }>> {
    try {
      // Get collection metadata and stored hooks
      const collection = await this.collectionService.getCollection(
        params.collectionName
      );
      const storedHooks = this.hookService.getStoredHooks(
        collection as Record<string, unknown>
      );

      const tableName = this.resolveTableName(
        collection,
        params.collectionName
      );

      // Fetch entry first (needed for access control and hooks)
      const entry = await tx.selectOne<Record<string, unknown>>(tableName, {
        where: this.whereEq("id", params.entryId),
      });

      if (!entry) {
        return {
          success: false,
          statusCode: 404,
          message: "Entry not found",
          data: null,
        };
      }

      // 1. Check collection-level access FIRST (with document for owner checks)
      const accessDenied = await this.accessService.checkCollectionAccess<{
        deleted: boolean;
      }>(params.collectionName, "delete", params.user, params.entryId, entry);
      if (accessDenied) {
        return accessDenied;
      }

      // Shared context between all hooks in this request
      const sharedContext: Record<string, unknown> = {};

      // Execute beforeOperation hooks FIRST (before operation-specific hooks)
      // Can modify operation arguments (id) or throw to abort
      await this.hookService.hookRegistry.executeBeforeOperation({
        collection: params.collectionName,
        operation: "delete",
        args: { id: params.entryId },
        user: params.user
          ? { id: params.user.id, email: params.user.email }
          : undefined,
        context: sharedContext,
      });

      // Note: For delete, we don't use modified id since we already fetched the entry
      // and checked access. The hook can throw to abort if needed.

      // Execute beforeDelete hooks (code-registered)
      const beforeContext = this.hookService.buildHookContext({
        collection: params.collectionName,
        operation: "delete" as const,
        data: entry,
        user: params.user,
        context: sharedContext,
      });

      await this.hookService.hookRegistry.execute(
        "beforeDelete",
        beforeContext
      );

      // Execute stored beforeDelete hooks (UI-configured)
      await this.hookService.storedHookExecutor.execute(
        "beforeDelete",
        storedHooks,
        this.hookService.buildPrebuiltHookContext(
          params.collectionName,
          "delete",
          entry,
          this.queryDatabaseFn,
          params.user,
          sharedContext
        )
      );

      // Cascade delete component data before deleting the main entry
      if (this.componentDataService) {
        const collectionFields = (collection.schemaDefinition?.fields ||
          collection.fields ||
          []) as FieldConfig[];
        await this.componentDataService.deleteComponentDataInTransaction(tx, {
          parentId: params.entryId,
          parentTable: tableName,
          fields: collectionFields,
        });
      }

      // Delete using transaction context
      const deletedCount = await tx.delete(
        tableName,
        this.whereEq("id", params.entryId)
      );

      if (deletedCount === 0) {
        return {
          success: false,
          statusCode: 404,
          message: "Entry not found",
          data: null,
        };
      }

      // Execute afterDelete hooks (code-registered)
      const afterContext = this.hookService.buildHookContext({
        collection: params.collectionName,
        operation: "delete" as const,
        data: entry,
        user: params.user,
        context: sharedContext,
      });

      await this.hookService.hookRegistry.execute("afterDelete", afterContext);

      // Execute stored afterDelete hooks (UI-configured)
      await this.hookService.storedHookExecutor.execute(
        "afterDelete",
        storedHooks,
        this.hookService.buildPrebuiltHookContext(
          params.collectionName,
          "delete",
          entry,
          this.queryDatabaseFn,
          params.user,
          sharedContext
        )
      );

      return {
        success: true,
        statusCode: 200,
        message: "Entry deleted successfully",
        data: { deleted: true },
      };
    } catch (error: unknown) {
      return {
        success: false,
        statusCode: 500,
        message:
          error instanceof Error
            ? error.message
            : "Failed to delete entry in transaction",
        data: null,
      };
    }
  }

  // ============================================================
  // Single-entry transaction helpers (used by CollectionBulkService)
  // ============================================================

  /**
   * Internal helper to create a single entry within a transaction.
   *
   * This is a streamlined version of createEntryInTransaction that:
   * - Skips collection-level access check (done once by caller)
   * - Optionally skips hooks for performance
   * - Returns the same result format
   *
   * @param tx - Transaction context
   * @param params - Collection name and optional user context
   * @param body - Entry data to create
   * @param skipHooks - Whether to skip hook execution
   * @returns CollectionServiceResult with created entry or error
   */
  async createSingleEntryInTransaction(
    tx: TransactionContext,
    params: {
      collectionName: string;
      user?: UserContext;
      overrideAccess?: boolean;
      // See createEntry: route-authorized REST responses stay redacted.
      routeAuthorized?: boolean;
    },
    body: Record<string, unknown>,
    skipHooks: boolean
  ): Promise<CollectionServiceResult<unknown>> {
    try {
      // Get collection metadata to identify relation fields
      const collection = await this.collectionService.getCollection(
        params.collectionName
      );
      const fields =
        ((
          (collection as Record<string, unknown>).schemaDefinition as
            | Record<string, unknown>
            | undefined
        )?.fields as FieldDefinition[]) ||
        ((collection as Record<string, unknown>).fields as FieldDefinition[]) ||
        [];
      const storedHooks = this.hookService.getStoredHooks(
        collection as Record<string, unknown>
      );

      const tableName = this.resolveTableName(
        collection,
        params.collectionName
      );

      let currentData: Record<string, unknown> = { ...body };

      // Shared context between all hooks in this request
      const sharedContext: Record<string, unknown> = {};

      // Execute hooks (unless skipped)
      if (!skipHooks) {
        // Execute beforeOperation hooks FIRST (before operation-specific hooks)
        // Can modify operation arguments or throw to abort
        const beforeOpArgs =
          await this.hookService.hookRegistry.executeBeforeOperation({
            collection: params.collectionName,
            operation: "create",
            args: { data: body },
            user: params.user
              ? { id: params.user.id, email: params.user.email }
              : undefined,
            context: sharedContext,
          });

        // Use modified data if returned by beforeOperation
        currentData =
          ((beforeOpArgs as BeforeOperationArgs)?.data as Record<
            string,
            unknown
          >) ?? body;

        // Execute beforeCreate hooks (code-registered)
        const beforeContext = this.hookService.buildHookContext({
          collection: params.collectionName,
          operation: "create" as const,
          data: currentData,
          user: params.user,
          context: sharedContext,
        });

        const modifiedData = await this.hookService.hookRegistry.execute(
          "beforeCreate",
          beforeContext
        );
        currentData = modifiedData ?? currentData;

        // Execute stored beforeCreate hooks (UI-configured)
        const storedBeforeResult =
          await this.hookService.storedHookExecutor.execute(
            "beforeCreate",
            storedHooks,
            this.hookService.buildPrebuiltHookContext(
              params.collectionName,
              "create",
              currentData,
              this.queryDatabaseFn,
              params.user,
              sharedContext
            )
          );
        currentData = (storedBeforeResult.data ?? currentData) as Record<
          string,
          unknown
        >;
      }

      const finalData = currentData;

      // Password fields store bcrypt hashes, never the submitted value —
      // same guarantee as the non-transaction paths.
      // Enforce the schema's declared rules on the server. Every writer
      // (admin, REST, Direct API, bulk, forms) funnels through this path,
      // so this is where required/min/max/pattern/options are guaranteed;
      // runs on the post-hook data and before hashing so password rules
      // see the plaintext length, not the hash's.

      // Generate the auto-injected `slug`/`title` before write access +
      // validation (see createEntry). This path backs bulk create, so an
      // entry that omits slug/title must still receive them. The uniqueness
      // check runs on the transaction so entries created earlier in the same
      // bulk batch are seen.
      const isSlugTaken = async (slug: string) => {
        const existing = await tx.selectOne<Record<string, unknown>>(
          tableName,
          {
            where: this.whereEq("slug", slug),
          }
        );
        return existing != null;
      };
      await this.applyGeneratedSlugAndTitle(finalData, isSlugTaken);

      // Field-level write access: fields the caller may not create are
      // stripped (Payload parity); a system write (no user) or an
      // explicit override bypasses.
      await applyFieldWriteAccess({
        kind: "collection",
        slug: params.collectionName,
        data: finalData,
        operation: "create",
        user: params.user,
        overrideAccess: params.overrideAccess,
      });

      // Field-level beforeValidate hooks transform values ahead of the
      // validation gate (functions resolved via the field-level registry). A
      // hook can set `slug`, so re-sanitize after it so the validated and
      // stored value stays URL-safe. When hooks are skipped the slug is still
      // the (already-sanitized) generated value, so no pass is needed.
      if (!skipHooks) {
        await runFieldHooks({
          kind: "collection",
          slug: params.collectionName,
          phase: "beforeValidate",
          data: finalData,
          operation: "create",
          user: params.user,
        });
        await this.reSanitizeSlug(finalData, isSlugTaken);
      }

      {
        const validationIssues = await validateEntryData(
          finalData,
          attachFieldValidators("collection", params.collectionName, fields),
          {
            mode: "create",
            req: params.user ? { user: params.user } : {},
          }
        );
        if (validationIssues.length > 0) {
          throw NextlyError.validation({ errors: validationIssues });
        }
      }

      // Field-level beforeChange hooks transform the final stored value
      // (runs after validation, before hashing/serialization). This hook can
      // also set `slug`, so re-sanitize once more before storage.
      if (!skipHooks) {
        await runFieldHooks({
          kind: "collection",
          slug: params.collectionName,
          phase: "beforeChange",
          data: finalData,
          operation: "create",
          user: params.user,
        });
        await this.reSanitizeSlug(finalData, isSlugTaken);
      }

      await hashPasswordFieldValues(finalData, fields);

      // Normalize relationship field values (extract IDs from objects with display properties)
      // This must happen before many-to-many extraction and JSON serialization
      fields.forEach(field => {
        if (isRelationshipField(field.type) && finalData[field.name] != null) {
          const isPolymorphic =
            Array.isArray(field.options?.target) ||
            Array.isArray(field.relationTo);
          const hasMany =
            field.hasMany === true ||
            field.options?.relationType === "manyToMany";

          let normalized = normalizeRelationshipValue(
            finalData[field.name],
            isPolymorphic
          );

          // Single relationships: unwrap arrays to a single value
          if (!hasMany && Array.isArray(normalized)) {
            normalized = normalized.length > 0 ? normalized[0] : null;
          }

          finalData[field.name] = normalized;
        }
      });

      // Normalize upload field values (extract IDs from populated media objects)
      normalizeUploadFields(finalData, fields);

      // Separate regular fields from many-to-many relations
      const manyToManyFields = fields.filter(
        f =>
          f.type === "relationship" &&
          // Only UI-built manyToMany routes through a junction table.
          // Code-first `hasMany: true` is stored as a JSON array on the
          // parent column (see field-column-descriptor.ts kind="json")
          // and is serialized later in the same finalData pass.
          f.options?.relationType === "manyToMany"
      );
      const manyToManyData: Record<string, string[]> = {};

      manyToManyFields.forEach(field => {
        if (finalData[field.name]) {
          manyToManyData[field.name] = Array.isArray(finalData[field.name])
            ? (finalData[field.name] as string[])
            : [finalData[field.name] as string];
          delete finalData[field.name];
        }
      });

      this.serializeHasManyRelationships(finalData, fields);

      // Convert date-field strings into `Date` objects so Drizzle can bind
      // them to `timestamp` columns. See `coerceDateFieldsToDate` for the
      // failure mode this guards against.
      coerceDateFieldsToDate(finalData, fields);

      // Prepare entry data
      const nowForTxCreate = new Date();
      const entryData = {
        id: this.collectionService.generateId(),
        // Strip client-supplied system columns (id / timestamps / created_by,
        // both snake and camel) so the generated id, stamped owner, and
        // timestamps below are authoritative — a stray `createdBy` alias can't
        // survive to overwrite the owner stamp.
        ...stripImmutableSystemFields(finalData),
        // Snake_case keys: the runtime Drizzle schema names these columns
        // created_at / updated_at / created_by, and the adapter maps by column
        // name. (The prior camelCase createdAt/updatedAt keys here were ignored
        // by Drizzle and only "worked" via the columns' DB defaults — but a
        // strict driver like better-sqlite3 rejects the whole insert once any
        // unknown key is present, so bulk create needs the real column names.)
        created_at: nowForTxCreate,
        updated_at: nowForTxCreate,
        // Stamp the row owner with the creating user's id so owner-only access
        // works zero-config. Null for system/seed creates (no user context).
        created_by: params.user?.id ?? null,
      };

      // Insert using transaction context
      const entry = await tx.insert<unknown>(tableName, entryData, {
        returning: "*",
      });

      // Handle many-to-many relationships on the caller's transaction so the
      // junction writes commit atomically with the entry.
      const txExecutor = tx.getDrizzle<RelationshipDbExecutor>();
      for (const field of manyToManyFields) {
        const relatedIds = manyToManyData[field.name];
        if (relatedIds && relatedIds.length > 0) {
          await this.relationshipService.insertManyToManyRelations(
            params.collectionName,
            (entry as Record<string, unknown>).id as string,
            field,
            relatedIds,
            txExecutor
          );
        }
      }

      // Execute afterCreate hooks (unless skipped)
      if (!skipHooks) {
        // Execute afterCreate hooks (code-registered)
        const afterContext = this.hookService.buildHookContext({
          collection: params.collectionName,
          operation: "create" as const,
          data: entry,
          user: params.user,
          context: sharedContext,
        });

        await this.hookService.hookRegistry.execute(
          "afterCreate",
          afterContext
        );

        // Execute stored afterCreate hooks (UI-configured)
        await this.hookService.storedHookExecutor.execute(
          "afterCreate",
          storedHooks,
          this.hookService.buildPrebuiltHookContext(
            params.collectionName,
            "create",
            entry,
            this.queryDatabaseFn,
            params.user,
            sharedContext
          )
        );
      }

      // Stored password hashes are write-only; the response never carries
      // them back to the client.
      // Field-level afterChange hooks observe the saved values (before the
      // password strip so they can see the full stored row).
      if (!skipHooks) {
        await runFieldHooks({
          kind: "collection",
          slug: params.collectionName,
          phase: "afterChange",
          data: entry as Record<string, unknown>,
          operation: "create",
          user: params.user,
        });
      }

      await this.redactResponseFields(
        entry as Record<string, unknown>,
        fields,
        {
          user: params.user,
          overrideAccess: params.overrideAccess,
          routeAuthorized: params.routeAuthorized,
        },
        params.collectionName
      );

      return {
        success: true,
        statusCode: 201,
        message: "Entry created successfully",
        data: entry,
      };
    } catch (error: unknown) {
      // Pass dialect explicitly so the helper can normalise raw driver errors.
      return errorToServiceResult(
        error,
        { defaultMessage: "Failed to create entry" },
        this.dialect
      );
    }
  }

  /**
   * Internal helper to update a single entry within a transaction.
   *
   * This is a streamlined version of updateEntryInTransaction that:
   * - Skips collection-level access check (done once by caller)
   * - Optionally skips hooks for performance
   * - Returns the same result format
   *
   * @param tx - Transaction context
   * @param params - Collection name and optional user context
   * @param entryId - ID of the entry to update
   * @param body - Partial data to update
   * @param skipHooks - Whether to skip hook execution
   * @returns CollectionServiceResult with updated entry or error
   */
  async updateSingleEntryInTransaction(
    tx: TransactionContext,
    params: {
      collectionName: string;
      user?: UserContext;
      overrideAccess?: boolean;
      // See createEntry: route-authorized REST responses stay redacted.
      routeAuthorized?: boolean;
    },
    entryId: string,
    body: Record<string, unknown>,
    skipHooks: boolean
  ): Promise<CollectionServiceResult<unknown>> {
    try {
      // Get collection metadata to identify relation fields
      const collection = await this.collectionService.getCollection(
        params.collectionName
      );
      const fields =
        ((
          (collection as Record<string, unknown>).schemaDefinition as
            | Record<string, unknown>
            | undefined
        )?.fields as FieldDefinition[]) ||
        ((collection as Record<string, unknown>).fields as FieldDefinition[]) ||
        [];
      const storedHooks = this.hookService.getStoredHooks(
        collection as Record<string, unknown>
      );

      const tableName = this.resolveTableName(
        collection,
        params.collectionName
      );

      // When update access is `owner-only`, fold the ownership
      // predicate into the SQL WHERE clause of the initial fetch. A
      // non-owner sees a 404, never gets the row back, and the
      // post-fetch check below stays as a defense-in-depth guard for
      // any future caller that might mutate the fetch logic.
      const ownerConstraint = await this.accessService.getOwnerConstraint(
        params.collectionName,
        "update",
        params.user,
        // A trusted override must not have an owner predicate forced onto its
        // fetch, or it would 404 rows it is entitled to update.
        params.overrideAccess
      );
      const fetchWhere = ownerConstraint
        ? this.whereAnd({
            id: entryId,
            [ownerConstraint.field]: ownerConstraint.value,
          })
        : this.whereEq("id", entryId);

      // Fetch existing entry first (needed for owner checks and hooks)
      const existingEntry = await tx.selectOne<Record<string, unknown>>(
        tableName,
        { where: fetchWhere }
      );

      if (!existingEntry) {
        return {
          success: false,
          statusCode: 404,
          message: `Entry not found: ${entryId}`,
          data: null,
        };
      }

      // Defense-in-depth: the WHERE-clause filter above is the
      // load-bearing check. This explicit comparison is a safety net
      // that fires only if a future refactor accidentally weakens the
      // fetch query — at which point we'd rather return 403 than
      // silently let a non-owner through.
      const accessRules = this.accessService.getAccessRules(
        collection as Record<string, unknown>
      );

      if (
        accessRules?.update?.type === "owner-only" &&
        params.user &&
        // A trusted override (overrideAccess) and super-admins both bypass
        // stored rules on every transport, including the batch transaction
        // path — mirror the SQL owner-predicate bypass so this safety net does
        // not re-impose owner-only on them.
        !params.overrideAccess &&
        !this.accessService.isSuperAdmin(params.user)
      ) {
        // Default to the auto-stamped system owner column (snake_case, matching
        // the runtime schema and raw rows) so zero-config owner-only works.
        const ownerField = accessRules.update.ownerField ?? "created_by";
        const ownerId = existingEntry[ownerField];
        if (ownerId !== params.user.id) {
          return {
            success: false,
            statusCode: 403,
            message: "You can only update your own entries",
            data: null,
          };
        }
      }

      let currentData: Record<string, unknown> = { ...body };

      // Shared context between all hooks in this request
      const sharedContext: Record<string, unknown> = {};

      // Execute hooks (unless skipped)
      if (!skipHooks) {
        // Execute beforeOperation hooks FIRST (before operation-specific hooks)
        // Can modify operation arguments (id, data) or throw to abort
        const beforeOpArgs =
          await this.hookService.hookRegistry.executeBeforeOperation({
            collection: params.collectionName,
            operation: "update",
            args: { id: entryId, data: body },
            user: params.user
              ? { id: params.user.id, email: params.user.email }
              : undefined,
            context: sharedContext,
          });

        // Use modified data if returned by beforeOperation
        currentData =
          ((beforeOpArgs as BeforeOperationArgs)?.data as Record<
            string,
            unknown
          >) ?? body;

        // Execute beforeUpdate hooks (code-registered)
        const beforeContext = this.hookService.buildHookContext({
          collection: params.collectionName,
          operation: "update" as const,
          data: currentData,
          originalData: existingEntry,
          user: params.user,
          context: sharedContext,
        });

        const modifiedData = await this.hookService.hookRegistry.execute(
          "beforeUpdate",
          beforeContext
        );
        currentData = modifiedData ?? currentData;

        // Execute stored beforeUpdate hooks (UI-configured)
        const storedBeforeResult =
          await this.hookService.storedHookExecutor.execute(
            "beforeUpdate",
            storedHooks,
            this.hookService.buildPrebuiltHookContext(
              params.collectionName,
              "update",
              currentData,
              this.queryDatabaseFn,
              params.user,
              sharedContext
            )
          );
        currentData = (storedBeforeResult.data ?? currentData) as Record<
          string,
          unknown
        >;
      }

      const finalData = currentData;

      // Password fields store bcrypt hashes, never the submitted value —
      // same guarantee as the non-transaction paths.
      // Enforce the schema's declared rules on the server. Every writer
      // (admin, REST, Direct API, bulk, forms) funnels through this path,
      // so this is where required/min/max/pattern/options are guaranteed;
      // runs on the post-hook data and before hashing so password rules
      // see the plaintext length, not the hash's.
      // Field-level write access: fields the caller may not update are
      // stripped (Payload parity); a system write (no user) or an
      // explicit override bypasses.
      await applyFieldWriteAccess({
        kind: "collection",
        slug: params.collectionName,
        data: finalData,
        operation: "update",
        user: params.user,
        overrideAccess: params.overrideAccess,
        id: entryId,
      });

      // Field-level beforeValidate hooks transform values ahead of the
      // validation gate (functions resolved via the field-level registry).
      if (!skipHooks) {
        await runFieldHooks({
          kind: "collection",
          slug: params.collectionName,
          phase: "beforeValidate",
          data: finalData,
          operation: "update",
          user: params.user,
        });
      }

      {
        const validationIssues = await validateEntryData(
          finalData,
          attachFieldValidators("collection", params.collectionName, fields),
          {
            mode: "update",
            req: params.user ? { user: params.user } : {},
          }
        );
        if (validationIssues.length > 0) {
          throw NextlyError.validation({ errors: validationIssues });
        }
      }

      // Field-level beforeChange hooks transform the final stored value
      // (runs after validation, before hashing/serialization).
      if (!skipHooks) {
        await runFieldHooks({
          kind: "collection",
          slug: params.collectionName,
          phase: "beforeChange",
          data: finalData,
          operation: "update",
          user: params.user,
        });
      }

      await hashPasswordFieldValues(finalData, fields);

      // Normalize relationship field values (extract IDs from objects with display properties)
      // This must happen before many-to-many extraction and JSON serialization
      fields.forEach(field => {
        if (isRelationshipField(field.type) && finalData[field.name] != null) {
          const isPolymorphic =
            Array.isArray(field.options?.target) ||
            Array.isArray(field.relationTo);
          const hasMany =
            field.hasMany === true ||
            field.options?.relationType === "manyToMany";

          let normalized = normalizeRelationshipValue(
            finalData[field.name],
            isPolymorphic
          );

          // Single relationships: unwrap arrays to a single value
          if (!hasMany && Array.isArray(normalized)) {
            normalized = normalized.length > 0 ? normalized[0] : null;
          }

          finalData[field.name] = normalized;
        }
      });

      // Normalize upload field values (extract IDs from populated media objects)
      normalizeUploadFields(finalData, fields);

      // Separate regular fields from many-to-many relations
      const manyToManyFields = fields.filter(
        f =>
          f.type === "relationship" &&
          // Only UI-built manyToMany routes through a junction table.
          // Code-first `hasMany: true` is stored as a JSON array on the
          // parent column (see field-column-descriptor.ts kind="json")
          // and is serialized later in the same finalData pass.
          f.options?.relationType === "manyToMany"
      );
      const manyToManyData: Record<string, string[]> = {};

      manyToManyFields.forEach(field => {
        if (finalData[field.name] !== undefined) {
          manyToManyData[field.name] = Array.isArray(finalData[field.name])
            ? (finalData[field.name] as string[])
            : finalData[field.name] === null
              ? []
              : [finalData[field.name] as string];
          delete finalData[field.name];
        }
      });

      this.serializeHasManyRelationships(finalData, fields);

      // Convert date-field strings into `Date` objects so Drizzle can bind
      // them to `timestamp` columns. See `coerceDateFieldsToDate` for the
      // failure mode this guards against.
      coerceDateFieldsToDate(finalData, fields);

      // Update using transaction context
      // IMPORTANT: Use UTC ISO string for updatedAt to ensure consistent timezone handling
      const [updated] = await tx.update<unknown>(
        tableName,
        {
          ...stripImmutableSystemFields(finalData),
          updatedAt: new Date(),
        },
        this.whereEq("id", entryId),
        { returning: "*" }
      );

      if (!updated) {
        return {
          success: false,
          statusCode: 404,
          message: `Entry not found: ${entryId}`,
          data: null,
        };
      }

      // Handle many-to-many relationships on the caller's transaction so the
      // junction writes commit atomically with the update.
      const txExecutor = tx.getDrizzle<RelationshipDbExecutor>();
      for (const field of manyToManyFields) {
        if (manyToManyData[field.name] !== undefined) {
          // Delete existing relations
          await this.relationshipService.deleteManyToManyRelations(
            params.collectionName,
            entryId,
            field,
            txExecutor
          );

          // Insert new relations
          const relatedIds = manyToManyData[field.name];
          if (relatedIds.length > 0) {
            await this.relationshipService.insertManyToManyRelations(
              params.collectionName,
              entryId,
              field,
              relatedIds,
              txExecutor
            );
          }
        }
      }

      // Execute afterUpdate hooks (unless skipped)
      if (!skipHooks) {
        // Execute afterUpdate hooks (code-registered)
        const afterContext = this.hookService.buildHookContext({
          collection: params.collectionName,
          operation: "update" as const,
          data: updated,
          originalData: existingEntry,
          user: params.user,
          context: sharedContext,
        });

        await this.hookService.hookRegistry.execute(
          "afterUpdate",
          afterContext
        );

        // Execute stored afterUpdate hooks (UI-configured)
        await this.hookService.storedHookExecutor.execute(
          "afterUpdate",
          storedHooks,
          this.hookService.buildPrebuiltHookContext(
            params.collectionName,
            "update",
            updated,
            this.queryDatabaseFn,
            params.user,
            sharedContext
          )
        );
      }

      // Stored password hashes are write-only; the response never carries
      // them back to the client.
      // Field-level afterChange hooks observe the saved values (before the
      // password strip so they can see the full stored row).
      if (!skipHooks) {
        await runFieldHooks({
          kind: "collection",
          slug: params.collectionName,
          phase: "afterChange",
          data: updated as Record<string, unknown>,
          operation: "update",
          user: params.user,
        });
      }

      await this.redactResponseFields(
        updated as Record<string, unknown>,
        fields,
        {
          user: params.user,
          overrideAccess: params.overrideAccess,
          routeAuthorized: params.routeAuthorized,
        },
        params.collectionName
      );

      return {
        success: true,
        statusCode: 200,
        message: "Entry updated successfully",
        data: updated,
      };
    } catch (error: unknown) {
      // Pass dialect explicitly so the helper can normalise raw driver errors.
      return errorToServiceResult(
        error,
        { defaultMessage: "Failed to update entry" },
        this.dialect
      );
    }
  }

  /**
   * Internal helper to delete a single entry within a transaction.
   *
   * This is a streamlined version of deleteEntryInTransaction that:
   * - Skips collection-level access check (done once by caller)
   * - Optionally skips hooks for performance
   * - Returns the same result format
   *
   * @param tx - Transaction context
   * @param params - Collection name and optional user context
   * @param entryId - ID of the entry to delete
   * @param skipHooks - Whether to skip hook execution
   * @returns CollectionServiceResult with deletion status
   */
  async deleteSingleEntryInTransaction(
    tx: TransactionContext,
    params: {
      collectionName: string;
      user?: UserContext;
      overrideAccess?: boolean;
    },
    entryId: string,
    skipHooks: boolean
  ): Promise<CollectionServiceResult<{ deleted: boolean }>> {
    try {
      // Get collection metadata early
      const collection = await this.collectionService.getCollection(
        params.collectionName
      );

      const tableName = this.resolveTableName(
        collection,
        params.collectionName
      );

      // When delete access is `owner-only`, fold the ownership
      // predicate into the SQL WHERE clause of the initial fetch.
      // The post-fetch check below remains as a defense-in-depth
      // guard.
      const ownerConstraint = await this.accessService.getOwnerConstraint(
        params.collectionName,
        "delete",
        params.user,
        // A trusted override must not have an owner predicate forced onto its
        // fetch, or it would 404 rows it is entitled to delete.
        params.overrideAccess
      );
      const fetchWhere = ownerConstraint
        ? this.whereAnd({
            id: entryId,
            [ownerConstraint.field]: ownerConstraint.value,
          })
        : this.whereEq("id", entryId);

      // Fetch entry first (needed for owner checks and hooks)
      const entry = await tx.selectOne<Record<string, unknown>>(tableName, {
        where: fetchWhere,
      });

      if (!entry) {
        return {
          success: false,
          statusCode: 404,
          message: `Entry not found: ${entryId}`,
          data: null,
        };
      }

      // See updateSingleEntryInTransaction for the rationale:
      // WHERE-clause filter is load-bearing, this comparison is the
      // safety net.
      const accessRules = this.accessService.getAccessRules(
        collection as Record<string, unknown>
      );
      const storedHooks = this.hookService.getStoredHooks(
        collection as Record<string, unknown>
      );

      if (
        accessRules?.delete?.type === "owner-only" &&
        params.user &&
        // A trusted override (overrideAccess) and super-admins both bypass
        // stored rules on every transport, including the batch transaction
        // path — mirror the SQL owner-predicate bypass so this safety net does
        // not re-impose owner-only on them.
        !params.overrideAccess &&
        !this.accessService.isSuperAdmin(params.user)
      ) {
        // Default to the auto-stamped system owner column (snake_case, matching
        // the runtime schema and raw rows) so zero-config owner-only works.
        const ownerField = accessRules.delete.ownerField ?? "created_by";
        const ownerId = entry[ownerField];
        if (ownerId !== params.user.id) {
          return {
            success: false,
            statusCode: 403,
            message: "You can only delete your own entries",
            data: null,
          };
        }
      }

      // Shared context between all hooks in this request
      const sharedContext: Record<string, unknown> = {};

      // Execute hooks (unless skipped)
      if (!skipHooks) {
        // Execute beforeOperation hooks FIRST (before operation-specific hooks)
        // Can modify operation arguments (id) or throw to abort
        await this.hookService.hookRegistry.executeBeforeOperation({
          collection: params.collectionName,
          operation: "delete",
          args: { id: entryId },
          user: params.user
            ? { id: params.user.id, email: params.user.email }
            : undefined,
          context: sharedContext,
        });

        // Note: For delete, we don't use modified id since we already fetched the entry
        // and checked access. The hook can throw to abort if needed.

        // Execute beforeDelete hooks (code-registered)
        const beforeContext = this.hookService.buildHookContext({
          collection: params.collectionName,
          operation: "delete" as const,
          data: entry,
          user: params.user,
          context: sharedContext,
        });

        await this.hookService.hookRegistry.execute(
          "beforeDelete",
          beforeContext
        );

        // Execute stored beforeDelete hooks (UI-configured)
        await this.hookService.storedHookExecutor.execute(
          "beforeDelete",
          storedHooks,
          this.hookService.buildPrebuiltHookContext(
            params.collectionName,
            "delete",
            entry,
            this.queryDatabaseFn,
            params.user,
            sharedContext
          )
        );
      }

      // Cascade delete component data before deleting the main entry
      if (this.componentDataService) {
        const collectionFields = (collection.schemaDefinition?.fields ||
          collection.fields ||
          []) as FieldConfig[];
        await this.componentDataService.deleteComponentDataInTransaction(tx, {
          parentId: entryId,
          parentTable: tableName,
          fields: collectionFields,
        });
      }

      // Delete using transaction context
      const deletedCount = await tx.delete(
        tableName,
        this.whereEq("id", entryId)
      );

      if (deletedCount === 0) {
        return {
          success: false,
          statusCode: 404,
          message: `Entry not found: ${entryId}`,
          data: null,
        };
      }

      // Execute afterDelete hooks (unless skipped)
      if (!skipHooks) {
        // Execute afterDelete hooks (code-registered)
        const afterContext = this.hookService.buildHookContext({
          collection: params.collectionName,
          operation: "delete" as const,
          data: entry,
          user: params.user,
          context: sharedContext,
        });

        await this.hookService.hookRegistry.execute(
          "afterDelete",
          afterContext
        );

        // Execute stored afterDelete hooks (UI-configured)
        await this.hookService.storedHookExecutor.execute(
          "afterDelete",
          storedHooks,
          this.hookService.buildPrebuiltHookContext(
            params.collectionName,
            "delete",
            entry,
            this.queryDatabaseFn,
            params.user,
            sharedContext
          )
        );
      }

      return {
        success: true,
        statusCode: 200,
        message: "Entry deleted successfully",
        data: { deleted: true },
      };
    } catch (error: unknown) {
      return {
        success: false,
        statusCode: 500,
        message:
          error instanceof Error ? error.message : "Failed to delete entry",
        data: null,
      };
    }
  }
}
