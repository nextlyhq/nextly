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

import type { AuthenticatedScope } from "../../../auth/authenticated-scope";
import { actorForWrite, type RequestActor } from "../../../auth/request-actor";
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
import {
  resolvePublishTransition,
  stripUndefinedStatus,
} from "../../../lib/status-transition";
import type { ResolvedVersionsConfig } from "../../../schemas/versions/types";
import type { CollectionAccessRules } from "../../../services/access";
import type { CollectionFileManager } from "../../../services/collection-file-manager";
import type {
  CollectionRelationshipService,
  RelationshipDbExecutor,
} from "../../../services/collections/collection-relationship-service";
import type { ComponentDataService } from "../../../services/components/component-data-service";
import type { Logger } from "../../../services/shared";
import { BaseService } from "../../../shared/base-service";
import { convertTimestampsToCamelCase } from "../../../shared/lib/case-conversion";
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
import { populateCompanionFields } from "../../i18n/companion-join";
import type { SanitizedLocalizationConfig } from "../../i18n/config/types";
import { COMPANION_DEFAULT_STATUS } from "../../i18n/migration/generate-up";
import {
  isValidLocale,
  resolveRequestedLocale,
} from "../../i18n/resolve-locale";
import { assembleDocument } from "../../versions/assemble-document";
import { captureInTx } from "../../versions/capture-in-tx";
import {
  resolveComponentFieldMap,
  tagComponentTypes,
  tagNestedComponentTypes,
} from "../../versions/tag-component-types";
import { VersionCaptureService } from "../../versions/version-capture-service";
import { withVersionConflictRetry } from "../../versions/version-conflict";
import { expandComponentFields } from "../../webhooks/expand-component-fields";
import { recordMutationEvent } from "../../webhooks/record-mutation-event";
import type { SensitiveFieldSource } from "../../webhooks/sensitive-fields";

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

/**
 * Aborts (rolls back) a write transaction when a publish/unpublish transition is
 * refused against the row-locked status. Extends {@link NextlyError} for the same
 * reason {@link VersionConflictError} does — a bare `Error` is disallowed in this
 * package — and is always caught inside the method (the 403 to return is read
 * from an out-of-band variable, since the adapter wraps this on the way out), so
 * it never reaches the API boundary.
 */
class StatusTransitionDeniedError extends NextlyError {
  constructor() {
    super({
      code: "FORBIDDEN",
      publicMessage:
        "You do not have permission to change the published state.",
      logMessage: "Publish transition denied against the row-locked status",
    });
    this.name = "StatusTransitionDeniedError";
  }
}

/**
 * A caller's publish/unpublish authorization for a collection, resolved ONCE on
 * the pooled connection BEFORE a write transaction opens. Each field holds the
 * 403 result to return if that op is attempted, or `null` when the op is allowed
 * (or the collection has no lifecycle / the write is trusted).
 *
 * The transaction/batch write paths consult this under the row lock instead of
 * reading permission storage inside the transaction: the permission a write can
 * require is fully determined by the FINAL status it persists (only `"published"`
 * can publish; any other explicit value can only unpublish a published row), so
 * resolving both ops up front lets the in-transaction step classify the
 * transition against the row-locked status and look up the answer with no DB read
 * — closing both the TOCTOU window and the pooled-read-inside-a-transaction stall.
 */
export interface TransitionAuthorization {
  publishDenied: CollectionServiceResult | null;
  unpublishDenied: CollectionServiceResult | null;
  /**
   * Pre-fetched inputs for the document-dependent (owner-only) publish/unpublish
   * check, or `null` when none applies. The permission fields above cannot judge
   * an owner-only rule up front because it needs the specific row (which is only
   * known under the lock); this carries the rules + user so the in-transaction
   * step can evaluate the owner against the row-locked document with no metadata
   * or permission read. `null` for a trusted write, a super-admin session, or a
   * collection without an owner-only transition rule — in which case the
   * transaction path skips the document check entirely.
   */
  documentRule: {
    accessRules: CollectionAccessRules;
    user: UserContext | undefined;
  } | null;
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
   *
   * `locale` is set only for a per-locale (companion `_status`) transition on a
   * localized collection; when present it rides on every emitted payload so a
   * subscriber can tell a single-language transition apart from a document-wide
   * one (a document-wide publish carries no `locale`).
   */
  /**
   * The collection's field tree with component references expanded.
   *
   * A component reference names its target by slug and carries no inline
   * children, so without this the secret/hidden walk never sees fields declared
   * inside a component and their values would ship in the event payload.
   */
  private async webhookFieldTree(
    fields: readonly SensitiveFieldSource[],
    // Executor to resolve component schemas on. When called inside an open
    // transaction, pass `tx.getDrizzle()`: resolving on the default pooled
    // connection would take a second connection while the tx holds one and can
    // starve a small pool. Omit it (the default) when no transaction is open.
    executor?: unknown
  ): Promise<SensitiveFieldSource[]> {
    const dataService = this.componentDataService;
    return expandComponentFields(fields, async slug =>
      dataService ? await dataService.getComponentFields(slug, executor) : null
    );
  }

  /**
   * Assemble a removed entry as the read shape the create/update events carry —
   * JSON container fields parsed, component subtrees and many-to-many id arrays
   * populated, password and system-owner fields stripped — so a delete event
   * reports the document in a shape consistent with every other event. Reads the
   * relations on the delete transaction, so the caller MUST build this BEFORE the
   * cascade delete removes them.
   */
  private async buildDeletedDocument(
    tx: TransactionContext,
    args: {
      collectionName: string;
      entryId: string;
      tableName: string;
      row: Record<string, unknown>;
      fields: FieldDefinition[];
      /**
       * Locale whose companion translations to merge into the snapshot. For a
       * migrated localized collection the main row holds no translatable values,
       * so without this the payload omits every localized field.
       */
      locale?: string;
    }
    // Returns the assembled document plus the locale that actually applied — set
    // only when the collection is localized — so the caller tags `resource.locale`
    // with the same locale the payload represents (and omits it otherwise).
  ): Promise<{ document: Record<string, unknown>; locale?: string }> {
    const { collectionName, entryId, tableName, row, fields, locale } = args;
    const manyToManyFields = fields.filter(
      f => f.type === "relationship" && f.options?.relationType === "manyToMany"
    );

    // Overlay the locale's translatable values from the companion table before
    // deserializing, so a localized field still held as a JSON string is parsed
    // to the read shape too — matching how the update path builds `previous`.
    const merged: Record<string, unknown> = {
      ...convertTimestampsToCamelCase({ ...row }),
    };
    let appliedLocale: string | undefined;
    if (locale && this.localization) {
      // A companion schema means the collection is localized; only then does the
      // locale disambiguate the payload, so only then is it recorded.
      const companion =
        await this.fileManager.loadCompanionSchema(collectionName);
      if (companion) {
        appliedLocale = locale;
        Object.assign(
          merged,
          await this.readCompanionLocalizedValues(
            tx,
            collectionName,
            entryId,
            locale
          )
        );
      }
    }

    const parentRow = this.deserializeJsonFieldsForSnapshot(merged, fields);
    stripPasswordFieldValues(parentRow, fields);
    stripSystemOwnerField(parentRow);

    const { components, manyToMany } = await this.buildFullSnapshotRelations(
      tx,
      entryId,
      collectionName,
      tableName,
      fields,
      manyToManyFields,
      appliedLocale
    );

    return {
      document: assembleDocument({ parentRow, components, manyToMany }),
      locale: appliedLocale,
    };
  }

  private transitionStatus(args: {
    collection: string;
    id: unknown;
    data: Record<string, unknown>;
    user?: UserContext;
    previousStatus: string | null;
    status: string;
    emitStatusChanged: boolean;
    locale?: string;
  }): void {
    const docBase = {
      id: args.id,
      data: args.data,
      user: args.user,
      ...(args.locale !== undefined ? { locale: args.locale } : {}),
    };
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
   * reject an unrecognized write locale with a 400 instead of silently mapping it to
   * the default locale (which would write the translatable values into the DEFAULT companion
   * row, potentially overwriting real default content). Returns a 400 result, or null when the
   * locale is absent/valid or localization is off.
   */
  private rejectInvalidWriteLocale(
    locale: string | undefined
  ): CollectionServiceResult | null {
    if (!locale || !this.localization) return null;
    if (isValidLocale(this.localization, locale)) return null;
    return {
      success: false,
      statusCode: 400,
      message:
        `Unknown locale '${locale}'. Configured locales: ` +
        `${this.localization.locales.map(l => l.code).join(", ")}.`,
      data: null,
    };
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
  /**
   * The locale a component subtree in a snapshot belongs to.
   *
   * Component tables are per-locale whether or not their parent is, and a write
   * that names no locale still reaches them at the configured default — the
   * component read and write both resolve `undefined` that way. Recording null
   * would leave that snapshot unplaceable, so the default is made explicit
   * here. Without localization configured there are no per-locale rows and
   * nothing to record.
   */
  private componentSnapshotLocale(
    requested: string | undefined
  ): string | null {
    if (!this.localization) return null;
    return resolveRequestedLocale(this.localization, requested);
  }

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
    // Whether the companion carries a per-locale `_status` column. Reading that
    // column on a collection without it fails the whole write, so every read of
    // it must be gated on this.
    hasStatus: boolean;
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
    // un-publish German).
    if (companion.hasStatus) {
      const statusVal = entryData.status;
      if (typeof statusVal === "string") {
        companionData._status = statusVal;
      } else if (isCreate) {
        companionData._status = COMPANION_DEFAULT_STATUS;
      }

      // the main table's `status` gates entry-level visibility (the read
      // path filters rows on it). A per-locale status change for a NON-default
      // locale must NOT clobber it — otherwise unpublishing e.g. German would
      // unpublish the whole entry (all locales). Only the default-locale write is
      // the entry-level status action, so strip `status` from the main payload for
      // any other locale. `writeLocale` is already resolved/validated above.
      if (
        writeLocale !== this.localization.defaultLocale &&
        Object.prototype.hasOwnProperty.call(entryData, "status")
      ) {
        delete entryData.status;
      }
    }

    return {
      companionTableName: companion.companionTableName,
      writeLocale,
      companionData,
      localizedFieldValues,
      hasStatus: companion.hasStatus,
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
   * Read the entry's component subtrees + many-to-many id arrays for a version
   * snapshot, using the WRITE TRANSACTION's connection (read-your-writes, #226)
   * so the components and junction rows just written in the same transaction are
   * visible on every dialect. The read path returns the full read shape — ids
   * populated, JSON parsed, password fields stripped — and an empty relationship
   * reads as `[]`, so the snapshot matches a normal read with no in-memory
   * overlay and cannot leak component password hashes. A read failure fails the
   * capture (the whole transaction rolls back) rather than persisting a
   * knowingly-incomplete snapshot the caller cannot tell is incomplete.
   */
  /**
   * The write locale's translatable values as the companion row currently holds
   * them, with no locale fallback so the caller sees exactly this locale.
   *
   * The main row never stores translatable values, so a snapshot built from it
   * alone omits every localized field. Reading through the transaction handle
   * makes the result reflect whatever the caller has already written in this
   * transaction (nothing, before the companion upsert; the new values after it).
   * Undefined values are skipped so an untranslated field is not written as
   * `undefined` over the main-row value.
   */
  private async readCompanionLocalizedValues(
    tx: { getDrizzle<T = unknown>(): T },
    collectionName: string,
    entryId: string,
    locale: string
  ): Promise<Record<string, unknown>> {
    const companion =
      await this.fileManager.loadCompanionSchema(collectionName);
    if (!companion) return {};

    const row: Record<string, unknown> = { id: entryId };
    await populateCompanionFields({
      db: tx.getDrizzle<Parameters<typeof populateCompanionFields>[0]["db"]>(),
      companionTable: companion.table,
      localizedFields: companion.localizedFields,
      rows: [row],
      localeChain: [locale],
    });

    const values: Record<string, unknown> = {};
    for (const field of companion.localizedFields) {
      const value = row[field.name];
      if (value !== undefined) values[field.name] = value;
    }
    return values;
  }

  /**
   * The write locale's per-locale `_status`, or null when the companion row has
   * none.
   *
   * Read with raw `tx.execute` (matching upsertCompanionRow / publishAllLocales):
   * the companion `_locales` table is not in the Drizzle schema, and the CRUD
   * helpers camelCase result keys, which would rename `_status`.
   */
  private async readCompanionStatus(
    tx: TransactionContext,
    companionTableName: string,
    entryId: string,
    locale: string
  ): Promise<string | null> {
    const isMysqlDialect = this.dialect === "mysql";
    const quote = (id: string) => (isMysqlDialect ? `\`${id}\`` : `"${id}"`);
    const placeholder = (i: number) =>
      this.dialect === "postgresql" ? `$${i}` : "?";
    const rows = await tx.execute<{ _status?: unknown }>(
      `SELECT ${quote("_status")} FROM ${quote(companionTableName)} ` +
        `WHERE ${quote("_parent")} = ${placeholder(1)} AND ${quote("_locale")} = ${placeholder(2)} LIMIT 1`,
      [entryId, locale]
    );
    const status = rows[0]?._status;
    return typeof status === "string" ? status : null;
  }

  /**
   * The document parts a version records, with component types tagged.
   *
   * A separate shape from what the outbox carries: the same parts feed both,
   * and the marker belongs only to the snapshot.
   */
  private async snapshotPartsFor(
    parts: {
      parentRow: Record<string, unknown>;
      components: Record<string, unknown>;
      manyToMany: Record<string, string[]>;
    },
    fields: FieldDefinition[],
    tx: { getDrizzle<T = unknown>(): T }
  ) {
    const schema = fields as unknown as FieldConfig[];

    // A component embedded in another component is tagged too, which needs the
    // inner component's own schema. The data service already exposes that
    // lookup; resolving the whole set once keeps the walk itself synchronous.
    //
    // Read on the transaction's own connection. The registry lookup would
    // otherwise take a second pooled connection while this write transaction
    // still holds one, which stalls against a small pool.
    const componentFields = this.componentDataService
      ? await resolveComponentFieldMap(schema, slug =>
          this.componentDataService!.getComponentFields(slug, tx.getDrizzle())
        )
      : new Map<string, FieldConfig[]>();
    const resolve = (slug: string) => componentFields.get(slug);

    return {
      ...parts,
      components: tagComponentTypes(parts.components, schema, resolve),
      // A component declared inside a group or repeater rides in that
      // container's JSON on the parent row rather than appearing as its own
      // key, so it has to be reached through the row.
      parentRow: tagNestedComponentTypes(
        parts.parentRow,
        schema,
        resolve
      ) as Record<string, unknown>,
    };
  }

  private async buildFullSnapshotRelations(
    tx: { getDrizzle<T = unknown>(): T },
    entryId: string,
    collectionName: string,
    parentTable: string,
    fields: FieldDefinition[],
    manyToManyFields: FieldDefinition[],
    locale?: string
  ): Promise<{
    components: Record<string, unknown>;
    manyToMany: Record<string, string[]>;
  }> {
    const components: Record<string, unknown> = {};
    if (this.componentDataService) {
      const componentFields = fields.filter(isComponentField);
      if (componentFields.length > 0) {
        try {
          const populated =
            await this.componentDataService.populateComponentData({
              entry: { id: entryId },
              // Resolved parent table (custom `dbName` collections do not match
              // getTableName(slug)) so the read targets the right comp_ tables.
              parentTable,
              fields: fields as unknown as FieldConfig[],
              // Read on the transaction so components written earlier in it are
              // visible (read-your-writes); the read path strips password fields.
              executor: tx.getDrizzle(),
              // References only. Expanding a relationship would embed a row from
              // another collection, which this snapshot has no business copying:
              // the sensitive-field list describes THIS collection's tree, so a
              // hidden field on the target would ship unredacted, and the
              // expansion reads through the pooled relationship service — taking
              // a second connection while this write holds its own.
              depth: 0,
              // The write's locale, so a localized component is read back in the
              // same language it was just written in. Without it the read falls
              // back to the default component locale and the snapshot records
              // values this write never touched.
              //
              // Fallback is suppressed for the same reason: an untranslated
              // component field would otherwise resolve to another locale's
              // value, and the document is labelled as THIS locale. The parent's
              // own translatable values are already read without fallback, so
              // this keeps the two halves of the document consistent.
              ...(locale !== undefined
                ? { locale, fallbackLocale: false as const }
                : {}),
            });
          for (const f of componentFields) {
            if (populated[f.name] !== undefined) {
              components[f.name] = populated[f.name];
            }
          }
        } catch (err) {
          // A version that looks complete but silently dropped a component is
          // worse than a failed, retriable write — fail the capture (rolls back).
          this.logger.error(
            "Version snapshot: failed to read components; failing the write instead of capturing an incomplete snapshot",
            {
              collection: collectionName,
              entryId,
              error: err instanceof Error ? err.message : String(err),
            }
          );
          throw NextlyError.internal({
            cause: err instanceof Error ? err : undefined,
            logContext: {
              reason: "version-snapshot-component-read",
              collection: collectionName,
              entryId,
            },
          });
        }
      }
    }

    const manyToMany: Record<string, string[]> = {};
    const txExecutor = tx.getDrizzle<RelationshipDbExecutor>();
    for (const field of manyToManyFields) {
      try {
        const relatedRows =
          await this.relationshipService.fetchManyToManyRelations(
            collectionName,
            entryId,
            field,
            txExecutor
          );
        manyToMany[field.name] = relatedRows.map(r => (r as { id: string }).id);
      } catch (err) {
        // Same reasoning as the component read above.
        this.logger.error(
          "Version snapshot: failed to read many-to-many relations; failing the write instead of capturing an incomplete snapshot",
          {
            collection: collectionName,
            entryId,
            field: field.name,
            error: err instanceof Error ? err.message : String(err),
          }
        );
        throw NextlyError.internal({
          cause: err instanceof Error ? err : undefined,
          logContext: {
            reason: "version-snapshot-m2m-read",
            collection: collectionName,
            entryId,
            field: field.name,
          },
        });
      }
    }

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
      params.excludeId,
      params.executor
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
    excludeId?: string,
    // Optional transaction-bound executor so the uniqueness read runs on the
    // caller's transaction connection (a stored unique-validation hook firing
    // inside a caller-owned transaction) instead of the pool; defaults to it.
    executor?: unknown
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

      // Build the query. Runs on the caller's transaction connection when an
      // executor is supplied so this read does not re-enter the pool from inside
      // the transaction; falls back to the pooled connection otherwise.
      const db = executor ?? this.db;
      let query = db.select().from(schema);

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
      /**
       * Who performed the write, recorded on the outbox event. Set by the
       * transport; absent for internal writes, which record as `system`.
       */
      actor?: RequestActor;
      overrideAccess?: boolean;
      /** Write locale (i18n M5): translatable values are stored for this language. */
      locale?: string;
      // Set by the REST dispatcher: route-level authorization already ran, so
      // the collection re-check is skipped, but the response is still redacted
      // to what this user may read (this is not a trusted-server read).
      routeAuthorized?: boolean;
      context?: Record<string, unknown>;
      // The caller's authenticated scope. For a scoped API-key REST create the
      // publish transition gate (a create-as-published) judges the key's OWN
      // grants — the route only authorized `create` against the key's scope.
      authenticatedScope?: AuthenticatedScope;
    },
    body: Record<string, unknown>,
    depth?: number
  ): Promise<CollectionServiceResult> {
    // Set once the outbox event is appended (below), so the catch can report a
    // committed-but-hook-failed write as `eventRecorded` even when `success` is
    // false. Declared out here so both the success and catch returns see it.
    let eventRecorded = false;
    try {
      // reject an unknown write locale before doing anything else.
      const badLocale = this.rejectInvalidWriteLocale(params.locale);
      if (badLocale) return badLocale;

      const accessUser = params.overrideAccess ? undefined : params.user;

      // 1. Check collection-level access FIRST
      const accessDenied = await this.accessService.checkCollectionAccess(
        params.collectionName,
        "create",
        accessUser,
        undefined,
        undefined,
        params.overrideAccess,
        params.routeAuthorized,
        // A scoped API key is judged on its own grants here too, so the session
        // super-admin bypass does not apply to it on the create gate.
        params.authenticatedScope
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

      // Strip an explicit `status: undefined` AFTER every mutating hook has run.
      // A field-level beforeValidate/beforeChange hook can (re)introduce an own
      // `status: undefined`, which names no status change but would otherwise be
      // sanitized to SQL NULL on the raw-parameter path — silently unpublishing a
      // published row, or nulling a create's draft default — without passing the
      // publish/unpublish gate. Placed here, the last status-touching step before
      // the transition classification and the write, so the write payload and the
      // gate agree even when a hook set the undefined.
      stripUndefinedStatus(finalData);

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

      // Authorize the published state this create will persist, judged on the
      // post-hook `finalData` rather than the raw body: a beforeCreate/stored
      // hook that derives `status: "published"`, or a status field the caller
      // may not write (stripped by field-write-access above), must be gated on
      // the value actually stored. A create has no prior status, so landing
      // directly on published is a publish and needs `publish-<slug>` on top of
      // create. Read before the locale split below removes `status` from the
      // non-default-locale main payload.
      const createTransitionDenied = await this.checkStatusTransitionAccess({
        collectionName: params.collectionName,
        collectionHasStatus:
          (collection as { status?: boolean }).status === true,
        previousStatus: null,
        nextStatus: finalData.status,
        accessUser,
        // A create has no prior row, so a document-dependent (owner-only/custom)
        // publish rule is judged against the row this create will persist. Pass
        // it so a custom rule inspecting the document does not see `data`
        // undefined and wrongly allow (or deny) a create-as-published.
        document: entryData,
        overrideAccess: params.overrideAccess,
        authenticatedScope: params.authenticatedScope,
      });
      if (createTransitionDenied) {
        return createTransitionDenied;
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

      // Resolved BEFORE the transaction opens. Expansion reads component
      // definitions from the registry on the pooled connection, and doing that
      // inside the transaction would hold this write's connection while waiting
      // for a second one. It depends only on static field config, so nothing is
      // gained by deferring it.
      const webhookFields = await this.webhookFieldTree(fields);

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
            // i18n: thread the write locale so an embedded localized component writes
            // translatable fields to its companion within the same transaction.
            locale: params.locale,
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

        // Assemble the read-shape document once, unconditionally: the webhook
        // outbox records every write, and a version snapshot reuses the same
        // assembly when the collection opts into versioning. Runs after
        // components + m2m so the reads below see them (read-your-writes).
        //
        // Snapshot the parent from the RAW insert row (field-name keys) — not
        // the camelCased `entry` used for the response — so user fields whose
        // names contain underscores keep their configured keys; convert only
        // the timestamp columns to match a normal read. Merge this locale's
        // translatable values (split out of the main insert), parse JSON-backed
        // fields, and strip password hashes + the owner column (created_by) so
        // neither ever enters durable history or an outbound payload.
        const createCompanionStatus = localizedWrite?.companionData?._status;
        const snapshotParent = convertTimestampsToCamelCase(
          this.deserializeJsonFieldsForSnapshot(
            {
              ...(rawEntry as Record<string, unknown>),
              ...(localizedWrite?.localizedFieldValues ?? {}),
              // Creating in a non-default locale with an explicit status moves
              // that status to the companion row and strips it from the main
              // insert, so the raw row carries the column default. Overlay the
              // committed value, or a publish is recorded as a draft create.
              ...(typeof createCompanionStatus === "string"
                ? { status: createCompanionStatus }
                : {}),
            },
            fields
          )
        );
        stripPasswordFieldValues(snapshotParent, fields);
        stripSystemOwnerField(snapshotParent);
        // Components + m2m are read from the transaction: the write above just
        // persisted them, and an empty relationship reads as [] — so the
        // document is complete and read-shaped with no in-memory overlay. These
        // reads are the costly part, so they happen exactly once and both
        // consumers below compose their document from the same parts.
        const { components: snapshotComponents, manyToMany: snapshotM2M } =
          await this.buildFullSnapshotRelations(
            tx,
            entry.id as string,
            params.collectionName,
            tableName,
            fields,
            manyToManyFields,
            // The RESOLVED write locale, not the raw request param: a localized
            // write with no `?locale` still writes the default locale, and the
            // parent's translatable values are read for that resolved locale.
            // Passing the raw param would read components under different rules
            // than the rest of the same document.
            localizedWrite?.writeLocale ?? params.locale
          );
        const documentParts = {
          parentRow: snapshotParent,
          components: snapshotComponents,
          manyToMany: snapshotM2M,
        };

        // Record a durable version snapshot atomically with the write when the
        // collection opts into versioning.
        if (versionsConfig?.enabled) {
          await captureInTx(tx, this.versionCapture, {
            ref: {
              scopeKind: "collection",
              scopeSlug: params.collectionName,
              entryId: entry.id as string,
            },
            // A localized create with an explicit status moves it to the
            // companion, leaving the main row on its table default. The snapshot
            // records the companion value, so the version must be indexed with
            // the same one or history reports a draft whose own document says
            // published.
            contentStatus:
              typeof createCompanionStatus === "string"
                ? createCompanionStatus
                : (entry as { status?: unknown }).status,
            // Tagged for the snapshot alone: `documentParts` is also what the
            // outbox event below carries, and that payload is read shape.
            parts: await this.snapshotPartsFor(documentParts, fields, tx),
            createdBy: params.user?.id ?? null,
            // Set only when localized values were actually routed, for the
            // same reason the update path is careful about it.
            // Set when locale-specific state was actually captured. A
            // collection whose translatable content lives only in embedded
            // components routes nothing through `localizedWrite`, yet the
            // components above were read as this locale — so without counting
            // them the version would be unlabelled and unrestorable.
            locale:
              localizedWrite?.writeLocale ??
              (Object.keys(snapshotComponents ?? {}).length > 0
                ? this.componentSnapshotLocale(params.locale)
                : null),
            maxPerDoc: versionsConfig.maxPerDoc,
          });
        }

        // Append the outbox event in the same transaction, so it commits with
        // the entry and is never recorded for a write that later rolls back.
        await recordMutationEvent(tx, {
          type: "entry.created",
          resource: {
            kind: "entry",
            collection: params.collectionName,
            id: entry.id as string,
            // The resolved write locale, so a receiver can tell which
            // translation this document represents. Absent unless the
            // collection actually stores per-locale values.
            ...(localizedWrite ? { locale: localizedWrite.writeLocale } : {}),
          },
          data: assembleDocument(documentParts),
          previous: null,
          fields: webhookFields,
          actor: actorForWrite(params.actor, params.user),
        });
      });
      // Set only after the transaction resolves (this line is skipped if it
      // rejected), so a commit failure never flags a durable event that isn't
      // there; from here a post-commit hook failure must not hide the delivery.
      eventRecorded = true;

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
        eventRecorded,
      };
    } catch (error: unknown) {
      // Legacy per-kind override messages ("Duplicate value: ...",
      // "Missing required field", etc.) are dropped: the new mapping uses
      // the §13.8-compliant generic strings from fromDatabaseError so the
      // wire never reveals which constraint or column failed. The original
      // DbError is preserved on the NextlyError as `cause` for log lines.
      // Pass dialect explicitly so the helper can normalise raw driver errors.
      return {
        ...errorToServiceResult(
          error,
          { defaultMessage: "Failed to create entry" },
          this.dialect
        ),
        eventRecorded,
      };
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
    // Set by the REST dispatcher: the route already authorized this POST as
    // `update`, so the preliminary update gate below skips its redundant RBAC
    // re-check (its stored rules still run). The publish gate is unaffected.
    routeAuthorized?: boolean;
    // A scoped API key is judged on its own `publish-<slug>` grant, not the key
    // owner's — the route authorized this POST only as `update`.
    authenticatedScope?: AuthenticatedScope;
  }): Promise<CollectionServiceResult> {
    // Set when the in-transaction document-rule re-check refuses the publish
    // against the row-locked document. Declared out here so the catch can read
    // it: the adapter re-wraps the thrown sentinel in a DatabaseError as the
    // transaction rolls back, so `instanceof` no longer identifies it.
    let publishDocDenied: CollectionServiceResult | undefined;
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
        params.overrideAccess,
        // The route already ran the `update` gate (against the API key's scope,
        // when applicable), so skip the redundant RBAC re-check here; the publish
        // gate below still runs.
        params.routeAuthorized,
        params.authenticatedScope
      );
      if (accessDenied) return accessDenied;

      // The draft/published lifecycle flag on the collection config, NOT the
      // mere presence of a `status` column: a collection that defines an
      // ordinary user field named `status` has the column but no lifecycle, so
      // it is not publishable and must not demand the publish permission here.
      // Resolved through the collection so a custom tableName/dbName override is
      // honored below, matching every other mutation.
      const publishCollection = await this.collectionService.getCollection(
        params.collectionName
      );
      const hasMainStatus =
        (publishCollection as { status?: boolean }).status === true;
      const companion = await this.fileManager.loadCompanionSchema(
        params.collectionName
      );
      const companionPublishable =
        !!companion &&
        companion.hasStatus &&
        (await this.companionTableExists(companion.companionTableName));

      if (!hasMainStatus && !companionPublishable) {
        // Nothing to publish — the collection has no status concept. Returned
        // before the publish permission check so a collection with no lifecycle
        // does not demand `publish-<slug>` for a call that changes nothing.
        return {
          success: true,
          statusCode: 200,
          message: "Nothing to publish (collection has no status).",
          data: { id: params.entryId },
        };
      }

      // This method exists to publish every locale, so it is unconditionally a
      // publish and needs the publish permission on top of update — checked
      // directly rather than via a transition, since it publishes companion
      // locales even when the main row is already published. Runs only once
      // there is actually something publishable.
      // Defer a document-dependent (owner-only/custom) publish rule to the
      // under-lock re-check so it is judged against the row-locked document, not
      // the stale pre-transaction `existingEntry` — a custom rule keyed on a
      // mutable field (e.g. an approval flag a concurrent writer clears) must
      // decide on the committed value this publish will overwrite.
      const publishStoredRules = this.accessService.getAccessRules(
        publishCollection as Record<string, unknown>
      );
      const deferPublishDocumentRule =
        this.accessService.isDocumentDependentRule(publishStoredRules?.publish);
      const publishDenied = await this.accessService.checkCollectionAccess(
        params.collectionName,
        "publish",
        accessUser,
        params.entryId,
        existingEntry,
        params.overrideAccess,
        // Not route-authorized as publish: the POST was authorized as `update`,
        // so the publish permission is checked here.
        false,
        // Judge a scoped API key on its own `publish-<slug>` grant.
        params.authenticatedScope,
        deferPublishDocumentRule
      );
      if (publishDenied) return publishDenied;
      const publishDocumentRule = deferPublishDocumentRule
        ? this.accessService.resolveTransitionDocumentRule(
            publishCollection as Record<string, unknown>,
            accessUser,
            params.authenticatedScope
          )
        : null;

      const isMysql = this.dialect === "mysql";
      const q = (id: string) => (isMysql ? `\`${id}\`` : `"${id}"`);
      const ph = (i: number) => (this.dialect === "postgresql" ? `$${i}` : "?");
      // `publishCollection` (loaded above for the lifecycle flag) also resolves a
      // custom tableName/dbName override, matching every other mutation;
      // getTableName would hardcode the default dc_<slug> and target the wrong
      // table for a renamed collection.
      const tableName = this.resolveTableName(
        publishCollection,
        params.collectionName
      );

      // Resolved versioning config + field set for the in-transaction capture.
      const versionsConfig = (publishCollection as Record<string, unknown>)
        .versions as ResolvedVersionsConfig | null | undefined;
      const fields = ((publishCollection as { fields?: unknown }).fields ??
        []) as FieldDefinition[];
      const manyToManyFields = fields.filter(
        f =>
          f.type === "relationship" && f.options?.relationType === "manyToMany"
      );
      const previousStatusRaw = (existingEntry as { status?: unknown }).status;
      const previousStatus =
        typeof previousStatusRaw === "string" ? previousStatusRaw : null;

      // The parent row for both the snapshot and the status-change event is
      // re-read fresh inside the transaction (not the pre-transaction
      // `existingEntry`), mirroring updateEntry: a conflict retry re-runs this
      // closure, and any concurrent write committed before the tx began is then
      // reflected, so neither the recorded snapshot nor the emitted event
      // payload exposes a stale pre-image of the non-status columns. The closure
      // sets it; it is read once after commit for the event.
      let publishedParentRow: Record<string, unknown> | undefined;
      const needsFreshParent =
        !!versionsConfig?.enabled ||
        (hasMainStatus && previousStatus !== "published");

      // Bump `updated_at` alongside status so caches / revalidation see the change (a bare
      // status flip left the timestamp stale). On SQLite the dynamic tables store `updated_at`
      // as an integer Unix-seconds column (Drizzle `integer` timestamp mode), so `unixepoch()`
      // keeps the value numeric; `CURRENT_TIMESTAMP` would write a text string and corrupt
      // decoding/ordering. Postgres/MySQL use the native timestamp default.
      const nowExpr =
        this.dialect === "sqlite" ? "unixepoch()" : "CURRENT_TIMESTAMP";

      // Retry the whole publish+capture transaction on a version_no allocation
      // race, mirroring updateEntry.
      await withVersionConflictRetry(() =>
        this.adapter.transaction(async tx => {
          // Re-check a deferred document-dependent (owner-only/custom) publish
          // rule against the row read UNDER the lock, before the status write, so
          // a concurrent change to a field the rule inspects is accounted for.
          // Throwing here rolls the publish back with nothing written.
          if (publishDocumentRule) {
            const lockedRow = await tx.selectOne<Record<string, unknown>>(
              tableName,
              { where: this.whereEq("id", params.entryId), forUpdate: true }
            );
            if (lockedRow) {
              const documentDenied =
                await this.accessService.evaluateTransitionDocumentRule(
                  publishDocumentRule.accessRules,
                  "publish",
                  publishDocumentRule.user,
                  lockedRow
                );
              if (documentDenied) {
                publishDocDenied = documentDenied;
                throw new StatusTransitionDeniedError();
              }
            }
          }
          if (hasMainStatus) {
            await tx.execute(
              `UPDATE ${q(tableName)} SET ${q("status")} = ${ph(1)}, ${q("updated_at")} = ${nowExpr} WHERE ${q("id")} = ${ph(2)}`,
              ["published", params.entryId]
            );
          }
          if (companion && companionPublishable) {
            await tx.execute(
              `UPDATE ${q(companion.companionTableName)} SET ${q("_status")} = ${ph(1)} WHERE ${q("_parent")} = ${ph(2)}`,
              ["published", params.entryId]
            );
          }

          if (needsFreshParent) {
            // Pool read, so it excludes this tx's own uncommitted status write —
            // publish only mutates status, so overlaying "published" onto the
            // fresh non-status columns reconstructs the committed post-publish
            // state. On retry this re-reads a concurrent winner's columns.
            const freshRows = await this.db
              .select()
              .from(schema)
              .where(eq(schema.id, params.entryId))
              .limit(1);
            const currentRow = freshRows[0] as
              | Record<string, unknown>
              | undefined;
            publishedParentRow = currentRow
              ? { ...currentRow, status: "published" }
              : undefined;

            // Record a version snapshot for the publish: publishing changes the
            // document's status, so history/audit should capture that state.
            // Components + m2m are read from the transaction (read-your-writes).
            // Status/owner/password handling matches the other capture paths. If
            // the row was deleted concurrently, skip — nothing committed to
            // snapshot.
            if (versionsConfig?.enabled && publishedParentRow) {
              const parentRow = convertTimestampsToCamelCase(
                this.deserializeJsonFieldsForSnapshot(
                  { ...publishedParentRow },
                  fields
                )
              );
              stripPasswordFieldValues(parentRow, fields);
              stripSystemOwnerField(parentRow);
              const {
                components: snapshotComponents,
                manyToMany: snapshotM2M,
              } = await this.buildFullSnapshotRelations(
                tx,
                params.entryId,
                params.collectionName,
                tableName,
                fields,
                manyToManyFields
              );
              await captureInTx(tx, this.versionCapture, {
                ref: {
                  scopeKind: "collection",
                  scopeSlug: params.collectionName,
                  entryId: params.entryId,
                },
                contentStatus: "published",
                // Tagged like every other capture: a snapshot records which
                // component its values came from, whichever path produced it.
                parts: await this.snapshotPartsFor(
                  {
                    parentRow,
                    components: snapshotComponents,
                    manyToMany: snapshotM2M,
                  },
                  fields,
                  tx
                ),
                createdBy: params.user?.id ?? null,
                // Left unlabelled deliberately. Publishing spans every locale,
                // and this snapshot is the main row alone — on a migrated
                // collection the localized columns live only in the companion,
                // so it holds no locale's translatable values. Claiming one
                // would tell a restore to write content it never captured.
                locale: null,
                maxPerDoc: versionsConfig.maxPerDoc,
              });
            }
          }
        })
      );

      // Post-commit status events: publishing is a real status transition, so
      // workflow subscribers on statusTransition/published must see it (this
      // path previously changed status without emitting anything). Skip when the
      // main row was already published (no transition), matching updateEntry.
      // Prefer the fresh in-tx row; fall back to the pre-read only if the row
      // vanished mid-publish.
      if (hasMainStatus && previousStatus !== "published") {
        this.transitionStatus({
          collection: params.collectionName,
          id: params.entryId,
          data: publishedParentRow ?? {
            ...(existingEntry as Record<string, unknown>),
            status: "published",
          },
          user: params.user,
          previousStatus,
          status: "published",
          emitStatusChanged: true,
        });
      }

      // emit the post-commit "updated" reaction event so cache
      // revalidation / webhooks fire, matching a single-locale publish. Best-effort: a
      // reaction failure must not fail the already-committed publish.
      try {
        const [updated] = await this.db
          .select()
          .from(schema)
          .where(eq(schema.id, params.entryId))
          .limit(1);
        if (updated) {
          emitCollectionEvent(
            "updated",
            params.collectionName,
            updated as Record<string, unknown>,
            params.user
          );
        }
      } catch {
        // Reaction/event emission is non-critical; the publish already committed.
      }

      return {
        success: true,
        statusCode: 200,
        message: "All languages published.",
        data: { id: params.entryId, status: "published" },
      };
    } catch (error) {
      // A publish refused by the under-lock document-rule re-check aborts the
      // transaction; return the 403 it resolved, not a 500.
      if (publishDocDenied) {
        return publishDocDenied;
      }
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

  /**
   * Whether this user may update the entry, decided without writing anything.
   *
   * The same load-then-check `updateEntry` performs, so it sees the
   * collection's stored per-document rules — owner-only and role-based — which
   * coarse RBAC does not express. For callers that write something OTHER than
   * the document and must still be held to the document's update rules;
   * version history is one. Sharing this path rather than restating the
   * decision elsewhere is what stops the gate drifting from the writer.
   */
  async canUpdateEntry(params: {
    collectionName: string;
    entryId: string;
    user?: UserContext;
    routeAuthorized?: boolean;
    /**
     * The caller's authenticated scope. A scoped API key is judged on its OWN
     * update grant, so the session super-admin bypass does not apply to a
     * super-admin-owned key when this gate authorizes a version-label edit.
     */
    authenticatedScope?: AuthenticatedScope;
  }): Promise<boolean> {
    const schema = await this.fileManager.loadDynamicSchema(
      params.collectionName
    );

    // Loaded because owner-only rules compare against the stored row; without
    // it those rules cannot be evaluated at all.
    const [existingEntry] = await this.db
      .select()
      .from(schema)
      .where(eq(schema.id, params.entryId))
      .limit(1);

    // A document that is not there cannot be updated. Answered as a refusal so
    // the caller treats missing and forbidden identically, rather than letting
    // the difference between them be probed.
    if (!existingEntry) return false;

    const denied = await this.accessService.checkCollectionAccess(
      params.collectionName,
      "update",
      params.user,
      params.entryId,
      existingEntry,
      // Never overridden: this exists to APPLY the document's rules, so a
      // caller that could opt out of them would defeat the point.
      false,
      params.routeAuthorized,
      // A scoped API key is judged on its own update grant, so the session
      // super-admin bypass does not apply to a super-admin-owned key here.
      params.authenticatedScope
    );
    return denied === null;
  }

  /**
   * Additionally authorize a write that changes a document's published state.
   *
   * Publishing is an ordinary write that sets `status: "published"`, so the
   * `update`/`create` gate a path already ran does not distinguish it. A move
   * into published needs `publish`, a move out of it needs `unpublish`, and
   * both are ON TOP of the write permission — editing and publishing are
   * separate capabilities. A write that is not a transition returns `null` and
   * nothing extra is required.
   *
   * `collectionHasStatus` is the draft/published lifecycle flag
   * (`collection.status === true`), the same signal the read path filters on. It
   * gates this check because a collection WITHOUT the lifecycle can still carry
   * an ordinary user-defined field named `status`: setting that to "published"
   * is a field edit, not a publish, and must not demand `publish-<slug>`.
   *
   * `nextStatus` is the FINAL status the write will persist — read after the
   * before-hooks and field-write-access have run, not the raw request body — so
   * a hook that derives `status: "published"` cannot let a caller publish
   * without the permission. `previousStatus` is the main-row status, or, for a
   * write targeting a non-default locale, that locale's companion `_status`,
   * since a per-locale translation publishes through the companion row and not
   * the main row.
   */
  private async checkStatusTransitionAccess(args: {
    collectionName: string;
    collectionHasStatus: boolean;
    previousStatus: string | null;
    nextStatus: unknown;
    accessUser?: UserContext;
    entryId?: string;
    document?: Record<string, unknown>;
    overrideAccess?: boolean;
    authenticatedScope?: AuthenticatedScope;
  }): Promise<CollectionServiceResult | null> {
    // No draft/published lifecycle → `status` is an ordinary field, not a
    // publish signal, so there is no transition to authorize.
    if (!args.collectionHasStatus) return null;

    const operation = resolvePublishTransition(
      args.previousStatus,
      args.nextStatus
    );
    if (!operation) return null;

    return this.accessService.checkCollectionAccess(
      args.collectionName,
      operation,
      args.accessUser,
      args.entryId,
      args.document,
      args.overrideAccess,
      // NOT route-authorized, even on a REST write. `routeAuthorized` means the
      // route middleware already ran this exact RBAC check — but the route
      // authorizes a document PATCH/create as `update`/`create`, never as
      // `publish`/`unpublish`, so for the transition operation that assertion
      // does not hold. Passing it through would skip the RBAC check for the very
      // permission this gate exists to enforce, letting any caller who may
      // update/create also publish.
      false,
      // A scoped API key is judged on its own publish/unpublish grant here, not
      // the key owner's.
      args.authenticatedScope
    );
  }

  /**
   * Resolve the caller's publish AND unpublish authorization on the pooled
   * connection, BEFORE a write transaction opens, so the transaction/batch write
   * paths can enforce a transition against the row-locked status without reading
   * permission storage inside the transaction (see {@link TransitionAuthorization}).
   *
   * Both ops are resolved because a batch is heterogeneous — one row may publish
   * while another unpublishes — and the per-row op is only known under the lock.
   * No-ops (returns all-allowed) for a trusted write or a collection with no
   * draft/published lifecycle.
   */
  async resolveTransitionAuthorization(args: {
    collectionName: string;
    accessUser?: UserContext;
    overrideAccess?: boolean;
    authenticatedScope?: AuthenticatedScope;
    // A transaction-bound Drizzle executor (`tx.getDrizzle()`), supplied when a
    // caller-owned-tx path resolves the transition authorization from INSIDE its
    // own transaction. The metadata and RBAC reads below then run on that
    // transaction's connection instead of taking a second pooled one, which can
    // stall against a small pool. Omitted (pooled connection) when a path
    // pre-resolves before opening its transaction, which is the common case.
    executor?: unknown;
  }): Promise<TransitionAuthorization> {
    if (args.overrideAccess) {
      return { publishDenied: null, unpublishDenied: null, documentRule: null };
    }
    const collection = await this.collectionService.getCollection(
      args.collectionName,
      args.executor
    );
    if ((collection as { status?: boolean }).status !== true) {
      return { publishDenied: null, unpublishDenied: null, documentRule: null };
    }
    // A document-dependent stored rule (owner-only or custom) must NOT be judged
    // docless here: owner-only would defer anyway, but a custom rule that denies
    // on absent `id`/`data` would cache a false denial that pre-empts the
    // under-lock recheck. Skip the stored-rule eval for such ops (the RBAC/
    // permission gate still runs) and evaluate the rule against the locked row
    // below via `documentRule`.
    const accessRules = this.accessService.getAccessRules(
      collection as Record<string, unknown>
    );
    const deferPublish = this.accessService.isDocumentDependentRule(
      accessRules?.publish
    );
    const deferUnpublish = this.accessService.isDocumentDependentRule(
      accessRules?.unpublish
    );
    // Resolve both concurrently; each is judged on the caller's own grant (a
    // scoped API key on its scope), never route-authorized — the route attested
    // update/create, never publish/unpublish.
    const [publishDenied, unpublishDenied] = await Promise.all([
      this.accessService.checkCollectionAccess(
        args.collectionName,
        "publish",
        args.accessUser,
        undefined,
        undefined,
        args.overrideAccess,
        false,
        args.authenticatedScope,
        deferPublish,
        args.executor
      ),
      this.accessService.checkCollectionAccess(
        args.collectionName,
        "unpublish",
        args.accessUser,
        undefined,
        undefined,
        args.overrideAccess,
        false,
        args.authenticatedScope,
        deferUnpublish,
        args.executor
      ),
    ]);
    // Owner-only / custom publish/unpublish rules cannot be judged above because
    // they need the specific row (only known under the lock). Pre-fetch the rules
    // + user off the already-loaded collection so the in-transaction step
    // evaluates them against the row-locked document with no further metadata read.
    const documentRule = this.accessService.resolveTransitionDocumentRule(
      collection as Record<string, unknown>,
      args.accessUser,
      args.authenticatedScope
    );
    return { publishDenied, unpublishDenied, documentRule };
  }

  /**
   * Enforce a pre-resolved {@link TransitionAuthorization} against the status read
   * UNDER the row lock, inside a caller-provided transaction. For an update it
   * locks the row (the write below takes the same lock anyway) and re-reads the
   * committed status, so a concurrent writer that changed the published state
   * between the pre-transaction read and this lock is accounted for; classifying
   * against that locked status, it returns the matching 403 if the transition is
   * denied, or `null` when the write is allowed. A create has no prior row, so
   * only a publish is possible and no lock/read is taken.
   *
   * Called immediately before the INSERT/UPDATE, so returning a denial leaves
   * nothing written for this row — no rollback needed.
   */
  private async enforceTransitionUnderLock(
    tx: TransactionContext,
    args: {
      tableName: string;
      entryId?: string;
      nextStatus: unknown;
      isCreate: boolean;
      auth: TransitionAuthorization;
      // The row a create will persist (owner-stamped `created_by` + final
      // status/data). A create has no prior row to lock, so a deferred
      // owner-only/custom publish rule is judged against this instead.
      createDocument?: Record<string, unknown>;
    }
  ): Promise<CollectionServiceResult | null> {
    // No status named in the write: no transition, nothing to enforce.
    if (args.nextStatus === undefined) return null;
    let lockedStatus: string | null = null;
    let lockedRow: Record<string, unknown> | null = null;
    if (!args.isCreate && args.entryId) {
      // Read the committed row UNDER a row lock, in the SAME query that takes the
      // lock (`forUpdate`). A separate plain read would, on MySQL's
      // repeatable-read isolation, return this transaction's snapshot —
      // established by the caller's earlier pre-lock fetch of the row — and so
      // miss a concurrent writer's publish/unpublish committed since, leaving the
      // TOCTOU window open on MySQL. A `FOR UPDATE` read always sees the latest
      // committed row; SQLite skips the lock (BEGIN IMMEDIATE already serializes
      // its writers) and its committed read is already current. The full row (not
      // just status) is read so an owner-only rule can be judged against the
      // locked owner column below.
      lockedRow = await tx.selectOne<Record<string, unknown>>(args.tableName, {
        where: this.whereEq("id", args.entryId),
        forUpdate: true,
      });
      if (!lockedRow) {
        // The row was found by the caller's pre-lock read but is gone under the
        // lock: a concurrent transaction deleted it in that window. There is no
        // prior state to transition, so the update targets a missing row —
        // return not-found rather than classifying the absent status as a
        // `null -> published` publish (which would wrongly demand a publish grant
        // for a row that no longer exists, or let the write silently no-op).
        return {
          success: false,
          statusCode: 404,
          message: "Entry not found",
          data: null,
        };
      }
      lockedStatus = (lockedRow.status as string | undefined) ?? null;
    }
    const op = resolvePublishTransition(lockedStatus, args.nextStatus);
    if (!op) return null;
    // Permission first (pre-resolved, no DB read): a caller lacking publish-<slug>
    // / unpublish-<slug> is denied regardless of ownership.
    const permissionDenied =
      op === "publish" ? args.auth.publishDenied : args.auth.unpublishDenied;
    if (permissionDenied) return permissionDenied;
    // Then the document-dependent (owner-only/custom) rule. Pre-resolved rules +
    // user are carried on `auth`, so this reads no metadata or permission storage
    // inside the transaction. For an update it is judged against the row-locked
    // document; for a create there is no prior row, so it is judged against the
    // row this create will persist — a deferred owner-only/custom publish rule
    // must still gate a create that lands directly on published (otherwise a
    // public create + owner-only publish could anonymously publish, or a custom
    // publish rule returning false would be skipped on creates).
    const documentForRule = lockedRow ?? args.createDocument ?? null;
    if (args.auth.documentRule && documentForRule) {
      return this.accessService.evaluateTransitionDocumentRule(
        args.auth.documentRule.accessRules,
        op,
        args.auth.documentRule.user,
        documentForRule
      );
    }
    return null;
  }

  async updateEntry(
    params: {
      collectionName: string;
      entryId: string;
      user?: UserContext;
      /**
       * Who performed the write, recorded on the outbox event. Set by the
       * transport; absent for internal writes, which record as `system`.
       */
      actor?: RequestActor;
      overrideAccess?: boolean;
      /** Write locale (i18n M5): translatable values are updated for this language only. */
      locale?: string;
      // Set by the REST dispatcher: route-level authorization already ran, so
      // the collection re-check is skipped, but the response is still redacted
      // to what this user may read (this is not a trusted-server read).
      routeAuthorized?: boolean;
      context?: Record<string, unknown>;
      /**
       * Set when this write restores an earlier version, recording which one on
       * the version it captures. Lineage cannot be inferred afterwards: a
       * restore is an ordinary write that happens to reproduce an earlier state.
       */
      sourceVersionNo?: number;
      // The caller's authenticated scope. For a scoped API-key REST write the
      // publish/unpublish transition gate judges the key's OWN grants, since the
      // route only authorized `update` against the key's scope.
      authenticatedScope?: AuthenticatedScope;
    },
    body: Record<string, unknown>,
    depth?: number
  ): Promise<CollectionServiceResult> {
    // Set once the outbox event is appended (below); lets the catch report a
    // committed-but-hook-failed update as `eventRecorded` even when `success` is
    // false. Declared out here so both the success and catch returns see it.
    let eventRecorded = false;
    // Set when the in-transaction transition check refuses the write. Declared
    // out here (not in `try`) so the catch can read it: the adapter wraps a
    // thrown error in a DatabaseError (see VersionConflictError), so `instanceof`
    // no longer identifies the sentinel after the throw, but this result stays
    // correct regardless of how the error is wrapped.
    let transitionDeniedResult: CollectionServiceResult | undefined;
    try {
      // reject an unknown write locale before doing anything else.
      const badLocale = this.rejectInvalidWriteLocale(params.locale);
      if (badLocale) return badLocale;

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
        params.routeAuthorized,
        // A scoped API key is judged on its own grants here too, so the session
        // super-admin bypass does not apply to it on the update gate.
        params.authenticatedScope
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

      // Strip an explicit `status: undefined` AFTER every mutating hook has run.
      // A field-level beforeValidate/beforeChange hook can (re)introduce an own
      // `status: undefined`, which names no status change but would otherwise be
      // sanitized to SQL NULL on the raw-parameter path — silently unpublishing a
      // published row, or nulling a create's draft default — without passing the
      // publish/unpublish gate. Placed here, the last status-touching step before
      // the transition classification and the write, so the write payload and the
      // gate agree even when a hook set the undefined.
      stripUndefinedStatus(finalData);

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
      // The status this write intends to persist, captured before the locale
      // split below removes it from `finalData` for a non-default-locale write
      // (it moves into the companion `_status`). Post-hook value, not the raw
      // body — see the create path.
      const intendedStatus = finalData.status;

      const localizedUpdate = await this.splitLocalizedWriteData(
        params.collectionName,
        finalData,
        params.locale,
        false
      );

      // Whether this write targets a non-default locale's companion `_status`
      // (which the in-transaction check below reads under the lock) rather than
      // the main row. A trusted write skips the transition gate entirely.
      const isNonDefaultLocaleStatusWrite =
        !params.overrideAccess &&
        localizedUpdate?.hasStatus === true &&
        localizedUpdate.writeLocale !== this.localization?.defaultLocale;
      // The status this write will persist: for a non-default locale it is the
      // companion `_status` the split produced (a string only when one was
      // provided), otherwise the main-row status.
      const transitionNextStatus = isNonDefaultLocaleStatusWrite
        ? localizedUpdate.companionData._status
        : intendedStatus;
      // Resolve the one publish permission this write could require — keyed on
      // the status it will persist — BEFORE the transaction opens, so the RBAC
      // read stays off this transaction's connection. The decision is cached and
      // enforced against the ROW-LOCKED status inside the transaction (below), so
      // a concurrent writer that changed the published state between the
      // pre-transaction read and the lock cannot slip a transition past the gate.
      // No guard is needed for a trusted write, a collection with no lifecycle,
      // or a write that names no status at all (`undefined` = leave it
      // untouched). Any other explicitly-provided value IS a write to the
      // status column — including a non-string one that a dialect coerces into
      // the text column — so the guard must cover it too: `"published"` is the
      // only value that can publish, and every other provided value can only
      // move a published row OUT of published (an unpublish). Requiring a string
      // here would let `status: 0`/`false` slip an unpublish past the gate.
      const collectionHasStatus =
        (collection as { status?: boolean }).status === true;
      // The guard carries the pre-resolved PERMISSION denial (document-
      // independent) plus, when the op's stored rule is document-dependent
      // (owner-only/custom), the rules to re-evaluate against the ROW-LOCKED
      // document inside the transaction — so a custom rule keyed on a mutable
      // field is not judged against the stale pre-transaction `existingEntry`.
      let transitionGuard: {
        op: "publish" | "unpublish";
        permissionDenied: CollectionServiceResult | null;
        documentRule: {
          accessRules: CollectionAccessRules;
          user: UserContext | undefined;
        } | null;
      } | null = null;
      if (
        collectionHasStatus &&
        !params.overrideAccess &&
        transitionNextStatus !== undefined
      ) {
        const transitionOp =
          transitionNextStatus === "published" ? "publish" : "unpublish";
        const storedRules = this.accessService.getAccessRules(
          collection as Record<string, unknown>
        );
        const deferDocumentRule = this.accessService.isDocumentDependentRule(
          storedRules?.[transitionOp]
        );
        const permissionDenied = await this.accessService.checkCollectionAccess(
          params.collectionName,
          transitionOp,
          accessUser,
          params.entryId,
          existingEntry,
          params.overrideAccess,
          // Never route-authorized: the route authorizes the write as `update`,
          // never as `publish`/`unpublish`, so the RBAC check must run.
          false,
          // A scoped API key is judged on its OWN publish/unpublish grant here,
          // not the key owner's — the route only checked `update` against the
          // key's scope.
          params.authenticatedScope,
          deferDocumentRule
        );
        // Pre-fetch the document-dependent rule + user so the in-transaction step
        // evaluates it against the row-locked document with no further metadata read.
        const documentRule = deferDocumentRule
          ? this.accessService.resolveTransitionDocumentRule(
              collection as Record<string, unknown>,
              accessUser,
              params.authenticatedScope
            )
          : null;
        if (permissionDenied || documentRule) {
          transitionGuard = {
            op: transitionOp,
            permissionDenied,
            documentRule,
          };
        }
      }

      // Wrap main update and component data save in a transaction so that
      // a component save failure rolls back the entry update — no partial state.
      // tx.execute() is used for the UPDATE so it runs on the same DB client
      // as the transaction (unlike tx.update() which delegates to the pool).
      // Resolved versioning config persisted on the collection (or null when
      // unversioned); read once so the in-tx capture below can skip cheaply.
      const versionsConfig = (collection as Record<string, unknown>)
        .versions as ResolvedVersionsConfig | null | undefined;

      // Resolved BEFORE the transaction opens, for the reason given on the
      // create path: expansion reads the component registry on the pooled
      // connection. Hoisting it also keeps a conflict retry from re-running the
      // same registry reads on every attempt.
      const webhookFields = await this.webhookFieldTree(fields);

      // Retry the whole content+capture transaction on a version_no allocation
      // race (concurrent updates to the same doc); the re-run re-reads the max.
      // The content UPDATE is a deterministic SET, so re-applying it is safe.
      // Committed pre-update status, refreshed each attempt: under a retry a
      // concurrent winner may have changed the status, so the D69 status event
      // below must report that as `previousStatus`, not the stale pre-tx value.
      let committedPreviousStatus: string | null | undefined;
      // The write locale's committed companion `_status` before this write, used
      // by the per-locale status event below. Re-read inside each attempt (like
      // committedPreviousStatus) so a retry reports the true prior state.
      let localizedPreviousStatus: string | null = null;
      // Reset at the start of each attempt and read back only after the retry
      // resolves, so a rolled-back attempt (a version conflict) or a commit
      // failure never flags a durable event that isn't there.
      let recorded = false;
      await withVersionConflictRetry(() =>
        this.adapter.transaction(async tx => {
          recorded = false;
          const updatePayload = {
            ...stripImmutableSystemFields(finalData),
            updatedAt: new Date(),
          };

          // This locale's committed status before the write, reused by both the
          // prior document and the post-write overlay so the two stay symmetric.
          let committedLocaleStatus: string | null = null;

          // Take the row lock the UPDATE below needs anyway, before reading the
          // prior state. Without it two concurrent updates to the same entry
          // interleave: this transaction reads the old row, the other commits,
          // then this UPDATE applies on top — so the post-write document carries
          // the other writer's fields while `previous` predates them, and the
          // diff attributes their change to this event. Acquiring the lock a few
          // statements early costs little, since the UPDATE takes the same lock
          // and holds it until commit either way.
          //
          // The adapter owns the dialect specifics and no-ops where row locking
          // does not exist.
          await tx.lockRow(tableName, params.entryId);

          // Read the committed state before this attempt's UPDATE. Nothing read
          // after the write can serve as prior state: the UPDATE below, the
          // companion upsert, and the many-to-many rewrite have all run by then.
          // Read through the transaction handle rather than the pool-backed
          // `this.db`: on Postgres and MySQL those are different connections, so
          // a pooled read could observe a concurrent commit that this
          // transaction will not, and report prior state the write never saw.
          const [preUpdateRow] = await tx
            .getDrizzle<typeof this.db>()
            .select()
            .from(schema)
            .where(eq(schema.id, params.entryId))
            .limit(1);

          // The status event uses the true prior value even after a conflict
          // retry. Only recorded for versioned collections (the only ones that
          // can retry), matching the status semantics the rest of this path
          // expects.
          if (versionsConfig?.enabled) {
            committedPreviousStatus = (
              preUpdateRow as { status?: unknown } | undefined
            )?.status as string | null | undefined;
          }

          // The prior document the outbox event reports as `previous`, read in
          // the same shape as the post-write document so the changed-field diff
          // compares like with like. Relations are read here, before they are
          // rewritten, so a component or m2m edit is visible in the diff.
          let previousDocument: Record<string, unknown> | null = null;
          if (preUpdateRow) {
            // The main row holds no translatable values and, for a per-locale
            // status, no current status either — both live in the companion.
            // Without them `previous` would omit every localized field that
            // `data` carries, so the diff would report untouched translations as
            // changed and lose the old value of the ones that did change.
            const previousLocalizedValues = localizedUpdate
              ? await this.readCompanionLocalizedValues(
                  tx,
                  params.collectionName,
                  params.entryId,
                  localizedUpdate.writeLocale
                )
              : {};
            // The locale's committed status, read before the write. Gated on
            // `hasStatus` rather than on the patch carrying a status: a content-
            // only translation update still has to report THIS locale's status,
            // which can differ from the main row (a German draft under a
            // published entry). The gate is what keeps the read safe — companion
            // `_status` exists only on collections migrated for per-locale
            // status, and querying it otherwise fails the whole write.
            committedLocaleStatus =
              localizedUpdate && localizedUpdate.hasStatus
                ? await this.readCompanionStatus(
                    tx,
                    localizedUpdate.companionTableName,
                    params.entryId,
                    localizedUpdate.writeLocale
                  )
                : null;
            const previousCompanionStatus = committedLocaleStatus;
            const previousParent = this.deserializeJsonFieldsForSnapshot(
              {
                ...convertTimestampsToCamelCase({
                  ...(preUpdateRow as Record<string, unknown>),
                }),
                ...previousLocalizedValues,
                ...(previousCompanionStatus !== null
                  ? { status: previousCompanionStatus }
                  : {}),
              },
              fields
            );
            stripPasswordFieldValues(previousParent, fields);
            stripSystemOwnerField(previousParent);
            const { components: previousComponents, manyToMany: previousM2M } =
              await this.buildFullSnapshotRelations(
                tx,
                params.entryId,
                params.collectionName,
                tableName,
                fields,
                manyToManyFields,
                // The resolved write locale — see the create path.
                localizedUpdate?.writeLocale ?? params.locale
              );
            previousDocument = assembleDocument({
              parentRow: previousParent,
              components: previousComponents,
              manyToMany: previousM2M,
            });
          }

          // TOCTOU-safe authorization: classify the transition against the
          // status just read UNDER THE ROW LOCK (`preUpdateRow` /
          // `committedLocaleStatus`), not the pre-transaction read, and enforce
          // the permission resolved before the transaction. A concurrent writer
          // that changed the published state between the pre-transaction read
          // and this lock is therefore accounted for. Runs before the UPDATE, so
          // throwing rolls the transaction back with nothing written.
          if (transitionGuard) {
            // A write can move the published state in two places, and the guard
            // must fire if EITHER makes the transition it denies:
            //   - the MAIN row `status` (a non-localized or default-locale write;
            //     a non-default-locale write leaves it untouched — its status was
            //     stripped from the main payload), and
            //   - the write locale's companion `_status` (any localized write that
            //     provides a status, INCLUDING the default locale, whose status
            //     lands on the companion row too).
            // Checking only the main row would let a default-locale write publish
            // a still-draft companion `_status` while the main row is already
            // published (a state reachable after a reconcile that added the
            // companion `_status` as draft under a published entry).
            const lockedMainStatus =
              ((preUpdateRow as { status?: unknown } | undefined)?.status as
                | string
                | undefined) ?? null;
            const mainNextStatus = isNonDefaultLocaleStatusWrite
              ? undefined
              : intendedStatus;
            const companionNextStatus = localizedUpdate?.companionData
              ?._status as string | undefined;
            const firesOnMainRow =
              mainNextStatus !== undefined &&
              resolvePublishTransition(lockedMainStatus, mainNextStatus) ===
                transitionGuard.op;
            const firesOnCompanion =
              companionNextStatus !== undefined &&
              resolvePublishTransition(
                committedLocaleStatus,
                companionNextStatus
              ) === transitionGuard.op;
            if (firesOnMainRow || firesOnCompanion) {
              // Permission first (pre-resolved, no DB read): a caller lacking
              // publish-<slug>/unpublish-<slug> is denied regardless of the row.
              if (transitionGuard.permissionDenied) {
                transitionDeniedResult = transitionGuard.permissionDenied;
                throw new StatusTransitionDeniedError();
              }
              // Then the deferred document-dependent (owner-only/custom) rule,
              // judged against the ROW-LOCKED document (`preUpdateRow`) — not the
              // stale pre-transaction `existingEntry` — so a custom rule keyed on
              // a mutable field sees the committed value this update transitions
              // from. Pure evaluation, no metadata or permission read.
              if (transitionGuard.documentRule && preUpdateRow) {
                const documentDenied =
                  await this.accessService.evaluateTransitionDocumentRule(
                    transitionGuard.documentRule.accessRules,
                    transitionGuard.op,
                    transitionGuard.documentRule.user,
                    preUpdateRow as Record<string, unknown>
                  );
                if (documentDenied) {
                  transitionDeniedResult = documentDenied;
                  throw new StatusTransitionDeniedError();
                }
              }
            }
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

          // Capture the committed per-locale `_status` BEFORE the upsert so the
          // post-commit event can report the real prior value. Only when the
          // write actually changes this locale's status (companion `_status` is
          // present only when `status` was explicitly in the patch).
          if (
            localizedUpdate &&
            typeof localizedUpdate.companionData._status === "string"
          ) {
            localizedPreviousStatus = await this.readCompanionStatus(
              tx,
              localizedUpdate.companionTableName,
              params.entryId,
              localizedUpdate.writeLocale
            );
          }

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
              // i18n: thread the write locale so an embedded localized component writes
              // translatable fields to its companion within the same transaction.
              locale: params.locale,
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
          {
            // Read on the transaction handle. Every update reaches this block
            // now that the assembly serves the outbox as well as versioning, and
            // a pooled read here would take a second connection while this
            // transaction still holds its own — enough to stall against a small
            // pool — besides being unable to see this transaction's own UPDATE.
            const freshRows = await tx
              .getDrizzle<typeof this.db>()
              .select()
              .from(schema)
              .where(eq(schema.id, params.entryId))
              .limit(1);
            // If the row is gone (deleted between the pre-read and this tx), the
            // UPDATE affected nothing and the method returns 404 below — do NOT
            // record a version for a write that did not commit. (No stale
            // fall-back to the pre-transaction existingEntry.)
            const currentRow = freshRows[0] as
              | Record<string, unknown>
              | undefined;
            if (currentRow) {
              // Match the read shape: keep user field keys (field.name, which may
              // contain underscores like `meta_title`) exactly, converting only
              // the timestamp columns — camel-casing every key would rewrite
              // those fields and diverge from a normal read.
              // The row as it stands AFTER this write (the UPDATE above has
              // already run); named for what it is, so it is never mistaken for
              // prior state — `previousDocument` above holds that.
              const currentParent = convertTimestampsToCamelCase({
                ...currentRow,
              });
              // Overlay `updatePayload` (not raw `finalData`): it carries the
              // `updatedAt` the write commits and has immutable system keys
              // (id/createdAt/createdBy) stripped, so the snapshot records the new
              // timestamp and cannot persist forged system values — `preImage`
              // keeps the real committed system columns.
              const companionStatus = localizedUpdate?.companionData?._status;
              // What this locale's status IS after the write: the value the
              // patch set, else the one already committed for the locale, else
              // the column default — a locale being translated for the first
              // time has no companion row, so the upsert creates one and
              // `_status` lands on its DEFAULT. Without this the document would
              // report the main row's status, telling receivers a brand-new
              // translation is published when the row just written is a draft.
              // The upsert below runs only when there are companion columns to
              // write, so an update touching shared fields alone leaves the
              // locale with no row at all. Claiming the default then would
              // invent a draft the write never committed and report a status
              // change against the main row.
              const writesCompanionRow =
                !!localizedUpdate &&
                Object.keys(localizedUpdate.companionData).length > 0;
              const effectiveLocaleStatus =
                typeof companionStatus === "string"
                  ? companionStatus
                  : (committedLocaleStatus ??
                    (localizedUpdate?.hasStatus && writesCompanionRow
                      ? COMPANION_DEFAULT_STATUS
                      : null));
              // A partial translatable update only carries the *changed*
              // localized values in `localizedFieldValues`; the write locale's
              // other companion fields (set by a prior write, untouched here)
              // would otherwise be dropped from the snapshot, since the main
              // `preImage` never holds translatable values. Read the full
              // localized field set for the write locale from the companion,
              // tx-visibly (read-your-writes, #226) so the just-upserted row is
              // included, with no locale fallback so the snapshot records
              // exactly this locale. The just-written values still overlay on
              // top. Undefined companion values are skipped so an untranslated
              // field is not written as `undefined` over the main value.
              const priorLocalizedValues = localizedUpdate
                ? await this.readCompanionLocalizedValues(
                    tx,
                    params.collectionName,
                    params.entryId,
                    localizedUpdate.writeLocale
                  )
                : {};
              const parentRow = this.deserializeJsonFieldsForSnapshot(
                {
                  ...currentParent,
                  ...updatePayload,
                  ...priorLocalizedValues,
                  ...(localizedUpdate?.localizedFieldValues ?? {}),
                  // Per-locale status lives in the companion, so the main row's
                  // `status` is not this locale's. Overlay the value this write
                  // committed, or — for a content-only update that carried no
                  // status — the one already stored for the locale, so the
                  // document never reports another locale's state.
                  ...(typeof effectiveLocaleStatus === "string"
                    ? { status: effectiveLocaleStatus }
                    : {}),
                },
                fields
              );
              stripPasswordFieldValues(parentRow, fields);
              // Strip the system owner column (created_by) — see create path.
              stripSystemOwnerField(parentRow);
              const {
                components: snapshotComponents,
                manyToMany: snapshotM2M,
              } = await this.buildFullSnapshotRelations(
                tx,
                params.entryId,
                params.collectionName,
                tableName,
                fields,
                manyToManyFields,
                // The resolved write locale — see the create path.
                localizedUpdate?.writeLocale ?? params.locale
              );
              const documentParts = {
                parentRow,
                components: snapshotComponents,
                manyToMany: snapshotM2M,
              };

              // Whether anything in this snapshot is specific to the write
              // locale: values read back from its companion row, values this
              // write put there, or its own status.
              const capturedLocaleState =
                Object.keys(priorLocalizedValues).length > 0 ||
                Object.keys(localizedUpdate?.localizedFieldValues ?? {})
                  .length > 0 ||
                typeof effectiveLocaleStatus === "string" ||
                // Components were read as the write locale just above, so a
                // translation edit touching only embedded component content is
                // locale-specific too — the singles path counts it the same way.
                Object.keys(snapshotComponents ?? {}).length > 0;

              if (versionsConfig?.enabled) {
                await captureInTx(tx, this.versionCapture, {
                  ref: {
                    scopeKind: "collection",
                    scopeSlug: params.collectionName,
                    entryId: params.entryId,
                  },
                  // Prefer the written status; for a localized write the status
                  // lives in the companion, so use this locale's effective value
                  // before the prior main-row status. The same value the snapshot
                  // records, or the version row would be indexed published while
                  // its own document says draft.
                  contentStatus:
                    (updatePayload as { status?: unknown }).status ??
                    effectiveLocaleStatus ??
                    (currentParent as { status?: unknown }).status,
                  // See the create path: tagged for the snapshot only.
                  parts: await this.snapshotPartsFor(documentParts, fields, tx),
                  createdBy: params.user?.id ?? null,
                  // Labelled with a locale only when locale-specific state was
                  // actually captured. A migrated localized collection routes
                  // every write through `localizedUpdate`, including one that
                  // touches only shared fields on a locale with no companion
                  // row — that snapshot holds no translations and falls back to
                  // the MAIN row's status, so calling it that locale's would let
                  // a restore publish a language from entry-level state.
                  // The write locale when the collection stores its own
                  // translations, otherwise the requested one: a collection
                  // that is not localized itself can still embed a localized
                  // component, and the components above were read as this
                  // language. The create path records it the same way; leaving
                  // it null here would make component translations captured on
                  // update unrestorable.
                  locale: capturedLocaleState
                    ? (localizedUpdate?.writeLocale ??
                      this.componentSnapshotLocale(params.locale))
                    : null,
                  sourceVersionNo: params.sourceVersionNo ?? null,
                  maxPerDoc: versionsConfig.maxPerDoc,
                });
              }

              // Append the outbox event in the same transaction, so it commits
              // with the entry and is never recorded for a write that rolls back.
              await recordMutationEvent(tx, {
                type: "entry.updated",
                resource: {
                  kind: "entry",
                  collection: params.collectionName,
                  id: params.entryId,
                  // The resolved write locale — see the create path.
                  ...(localizedUpdate
                    ? { locale: localizedUpdate.writeLocale }
                    : {}),
                },
                data: assembleDocument(documentParts),
                previous: previousDocument,
                fields: webhookFields,
                actor: actorForWrite(params.actor, params.user),
              });
              recorded = true;
            }
          }
        })
      );
      // The transaction committed (skipped if the retry ultimately threw), so
      // the event is durable; a later hook failure must not hide the delivery.
      eventRecorded = recorded;

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
          // The event may already be durable (the row vanished only after the
          // update committed), so still signal a delivery is owed.
          eventRecorded,
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

      // Per-locale status transition (i18n M6). On a localized collection the
      // status moves to the companion `_status` for the write locale, leaving
      // the main row's status unchanged — so the document-level check above
      // never fires. Emit the same lifecycle events tagged with `locale` when a
      // write actually changes this locale's status (companion `_status` is set
      // only when `status` was explicitly in the patch), so workflows see the
      // German publish they would otherwise miss. Skipped when the value did not
      // move (re-publishing already-published content fires nothing).
      const localizedNextStatus = localizedUpdate?.companionData._status;
      if (
        localizedUpdate &&
        typeof localizedNextStatus === "string" &&
        localizedNextStatus !== localizedPreviousStatus
      ) {
        this.transitionStatus({
          collection: params.collectionName,
          id: (updated as { id?: unknown }).id,
          data: { ...(updated as Record<string, unknown>) },
          user: params.user,
          previousStatus: localizedPreviousStatus,
          status: localizedNextStatus,
          emitStatusChanged: true,
          locale: localizedUpdate.writeLocale,
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
        // Reflects whether this update actually recorded an event (a no-op
        // update commits without one), so a no-op does not kick the drain.
        eventRecorded,
      };
    } catch (error: unknown) {
      // A publish-transition refused against the row-locked status aborts the
      // write; return the 403 the pre-transaction guard resolved, not a 500.
      // Read from the out-of-band result rather than `instanceof`: the adapter
      // wraps the thrown sentinel in a DatabaseError before it reaches here.
      if (transitionDeniedResult) {
        return transitionDeniedResult;
      }
      // See createEntry's catch — legacy override messages are dropped in
      // favour of fromDatabaseError's spec-compliant generic strings.
      // Pass dialect explicitly so the helper can normalise raw driver errors.
      return {
        ...errorToServiceResult(
          error,
          { defaultMessage: "Failed to update entry" },
          this.dialect
        ),
        eventRecorded,
      };
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
    /** Who performed the delete, recorded on the outbox event. */
    actor?: RequestActor;
    /** When true, bypass all access control checks */
    overrideAccess?: boolean;
    /** When true, the route middleware already ran the RBAC gate; stored rules
     * are still enforced. See CollectionAccessService.checkCollectionAccess. */
    routeAuthorized?: boolean;
    /** Arbitrary data passed to hooks via context */
    context?: Record<string, unknown>;
    /**
     * The caller's authenticated scope. A scoped API key is judged on its OWN
     * delete grant here, so the session super-admin bypass does not apply to a
     * super-admin-owned key on the delete gate.
     */
    authenticatedScope?: AuthenticatedScope;
  }): Promise<CollectionServiceResult> {
    // Set once the outbox event is appended (below); lets the catch report a
    // committed-but-hook-failed delete as `eventRecorded` even when `success` is
    // false. Declared out here so both the success and catch returns see it.
    let eventRecorded = false;
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
        params.routeAuthorized,
        // A scoped API key is judged on its own delete grant, so the session
        // super-admin bypass does not apply to a super-admin-owned key here.
        params.authenticatedScope
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

      // The collection schema, viewed two ways: the component cascade takes
      // FieldConfig, the outbox snapshot takes FieldDefinition. Both are the
      // same underlying array off the loosely-typed collection.
      const collectionFields = (collection.schemaDefinition?.fields ||
        collection.fields ||
        []) as FieldConfig[];
      const snapshotFields = (collection.schemaDefinition?.fields ||
        collection.fields ||
        []) as FieldDefinition[];
      // Resolved before the transaction opens: the expansion reads the component
      // registry on the pooled connection (see the create/update paths).
      const webhookFields = await this.webhookFieldTree(snapshotFields);

      // Delete the entry, cascade its component subtrees, and append the
      // `entry.deleted` event in one transaction, so the event commits with the
      // deletion and is never recorded for a delete that rolled back. (The
      // component cascade is best-effort inside the shared helper — it logs and
      // continues on a per-table failure — so this pairs the entry delete with
      // its event, not full cascade atomicity.)
      let deletedRow = false;
      await this.adapter.transaction(async tx => {
        // Lock and re-read the committed row inside the transaction. `entry`
        // above was read before the hooks ran and outside this transaction, so a
        // concurrent write may have changed or removed it; the event must
        // describe the row actually deleted, and the lock serializes a racing
        // delete so only one of them records the event. The adapter no-ops the
        // lock where row locking is unavailable (e.g. SQLite, itself serialized).
        await tx.lockRow(tableName, params.entryId);
        const [currentRow] = await tx
          .getDrizzle<typeof this.db>()
          .select()
          .from(schema)
          .where(eq(schema.id, params.entryId))
          .limit(1);
        if (!currentRow) return; // a concurrent delete won the race.

        // Read the removed document before the cascade delete removes its
        // relations, in the read shape create/update events use. A localized
        // collection keeps translatable values in the companion, so overlay the
        // default locale's.
        const { document: deletedDocument, locale: deletedLocale } =
          await this.buildDeletedDocument(tx, {
            collectionName: params.collectionName,
            entryId: params.entryId,
            tableName,
            row: currentRow as Record<string, unknown>,
            fields: snapshotFields,
            locale: this.localization?.defaultLocale,
          });

        if (this.componentDataService) {
          await this.componentDataService.deleteComponentDataInTransaction(tx, {
            parentId: params.entryId,
            parentTable: tableName,
            fields: collectionFields,
          });
        }

        const deletedCount = await tx.delete(
          tableName,
          this.whereEq("id", params.entryId)
        );
        // With the lock held a found row always deletes; the guard still covers
        // the lock-less dialects and keeps a racing delete from recording a
        // duplicate `entry.deleted` for a row it did not remove.
        if (deletedCount === 0) return;
        deletedRow = true;

        // The removed document's final state ships as `data`; there is no
        // post-delete state, so `previous` is null (mirroring create, which
        // carries only `data`). `locale` is set only for a localized collection,
        // so a receiver knows which translation the payload represents.
        await recordMutationEvent(tx, {
          type: "entry.deleted",
          resource: {
            kind: "entry",
            collection: params.collectionName,
            id: params.entryId,
            ...(deletedLocale ? { locale: deletedLocale } : {}),
          },
          data: deletedDocument,
          previous: null,
          fields: webhookFields,
          actor: actorForWrite(params.actor, params.user),
        });
      });
      // Set only after the transaction resolves: `deletedRow` is true exactly
      // when the delete + event committed, so a commit failure never flags a
      // durable event that isn't there; a later hook failure must not hide it.
      eventRecorded = deletedRow;

      // A concurrent delete removed the row first: report not-found rather than
      // a second success (and a duplicate event) for a deletion this call did
      // not perform.
      if (!deletedRow) {
        return {
          success: false,
          statusCode: 404,
          message: "Entry not found",
          data: null,
        };
      }

      const deleted = entry;

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
        eventRecorded,
      };
    } catch (error: unknown) {
      return {
        success: false,
        statusCode: 500,
        message:
          error instanceof Error ? error.message : "Failed to delete entry",
        data: null,
        eventRecorded,
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
      // Publish/unpublish authorization resolved by the batch caller before this
      // transaction opened, so the transition is enforced under the row lock with
      // no permission read inside the transaction. Self-resolved (pooled) when a
      // direct caller does not provide it.
      transitionAuth?: TransitionAuthorization;
    },
    body: Record<string, unknown>
  ): Promise<CollectionServiceResult<unknown>> {
    try {
      // A direct caller runs this inside its own transaction, so every metadata
      // and access read below is bound to that transaction's connection — a
      // pooled read would take a second connection the transaction is holding,
      // which stalls against a small pool.
      const txExecutor = tx.getDrizzle<RelationshipDbExecutor>();
      // 1. Check collection-level access FIRST
      const accessDenied = await this.accessService.checkCollectionAccess(
        params.collectionName,
        "create",
        params.user,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        txExecutor
      );
      if (accessDenied) {
        return accessDenied;
      }

      // Get collection metadata to identify relation fields and hooks
      const collection = await this.collectionService.getCollection(
        params.collectionName,
        txExecutor
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
        // Bind DB-reading hooks (e.g. the built-in sanitization hook) to the
        // caller's transaction connection so they do not re-enter the pool.
        executor: txExecutor,
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
            sharedContext,
            // Bind a stored hook's uniqueness read to the caller's transaction
            // connection so it does not re-enter the pool from inside the tx.
            tx.getDrizzle()
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

      // Strip an explicit `status: undefined` AFTER every mutating hook has run.
      // A field-level beforeValidate/beforeChange hook can (re)introduce an own
      // `status: undefined`, which names no status change but would otherwise be
      // sanitized to SQL NULL on the raw-parameter path — silently unpublishing a
      // published row, or nulling a create's draft default — without passing the
      // publish/unpublish gate. Placed here, the last status-touching step before
      // the transition classification and the write, so the write payload and the
      // gate agree even when a hook set the undefined.
      stripUndefinedStatus(finalData);

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

      // Authorize the published state this create will persist, on the post-hook
      // `finalData`: a hook that derives `status: "published"`, or a status field
      // the caller may not write, is judged on the value actually stored. A create
      // has no prior status, so landing on published needs `publish-<slug>` on top
      // of create; a trusted server write bypasses via overrideAccess.
      //
      // The permission is resolved OUTSIDE this transaction (pre-resolved by a
      // batch caller, or here on the pooled connection before the insert), then
      // enforced with no DB read inside the transaction — see
      // resolveTransitionAuthorization / enforceTransitionUnderLock.
      const transitionAuth =
        params.transitionAuth ??
        (await this.resolveTransitionAuthorization({
          collectionName: params.collectionName,
          accessUser: params.overrideAccess ? undefined : params.user,
          overrideAccess: params.overrideAccess,
          // This fallback fires only for a direct caller-owned-tx write (the bulk
          // paths always pre-resolve and pass transitionAuth), so bind the reads
          // to this transaction's connection rather than re-entering the pool.
          executor: tx.getDrizzle(),
        }));
      const transitionDenied = await this.enforceTransitionUnderLock(tx, {
        tableName,
        nextStatus: finalData.status,
        isCreate: true,
        auth: transitionAuth,
        createDocument: entryData,
      });
      if (transitionDenied) {
        return transitionDenied;
      }

      // Insert using transaction context
      const entry = await tx.insert<unknown>(tableName, entryData, {
        returning: "*",
      });

      // Handle many-to-many relationships on the caller's transaction so the
      // junction writes commit atomically with the entry.
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
        // Bind an after-hook that reads via context.executor to the caller's
        // transaction connection so it does not re-enter the pool from the tx.
        executor: tx.getDrizzle(),
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
          sharedContext,
          // Bind a stored hook's uniqueness read to the caller's transaction
          // connection so it does not re-enter the pool from inside the tx.
          tx.getDrizzle()
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
      // Publish/unpublish authorization resolved by the batch caller before this
      // transaction opened, so the transition is enforced under the row lock with
      // no permission read inside the transaction. Self-resolved (pooled) when a
      // direct caller does not provide it.
      transitionAuth?: TransitionAuthorization;
    },
    body: Record<string, unknown>
  ): Promise<CollectionServiceResult<unknown>> {
    try {
      // A direct caller runs this inside its own transaction, so every metadata
      // and access read below is bound to that transaction's connection — a
      // pooled read would take a second connection the transaction is holding,
      // which stalls against a small pool.
      const txExecutor = tx.getDrizzle<RelationshipDbExecutor>();
      // Get collection metadata and hooks first
      const collection = await this.collectionService.getCollection(
        params.collectionName,
        txExecutor
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
        existingEntry,
        undefined,
        undefined,
        undefined,
        undefined,
        txExecutor
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
        // Bind DB-reading hooks (e.g. the built-in sanitization hook) to the
        // caller's transaction connection so they do not re-enter the pool.
        executor: txExecutor,
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
            sharedContext,
            // Bind a stored hook's uniqueness read to the caller's transaction
            // connection so it does not re-enter the pool from inside the tx.
            tx.getDrizzle()
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

      // Strip an explicit `status: undefined` AFTER every mutating hook has run.
      // A field-level beforeValidate/beforeChange hook can (re)introduce an own
      // `status: undefined`, which names no status change but would otherwise be
      // sanitized to SQL NULL on the raw-parameter path — silently unpublishing a
      // published row, or nulling a create's draft default — without passing the
      // publish/unpublish gate. Placed here, the last status-touching step before
      // the transition classification and the write, so the write payload and the
      // gate agree even when a hook set the undefined.
      stripUndefinedStatus(finalData);

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
      // Authorize a change to the document's published state on the post-hook
      // `finalData`. Publishing or unpublishing needs `publish`/`unpublish` on top
      // of update; a trusted server write bypasses via overrideAccess. No-ops when
      // the collection has no lifecycle.
      //
      // Classified against the status read UNDER the row lock (not the pre-lock
      // `existingEntry`), using authorization resolved before this transaction, so
      // a concurrent writer that changed the published state between the initial
      // read and the write cannot slip a transition past the gate — and no
      // permission read runs inside the transaction.
      const transitionAuth =
        params.transitionAuth ??
        (await this.resolveTransitionAuthorization({
          collectionName: params.collectionName,
          accessUser: params.overrideAccess ? undefined : params.user,
          overrideAccess: params.overrideAccess,
          // This fallback fires only for a direct caller-owned-tx write (the bulk
          // paths always pre-resolve and pass transitionAuth), so bind the reads
          // to this transaction's connection rather than re-entering the pool.
          executor: tx.getDrizzle(),
        }));
      const transitionDenied = await this.enforceTransitionUnderLock(tx, {
        tableName,
        entryId: params.entryId,
        nextStatus: finalData.status,
        isCreate: false,
        auth: transitionAuth,
      });
      if (transitionDenied) {
        return transitionDenied;
      }

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
        // Bind an after-hook that reads via context.executor to the caller's
        // transaction connection so it does not re-enter the pool from the tx.
        executor: tx.getDrizzle(),
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
          sharedContext,
          // Bind a stored hook's uniqueness read to the caller's transaction
          // connection so it does not re-enter the pool from inside the tx.
          tx.getDrizzle()
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
      /** Who performed the delete, recorded on the outbox event. */
      actor?: RequestActor;
    }
  ): Promise<CollectionServiceResult<{ deleted: boolean }>> {
    // True only in the window between the row delete and the outbox insert: a
    // failure there has left this shared transaction with a delete but no event,
    // so the catch re-throws to force a rollback. Cleared once the event is
    // recorded — a later failure (e.g. an afterDelete hook) is a per-item
    // side-effect issue, not an eventless delete, and must NOT roll the batch back.
    let deleteNeedsRollback = false;
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
          sharedContext,
          // Bind a stored hook's uniqueness read to the caller's transaction
          // connection so it does not re-enter the pool from inside the tx.
          tx.getDrizzle()
        )
      );

      // The collection schema, two views: FieldConfig for the component cascade,
      // FieldDefinition for the outbox snapshot.
      const collectionFields = (collection.schemaDefinition?.fields ||
        collection.fields ||
        []) as FieldConfig[];
      const snapshotFields = (collection.schemaDefinition?.fields ||
        collection.fields ||
        []) as FieldDefinition[];

      // Lock and re-read the committed row before snapshotting it: `entry` above
      // was read before the hooks ran, so a concurrent update could otherwise
      // make the event describe values other than the row this delete removes.
      // The adapter no-ops the lock where row locking is unavailable (SQLite,
      // itself serialized).
      await tx.lockRow(tableName, params.entryId);
      const freshEntry = await tx.selectOne<Record<string, unknown>>(
        tableName,
        {
          where: this.whereEq("id", params.entryId),
        }
      );
      if (!freshEntry) {
        return {
          success: false,
          statusCode: 404,
          message: "Entry not found",
          data: null,
        };
      }

      // Assemble the removed document before the cascade removes its relations,
      // in the read shape create/update events use.
      const { document: deletedDocument, locale: deletedLocale } =
        await this.buildDeletedDocument(tx, {
          collectionName: params.collectionName,
          entryId: params.entryId,
          tableName,
          row: freshEntry,
          fields: snapshotFields,
          locale: this.localization?.defaultLocale,
        });

      // Cascade delete component data before deleting the main entry
      if (this.componentDataService) {
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
      deleteNeedsRollback = true;

      // Append the outbox event in the same transaction so a delete performed
      // through this helper (batch/cascade/internal) is observable too, in the
      // same shape as the single-delete path. Resolve component schemas on this
      // transaction's connection to avoid taking a second pooled connection.
      // `locale` is set only for a localized collection.
      await recordMutationEvent(tx, {
        type: "entry.deleted",
        resource: {
          kind: "entry",
          collection: params.collectionName,
          id: params.entryId,
          ...(deletedLocale ? { locale: deletedLocale } : {}),
        },
        data: deletedDocument,
        previous: null,
        fields: await this.webhookFieldTree(snapshotFields, tx.getDrizzle()),
        actor: actorForWrite(params.actor, params.user),
      });
      // The event is recorded, so the delete + event are now consistent; a later
      // failure no longer needs to force a rollback.
      deleteNeedsRollback = false;

      // Execute afterDelete hooks (code-registered)
      const afterContext = this.hookService.buildHookContext({
        collection: params.collectionName,
        operation: "delete" as const,
        data: entry,
        user: params.user,
        context: sharedContext,
        // Bind an after-hook that reads via context.executor to the caller's
        // transaction connection so it does not re-enter the pool from the tx.
        executor: tx.getDrizzle(),
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
          sharedContext,
          // Bind a stored hook's uniqueness read to the caller's transaction
          // connection so it does not re-enter the pool from inside the tx.
          tx.getDrizzle()
        )
      );

      return {
        success: true,
        statusCode: 200,
        message: "Entry deleted successfully",
        data: { deleted: true },
      };
    } catch (error: unknown) {
      // Only a failure in the delete→event window propagates (to roll back an
      // eventless delete). Pre-delete failures and post-event failures (e.g. an
      // afterDelete hook) stay soft: the row is either untouched or already
      // consistent with its event, so a returned failure is safe.
      if (deleteNeedsRollback) throw error;
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
      // Publish authorization resolved once by the batch caller before this
      // shared transaction opened, so the create-as-published is enforced with no
      // permission read inside the transaction. Self-resolved (pooled) when a
      // direct caller does not provide it.
      transitionAuth?: TransitionAuthorization;
    },
    body: Record<string, unknown>,
    skipHooks: boolean
  ): Promise<CollectionServiceResult<unknown>> {
    try {
      // Get collection metadata to identify relation fields. Runs on the
      // caller's transaction connection so this per-entry read does not re-enter
      // the pool from inside the transaction (which can stall against a small pool).
      const collection = await this.collectionService.getCollection(
        params.collectionName,
        tx.getDrizzle()
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
          // Bind DB-reading hooks (e.g. the built-in sanitization hook, which
          // loads field metadata) to the caller's transaction connection so they
          // do not re-enter the pool from inside the transaction.
          executor: tx.getDrizzle(),
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
              sharedContext,
              // Bind a stored hook's uniqueness read to the caller's transaction
              // connection so it does not re-enter the pool from inside the tx.
              tx.getDrizzle()
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

      // Strip an explicit `status: undefined` AFTER every mutating hook has run.
      // A field-level beforeValidate/beforeChange hook can (re)introduce an own
      // `status: undefined`, which names no status change but would otherwise be
      // sanitized to SQL NULL on the raw-parameter path — silently unpublishing a
      // published row, or nulling a create's draft default — without passing the
      // publish/unpublish gate. Placed here, the last status-touching step before
      // the transition classification and the write, so the write payload and the
      // gate agree even when a hook set the undefined.
      stripUndefinedStatus(finalData);

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

      // The bulk create worker inserts status like any other field, so publishing
      // through it needs `publish-<slug>` the same as a single create — otherwise
      // batch create is a way around the gate. Judged on the post-hook `finalData`
      // (hooks run unless skipped); a create has no prior status, and a trusted
      // server write bypasses via overrideAccess.
      //
      // Authorization is resolved once by the batch caller before this shared
      // transaction (or here on the pooled connection when called directly), so no
      // permission read runs inside the transaction.
      const transitionAuth =
        params.transitionAuth ??
        (await this.resolveTransitionAuthorization({
          collectionName: params.collectionName,
          accessUser: params.overrideAccess ? undefined : params.user,
          overrideAccess: params.overrideAccess,
          // This fallback fires only for a direct caller-owned-tx write (the bulk
          // paths always pre-resolve and pass transitionAuth), so bind the reads
          // to this transaction's connection rather than re-entering the pool.
          executor: tx.getDrizzle(),
        }));
      const transitionDenied = await this.enforceTransitionUnderLock(tx, {
        tableName,
        nextStatus: finalData.status,
        isCreate: true,
        auth: transitionAuth,
        createDocument: entryData,
      });
      if (transitionDenied) {
        return transitionDenied;
      }

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
          // Bind an after-hook that reads via context.executor to the caller's
          // transaction connection so it does not re-enter the pool from the tx.
          executor: tx.getDrizzle(),
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
            sharedContext,
            // Bind a stored hook's uniqueness read to the caller's transaction
            // connection so it does not re-enter the pool from inside the tx.
            tx.getDrizzle()
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
      // Publish/unpublish authorization resolved once by the batch caller before
      // this shared transaction opened, so the transition is enforced under the
      // row lock with no permission read inside the transaction. Self-resolved
      // (pooled) when a direct caller does not provide it.
      transitionAuth?: TransitionAuthorization;
      // The caller's authenticated scope. A scoped API key is judged on its OWN
      // update grant for the owner-only predicate + safety net, so a
      // super-admin-owned key cannot batch-update other users' rows.
      authenticatedScope?: AuthenticatedScope;
    },
    entryId: string,
    body: Record<string, unknown>,
    skipHooks: boolean
  ): Promise<CollectionServiceResult<unknown>> {
    try {
      // Get collection metadata to identify relation fields. Runs on the
      // caller's transaction connection so this per-entry read does not re-enter
      // the pool from inside the transaction (which can stall against a small pool).
      const collection = await this.collectionService.getCollection(
        params.collectionName,
        tx.getDrizzle()
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
        params.overrideAccess,
        // A scoped API key keeps the owner predicate even when owned by a
        // super-admin, so a batch update judges the key on its OWN grant.
        params.authenticatedScope,
        // Bound to the caller's transaction connection so the metadata read does
        // not re-enter the pool from inside the transaction.
        tx.getDrizzle()
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

      // A super-admin bypasses stored rules on every transport — EXCEPT via a
      // scoped API key, which is judged on its own grant (mirrors the owner
      // predicate + checkCollectionAccess). So the safety net still fires for a
      // scoped key even when the key owner is a super-admin.
      const isScopedApiKey = params.authenticatedScope?.actorType === "apiKey";
      if (
        accessRules?.update?.type === "owner-only" &&
        params.user &&
        // A trusted override (overrideAccess) and a super-admin SESSION bypass
        // stored rules on every transport, including the batch transaction
        // path — mirror the SQL owner-predicate bypass so this safety net does
        // not re-impose owner-only on them. A scoped API key is not covered by
        // the super-admin bypass.
        !params.overrideAccess &&
        !(this.accessService.isSuperAdmin(params.user) && !isScopedApiKey)
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
          // Bind DB-reading hooks (e.g. the built-in sanitization hook) to the
          // caller's transaction connection so they do not re-enter the pool.
          executor: tx.getDrizzle(),
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
              sharedContext,
              // Bind a stored hook's uniqueness read to the caller's transaction
              // connection so it does not re-enter the pool from inside the tx.
              tx.getDrizzle()
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

      // Strip an explicit `status: undefined` AFTER every mutating hook has run.
      // A field-level beforeValidate/beforeChange hook can (re)introduce an own
      // `status: undefined`, which names no status change but would otherwise be
      // sanitized to SQL NULL on the raw-parameter path — silently unpublishing a
      // published row, or nulling a create's draft default — without passing the
      // publish/unpublish gate. Placed here, the last status-touching step before
      // the transition classification and the write, so the write payload and the
      // gate agree even when a hook set the undefined.
      stripUndefinedStatus(finalData);

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
      // The Direct-API batch worker writes status like any other field, so a
      // status transition here needs `publish`/`unpublish` the same as a single
      // update — a bulk update must not publish what a single update could not.
      // A trusted server write bypasses via overrideAccess.
      //
      // Classified against the status read UNDER the row lock (not the pre-lock
      // `existingEntry`), using authorization resolved once by the batch caller
      // before this shared transaction, so a concurrent writer cannot slip a
      // transition past the gate and no permission read runs inside the batch's
      // transaction.
      const transitionAuth =
        params.transitionAuth ??
        (await this.resolveTransitionAuthorization({
          collectionName: params.collectionName,
          accessUser: params.overrideAccess ? undefined : params.user,
          overrideAccess: params.overrideAccess,
          // This fallback fires only for a direct caller-owned-tx write (the bulk
          // paths always pre-resolve and pass transitionAuth), so bind the reads
          // to this transaction's connection rather than re-entering the pool.
          executor: tx.getDrizzle(),
        }));
      const transitionDenied = await this.enforceTransitionUnderLock(tx, {
        tableName,
        entryId,
        nextStatus: finalData.status,
        isCreate: false,
        auth: transitionAuth,
      });
      if (transitionDenied) {
        return transitionDenied;
      }

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
          // Bind an after-hook that reads via context.executor to the caller's
          // transaction connection so it does not re-enter the pool from the tx.
          executor: tx.getDrizzle(),
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
            sharedContext,
            // Bind a stored hook's uniqueness read to the caller's transaction
            // connection so it does not re-enter the pool from inside the tx.
            tx.getDrizzle()
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
      /** Who performed the delete, recorded on the outbox event. */
      actor?: RequestActor;
    },
    entryId: string,
    skipHooks: boolean
  ): Promise<CollectionServiceResult<{ deleted: boolean }>> {
    // True only in the window between the row delete and the outbox insert: a
    // failure there has left this shared transaction with a delete but no event,
    // so the catch re-throws to force a rollback. Cleared once the event is
    // recorded — a later failure (e.g. an afterDelete hook) is a per-item
    // side-effect issue, not an eventless delete, and must NOT roll the batch back.
    let deleteNeedsRollback = false;
    // Set once the event is appended to the shared transaction; the batch caller
    // reads it back and applies it only after the transaction commits.
    let eventRecorded = false;
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
            sharedContext,
            // Bind a stored hook's uniqueness read to the caller's transaction
            // connection so it does not re-enter the pool from inside the tx.
            tx.getDrizzle()
          )
        );
      }

      // The collection schema, two views: FieldConfig for the component cascade,
      // FieldDefinition for the outbox snapshot.
      const collectionFields = (collection.schemaDefinition?.fields ||
        collection.fields ||
        []) as FieldConfig[];
      const snapshotFields = (collection.schemaDefinition?.fields ||
        collection.fields ||
        []) as FieldDefinition[];

      // Lock and re-read the committed row before snapshotting it: `entry` above
      // was read before the hooks ran, so a concurrent update could otherwise
      // make the event describe values other than the row this delete removes.
      // The adapter no-ops the lock where row locking is unavailable (SQLite,
      // itself serialized).
      await tx.lockRow(tableName, entryId);
      const freshEntry = await tx.selectOne<Record<string, unknown>>(
        tableName,
        {
          where: this.whereEq("id", entryId),
        }
      );
      if (!freshEntry) {
        return {
          success: false,
          statusCode: 404,
          message: `Entry not found: ${entryId}`,
          data: null,
        };
      }

      // Assemble the removed document before the cascade removes its relations,
      // in the read shape create/update events use.
      const { document: deletedDocument, locale: deletedLocale } =
        await this.buildDeletedDocument(tx, {
          collectionName: params.collectionName,
          entryId,
          tableName,
          row: freshEntry,
          fields: snapshotFields,
          locale: this.localization?.defaultLocale,
        });

      // Cascade delete component data before deleting the main entry
      if (this.componentDataService) {
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
      deleteNeedsRollback = true;

      // Append the outbox event in the same transaction so a batch delete
      // through this helper is observable too, in the same shape as the
      // single-delete path. Resolve component schemas on this transaction's
      // connection to avoid taking a second pooled connection. `locale` is set
      // only for a localized collection.
      await recordMutationEvent(tx, {
        type: "entry.deleted",
        resource: {
          kind: "entry",
          collection: params.collectionName,
          id: entryId,
          ...(deletedLocale ? { locale: deletedLocale } : {}),
        },
        data: deletedDocument,
        previous: null,
        fields: await this.webhookFieldTree(snapshotFields, tx.getDrizzle()),
        actor: actorForWrite(params.actor, params.user),
      });
      // The event is recorded, so the delete + event are now consistent; a later
      // failure no longer needs to force a rollback.
      deleteNeedsRollback = false;
      eventRecorded = true;

      // Execute afterDelete hooks (unless skipped)
      if (!skipHooks) {
        // Execute afterDelete hooks (code-registered)
        const afterContext = this.hookService.buildHookContext({
          collection: params.collectionName,
          operation: "delete" as const,
          data: entry,
          user: params.user,
          context: sharedContext,
          // Bind an after-hook that reads via context.executor to the caller's
          // transaction connection so it does not re-enter the pool from the tx.
          executor: tx.getDrizzle(),
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
            sharedContext,
            // Bind a stored hook's uniqueness read to the caller's transaction
            // connection so it does not re-enter the pool from inside the tx.
            tx.getDrizzle()
          )
        );
      }

      return {
        success: true,
        statusCode: 200,
        message: "Entry deleted successfully",
        data: { deleted: true },
        eventRecorded,
      };
    } catch (error: unknown) {
      // Only a failure in the delete→event window propagates (to roll back an
      // eventless delete). Pre-delete failures and post-event failures (e.g. an
      // afterDelete hook) stay soft: the row is either untouched or already
      // consistent with its event, so a returned failure is safe.
      if (deleteNeedsRollback) throw error;
      return {
        success: false,
        statusCode: 500,
        message:
          error instanceof Error ? error.message : "Failed to delete entry",
        data: null,
        eventRecorded,
      };
    }
  }
}
