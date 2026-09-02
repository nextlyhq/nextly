/**
 * CollectionQueryService — Read/query operations for collection entries.
 *
 * Extracted from CollectionEntryService (6,490-line god file).
 *
 * Responsibilities:
 * - List entries with pagination, search, where clauses, geo filtering
 * - Count entries matching criteria
 * - Get single entry by ID
 * - Build search and filter conditions for Drizzle ORM queries
 * - Apply field selection to filter response data
 */

import { AsyncLocalStorage } from "node:async_hooks";

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import { eq, and, or, like, ilike, sql, asc, desc } from "drizzle-orm";

import { transformRichTextFields } from "@nextly/lib/field-transform";
import type { RichTextOutputFormat } from "@nextly/lib/rich-text-html";
import type { FieldDefinition } from "@nextly/schemas/dynamic-collections";

import type { AuthenticatedScope } from "../../../auth/authenticated-scope";
import { isFieldGroupField } from "../../../collections/fields/guards";
import type { FieldConfig } from "../../../collections/fields/types";
import { errorEnvelopeFields } from "../../../errors/from-service-envelope";
import { NextlyError } from "../../../errors/nextly-error";
import { getFilterRegistry, FilterSeams } from "../../../filters";
import { toSnakeCase } from "../../../lib/case-conversion";
import { statusCondition } from "../../../lib/status-condition";
import {
  expansionStatusScope,
  resolveStatusFilter,
  type StatusFilter,
  type StatusOption,
} from "../../../lib/status-filter";
import { STORAGE_FORMAT } from "../../../schemas/storage-format";
import {
  describeUntranslatableConstraint,
  stripNoOpConstraintMembers,
} from "../../../services/access/constraint-shape";
import type {
  CollectionFileManager,
  CompanionSchema,
} from "../../../services/collection-file-manager";
import type { CollectionRelationshipService } from "../../../services/collections/collection-relationship-service";
import {
  buildDrizzleCondition,
  buildLocalizedWhereExists,
  type LocalizedQueryContext,
} from "../../../services/collections/drizzle-condition";
import {
  applyGeoFilters,
  sortByDistance,
} from "../../../services/collections/geo-utils";
import {
  buildWhereClause,
  extractGeoFilters,
  extractComponentFieldConditions,
} from "../../../services/collections/query-operators";
import type {
  WhereFilter,
  ComponentFieldFilter,
} from "../../../services/collections/query-operators";
import type { TrustBound } from "../../../services/collections/trust-grant";
import {
  assumedBound,
  narrows,
} from "../../../services/collections/trust-grant";
import type { FieldGroupDataService } from "../../../services/field-groups/field-group-data-service";
import type { Logger } from "../../../services/shared";
import { BaseService } from "../../../shared/base-service";
import {
  convertTimestampsToCamelCase,
  rehydrateSystemTimestamps,
  SYSTEM_TIMESTAMP_KEYS,
} from "../../../shared/lib/case-conversion";
import {
  applyFieldReadAccess,
  type ReadAccessRedactions,
  runFieldHooks,
} from "../../../shared/lib/field-level-registry";
import {
  assertFilterableFields,
  assertSortableField,
  filterSearchableFields,
} from "../../../shared/lib/filterable-fields";
import {
  hasPasswordField,
  stripPasswordFieldValues,
  stripSystemOwnerField,
} from "../../../shared/lib/password-fields";
import {
  buildPaginatedResponse,
  clampLimit,
  calculateOffset,
  PAGINATION_DEFAULTS,
} from "../../../types/pagination";
import type { PaginatedResponse } from "../../../types/pagination";
import type { DynamicCollectionService } from "../../dynamic-collections";
import { readFieldGroupType } from "../../field-groups/storage/field-group-type-key";
import { resolveTypeColumns } from "../../field-groups/storage/resolve-storage-names";
import { COMPANION_UPDATED_AT_COLUMN } from "../../i18n/companion-columns";
import {
  buildCompanionExists,
  buildLocalizedOrderExpr,
  buildTranslationStatusCondition,
  TRANSLATION_FILTER_STATES,
  populateCompanionFields,
  populateCompanionFieldsAllLocales,
  populateTranslationStatus,
  type TranslationStatusFilter,
  type TranslationFilterState,
} from "../../i18n/companion-join";
import type { SanitizedLocalizationConfig } from "../../i18n/config/types";
import {
  isValidLocale,
  resolveFallbackChain,
  resolveRequestedLocale,
} from "../../i18n/resolve-locale";
import {
  resolveCompanionColumn,
  resolveCompanionSchemaReadiness,
} from "../../i18n/runtime/companion-readiness";
import {
  NO_DECISIONS,
  type ReleaseDecisions,
} from "../../releases/release-scope";
import {
  NO_RELEASE_VISIBILITY,
  type ReleaseVisibility,
} from "../../releases/release-visibility";
import { resolveComponentTableName } from "../../schema/utils/resolve-table-name";
import {
  draftDocumentFacts,
  resolveDraftOverlay,
  type DraftDocumentConfig,
} from "../../versions/draft-overlay";
import {
  buildRestorePayload,
  type ComponentSchemas,
} from "../../versions/restore-snapshot";
import { resolveComponentSchemas } from "../../versions/restore-version";
import { rehydrateSnapshotDates } from "../../versions/tag-component-types";
import { VersionsRepository } from "../../versions/versions-repository";
import { workingDraftLocale } from "../../versions/working-draft-locale";

import type { CollectionAccessService } from "./collection-access-service";
import type { CollectionHookService } from "./collection-hook-service";
import type { CollectionServiceResult, UserContext } from "./collection-types";
import {
  getTableName,
  getSearchableFields,
  getMinSearchLength,
  decodeJsonFieldValues,
} from "./collection-utils";

/**
 * One component-field predicate, as raw SQL against a named column.
 *
 * Extracted from the filter loop so it can be built once per component TABLE
 * rather than once per filter: a `_componentType` filter over a dynamic zone
 * spans several tables, and the storage migration can have moved the
 * discriminator on some of them and not others.
 */
function buildComponentValueCondition(
  filter: ComponentFieldFilter,
  dbColumnName: string,
  dialect: string
): ReturnType<typeof sql> | undefined {
  let valueCondition: ReturnType<typeof sql>;

  switch (filter.operator) {
    case "equals":
      valueCondition = sql`${sql.identifier(dbColumnName)} = ${filter.value}`;
      break;
    case "not_equals":
      valueCondition = sql`${sql.identifier(dbColumnName)} != ${filter.value}`;
      break;
    case "greater_than":
      valueCondition = sql`${sql.identifier(dbColumnName)} > ${filter.value}`;
      break;
    case "greater_than_equal":
      valueCondition = sql`${sql.identifier(dbColumnName)} >= ${filter.value}`;
      break;
    case "less_than":
      valueCondition = sql`${sql.identifier(dbColumnName)} < ${filter.value}`;
      break;
    case "less_than_equal":
      valueCondition = sql`${sql.identifier(dbColumnName)} <= ${filter.value}`;
      break;
    case "like":
      valueCondition = sql`${sql.identifier(dbColumnName)} LIKE ${`%${String(filter.value)}%`}`;
      break;
    case "contains":
    case "search":
      // Use ILIKE for PostgreSQL, LIKE for others
      if (dialect === "postgresql") {
        valueCondition = sql`${sql.identifier(dbColumnName)} ILIKE ${`%${String(filter.value)}%`}`;
      } else {
        valueCondition = sql`LOWER(${sql.identifier(dbColumnName)}) LIKE LOWER(${`%${String(filter.value)}%`})`;
      }
      break;
    case "in": {
      const inValues = Array.isArray(filter.value)
        ? filter.value
        : [filter.value];
      if (inValues.length === 0) return undefined;
      const inPlaceholders = sql.join(
        inValues.map(v => sql`${v}`),
        sql`, `
      );
      valueCondition = sql`${sql.identifier(dbColumnName)} IN (${inPlaceholders})`;
      break;
    }
    case "not_in": {
      const notInValues = Array.isArray(filter.value)
        ? filter.value
        : [filter.value];
      if (notInValues.length === 0) return undefined;
      const notInPlaceholders = sql.join(
        notInValues.map(v => sql`${v}`),
        sql`, `
      );
      valueCondition = sql`${sql.identifier(dbColumnName)} NOT IN (${notInPlaceholders})`;
      break;
    }
    case "exists":
      if (filter.value === true || filter.value === "true") {
        valueCondition = sql`${sql.identifier(dbColumnName)} IS NOT NULL`;
      } else {
        valueCondition = sql`${sql.identifier(dbColumnName)} IS NULL`;
      }
      break;
    default:
      // An operator this builder does not implement contributes no condition.
      return undefined;
  }

  return valueCondition;
}

/**
 * A collection's declared top-level fields.
 *
 * The stored record carries them under `schemaDefinition.fields` for a
 * Builder collection and `fields` for a code-first one. Read through one
 * function because the draft-overlay decision and the read assembly both need
 * them, and a second copy of this fallback would be a second place for the two
 * to disagree about what the collection declares.
 */
function collectionFieldsFor(collection: unknown): FieldDefinition[] {
  const record = collection as Record<string, unknown>;
  const schemaDefinition = record.schemaDefinition as
    | Record<string, unknown>
    | undefined;
  return (schemaDefinition?.fields || record.fields || []) as FieldDefinition[];
}

/**
 * Whether this read is trusted for FIELD contents, which is not the same as
 * being trusted for rows.
 *
 * `overrideAccess` grants both, and a caller may deliberately hand the field
 * half back with `enforceFieldAccess` — a preview link reads a never-published
 * row as trusted while still hiding fields its recipient may not see. The
 * filter, sort and search guards all protect field CONTENTS, so every one of
 * them must follow the field decision rather than the row one. Asked in a
 * single place because three callers agreeing today is not three callers that
 * stay agreed.
 */
function fieldTrustOf(params: {
  overrideAccess?: boolean;
  enforceFieldAccess?: boolean;
}): boolean {
  return params.overrideAccess === true && params.enforceFieldAccess !== true;
}

export class CollectionQueryService extends BaseService {
  constructor(
    adapter: DrizzleAdapter,
    logger: Logger,
    private readonly fileManager: CollectionFileManager,
    private readonly collectionService: DynamicCollectionService,
    private readonly relationshipService: CollectionRelationshipService,
    private readonly accessService: CollectionAccessService,
    private readonly hookService: CollectionHookService,
    private readonly fieldGroupDataService?: FieldGroupDataService,
    /**
     * Normalized localization config (i18n M4). When set and a collection is localized,
     * reads resolve translatable fields from the companion `_locales` table for the
     * requested locale with fallback. Absent → non-localized behavior (unchanged).
     */
    private readonly localization?: SanitizedLocalizationConfig,
    /**
     * What a due release makes visible on this read.
     *
     * A null object by default, so a runtime with no releases wired needs no
     * special case here and cannot silently narrow a read by forgetting one.
     */
    private readonly releaseVisibility: ReleaseVisibility = NO_RELEASE_VISIBILITY
  ) {
    super(adapter, logger);
  }

  /**
   * The documents a due release would publish in this collection, if any.
   *
   * Costs a memo read while nothing is scheduled — see `createReleaseVisibility`
   * — so the common case is not paying for a query it cannot use. Only asked
   * for a PUBLISHED read: an unbounded or draft-only read has nothing to reveal.
   */
  private async releaseDecisions(
    collectionName: string,
    statusFilter: StatusFilter | null,
    now: Date
  ): Promise<ReleaseDecisions> {
    // Asked of the workflow rather than compared against the word `published`:
    // a release publishes into whatever state the workflow calls public, and a
    // literal here would skip the lookup — and the due publication — for any
    // team that renamed it.
    // Read off the filter, which carries why its set was chosen. Asking the
    // values again here would be a second answer to that question.
    if (statusFilter === null || !statusFilter.isPublicRead) {
      return NO_DECISIONS;
    }
    return this.releaseVisibility.decisions({
      scopeKind: "collection",
      scopeSlug: collectionName,
      now,
    });
  }

  // ============================================================
  // i18n (M4) — companion-aware read helpers
  // ============================================================

  /**
   * Resolve the fallback chain for a read request, or `null` when localization is off.
   * `fallbackLocale === false | "none"` disables fallback (chain = just the requested locale);
   * otherwise the requested locale's configured chain + default locale is used (spec §8).
   */
  private resolveLocaleChain(
    locale: string | undefined,
    fallbackLocale: string | false | undefined
  ): string[] | null {
    // `locale=all` is handled by a separate keyed-populate path — not a single-value chain.
    if (!this.localization || locale === "all") return null;
    const requested = resolveRequestedLocale(this.localization, locale);
    // A per-request opt-out disables fallback: return the requested language only.
    if (fallbackLocale === false || fallbackLocale === "none") {
      return [requested];
    }
    // A concrete per-request fallback locale overrides the configured chain: the
    // requested locale first, then the named fallback's own chain (deduped).
    if (
      typeof fallbackLocale === "string" &&
      isValidLocale(this.localization, fallbackLocale)
    ) {
      const seen = new Set<string>();
      return [
        requested,
        ...resolveFallbackChain(this.localization, fallbackLocale),
      ].filter(code => (seen.has(code) ? false : (seen.add(code), true)));
    }
    // The global localization.fallback switch (default true) disables fallback
    // for ordinary reads when turned off.
    if (!this.localization.fallback) {
      return [requested];
    }
    return resolveFallbackChain(this.localization, requested);
  }

  /**
   * `locale=all` populate (admin/export): set each localized field to a language-keyed object
   * covering every configured locale. No-op when localization is off, the request isn't
   * `locale=all`, or the collection isn't localized.
   */
  /**
   * Run a companion overlay, turning a driver failure into the canonical envelope.
   *
   * The companion reads used to swallow a failure — deciding existence by catching one is what
   * aborted PostgreSQL transactions — so these overlays could not throw and nothing here needed to
   * shape their errors. Now every failure propagates, and the result builders below put a bare
   * `Error`'s own message into the response: the failed query, with companion table and column
   * names in it.
   *
   * Only non-`NextlyError` failures are wrapped. One that is already typed carries a deliberate
   * status — a refused access constraint is a 403 — and flattening it would report an
   * authorization decision as a server fault.
   */
  private async overlayLocalized(
    collectionName: string,
    reason: string,
    run: () => Promise<void>
  ): Promise<void> {
    try {
      await run();
    } catch (error) {
      if (NextlyError.is(error)) throw error;
      throw NextlyError.internal({
        cause: error instanceof Error ? error : undefined,
        logContext: { collection: collectionName, reason },
      });
    }
  }

  private async populateLocalizedAll(
    collectionName: string,
    rows: Record<string, unknown>[],
    locale: string | undefined,
    preloaded?: CompanionSchema | null,
    statusFilterValues?: readonly string[] | null
  ): Promise<void> {
    if (!this.localization || locale !== "all" || rows.length === 0) return;
    const companion =
      preloaded ?? (await this.fileManager.loadCompanionSchema(collectionName));
    if (!companion) return;
    await populateCompanionFieldsAllLocales({
      db: this.db as never,
      companionTable: companion.table,
      // Outside any transaction, so this may resolve rather than only read what is remembered.
      readiness: await resolveCompanionSchemaReadiness(this.adapter, companion),
      localizedFields: companion.localizedFields,
      rows,
      locales: this.localization.locales.map(l => l.code),
      // Only constrain by status on a status-enabled collection with a resolved
      // single status, so a published locale=all read drops draft translations.
      statusValues:
        companion.hasStatus && statusFilterValues
          ? statusFilterValues
          : undefined,
    });
  }

  /**
   * Translation-status overview populate (i18n M7): attach a per-locale `_translations` map
   * (which languages are translated + each one's draft/published status) to each row, for the
   * admin's completeness badges / per-language pills / language filter. One batched query over
   * the page. No-op when localization is off or the collection isn't localized.
   */
  private async populateTranslationMeta(
    collectionName: string,
    rows: Record<string, unknown>[],
    preloaded?: CompanionSchema | null,
    statusFilterValues?: readonly string[] | null
  ): Promise<void> {
    if (!this.localization || rows.length === 0) return;
    const companion =
      preloaded ?? (await this.fileManager.loadCompanionSchema(collectionName));
    if (!companion) return;
    // Which languages hold a pending change, for this whole page in one query.
    // Read here rather than inside the join because the versions repository
    // takes the adapter this service already has, and because a per-row lookup
    // would turn a list render into one round trip per document.
    const pendingChangeLocales = await new VersionsRepository(
      this.adapter
    ).findPendingChangeLocales(
      "collection",
      collectionName,
      rows.map(r => r.id).filter((id): id is string => typeof id === "string")
    );
    // 🔴 Resolved ONCE and read twice. `populateTranslationStatus` returns immediately for any
    // verdict but `ready`, so probing the column for a companion that is not there introspects a
    // table that does not exist to answer a question nobody will ask — and since a negative column
    // verdict is deliberately not remembered, it does that on every list read until the operator
    // migrates. Resolving it inline in the argument list is what hid the ordering.
    const readiness = await resolveCompanionSchemaReadiness(
      this.adapter,
      companion
    );
    await populateTranslationStatus({
      db: this.db as never,
      companionTable: companion.table,
      pendingChangeLocales,
      readiness,
      localizedFields: companion.localizedFields,
      rows,
      locales: this.localization.locales.map(l => l.code),
      defaultLocale: this.localization.defaultLocale,
      hasStatus: companion.hasStatus,
      // 🔴 Supplied only when the companion PHYSICALLY carries the column, which is a different
      // question from whether the schema declares it. `companion.hasUpdatedAt` reports the
      // DECLARED shape and is unconditionally true, so trusting it would emit SQL naming a column
      // a pre-existing companion may not have and fail the whole read for that collection.
      //
      // Omission is the mechanism rather than a flag, because absent is already the defined answer
      // for a caller that cannot ask: every locale then reports UNKNOWN, which is never rendered
      // as up to date. A wrong "needs review" is indistinguishable from a right one to the person
      // reading it, so the conservative direction is the only safe default.
      //
      // Resolved on the pool BEFORE any transaction opens — a failed probe inside one marks the
      // whole PostgreSQL transaction aborted and the error then names an innocent statement.
      //
      // Unconditional here, unlike the filter path, and the difference is that this read NEEDS the
      // answer: there is no badge without it. A companion that already carries the column answers
      // from the remembered verdict and costs nothing; one that predates it pays an introspection
      // per list read, because a negative is deliberately not remembered and the migration that
      // would end that cost runs in another process. That is the same trade `companion-readiness`
      // already makes for an entity in a `pre-migration` state, and it is bounded the same way —
      // it stops the moment the operator migrates.
      staleness:
        readiness === "ready" &&
        (await resolveCompanionColumn(
          this.adapter,
          companion.companionTableName,
          COMPANION_UPDATED_AT_COLUMN
        ))
          ? {
              companionTableName: companion.companionTableName,
              dialect: this.adapter.dialect,
            }
          : undefined,

      // On a status-scoped read, don't report a draft-only translation as present.
      statusValues:
        companion.hasStatus && statusFilterValues
          ? statusFilterValues
          : undefined,
    });
  }

  /**
   * Pull the reserved `_translated` key (i18n M7 language filter) out of a where object, returning
   * the validated filter and a cleaned where without it (so the generic where-builder never sees
   * it). Shape: `{ _translated: { locale, state } }`, state ∈ missing|translated|draft|published.
   */
  /**
   * What a caller may select and order by, asked once for both read verbs.
   *
   * `listEntries` and `countEntries` ask the same question of the same request,
   * and a count is the CLEANER oracle of the two -- it answers 1 or 0 for a
   * guessed value and returns no row to redact -- so the two must not be able
   * to drift. One method rather than a copy in each.
   */
  private assertQueryReadable(params: {
    collectionName: string;
    where?: WhereFilter;
    sort?: string;
    overrideAccess?: boolean;
    frameworkFilter?: boolean;
  }): void {
    const opts = {
      overrideAccess: fieldTrustOf(params),
      frameworkFilter: params.frameworkFilter,
    };
    // `params.where` -- what the CALLER sent -- never the hook-settled
    // predicate. A `beforeRead` or `beforeOperation` hook is trusted server
    // code and narrows reads on purpose, sometimes by a protected column (a
    // tenant scope is the ordinary case); judging its output would reject the
    // very reads those hooks exist to make safe.
    assertFilterableFields(
      "collection",
      params.collectionName,
      params.where,
      opts
    );
    assertSortableField("collection", params.collectionName, params.sort, opts);
  }

  /**
   * The searchable fields this caller may actually be matched against.
   *
   * Narrowed rather than refused: the caller named no column, so dropping the
   * ones they may not read answers exactly what they asked.
   */
  private searchableFieldsFor(
    collectionName: string,
    collectionMeta: Record<string, unknown>,
    /** Field trust, as `assertQueryReadable` computes it -- never raw row trust. */
    fieldTrusted?: boolean
  ): string[] {
    return filterSearchableFields(
      "collection",
      collectionName,
      getSearchableFields(collectionMeta),
      { overrideAccess: fieldTrusted }
    );
  }

  private extractTranslationStatusFilter(where: WhereFilter | undefined): {
    filter: TranslationStatusFilter | null;
    cleanedWhere: WhereFilter | undefined;
  } {
    if (!where || typeof where !== "object") {
      return { filter: null, cleanedWhere: where };
    }
    const raw = where as Record<string, unknown>;
    if (!("_translated" in raw)) return { filter: null, cleanedWhere: where };
    const { _translated, ...rest } = raw;
    const cleanedWhere =
      Object.keys(rest).length > 0 ? (rest as WhereFilter) : undefined;
    const f = _translated as { locale?: unknown; state?: unknown };
    const states: readonly TranslationFilterState[] = TRANSLATION_FILTER_STATES;
    if (
      typeof f?.locale !== "string" ||
      typeof f?.state !== "string" ||
      !states.includes(f.state as TranslationFilterState)
    ) {
      return { filter: null, cleanedWhere };
    }
    return {
      filter: { locale: f.locale, state: f.state as TranslationFilterState },
      cleanedWhere,
    };
  }

  /**
   * Build the SQL condition for a `_translated` filter (i18n M7). Loads the companion (reusing a
   * preloaded one) and delegates to {@link buildTranslationStatusCondition}. Returns `undefined`
   * for non-localized collections or no-op filters.
   */
  private async buildTranslationStatusFilterCondition(
    collectionName: string,
    filter: TranslationStatusFilter,
    mainIdColumn: unknown,
    preloaded?: CompanionSchema | null
  ): Promise<ReturnType<typeof buildTranslationStatusCondition>> {
    if (!this.localization) return undefined;
    const companion =
      preloaded ?? (await this.fileManager.loadCompanionSchema(collectionName));
    if (!companion) return undefined;
    return buildTranslationStatusCondition({
      companionTableName: companion.companionTableName,
      mainIdColumn,
      localizedColumns: companion.localizedFields.map(f => f.column),
      hasStatus: companion.hasStatus,
      // 🔴 The PHYSICAL answer, not the declared one, and it is the same probe the per-row badge
      // resolves — so the tab and the badge cannot disagree about whether the question is even
      // askable for this collection.
      //
      // `companion.hasUpdatedAt` reports the DECLARED shape and is unconditionally true, which is
      // a claim about a physical column that nothing has checked. Emitting SQL naming a column a
      // pre-existing companion lacks would fail the query for that collection, and a filter that
      // cannot be evaluated is worse than one returning nothing: the worklist would present every
      // document as needing review.
      //
      // False leaves the `stale` arm answering `1=0` — nothing is KNOWN to be stale — which is
      // the defined answer for "cannot ask" rather than a claim that nothing is.
      //
      // 🔴 Resolved ONLY for the state that reads it. The probe introspects, and a NEGATIVE verdict
      // is deliberately not cached — so on a companion that predates the column, asking here
      // unconditionally would put a catalogue query on every filtered list, twice per page, for a
      // capability the other four states never consult. The one state that needs it pays for it.
      hasUpdatedAt:
        filter.state === "stale"
          ? await resolveCompanionColumn(
              this.adapter,
              companion.companionTableName,
              COMPANION_UPDATED_AT_COLUMN
            )
          : undefined,
      defaultLocale: this.localization.defaultLocale,
      filter,
    });
  }

  /**
   * Populate localized fields onto result rows from the companion `_locales` table for the
   * resolved locale chain. No-op when localization is off (`localeChain === null`), there are no
   * rows, or the collection is not localized (no companion). Shared by getEntry + listEntries.
   */
  private async populateLocalized(
    collectionName: string,
    rows: Record<string, unknown>[],
    localeChain: string[] | null,
    preloaded?: CompanionSchema | null,
    /**
     * Resolved status the read is scoped to (`"published"` / `"draft"`), or `null` for `all`.
     * When the companion has per-locale status (i18n M6), a companion row whose `_status` differs
     * is filtered out so a draft translation never leaks — the field falls back to the published
     * default.
     */
    statusFilterValues?: readonly string[] | null
  ): Promise<void> {
    if (!localeChain || rows.length === 0) return;
    const companion =
      preloaded ?? (await this.fileManager.loadCompanionSchema(collectionName));
    if (!companion) return;
    await populateCompanionFields({
      db: this.db as never,
      companionTable: companion.table,
      readiness: await resolveCompanionSchemaReadiness(this.adapter, companion),
      localizedFields: companion.localizedFields,
      rows,
      localeChain,
      statusValues:
        companion.hasStatus && statusFilterValues
          ? statusFilterValues
          : undefined,
    });
  }

  /**
   * Build the localized-query context for the search/where builders, or `null` when the
   * collection isn't localized. Uses the requested locale (chain head) for EXISTS filtering.
   */
  /**
   * Run the hooks that precede a where-filtered read and return the filter they
   * settled on.
   *
   * The chain is the caller's own filter, then `beforeOperation`'s `args.where`,
   * then `beforeRead`'s return, and each stage is shown the previous stage's
   * result. Stating it in one place matters twice over: a hook cannot narrow a
   * filter it was never shown, and a list and its count have to narrow
   * identically or the total describes rows the list correctly withheld.
   *
   * The `CollectionsListQuery` filter seam runs after this, on what this
   * returns.
   *
   * With no hooks registered both calls hand back what they were given, so the
   * caller's filter reaches the query untouched.
   */
  /**
   * The collections whose read hooks are running on this async call stack.
   *
   * A read handler may read again -- a `count()` for a quota, a `findByID()`
   * for related state -- and that was safe while a count ran no hooks. Now
   * that every read path runs them, a nested read of the collection the
   * handler is already running for would call that handler a second time, and
   * so on without end.
   *
   * Scoped per collection, not per call stack: a nested read of a DIFFERENT
   * collection is an ordinary read and must run that collection's own hooks.
   * Those hooks may be what scopes it to a tenant or hides soft-deleted rows,
   * so suppressing them would hand the handler rows the other collection
   * withholds -- a silent widening, which is worse than the recursion this
   * guards against.
   *
   * Keyed by collection rather than by individual handler because handlers can
   * cycle in pairs (a handler on A reads B, a handler on B reads A) and only a
   * per-collection key breaks that. The cost is that a handler re-reading its
   * own collection runs unhooked, which is what such handlers were written
   * against.
   */
  private static readonly activeReadHookCollections = new AsyncLocalStorage<
    ReadonlySet<string>
  >();

  /** True when this collection's read hooks are already running up-stack. */
  private static readHooksActiveFor(collectionName: string): boolean {
    return (
      CollectionQueryService.activeReadHookCollections
        .getStore()
        ?.has(collectionName) ?? false
    );
  }

  /**
   * Runs `run` with this collection marked active, preserving any collection
   * already marked so an A-reads-B-reads-A cycle still terminates.
   */
  private static withReadHookScope<T>(
    collectionName: string,
    run: () => Promise<T>
  ): Promise<T> {
    const active = CollectionQueryService.activeReadHookCollections.getStore();
    const nested = new Set(active ?? []);
    nested.add(collectionName);
    return CollectionQueryService.activeReadHookCollections.run(nested, run);
  }

  private async resolveReadWhere(params: {
    collectionName: string;
    where: WhereFilter | undefined;
    user?: UserContext;
    sharedContext: Record<string, unknown>;
  }): Promise<WhereFilter | undefined> {
    // Already inside this collection's read hooks: the call came from one of
    // its own handlers, so it uses the filter it was given and runs nothing.
    if (CollectionQueryService.readHooksActiveFor(params.collectionName)) {
      return params.where;
    }
    const seededWhere = params.where ?? {};
    return CollectionQueryService.withReadHookScope(
      params.collectionName,
      async () => {
        const beforeOpArgs =
          await this.hookService.hookRegistry.executeBeforeOperation({
            collection: params.collectionName,
            operation: "read",
            // An object, for the same reason `beforeRead` gets one below: a
            // handler scoping in place (`ctx.args.where.tenant = ...`) would
            // otherwise throw on every unfiltered read instead of adding its
            // predicate. The settled filter keeps `undefined` as its own value.
            args: { where: seededWhere },
            user: params.user
              ? { id: params.user.id, email: params.user.email }
              : undefined,
            context: params.sharedContext,
          });

        // Returning an args object replaces the arguments wholesale, so a handler
        // that omits `where` -- or sets it to `undefined` -- is clearing the filter,
        // not declining to change it. Only the absence of a returned object leaves
        // the caller's filter in place.
        // The seeded object is an input convenience, not a filter. If it comes
        // back untouched and still empty, the read has no filter -- turning that
        // into `{}` would make every downstream `if (where)` believe one exists.
        const returnedWhere = beforeOpArgs ? beforeOpArgs.where : params.where;
        const afterBeforeOperation = (
          returnedWhere === seededWhere && Object.keys(seededWhere).length === 0
            ? params.where
            : returnedWhere
        ) as WhereFilter | undefined;

        const beforeReadResult = await this.hookService.hookRegistry.execute(
          "beforeRead",
          this.hookService.buildHookContext({
            collection: params.collectionName,
            operation: "read" as const,
            // Always an object: handlers documented as "modify query parameters"
            // assign onto it in place, and handing them `undefined` would throw on
            // every unfiltered read rather than adding their predicate.
            data: afterBeforeOperation ?? {},
            user: params.user,
            context: params.sharedContext,
          })
        );

        // `undefined` means the hook returned nothing, so the filter is unchanged;
        // `null` is a deliberate return the registry preserves, and it means the
        // hook cleared the filter. Collapsing the two would leave a hook unable to
        // widen a read it had decided should not be narrowed.
        if (beforeReadResult === undefined) return afterBeforeOperation;
        return beforeReadResult ?? undefined;
      }
    );
  }

  /**
   * The detail read's half of {@link resolveReadWhere}: runs `beforeOperation`
   * and `beforeRead` for a read by id and returns the id they settled on.
   *
   * Deliberately the same check-then-enter shape as the list half. A detail
   * read reached from another read's handler must skip its hooks for the same
   * reason a nested list does, and holding both to one shape is what keeps the
   * guard from being applied to one path and not the other.
   */
  private async resolveReadEntryId(params: {
    collectionName: string;
    entryId: string;
    user?: UserContext;
    sharedContext: Record<string, unknown>;
  }): Promise<string> {
    if (CollectionQueryService.readHooksActiveFor(params.collectionName)) {
      return params.entryId;
    }
    return CollectionQueryService.withReadHookScope(
      params.collectionName,
      async () => {
        const beforeOpArgs =
          await this.hookService.hookRegistry.executeBeforeOperation({
            collection: params.collectionName,
            operation: "read",
            args: { id: params.entryId },
            user: params.user
              ? { id: params.user.id, email: params.user.email }
              : undefined,
            context: params.sharedContext,
          });

        // Use the modified id when beforeOperation returned one.
        const resolvedId = beforeOpArgs?.id ?? params.entryId;

        await this.hookService.hookRegistry.execute(
          "beforeRead",
          this.hookService.buildHookContext({
            collection: params.collectionName,
            operation: "read" as const,
            data: { entryId: resolvedId },
            user: params.user,
            context: params.sharedContext,
          })
        );

        return resolvedId;
      }
    );
  }

  private buildLocalizedQueryContext(
    companion: CompanionSchema | null,
    localeChain: string[] | null,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Drizzle dynamic schema
    schema: any,
    statusFilterValues?: readonly string[] | null
  ): LocalizedQueryContext | null {
    if (!companion || !localeChain || localeChain.length === 0) return null;
    // The caller resolves the Draft/Published filter before building the context and
    // passes it as `statusFilterValues`, so per-locale where/search/order subqueries
    // constrain by the resolved status too (a public read never matches a draft).
    return {
      companionTableName: companion.companionTableName,
      localizedFields: companion.localizedFields,
      mainIdColumn: schema.id,
      locale: localeChain[0],
      // Only constrain by status when the collection has per-locale status and the
      // read resolved to a single status; otherwise leave it unfiltered.
      statusValues:
        companion.hasStatus && statusFilterValues
          ? statusFilterValues
          : undefined,
    };
  }

  // ============================================================
  // PUBLIC METHODS
  // ============================================================

  /**
   * List entries in a collection with pagination.
   *
   * Returns a paginated response with documents and
   * comprehensive pagination metadata.
   *
   * Applies collection-level access control and expands relationships.
   *
   * Security checks are applied in order:
   * 1. Collection-level access (AccessControlService)
   *
   * @param params - Collection name, user context, pagination, and query options
   * @returns Paginated response with docs array and pagination metadata
   *
   * @example
   * ```typescript
   * const result = await entryService.listEntries({
   *   collectionName: 'posts',
   *   user: { id: 'user-123', role: 'editor' },
   *   page: 2,
   *   limit: 20,
   *   search: 'tutorial',
   * });
   *
   * if (result.success) {
   *   console.log(result.data.docs);        // Entry[]
   *   console.log(result.data.totalDocs);   // Total count
   *   console.log(result.data.page);        // Current page (2)
   *   console.log(result.data.totalPages);  // Total pages
   *   console.log(result.data.hasNextPage); // boolean
   *   console.log(result.data.hasPrevPage); // boolean
   * }
   * ```
   */
  async listEntries(params: {
    collectionName: string;
    user?: UserContext;
    /** Search query to filter entries by searchable fields */
    search?: string;
    /**
     * Page number (1-indexed).
     * @default 1
     */
    page?: number;
    /**
     * Number of documents per page.
     * Maximum allowed is 500 to prevent abuse.
     * @default 10
     */
    limit?: number;
    /**
     * Depth for relationship population (0-5).
     * - 0: No expansion, return IDs only
     * - 1: Expand immediate relationships
     * - 2+ (default): Expand nested relationships
     * @default 2
     */
    depth?: number;
    /**
     * Select specific fields to include in the response.
     * Format: `{ fieldName: true }` to include fields.
     * The `id` field is always included regardless of selection.
     * Supports dot notation for nested fields (e.g., `{ 'author.name': true }`).
     *
     * @example
     * ```typescript
     * // Select only title and slug
     * { title: true, slug: true }
     *
     * // Select nested field from relationship
     * { title: true, 'author.name': true }
     * ```
     */
    select?: Record<string, boolean>;
    /**
     * Where clause for advanced filtering.
     *
     * Supports all query operators:
     * - equals, not_equals: Exact match
     * - greater_than, greater_than_equal, less_than, less_than_equal: Numeric/date comparison
     * - like, contains: Text search (case-insensitive)
     * - in, not_in: Array membership
     * - exists: Field existence check
     *
     * Also supports compound queries with `and` and `or`.
     *
     * @example
     * ```typescript
     * // Simple equality
     * { status: { equals: 'published' } }
     *
     * // Numeric comparison
     * { price: { greater_than: 100 } }
     *
     * // OR condition
     * { or: [
     *   { status: { equals: 'draft' } },
     *   { status: { equals: 'pending' } }
     * ]}
     *
     * // Complex AND/OR
     * { and: [
     *   { status: { equals: 'published' } },
     *   { or: [
     *     { author: { equals: 'john' } },
     *     { author: { equals: 'jane' } }
     *   ]}
     * ]}
     * ```
     */
    where?: WhereFilter;
    /**
     * Output format for rich text fields.
     * - "json" (default): Return Lexical JSON structure only
     * - "html": Return HTML string only
     * - "both": Return object with both { json, html } properties
     * @default "json"
     */
    richTextFormat?: RichTextOutputFormat;
    /**
     * Sort order for results.
     * Prefix with `-` for descending.
     *
     * @example
     * ```typescript
     * sort: '-createdAt'  // Sort by createdAt descending
     * sort: 'title'       // Sort by title ascending
     * ```
     */
    sort?: string;
    /** When true, bypass all access control checks (collection-level, field permissions) */
    overrideAccess?: boolean;
    /**
     * Enforce FIELD-level read rules even on a read that is otherwise trusted.
     *
     * `overrideAccess` governs two different trusts with one boolean — "you may
     * see this row" and "skip every field rule" — and a caller can genuinely
     * need the first without the second. A shared preview link is the case that
     * forced them apart: it must reach a never-published row, which only
     * `overrideAccess` grants, and it must NOT show its recipient fields the
     * person who shared it cannot see, which is what the same flag silently
     * turned off.
     *
     * Absent means today's behaviour exactly — field trust follows row trust —
     * so no existing caller changes. Set it beside a `user`: the rules are
     * evaluated as THAT user, and a trusted read has otherwise dropped its user
     * for row purposes (see `accessUser`), so the two are asked separately on
     * purpose.
     *
     * Relationship expansion has always carried its own copy of this question
     * ({@link RelatedRowReadContext.enforceFieldAccess}); this is the same axis
     * for the top-level rows, which had no way to express it.
     */
    enforceFieldAccess?: boolean;
    /**
     * Whose field-level read rules to judge by, when that is NOT the caller.
     *
     * A preview link is the case this exists for. The bearer is anonymous and
     * must stay anonymous to every hook — a hook branching on `req.user` that
     * saw the sharer would add an editor-only value and hand it to whoever
     * holds the link, and a value a hook invents need not correspond to any
     * declared field, so the access pass below cannot remove it again. What the
     * sharer decides is narrower than that: which of the document's declared
     * fields are visible.
     *
     * So it is a redaction basis and nothing else, and it is a separate
     * parameter for exactly that reason. Folding it into `user` made the
     * identity mean two things at once, which is the shape of defect this
     * option exists to repair one level up.
     *
     * Absent means the caller's own `user`, which is the ordinary case.
     */
    fieldAccessUser?: UserContext;
    /**
     * This `where` was built by the framework from a route it was asked to
     * render, not received from a request.
     *
     * Exempts it from `assertFilterableFields`, whose subject is a caller
     * CHOOSING probe values against a field it may not read. Per-operation and
     * never a config field, so a nested call cannot inherit it.
     */
    frameworkFilter?: boolean;
    /**
     * Which collections a trusted read may reach as relationships are expanded,
     * asked per RELATED collection. Absent means every populated target inherits
     * the caller's trust. Evaluated as `overrideAccess && trusted(target)`, so it
     * can only ever narrow. See {@link RelatedRowReadContext.trusted}.
     */
    trusted?: TrustBound;
    /**
     * The route middleware already ran the RBAC gate for the authorizing
     * operation, so skip only that redundant re-check while still evaluating
     * the stored read rules (owner-only filter, custom queries). Used by the
     * bulk-by-query writers to enumerate their targets: the route authorized
     * the write, so an update/delete-only key must not be rejected by a read
     * RBAC gate here — but owner-only scoping must still apply.
     */
    routeAuthorized?: boolean;
    /**
     * The caller's authenticated scope. A scoped API key is judged on its OWN
     * read grant, so a super-admin-owned key stays bound by a `read: owner-only`
     * rule instead of inheriting the owner's session bypass. Undefined for
     * session/system callers. Mirrors getEntry.
     */
    authenticatedScope?: AuthenticatedScope;
    /**
     * Draft/Published filter override. Only takes effect when the collection
     * has Draft/Published enabled (collection.status === true).
     * - 'published' (default for public callers): only published rows
     * - 'draft': only draft rows
     * - 'all': skip the filter entirely
     * Trusted callers (overrideAccess: true) default to 'all' if unset.
     */
    status?: StatusOption;
    /**
     * Requested content locale (i18n M4). For a localized collection, translatable fields are
     * resolved to this language (with fallback) from the companion `_locales` table.
     */
    locale?: string;
    /** Fallback control. `false`/`"none"` disables fallback (raw requested language). */
    fallbackLocale?: string | false;
    /**
     * i18n M7: when true, attach a per-locale `_translations` map (translated + status) to each
     * row for the admin translation-status overview. No-op for non-localized collections.
     */
    translationStatus?: boolean;
    /** Arbitrary data passed to hooks via context */
    context?: Record<string, unknown>;
  }): Promise<CollectionServiceResult<PaginatedResponse<unknown>>> {
    try {
      // Determine the effective user for access control
      // When overrideAccess is true, skip all access checks even if user is provided
      const accessUser = params.overrideAccess ? undefined : params.user;

      // 1. Check collection-level access FIRST
      const accessDenied = await this.accessService.checkCollectionAccess<
        PaginatedResponse<unknown>
      >(
        params.collectionName,
        "read",
        accessUser,
        undefined,
        undefined,
        params.overrideAccess,
        params.routeAuthorized,
        // A scoped API key is judged on its own read grant, so the session
        // super-admin bypass does not apply to a super-admin-owned key here.
        params.authenticatedScope
      );
      if (accessDenied) {
        return accessDenied;
      }

      const schema = await this.fileManager.loadDynamicSchema(
        params.collectionName
      );

      // i18n M4: resolve the locale chain + load the companion once, so both the sort
      // block (in-query ORDER BY on a localized column) and the post-query populate reuse
      // it. `null` when localization is off or the collection isn't localized.
      const localeChain = this.resolveLocaleChain(
        params.locale,
        params.fallbackLocale
      );
      const companion =
        localeChain || params.locale === "all" || params.translationStatus
          ? await this.fileManager.loadCompanionSchema(params.collectionName)
          : null;

      // Shared context between all hooks in this request
      // Seed with caller's context if provided (e.g., from Direct API)
      const sharedContext: Record<string, unknown> = { ...params.context };

      // BEFORE the hooks, deliberately. `resolveReadWhere` hands them the
      // caller's own object, and a hook that narrows it IN PLACE -- adding a
      // tenant predicate to the same reference -- would otherwise leave this
      // "caller-only" check reading a predicate the caller never sent, and
      // rejecting the read that hook exists to make safe. Running first is what
      // makes "what the caller sent" true rather than intended.
      this.assertQueryReadable(params);

      // The read hooks settle the filter before any seam or constraint touches
      // it, so `beforeOperation` and `beforeRead` both narrow the rows actually
      // returned rather than being computed and dropped.
      const hookedWhere = await this.resolveReadWhere({
        collectionName: params.collectionName,
        where: params.where,
        user: params.user,
        sharedContext,
      });

      // D63 seam: let plugins transform the structured list-query `where`.
      // Guarded by hasFilters so default behavior (no plugins) is unchanged. It
      // runs last, on what the hooks settled, because it is the only one of the
      // three that was already live.
      const filterRegistry = getFilterRegistry();
      const listQueryWhere = filterRegistry.hasFilters(
        FilterSeams.CollectionsListQuery
      )
        ? await filterRegistry.applyFilters(
            FilterSeams.CollectionsListQuery,
            hookedWhere ?? {},
            {
              collection: params.collectionName,
              userId: params.user?.id,
              search: params.search,
              limit: params.limit,
            }
          )
        : hookedWhere;

      // Build base query using Drizzle (via BaseService db compatibility layer)
      let query = this.db.select().from(schema);

      // Build final query conditions
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Drizzle SQL condition accumulator
      const whereConditions: any[] = [];

      // Get access query constraint (e.g., for owner-only filtering)
      const accessConstraint =
        await this.accessService.getAccessQueryConstraint(
          params.collectionName,
          accessUser,
          params.overrideAccess,
          // Scope the owner filter too: without this a super-admin-owned scoped
          // key takes the session bypass and reads past its own grant, the
          // predicate having been lifted before it ever reached SQL.
          params.authenticatedScope
        );

      // The constraint is applied further down, through the same translation
      // the caller's own `where` uses: it is a full filter predicate, not a
      // single equality, and reducing it here would narrow less than the rule
      // asks for.

      // Apply Draft/Published auto-filter. The helper returns null when the
      // collection has no status column, the caller is trusted with no
      // explicit choice, or explicit was 'all'. Otherwise it returns the
      // value to filter by ('published' for public callers by default).
      // Guarding on schema.status avoids referencing a column that may not
      // exist when the collection has status disabled.
      const collectionForStatus = await this.collectionService.getCollection(
        params.collectionName
      );
      const statusFilter = resolveStatusFilter({
        collectionHasStatus:
          (collectionForStatus as { status?: boolean }).status === true,
        overrideAccess: params.overrideAccess === true,
        explicit: params.status,
      });
      // ONE instant for this read. Each release lookup taking its own
      // `new Date()` let a release become due between the row query and a
      // sibling condition, so one response could carry pre-release rows beside
      // a post-release count.
      const readNow = new Date();
      const releaseCondition = statusCondition({
        filter: statusFilter,
        statusColumn: schema.status,
        idColumn: schema.id,
        decisions: await this.releaseDecisions(
          params.collectionName,
          statusFilter,
          readNow
        ),
      });
      if (releaseCondition) whereConditions.push(releaseCondition);
      // Build the localized-query context AFTER the status filter is resolved so
      // localized where/search EXISTS checks constrain by the per-locale status too
      // (a published read must not match a draft translation).
      const localizedCtx = this.buildLocalizedQueryContext(
        companion,
        localeChain,
        schema,
        statusFilter?.values
      );

      // Apply search filter if provided
      if (params.search) {
        // Get collection metadata for search configuration
        const collectionMeta = await this.collectionService.getCollection(
          params.collectionName
        );

        // Check minimum search length
        const minLength = getMinSearchLength(collectionMeta);
        if (params.search.trim().length >= minLength) {
          // Get searchable fields
          // Narrowed, not refused: the caller never named a column, so
          // dropping the ones they may not read answers what they asked.
          // Leaving them in lets `search=<guess>` probe a hidden value
          // through which rows come back.
          const searchableFields = this.searchableFieldsFor(
            params.collectionName,
            collectionMeta,
            fieldTrustOf(params)
          );

          if (searchableFields.length === 0) {
            // Every searchable field carries a read rule, so this caller has
            // nothing to be matched against. Adding NO condition would return
            // and count every otherwise-visible row -- the exact opposite of a
            // narrowed search, and a worse answer than the leak this narrowing
            // exists to close. An unsatisfiable predicate is the honest reading
            // of "matched against nothing".
            whereConditions.push(sql`1 = 0`);
          } else {
            // Determine database dialect for ILIKE vs LIKE
            const dialect = this.adapter?.dialect || "postgresql";

            // Build search condition (localizedCtx routes localized searchable fields to
            // a companion EXISTS instead of dropping them).
            const searchCondition = this.buildSearchCondition(
              schema,
              searchableFields,
              params.search,
              dialect,
              localizedCtx
            );

            if (searchCondition) {
              whereConditions.push(searchCondition);
            }
          }
        }
      }

      // ============================================================
      // GEO FILTERING: Extract geo operators for post-query filtering
      // ============================================================

      // i18n M7: pull the reserved `_translated` language filter out FIRST — the geo/component
      // extractors below drop object-valued keys they don't recognize, so it must be removed
      // before them and turned into a companion EXISTS/NOT EXISTS condition.
      // Before the filter can reach SQL. Redaction runs on rows already chosen,
      // so it cannot answer a `where` that selected them BY a hidden value.

      const { filter: translationFilter, cleanedWhere: whereAfterTranslation } =
        this.extractTranslationStatusFilter(listQueryWhere);
      if (translationFilter) {
        const translationCondition =
          await this.buildTranslationStatusFilterCondition(
            params.collectionName,
            translationFilter,
            schema.id,
            companion
          );
        if (translationCondition) whereConditions.push(translationCondition);
      }

      // Extract geo filters (near, within) that must be applied in JS
      // These operators can't be translated to SQL for cross-database support
      const { geoFilters, cleanedWhere: whereAfterGeo } = extractGeoFilters(
        whereAfterTranslation
      );
      const hasGeoFilters = geoFilters.length > 0;

      // ============================================================
      // COMPONENT FIELD FILTERING: Extract for EXISTS subqueries
      // ============================================================

      // Get collection metadata early for component field detection
      // (may have been fetched above for search — we'll reuse if available)
      const collectionForFilters = await this.collectionService.getCollection(
        params.collectionName
      );
      const fieldsForFilters = ((
        (collectionForFilters as Record<string, unknown>).schemaDefinition as
          | Record<string, unknown>
          | undefined
      )?.fields ||
        (collectionForFilters as Record<string, unknown>).fields ||
        []) as Array<{
        name: string;
        type: string;
        component?: string;
        components?: string[];
      }>;

      // Extract component field conditions (e.g., 'seo.metaTitle')
      // These require EXISTS subqueries against component data tables
      const { componentFilters, cleanedWhere } =
        extractComponentFieldConditions(whereAfterGeo, fieldsForFilters);

      // Determine database dialect for ILIKE vs LIKE
      const dialect = this.adapter?.dialect || "postgresql";

      // Get the table name for component subqueries
      const tableName = getTableName(params.collectionName);

      // Build component field EXISTS conditions
      const componentTables =
        await this.resolveComponentTableNames(componentFilters);
      // Kept so the count over these same filters can reuse them instead of
      // repeating the registry lookup and the catalog introspection.
      const componentTypeColumns = await this.resolveComponentTypeColumns(
        componentFilters,
        componentTables.values()
      );
      const componentCondition = this.buildComponentFieldConditions(
        componentFilters,
        tableName,
        schema.id,
        dialect,
        componentTables,
        componentTypeColumns
      );

      // Apply component field conditions to query
      if (componentCondition) {
        whereConditions.push(componentCondition);
      }

      // Apply where clause if provided (excluding geo and component operators)
      if (cleanedWhere) {
        // Convert WhereFilter to internal WhereClause format
        const internalWhere = buildWhereClause(cleanedWhere);

        // Build Drizzle condition from the WhereClause
        const whereCondition = this.buildDrizzleCondition(
          internalWhere,
          schema,
          dialect,
          localizedCtx
        );

        if (whereCondition) {
          whereConditions.push(whereCondition);
        }
      }

      // Apply the stored read rule's query constraint through the same
      // translation the caller's `where` uses. It is a full filter predicate:
      // an owner-only read emits one field, but a custom rule can return any
      // supported operator across several fields, and reading a single `equals`
      // off the first key silently returns rows the rule excludes.
      if (accessConstraint) {
        // Refuse before translating: a partially translatable constraint yields a
        // non-empty condition that binds less than the rule requires.
        const untranslatable = describeUntranslatableConstraint(
          accessConstraint,
          name => Object.prototype.hasOwnProperty.call(schema, name),
          name =>
            Boolean(localizedCtx?.localizedFields.some(f => f.name === name))
        );
        // Explicitly against null: a reason can be any string, and an empty one
        // would read as success.
        if (untranslatable !== null) {
          // Logged here rather than left on the error: the surrounding catch
          // flattens this into a result envelope, so the reason would otherwise
          // never reach operator logs and every refusal would look alike.
          this.logger.warn("Refused an untranslatable access constraint", {
            collection: params.collectionName,
            reason: untranslatable,
          });
          throw NextlyError.forbidden({
            logContext: {
              collection: params.collectionName,
              reason: "untranslatable-access-constraint",
              reason_detail: untranslatable,
            },
          });
        }
        // Members that cannot narrow anything are removed before translation,
        // so the "translated to nothing" check below judges only what was meant
        // to restrict. A constraint made up entirely of them restricts nothing,
        // and the rule already allowed the caller.
        const restricting = stripNoOpConstraintMembers(accessConstraint);
        const accessCondition =
          Object.keys(restricting).length === 0
            ? undefined
            : this.buildDrizzleCondition(
                buildWhereClause(restricting as WhereFilter),
                schema,
                dialect,
                localizedCtx
              );
        if (accessCondition) {
          whereConditions.push(accessCondition);
        } else if (Object.keys(restricting).length > 0) {
          // A constraint that translates to nothing would widen the read to
          // every row. Fail closed instead: the rule asked to narrow.
          throw NextlyError.forbidden({
            logContext: {
              collection: params.collectionName,
              reason: "untranslatable-access-constraint",
            },
          });
        }
      }

      // Apply all collective WHERE conditions
      if (whereConditions.length > 0) {
        query = query.where(
          whereConditions.length === 1
            ? whereConditions[0]
            : and(...whereConditions)
        );
      }

      // ============================================================
      // SORTING: Apply ORDER BY clause
      // ============================================================

      // Parse sort format: '-createdAt' → DESC, 'title' → ASC
      if (params.sort) {
        const sortDesc = params.sort.startsWith("-");
        const sortField = sortDesc ? params.sort.slice(1) : params.sort;

        // Convert camelCase field names to snake_case for database column lookup
        // e.g., 'createdAt' → 'created_at', 'updatedAt' → 'updated_at'
        const toSnakeCase = (str: string): string => {
          return str.replace(/([A-Z])/g, "_$1").toLowerCase();
        };

        const sortFieldSnake = toSnakeCase(sortField);

        // i18n M4: a localized sort field lives in the companion table (absent from the main
        // schema). Order by a correlated subquery pulling the companion value for the requested
        // locale (with fallback) so pagination is correct. Applied only when the collection is
        // localized and this field is one of its translatable fields.
        const localizedSortField =
          companion && localeChain
            ? companion.localizedFields.find(
                f => f.name === sortField || f.column === sortFieldSnake
              )
            : undefined;

        // The system owner column is stripped from responses, so it must not be
        // sortable either — sorting by it would let a caller order/target rows
        // by creator. Ignore an owner-column sort instead of resolving it.
        const ownerSort =
          sortField === "created_by" ||
          sortField === "createdBy" ||
          sortFieldSnake === "created_by";

        // Try both camelCase and snake_case versions of the field name
        // This handles both user-defined fields (often camelCase) and system fields (snake_case in DB)
        const column = ownerSort
          ? undefined
          : schema[sortField] || schema[sortFieldSnake];

        if (localizedSortField && companion && localeChain) {
          const orderExpr = buildLocalizedOrderExpr({
            companionTableName: companion.companionTableName,
            mainIdColumn: schema.id,
            column: localizedSortField.column,
            localeChain,
            statusValues: localizedCtx?.statusValues, // don't sort by draft translations
          });
          query = query.orderBy(sortDesc ? desc(orderExpr) : asc(orderExpr));
        } else if (column) {
          query = query.orderBy(sortDesc ? desc(column) : asc(column));
        } else if (sortField) {
          // Log warning if sort field is not found in either format
          this.logger?.warn(
            `Sort field '${sortField}' (or '${sortFieldSnake}') not found in schema for collection '${params.collectionName}'. ` +
              `Available fields: ${Object.keys(schema).join(", ")}`
          );
        }
      }

      // ============================================================
      // PAGINATION: Apply page/limit parameters
      // ============================================================

      // Extract pagination parameters with defaults
      const page = Math.max(1, params.page ?? PAGINATION_DEFAULTS.page);
      const limit = clampLimit(params.limit ?? PAGINATION_DEFAULTS.limit);
      const offset = calculateOffset(page, limit);

      // For geo-filtered queries, we need to fetch all candidates first,
      // apply geo filtering in memory, then paginate the result.
      // For non-geo queries, apply standard SQL pagination.
      let entries: Record<string, unknown>[];
      let totalDocs: number;

      if (hasGeoFilters) {
        // Geo filtering: fetch all matching entries (with reasonable limit)
        // We'll filter and paginate in memory
        const maxGeoResults = 10000; // Prevent memory issues on very large collections
        query = query.limit(maxGeoResults);
        entries = await query;

        // We'll calculate totalDocs after geo filtering below
        totalDocs = 0;
      } else {
        // Standard pagination: use SQL LIMIT/OFFSET
        query = query.limit(limit).offset(offset);

        // Execute data query and count query in parallel
        // We call countEntries separately to get total (it handles same filters)
        const [fetchedEntries, countResult] = await Promise.all([
          query,
          this.countEntries({
            collectionName: params.collectionName,
            user: params.user,
            search: params.search,
            // This count is part of THIS read, so it resolves releases against
            // the same instant the rows did.
            releaseNow: readNow,
            // Resolved once for this request; see the parameter's own note.
            resolvedComponentTables: componentTables,
            resolvedComponentTypeColumns: componentTypeColumns,
            // Geo operators removed (the count cannot apply them), but component
            // predicates kept: `cleanedWhere` has BOTH stripped, and the count
            // builds its own EXISTS conditions from the ones it is given. Sending
            // the component-stripped filter counts rows the page excluded, so a
            // read filtered on `seo.metaTitle` reported a total describing rows
            // it had correctly withheld.
            where: whereAfterGeo,
            // The read hooks already ran for this request and `cleanedWhere`
            // is what they settled on. Running them again here would fire every
            // side effect twice -- an audit entry, a rate-limit tick -- for one
            // list call.
            readHooksAlreadyRan: true,
            // The `_translated` language filter was stripped from `cleanedWhere` for
            // the list query; pass it explicitly so the count applies the same filter.
            // Without it the count ignores the filter and over-counts
            // totalDocs/totalPages when a language filter is active.
            translationFilter: translationFilter ?? undefined,
            // Forward locale so count mirrors any locale-scoped filter (M4b parity).
            locale: params.locale,
            fallbackLocale: params.fallbackLocale,
            // The count has to answer the same question as the rows beside it.
            // Both resolve the Draft/Published filter from these two, so
            // leaving them out counts published-only for every caller: a
            // trusted reader gets its drafts listed but not counted, and
            // totalPages then hides the tail of its own result set.
            status: params.status,
            overrideAccess: params.overrideAccess,
            frameworkFilter: true,
            // Not a caller, and not a second boundary. This count is THIS
            // read's own continuation: the caller's filter was judged at the
            // top of `listEntries`, and what arrives here is the settled
            // predicate, which legitimately carries whatever a trusted
            // `beforeRead` hook narrowed it by. Re-judging it would reject a
            // list that was already allowed -- and the rejection is swallowed
            // into `totalDocs = 0`, so the page would come back correct with a
            // total that quietly said there was nothing.

            // The count must answer the same access question as the rows, or a
            // route-authorized update/delete-only caller gets its read gate
            // denied here and totalDocs silently falls back to 0 — breaking the
            // bulk-by-query limit guard and pagination.
            routeAuthorized: params.routeAuthorized,
            // The scope has to travel with it for the same reason. The rows
            // above are filtered by the key's own grant, so a count taken
            // without the scope takes the owner's super-admin bypass instead
            // and reports the unscoped total beside correctly filtered rows —
            // disclosing how many rows exist outside the grant.
            authenticatedScope: params.authenticatedScope,
          }),
        ]);

        entries = fetchedEntries;

        // Extract total from count result (default to 0 if failed)
        totalDocs =
          countResult.success && countResult.data
            ? countResult.data.totalDocs
            : 0;
      }

      // i18n M4: resolve localized fields for the whole page from the companion table
      // (batch — one query for all rows), with fallback, BEFORE relationship/component
      // expansion and hooks. Reuses the companion loaded above. No-op when non-localized.
      await this.overlayLocalized(
        params.collectionName,
        "translation-load-failed",
        () =>
          this.populateLocalized(
            params.collectionName,
            entries,
            localeChain,
            companion,
            statusFilter?.values ?? null // i18n M6: per-locale published filter
          )
      );
      // `locale=all` → language-keyed values per localized field (admin/export).
      await this.overlayLocalized(
        params.collectionName,
        "translation-projection-failed",
        () =>
          this.populateLocalizedAll(
            params.collectionName,
            entries,
            params.locale,
            companion,
            statusFilter?.values ?? null // i18n M6: per-locale published filter
          )
      );
      // i18n M7: per-locale translation-status map for the admin overview (opt-in).
      if (params.translationStatus) {
        await this.overlayLocalized(
          params.collectionName,
          "translation-overview-failed",
          () =>
            this.populateTranslationMeta(
              params.collectionName,
              entries,
              companion,
              statusFilter?.values ?? null // i18n M6: per-locale published filter
            )
        );
      }

      // Get collection metadata to identify relation fields and hooks
      const collection = await this.collectionService.getCollection(
        params.collectionName
      );
      const fields = collectionFieldsFor(collection);
      const storedHooks = this.hookService.getStoredHooks(
        collection as Record<string, unknown>
      );

      // Use batch expansion to avoid N+1 queries for better scalability
      // Pass depth parameter for relationship population control
      let expandedEntries =
        await this.relationshipService.batchExpandRelationships(
          entries,
          params.collectionName,
          fields,
          {
            depth: params.depth,
            // Expansion spreads whole related rows into these entries, and this
            // collection's field rules say nothing about another collection's
            // fields — so the caller has to reach the related row's own rules.
            enforceFieldAccess: true,
            fieldAccessUser: params.fieldAccessUser,
            // The caller's bound, at the TOP-LEVEL expansion. Without it the
            // relationship service sees no predicate and treats every target as
            // fully trusted, so a rejected collection's rows are returned before
            // the post-assembly pass ever runs.
            trusted: params.trusted,
            // This path finishes with the post-assembly pass, so the target's
            // field rules run there, after its masking hooks have seen a whole
            // row.
            fieldAccessStage: "assembled" as const,
            user: params.user,
            overrideAccess: params.overrideAccess,
            authenticatedScope: params.authenticatedScope,
            // The language this read resolved to, so a target collection whose
            // read rule filters on a localized field can have that filter
            // applied against the right companion rows instead of withholding.
            locale: localeChain?.[0],
            // Only "read everything" propagates, and only when the caller
            // actually asked for it. Deriving this from the parent having
            // resolved to no filter would unfilter every target behind a
            // status-less collection.
            status: expansionStatusScope({
              status: params.status,
              overrideAccess: params.overrideAccess,
              bounded: narrows(params.trusted),
            }),
          }
        );

      // Batch-populate component field data from comp_{slug} tables
      // Uses WHERE _parent_id IN (...) for N+1 prevention
      // Pass depth for relationship expansion within component data
      // Pass select to skip component fields excluded from selection (performance optimization)
      if (this.fieldGroupDataService) {
        expandedEntries =
          await this.fieldGroupDataService.populateComponentDataMany({
            entries: expandedEntries,
            parentTable: getTableName(params.collectionName),
            fields: fields as FieldConfig[],
            depth: params.depth,
            select: params.select,
            // i18n: thread the read locale so embedded localized components resolve
            // per language across the list, and forward fallback control so the
            // admin's no-fallback edit mode (`?fallback-locale=none`) leaves an
            // untranslated embedded field blank instead of showing default text.
            locale: params.locale,
            fallbackLocale: params.fallbackLocale,
            // A component's relationship fields copy whole rows out of the
            // target collection, which this collection's field rules say nothing
            // about — so the caller travels down to reach the related row's own
            // rules, exactly as it does for direct relationships.
            access: {
              enforceFieldAccess: true,
              fieldAccessUser: params.fieldAccessUser,
              user: params.user,
              overrideAccess: params.overrideAccess,
              // Narrows that bypass per RELATED collection. Absent means unchanged;
              // dropping it here would silently restore the full bypass.
              trusted: assumedBound(params.trusted),
              authenticatedScope: params.authenticatedScope,
              // Shared across every component row this listing expands, so
              // rows pointing at the same target resolve its policy once.
              targetPolicies: new Map(),
              targetCompanions: new Map(),
              // A relationship inside a component points at a collection whose
              // read rule may filter on one of its own localized fields.
              locale: localeChain?.[0],
              // Only "read everything" propagates, and only when the caller
              // actually asked for it. Deriving this from the parent having
              // resolved to no filter would unfilter every target behind a
              // status-less collection.
              status: expansionStatusScope({
                status: params.status,
                overrideAccess: params.overrideAccess,
                bounded: narrows(params.trusted),
              }),
            },
          });
      }

      // ============================================================
      // GEO FILTERING: Apply geo operators in application layer
      // ============================================================

      // Apply geo filtering if there are geo filters
      let geoFilteredEntries = expandedEntries;
      let geoDistances: Map<string, number> | undefined;

      if (hasGeoFilters) {
        // Apply geo filters to the expanded entries
        const geoResult = applyGeoFilters(expandedEntries, geoFilters, {
          calculateDistances: true,
          idField: "id",
        });

        geoFilteredEntries = geoResult.entries;
        geoDistances = geoResult.distances;

        // Update totalDocs to reflect geo-filtered count
        totalDocs = geoFilteredEntries.length;

        // Sort by distance (nearest first) for 'near' queries
        const hasNearQuery = geoFilters.some(f => f.operator === "near");
        if (hasNearQuery && geoDistances && geoDistances.size > 0) {
          geoFilteredEntries = sortByDistance(
            geoFilteredEntries,
            geoDistances,
            "id",
            "asc"
          );
        }

        // Apply in-memory pagination
        const startIndex = offset;
        const endIndex = startIndex + limit;
        geoFilteredEntries = geoFilteredEntries.slice(startIndex, endIndex);
      }

      // Use geo-filtered entries for the rest of the pipeline
      expandedEntries = geoFilteredEntries;

      // Redact password hashes BEFORE any afterRead hook (collection,
      // stored, or field-level) runs: a hook receiving the hash could copy
      // it into another allowed property that the later redaction would not
      // catch. The final redaction below stays as defense in depth.
      const collectionHasPassword = hasPasswordField(fields);
      if (collectionHasPassword) {
        for (const entry of expandedEntries) {
          stripPasswordFieldValues(entry, fields);
        }
      }
      // Always strip the system owner column so a list readable by non-creators
      // never leaks the creator's user id (unconditional — not gated on
      // password fields).
      for (const entry of expandedEntries) {
        stripSystemOwnerField(entry);
      }

      // Decode before any afterRead hook runs. A hook is documented against the
      // configured value, and on SQLite these columns are strings, so decoding
      // after the hooks handed every one of them the storage encoding instead.
      decodeJsonFieldValues(expandedEntries, fields, params.locale);

      // A related row's own field hooks run BEFORE this collection's afterRead
      // hooks can observe it, and before field selection narrows it.
      //
      // Before the collection's hooks, because one of them can copy a related
      // row's value onto a root property of its own; the traversal masks the
      // nested field it walked, never the copy, so a hook handed an unmasked
      // target could publish it under a key nothing sanitizes. That is the same
      // reason password hashes are stripped above rather than after.
      //
      // Before selection, because selection rebuilds each related row as a fresh
      // object holding only the projected paths, so a hook masking on a sibling
      // -- `select: { "author.secret": true }` while the rule reads
      // `organization.classification` -- would be handed a row with its evidence
      // missing and fall open.
      //
      // Every populated related row is walked, including one under a
      // relationship the projection drops. Skipping those would leave them on
      // the document unmasked for the hooks below to read and copy elsewhere,
      // and the skip could not be honoured coherently in any case: batch
      // expansion shares one row object between parents, so a row reachable
      // through both a kept and a dropped relationship would end up masked or
      // not depending on which reference the traversal happened to meet first.
      //
      // One state for the whole listing, for that same sharing: a per-entry pass
      // would run a shared row's hooks once per reference.
      const nestedHookState = this.relationshipService.createNestedHookState();
      const nestedAccess = {
        enforceFieldAccess: true,
        fieldAccessUser: params.fieldAccessUser,
        user: params.user,
        overrideAccess: params.overrideAccess,
        // Narrows that bypass per RELATED collection. Absent means unchanged;
        // dropping it here would silently restore the full bypass.
        trusted: assumedBound(params.trusted),
        authenticatedScope: params.authenticatedScope,
      };
      for (const entry of expandedEntries) {
        await this.relationshipService.applyNestedFieldHooks(
          entry,
          params.collectionName,
          nestedAccess,
          nestedHookState
        );
      }
      // Once, after the whole listing: the walk already applied field access to
      // each related row before its parent's hooks; this re-applies it (restoring
      // the removed evidence and re-judging the current content) to strip a denied
      // field a parent hook reintroduced, mutated, or added, then rebuilds labels
      // from the survivors.
      await this.relationshipService.finalizeRelatedRows(
        nestedHookState,
        nestedAccess
      );

      // Execute afterRead hooks (code-registered)
      // Hooks can transform the fetched data
      const afterContext = this.hookService.buildHookContext({
        collection: params.collectionName,
        operation: "read" as const,
        data: expandedEntries,
        user: params.user,
        context: sharedContext,
      });

      const transformedData = await this.hookService.hookRegistry.execute(
        "afterRead",
        afterContext
      );
      const dataAfterCodeHooks = (transformedData ??
        expandedEntries) as unknown[];

      // A code hook may have RETURNED a reshaped related row carrying a denied
      // field; sanitize now, before the stored and field-level hooks run, so one
      // of them cannot read that field and copy it onto an allowed source key the
      // final pass no longer looks at. The authoritative pass is idempotent over
      // the shared walk state, so running it after each source phase is safe.
      await this.relationshipService.reprojectRelatedRows(
        dataAfterCodeHooks as Record<string, unknown>[],
        params.collectionName,
        nestedAccess,
        nestedHookState
      );

      // Execute stored afterRead hooks (UI-configured)
      const storedAfterResult =
        await this.hookService.storedHookExecutor.execute(
          "afterRead",
          storedHooks,
          this.hookService.buildPrebuiltHookContext(
            params.collectionName,
            "read",
            dataAfterCodeHooks,
            // eslint-disable-next-line @typescript-eslint/require-await
            async () => false,
            params.user,
            sharedContext
          )
        );
      let finalData = (storedAfterResult.data ??
        dataAfterCodeHooks) as unknown[];

      // Convert snake_case timestamp columns to their camelCase API form.
      finalData = (finalData as Record<string, unknown>[]).map(entry =>
        convertTimestampsToCamelCase(entry)
      );

      // Defense in depth: re-strip after hooks in case a hook re-introduced
      // a password value under its declared key.
      if (collectionHasPassword) {
        for (const entry of finalData as Record<string, unknown>[]) {
          stripPasswordFieldValues(entry, fields);
        }
      }

      // A stored hook may likewise have reintroduced a denied related field;
      // sanitize before the field-level hooks read the assembled document.
      await this.relationshipService.reprojectRelatedRows(
        finalData as Record<string, unknown>[],
        params.collectionName,
        nestedAccess,
        nestedHookState
      );

      // Field-level afterRead hooks + read access (code-first functions
      // resolved via the field-level registry): hooks may transform values;
      // fields whose access.read denies are stripped from the response. Access is
      // applied BEFORE the hooks and AGAIN after, sharing a redactions store: the
      // first pass hides a denied source field from the hooks — so a hook on a
      // selected, allowed field cannot read a denied sibling and copy it onto its
      // own value (selection now runs last and no longer projects such a sibling out
      // first) — while restoring each removed value as evidence in the second pass
      // keeps a conditional rule judging against the whole row and catches a denied
      // field a hook reintroduced. Runs on the whole rows, before selection.
      // Row trust and FIELD trust are separate questions and this read may
      // answer them differently. `overrideAccess` alone means both; a caller
      // that asked for field rules to be enforced keeps its row bypass and
      // gives up only the field one. Computed once, beside the two passes it
      // governs, so they cannot drift apart.
      const skipFieldRules =
        params.enforceFieldAccess === true ? false : params.overrideAccess;
      for (const entry of finalData as Record<string, unknown>[]) {
        const sourceRedactions: ReadAccessRedactions = new WeakMap();
        await applyFieldReadAccess(
          {
            kind: "collection",
            slug: params.collectionName,
            entry,
            user: params.fieldAccessUser ?? params.user,
            overrideAccess: skipFieldRules,
          },
          sourceRedactions
        );
        await runFieldHooks({
          kind: "collection",
          slug: params.collectionName,
          phase: "afterRead",
          data: entry,
          operation: "read",
          user: params.user,
        });
        await applyFieldReadAccess(
          {
            kind: "collection",
            slug: params.collectionName,
            entry,
            user: params.fieldAccessUser ?? params.user,
            overrideAccess: skipFieldRules,
          },
          sourceRedactions
        );
      }

      // Authoritative related-row sanitization: re-apply each related row's OWN
      // collection field access over the ASSEMBLED response, after EVERY source
      // afterRead hook phase above (code, stored, and field-level). Those hooks
      // can write a denied target field back onto a related row, or return a
      // reshaped document whose related rows are new objects the earlier walk
      // never held; the root access pass above knows only this collection's
      // schema and never descends into a related row. Before selection, so it
      // judges whole rows with their sibling evidence intact.
      await this.relationshipService.reprojectRelatedRows(
        finalData as Record<string, unknown>[],
        params.collectionName,
        nestedAccess,
        nestedHookState
      );

      // Apply field selection if select parameter is provided. Last of the
      // sanitizing steps, so every hook and access pass above judged the whole
      // row rather than the projected slice.
      if (params.select && Object.keys(params.select).length > 0) {
        finalData = this.applyFieldSelectionToArray(
          finalData as Record<string, unknown>[],
          params.select
        );
      }

      // Transform rich text fields to requested format (html, both)
      // Default is "json" which returns the Lexical JSON structure as-is
      if (params.richTextFormat && params.richTextFormat !== "json") {
        // Cast FieldDefinition[] to FieldConfig[] - they share the same structure
        // for the properties used by transformRichTextFields (name, type, fields)
        const fieldConfig = fields as unknown as Parameters<
          typeof transformRichTextFields
        >[1];
        finalData = (finalData as Record<string, unknown>[]).map(entry =>
          transformRichTextFields(entry, fieldConfig, params.richTextFormat)
        );
      }

      // Final owner-column strip at the response boundary — after every
      // afterRead hook, field-level read access, and transform — so nothing
      // downstream can re-expose the creator's user id. (The pre-hook strip
      // above also keeps it out of hook inputs.)
      for (const entry of finalData as Record<string, unknown>[]) {
        stripSystemOwnerField(entry);
      }

      // Build paginated response with all metadata
      const paginatedResponse = buildPaginatedResponse(finalData, {
        total: totalDocs,
        page,
        limit,
      });

      return {
        success: true,
        statusCode: 200,
        message: "Entries fetched successfully",
        data: paginatedResponse,
      };
    } catch (error: unknown) {
      // Determine appropriate status code based on error type
      const message =
        error instanceof Error ? error.message : "Failed to fetch entries";
      const isNotFound =
        message.includes("not found") || message.includes("does not exist");
      // A NextlyError already carries the right status (a refused access
      // constraint is a 403); flattening it to 500 would report an authorization
      // decision as a server fault.
      const statusCode = NextlyError.is(error)
        ? error.statusCode
        : isNotFound
          ? 404
          : 500;
      return {
        success: false,
        statusCode,
        message,
        data: null,
        // A boundary can only rebuild what the envelope carried. Recording the
        // status alone left a read hook's `rateLimited()` or `authRequired()`
        // arriving at the caller as a generic 500, because the code-keyed
        // rebuild had no code to key on.
        ...errorEnvelopeFields(error),
      };
    }
  }

  /**
   * Count entries in a collection.
   *
   * Returns the total number of entries matching the provided criteria.
   * Uses efficient SQL COUNT query without fetching entry data.
   * Applies collection-level access control.
   *
   * Security checks are applied in order:
   * 1. Collection-level access (AccessControlService)
   *
   * Runs the read hooks that precede a query -- `beforeOperation` and
   * `beforeRead` -- so the total describes the rows a list would return. There
   * is no after phase: those reshape a document, and a count has none.
   *
   * Skipped when the caller sets `readHooksAlreadyRan`, which `listEntries`
   * does for the count it takes for its own total.
   *
   * @param params - Collection name, optional user context, and optional search query
   * @returns Count result with totalDocs or error
   *
   * @example
   * ```typescript
   * // Count all entries
   * const result = await entryService.countEntries({
   *   collectionName: 'posts',
   *   user: { id: 'user-123', role: 'editor' }
   * });
   * console.log(result.data.totalDocs); // 42
   *
   * // Count with search filter
   * const filtered = await entryService.countEntries({
   *   collectionName: 'posts',
   *   user: { id: 'user-123' },
   *   search: 'tutorial'
   * });
   *
   * // Count with where clause
   * const published = await entryService.countEntries({
   *   collectionName: 'posts',
   *   user: { id: 'user-123' },
   *   where: { status: { equals: 'published' } }
   * });
   * ```
   */
  async countEntries(params: {
    collectionName: string;
    user?: UserContext;
    /**
     * The instant the enclosing read resolved releases against.
     *
     * Set only by `listEntries`, which calls this as its own continuation. A
     * standalone count takes its own clock; a nested one MUST take its
     * parent's, or a release becoming due between the two makes the page report
     * pre-release rows beside a post-release `totalDocs`.
     */
    releaseNow?: Date;
    /** Search query to filter entries by searchable fields */
    search?: string;
    /** Where clause for advanced filtering */
    where?: WhereFilter;
    /** When true, bypass all access control checks */
    overrideAccess?: boolean;
    /**
     * This `where` was built by the framework from a route it was asked to
     * render, not received from a request.
     *
     * Exempts it from `assertFilterableFields`, whose subject is a caller
     * CHOOSING probe values against a field it may not read. Per-operation and
     * never a config field, so a nested call cannot inherit it.
     */
    frameworkFilter?: boolean;
    /**
     * Which collections a trusted read may reach as relationships are expanded,
     * asked per RELATED collection. Absent means every populated target inherits
     * the caller's trust. Evaluated as `overrideAccess && trusted(target)`, so it
     * can only ever narrow. See {@link RelatedRowReadContext.trusted}.
     */
    trusted?: TrustBound;
    /**
     * The route middleware already ran the RBAC gate for the authorizing
     * operation; skip only that redundant re-check while stored read rules
     * (owner-only filter) still apply. Mirrors listEntries so the count
     * beside a route-authorized enumeration answers the same question and
     * does not fall back to 0 for update/delete-only callers.
     */
    routeAuthorized?: boolean;
    /**
     * The caller's authenticated scope, mirroring listEntries so a scoped key
     * counts exactly the rows it can list.
     */
    authenticatedScope?: AuthenticatedScope;
    /**
     * Draft/Published filter override (only effective when collection.status === true).
     * See listEntries for full semantics.
     */
    status?: StatusOption;
    /**
     * Requested content locale (i18n M4). Kept in parity with listEntries so a locale-scoped
     * filter (M4c EXISTS) counts the same rows the page returns. For plain reads it has no
     * effect on the count (localized display resolution is post-query).
     */
    locale?: string;
    /** Fallback control (`false`/`"none"` disables fallback). */
    fallbackLocale?: string | false;
    /**
     * Set by `listEntries`, which has already run the read hooks for this
     * request and forwards the filter they settled on. A standalone count runs
     * them itself, so the total answers the same question as a list would.
     */
    readHooksAlreadyRan?: boolean;
    /**
     * Language filter, already extracted by the caller (listEntries). When present it is
     * applied directly instead of re-extracting `_translated` from `where` — listEntries strips
     * `_translated` from the where it forwards, so re-extraction would find nothing and the count
     * would over-count.
     */
    translationFilter?: TranslationStatusFilter;
    /**
     * Component table names and discriminator columns, already resolved by the
     * caller (listEntries) for this same request.
     *
     * The list path resolves both to build its page, then asks for a total over
     * the same filters, so without this the count repeats a registry lookup per
     * component slug and a catalog introspection per table: column and index
     * reads on Postgres and MySQL, a PRAGMA each on SQLite. A standalone count
     * omits them and resolves its own.
     */
    resolvedComponentTables?: Map<string, string>;
    resolvedComponentTypeColumns?: Map<string, string>;
    /** Arbitrary data passed to hooks via context */
    context?: Record<string, unknown>;
  }): Promise<CollectionServiceResult<{ totalDocs: number }>> {
    try {
      const accessUser = params.overrideAccess ? undefined : params.user;

      // 1. Check collection-level access FIRST
      const accessDenied = await this.accessService.checkCollectionAccess<{
        totalDocs: number;
      }>(
        params.collectionName,
        "read",
        accessUser,
        undefined,
        undefined,
        params.overrideAccess,
        params.routeAuthorized,
        // Same scope judgement as listEntries, so a count cannot describe rows
        // the key itself is not allowed to list.
        params.authenticatedScope
      );
      if (accessDenied) {
        return accessDenied;
      }

      // A count is a cleaner oracle than a listing, not a lesser one: "how many
      // rows carry this value" answers 1 or 0 without returning a row at all.
      this.assertQueryReadable(params);

      const schema = await this.fileManager.loadDynamicSchema(
        params.collectionName
      );

      // A standalone count runs the read hooks for the same reason it mirrors
      // every other listEntries filter: the total has to describe the rows a
      // list would return. Skipped when listEntries already ran them and
      // forwarded what they settled on.
      const countWhere = params.readHooksAlreadyRan
        ? params.where
        : await this.resolveReadWhere({
            collectionName: params.collectionName,
            where: params.where,
            user: params.user,
            sharedContext: { ...params.context },
          });

      // A count cannot apply geo predicates: `listEntries` evaluates them in
      // memory over the rows it fetched, and there are no rows here.
      // `buildWhereClause` emits no SQL for them, so leaving one in place would
      // return a total describing every candidate the geo filter was meant to
      // exclude. Refusing says so instead of answering wrongly.
      const { geoFilters: countGeoFilters } = extractGeoFilters(countWhere);
      if (countGeoFilters.length > 0) {
        throw NextlyError.invalidInput({
          message:
            "A geo filter cannot be counted. Geo predicates are evaluated over fetched rows, so they apply to a list but not to a count; remove the geo operator or take the total from the list instead.",
          logContext: {
            collection: params.collectionName,
            operators: countGeoFilters.map(f => f.operator),
          },
        });
      }

      // i18n M4c: mirror listEntries' localized-query context so a locale-scoped search/where
      // counts the SAME rows the page returns (count==list parity).
      const localeChain = this.resolveLocaleChain(
        params.locale,
        params.fallbackLocale
      );
      const companion =
        localeChain || params.locale === "all"
          ? await this.fileManager.loadCompanionSchema(params.collectionName)
          : null;

      // Build count query using Drizzle
      // Start with a base count query
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Drizzle SQL condition accumulator
      const whereConditions: any[] = [];

      // Get access query constraint (e.g., for owner-only filtering)
      const accessConstraint =
        await this.accessService.getAccessQueryConstraint(
          params.collectionName,
          accessUser,
          params.overrideAccess,
          // Scoped the same way as listEntries, so the total matches the rows a
          // scoped key can actually page through.
          params.authenticatedScope
        );

      // The constraint is applied further down, through the same translation
      // the caller's own `where` uses: it is a full filter predicate, not a
      // single equality, and reducing it here would narrow less than the rule
      // asks for.

      // Apply Draft/Published auto-filter. The helper returns null when the
      // collection has no status column, the caller is trusted with no
      // explicit choice, or explicit was 'all'. Otherwise it returns the
      // value to filter by ('published' for public callers by default).
      // Guarding on schema.status avoids referencing a column that may not
      // exist when the collection has status disabled.
      const collectionForStatus = await this.collectionService.getCollection(
        params.collectionName
      );
      const statusFilter = resolveStatusFilter({
        collectionHasStatus:
          (collectionForStatus as { status?: boolean }).status === true,
        overrideAccess: params.overrideAccess === true,
        explicit: params.status,
      });
      // ONE instant for this read. Each release lookup taking its own
      // `new Date()` let a release become due between the row query and a
      // sibling condition, so one response could carry pre-release rows beside
      // a post-release count.
      // The enclosing read's instant when this count is its continuation,
      // and this count's own clock when it was called directly.
      const readNow = params.releaseNow ?? new Date();
      const releaseCondition = statusCondition({
        filter: statusFilter,
        statusColumn: schema.status,
        idColumn: schema.id,
        decisions: await this.releaseDecisions(
          params.collectionName,
          statusFilter,
          readNow
        ),
      });
      if (releaseCondition) whereConditions.push(releaseCondition);
      // Build the localized-query context AFTER the status filter is resolved so
      // localized where/search EXISTS checks constrain by the per-locale status too
      // (a published read must not match a draft translation).
      const localizedCtx = this.buildLocalizedQueryContext(
        companion,
        localeChain,
        schema,
        statusFilter?.values
      );

      // Apply search filter if provided
      if (params.search) {
        // Get collection metadata for search configuration
        const collectionMeta = await this.collectionService.getCollection(
          params.collectionName
        );

        // Check minimum search length
        const minLength = getMinSearchLength(collectionMeta);
        if (params.search.trim().length >= minLength) {
          // Get searchable fields
          // Narrowed, not refused: the caller never named a column, so
          // dropping the ones they may not read answers what they asked.
          // Leaving them in lets `search=<guess>` probe a hidden value
          // through which rows come back.
          const searchableFields = this.searchableFieldsFor(
            params.collectionName,
            collectionMeta,
            fieldTrustOf(params)
          );

          if (searchableFields.length === 0) {
            // Every searchable field carries a read rule, so this caller has
            // nothing to be matched against. Adding NO condition would return
            // and count every otherwise-visible row -- the exact opposite of a
            // narrowed search, and a worse answer than the leak this narrowing
            // exists to close. An unsatisfiable predicate is the honest reading
            // of "matched against nothing".
            whereConditions.push(sql`1 = 0`);
          } else {
            // Determine database dialect for ILIKE vs LIKE
            const dialect = this.adapter?.dialect || "postgresql";

            // Build search condition (localizedCtx routes localized searchable fields to
            // a companion EXISTS instead of dropping them).
            const searchCondition = this.buildSearchCondition(
              schema,
              searchableFields,
              params.search,
              dialect,
              localizedCtx
            );

            if (searchCondition) {
              whereConditions.push(searchCondition);
            }
          }
        }
      }

      // apply the `_translated` language filter regardless of `countWhere` — when it
      // is the ONLY filter, listEntries forwards `where: undefined` (the key having been stripped)
      // and passes the filter via `translationFilter`. Applying it here (not inside the
      // `if (countWhere)` block below) keeps count == list so pagination totals stay correct.
      const countTranslationFilter =
        params.translationFilter ??
        this.extractTranslationStatusFilter(countWhere).filter;
      if (countTranslationFilter) {
        const translationCondition =
          await this.buildTranslationStatusFilterCondition(
            params.collectionName,
            countTranslationFilter,
            schema.id
          );
        if (translationCondition) whereConditions.push(translationCondition);
      }

      // Apply where clause if provided
      if (countWhere) {
        // Determine database dialect for ILIKE vs LIKE
        const dialect = this.adapter?.dialect || "postgresql";

        // Get collection metadata for component field detection
        const collectionForFilters = await this.collectionService.getCollection(
          params.collectionName
        );
        const fieldsForFilters = ((
          (collectionForFilters as Record<string, unknown>).schemaDefinition as
            | Record<string, unknown>
            | undefined
        )?.fields ||
          (collectionForFilters as Record<string, unknown>).fields ||
          []) as Array<{
          name: string;
          type: string;
          component?: string;
          components?: string[];
        }>;

        // Strip the `_translated` key before the component extractor (which drops unrecognized
        // object keys). The filter itself was already applied above.
        const { cleanedWhere: whereWithoutTranslation } =
          this.extractTranslationStatusFilter(countWhere);

        // Extract component field conditions (e.g., 'seo.metaTitle')
        const { componentFilters, cleanedWhere } =
          extractComponentFieldConditions(
            whereWithoutTranslation,
            fieldsForFilters
          );

        // Get the table name for component subqueries
        const tableName = getTableName(params.collectionName);

        // Build component field EXISTS conditions
        const componentTables =
          params.resolvedComponentTables ??
          (await this.resolveComponentTableNames(componentFilters));
        const componentCondition = this.buildComponentFieldConditions(
          componentFilters,
          tableName,
          schema.id,
          dialect,
          componentTables,
          params.resolvedComponentTypeColumns ??
            (await this.resolveComponentTypeColumns(
              componentFilters,
              componentTables.values()
            ))
        );

        if (componentCondition) {
          whereConditions.push(componentCondition);
        }

        // Convert remaining WhereFilter to internal WhereClause format
        if (cleanedWhere) {
          const internalWhere = buildWhereClause(cleanedWhere);

          // Build Drizzle condition from the WhereClause
          const whereCondition = this.buildDrizzleCondition(
            internalWhere,
            schema,
            dialect,
            localizedCtx
          );

          if (whereCondition) {
            whereConditions.push(whereCondition);
          }
        }
      }

      // Apply the stored read rule's query constraint through the same
      // translation the caller's `where` uses. It is a full filter predicate:
      // an owner-only read emits one field, but a custom rule can return any
      // supported operator across several fields, and reading a single `equals`
      // off the first key silently returns rows the rule excludes.
      if (accessConstraint) {
        // Refuse before translating: a partially translatable constraint yields a
        // non-empty condition that binds less than the rule requires.
        const untranslatable = describeUntranslatableConstraint(
          accessConstraint,
          name => Object.prototype.hasOwnProperty.call(schema, name),
          name =>
            Boolean(localizedCtx?.localizedFields.some(f => f.name === name))
        );
        // Explicitly against null: a reason can be any string, and an empty one
        // would read as success.
        if (untranslatable !== null) {
          // Logged here rather than left on the error: the surrounding catch
          // flattens this into a result envelope, so the reason would otherwise
          // never reach operator logs and every refusal would look alike.
          this.logger.warn("Refused an untranslatable access constraint", {
            collection: params.collectionName,
            reason: untranslatable,
          });
          throw NextlyError.forbidden({
            logContext: {
              collection: params.collectionName,
              reason: "untranslatable-access-constraint",
              reason_detail: untranslatable,
            },
          });
        }
        // Members that cannot narrow anything are removed before translation,
        // so the "translated to nothing" check below judges only what was meant
        // to restrict. A constraint made up entirely of them restricts nothing,
        // and the rule already allowed the caller.
        const restricting = stripNoOpConstraintMembers(accessConstraint);
        const accessCondition =
          Object.keys(restricting).length === 0
            ? undefined
            : this.buildDrizzleCondition(
                buildWhereClause(restricting as WhereFilter),
                schema,
                this.adapter?.dialect || "postgresql",
                localizedCtx
              );
        if (accessCondition) {
          whereConditions.push(accessCondition);
        } else if (Object.keys(restricting).length > 0) {
          // A constraint that translates to nothing would widen the read to
          // every row. Fail closed instead: the rule asked to narrow.
          throw NextlyError.forbidden({
            logContext: {
              collection: params.collectionName,
              reason: "untranslatable-access-constraint",
            },
          });
        }
      }

      // Build the count query
      let query = this.db.select({ count: sql<number>`count(*)` }).from(schema);

      // Apply combined where conditions
      if (whereConditions.length > 0) {
        query = query.where(
          whereConditions.length === 1
            ? whereConditions[0]
            : and(...whereConditions)
        );
      }

      // Execute count query
      const result = await query;
      const totalDocs = Number(result[0]?.count || 0);

      return {
        success: true,
        statusCode: 200,
        message: "Count retrieved successfully",
        data: { totalDocs },
      };
    } catch (error: unknown) {
      const message =
        error instanceof Error ? error.message : "Failed to count entries";
      this.logger.error("Error counting entries", {
        collectionName: params.collectionName,
        error: message,
      });
      return {
        success: false,
        // Mirrors listEntries: a refused access constraint is a 403, not a
        // server fault, and the count must report it the same way.
        statusCode: NextlyError.is(error) ? error.statusCode : 500,
        message,
        data: null,
        // Same reason as listEntries: without the code the boundary rebuilds a
        // typed refusal as a generic internal error.
        ...errorEnvelopeFields(error),
      };
    }
  }

  /**
   * Get a single entry by ID.
   * Applies collection-level access control.
   *
   * Security checks are applied in order:
   * 1. Collection-level access (AccessControlService)
   *
   * @param params - Collection name, entry ID, optional user context, and depth
   * @returns Entry with expanded relationships or error
   */
  async getEntry(params: {
    collectionName: string;
    entryId: string;
    user?: UserContext;
    /**
     * Depth for relationship population (0-5).
     * - 0: No expansion, return IDs only
     * - 1: Expand immediate relationships
     * - 2+ (default): Expand nested relationships recursively
     * @default 2
     */
    depth?: number;
    /**
     * Select specific fields to include in the response.
     * Format: `{ fieldName: true }` to include fields.
     * The `id` field is always included regardless of selection.
     * Supports dot notation for nested fields (e.g., `{ 'author.name': true }`).
     *
     * @example
     * ```typescript
     * // Select only title and slug
     * { title: true, slug: true }
     *
     * // Select nested field from relationship
     * { title: true, 'author.name': true }
     * ```
     */
    select?: Record<string, boolean>;
    /**
     * Output format for rich text fields.
     * - "json" (default): Return Lexical JSON structure only
     * - "html": Return HTML string only
     * - "both": Return object with both { json, html } properties
     * @default "json"
     */
    richTextFormat?: RichTextOutputFormat;
    /** When true, bypass all access control checks */
    overrideAccess?: boolean;
    /**
     * Enforce FIELD-level read rules even on a read that is otherwise trusted.
     *
     * `overrideAccess` governs two different trusts with one boolean — "you may
     * see this row" and "skip every field rule" — and a caller can genuinely
     * need the first without the second. A shared preview link is the case that
     * forced them apart: it must reach a never-published row, which only
     * `overrideAccess` grants, and it must NOT show its recipient fields the
     * person who shared it cannot see, which is what the same flag silently
     * turned off.
     *
     * Absent means today's behaviour exactly — field trust follows row trust —
     * so no existing caller changes. Set it beside a `user`: the rules are
     * evaluated as THAT user, and a trusted read has otherwise dropped its user
     * for row purposes (see `accessUser`), so the two are asked separately on
     * purpose.
     *
     * Relationship expansion has always carried its own copy of this question
     * ({@link RelatedRowReadContext.enforceFieldAccess}); this is the same axis
     * for the top-level rows, which had no way to express it.
     */
    enforceFieldAccess?: boolean;
    /**
     * Whose field-level read rules to judge by, when that is NOT the caller.
     *
     * A preview link is the case this exists for. The bearer is anonymous and
     * must stay anonymous to every hook — a hook branching on `req.user` that
     * saw the sharer would add an editor-only value and hand it to whoever
     * holds the link, and a value a hook invents need not correspond to any
     * declared field, so the access pass below cannot remove it again. What the
     * sharer decides is narrower than that: which of the document's declared
     * fields are visible.
     *
     * So it is a redaction basis and nothing else, and it is a separate
     * parameter for exactly that reason. Folding it into `user` made the
     * identity mean two things at once, which is the shape of defect this
     * option exists to repair one level up.
     *
     * Absent means the caller's own `user`, which is the ordinary case.
     */
    fieldAccessUser?: UserContext;
    /**
     * Which collections a trusted read may reach as relationships are expanded,
     * asked per RELATED collection. Absent means every populated target inherits
     * the caller's trust. Evaluated as `overrideAccess && trusted(target)`, so it
     * can only ever narrow. See {@link RelatedRowReadContext.trusted}.
     */
    trusted?: TrustBound;
    /**
     * Draft/Published filter override (only effective when collection.status === true).
     * Public callers default to 'published'; trusted callers see all.
     * If the entry exists but doesn't match the filter (e.g., a 'draft' row
     * fetched without override), the response is 404 — same as a non-existent
     * id, so visibility doesn't leak via response codes.
     */
    status?: StatusOption;
    /**
     * Requested content locale (i18n M4). For a localized collection, translatable fields are
     * resolved to this language (with fallback) from the companion `_locales` table. Ignored
     * for non-localized collections. Defaults to the configured default locale.
     */
    locale?: string;
    /**
     * Fallback control. `false` / `"none"` disables fallback (raw requested language, blank if
     * untranslated). Otherwise the configured fallback chain + default locale is used.
     */
    fallbackLocale?: string | false;
    /**
     * i18n M7: when true, attach a per-locale `_translations` map (translated + status) to the
     * entry for the admin translation-status pills. No-op for non-localized collections.
     */
    translationStatus?: boolean;
    /** Arbitrary data passed to hooks via context */
    context?: Record<string, unknown>;
    /**
     * Set by a route whose middleware already authenticated AND authorized the
     * caller (mirrors listEntries). It skips only the redundant RBAC re-check,
     * which would otherwise resolve permissions from the caller's stored roles
     * and so reject an API key whose scoped permissions differ from its
     * creator's. Owner-only and other document-level rules still apply.
     */
    routeAuthorized?: boolean;
    /**
     * The caller's authenticated scope. A scoped API key is judged on its OWN
     * read grant here, so a super-admin-owned key cannot read a row its scope
     * excludes (used by duplicate, which reads the source before creating a
     * copy). Undefined for session/system callers.
     */
    authenticatedScope?: AuthenticatedScope;
    /**
     * Whether the caller is an editor asking to SEE the working draft (pending
     * unpublished edits) in place of the live row. Opt-in on purpose: a
     * status-less read is the default for many internal callers (duplicate,
     * reference labels), and they must keep seeing the published row, so draft
     * visibility follows an explicit editor-view intent rather than every
     * status-less read. Still gated by trust below (overrideAccess, or an actual
     * update-capability decision against the loaded row), so setting it does not
     * expose a draft to a caller who cannot edit the document.
     */
    includeWorkingDraft?: boolean;
  }): Promise<CollectionServiceResult> {
    try {
      const accessUser = params.overrideAccess ? undefined : params.user;

      // 1. Check collection-level access FIRST
      const accessDenied = await this.accessService.checkCollectionAccess(
        params.collectionName,
        "read",
        accessUser,
        params.entryId,
        undefined,
        params.overrideAccess,
        params.routeAuthorized,
        // A scoped API key is judged on its own read grant, so the session
        // super-admin bypass does not apply to a super-admin-owned key here.
        params.authenticatedScope
      );
      if (accessDenied) {
        return accessDenied;
      }

      const schema = await this.fileManager.loadDynamicSchema(
        params.collectionName
      );

      // Shared context between all hooks in this request
      const sharedContext: Record<string, unknown> = { ...params.context };

      // `beforeOperation` runs first and may rewrite the id, then `beforeRead`
      // sees the id it settled on.
      const entryId = await this.resolveReadEntryId({
        collectionName: params.collectionName,
        entryId: params.entryId,
        user: params.user,
        sharedContext,
      });

      // When read access is `owner-only`, fold the ownership
      // predicate into the SQL WHERE clause. A non-owner gets a 404
      // (same response shape as a non-existent ID), not a 403, so
      // IDOR-by-iteration leaks nothing about which IDs exist.
      const ownerConstraint = await this.accessService.getOwnerConstraint(
        params.collectionName,
        "read",
        accessUser,
        params.overrideAccess,
        // Scope the owner filter too: a super-admin-owned key must still be
        // bound by a `read: owner-only` rule, not treated as a session admin.
        params.authenticatedScope
      );

      // Same 404-not-403 reasoning applies to Draft/Published — a public
      // caller asking for a draft entry by ID gets a 404, never a hint that
      // it exists.
      const collectionForStatus = await this.collectionService.getCollection(
        params.collectionName
      );
      const statusFilter = resolveStatusFilter({
        collectionHasStatus:
          (collectionForStatus as { status?: boolean }).status === true,
        overrideAccess: params.overrideAccess === true,
        explicit: params.status,
      });

      const idCondition = eq(schema.id, entryId);
      const ownerCondition = ownerConstraint
        ? eq(schema[ownerConstraint.field], ownerConstraint.value)
        : null;
      // An explicit `status: "draft"` view that opts into the working draft must
      // not filter the live row to draft-only: the split keeps the main row
      // published, so that predicate would 404 before the overlay below can
      // surface the pending draft. Drop it for a drafts-enabled collection when
      // `includeWorkingDraft` is set; the overlay returns the draft (or the live
      // row when none exists). Every other status filter is applied as usual.
      // Whether this read could surface a working draft at all, from the same
      // rule the overlay below uses. Computed ONCE and consulted twice: this
      // predicate and the overlay must agree about what is eligible, and a
      // second hand-rolled copy here is exactly how they came apart — it still
      // excluded a localized document, so a draft-status read filtered a
      // PUBLISHED main row to `status = draft`, matched nothing, and answered
      // 404 before the overlay could run. The write had held the edit; the read
      // said the document did not exist.
      //
      // Component schemas are left unresolved to keep the registry reads off the
      // common path; the confirming check against resolved schemas runs before
      // any draft is exposed.
      const draftOverlayPossible = resolveDraftOverlay({
        ...draftDocumentFacts(collectionForStatus as DraftDocumentConfig),
        fields: collectionFieldsFor(collectionForStatus) as FieldConfig[],
        componentSchemas: null,
        includeWorkingDraft: params.includeWorkingDraft === true,
        requestedStatus: params.status,
        // The capability is probed against the loaded row further down; this
        // asks only whether the document and the request allow an overlay.
        callerMayEdit: true,
        requestLocale: params.locale ?? null,
        defaultLocale: this.localization?.defaultLocale ?? null,
      }).overlay;

      // An explicit `status: "draft"` view that opts into the working draft must
      // not filter the live row to draft-only: the split keeps the main row
      // published, so that predicate would 404 before the overlay can surface
      // the pending draft. When nothing is overlaid after all, the 404 below
      // still refuses to return the published row to a draft-only view.
      const suppressDraftStatusFilter =
        draftOverlayPossible &&
        statusFilter !== null &&
        !statusFilter.isPublicRead;
      // Named `lifecycleCondition` rather than shadowing the imported
      // `statusCondition` helper it now delegates to.
      const readNow = new Date();
      const lifecycleCondition = suppressDraftStatusFilter
        ? undefined
        : statusCondition({
            filter: statusFilter,
            statusColumn: schema.status,
            idColumn: schema.id,
            decisions: await this.releaseDecisions(
              params.collectionName,
              statusFilter,
              readNow
            ),
          });
      const whereParts = [
        idCondition,
        ownerCondition,
        lifecycleCondition,
      ].filter(
        (c): c is NonNullable<typeof c> => c !== null && c !== undefined
      );
      const whereCondition =
        whereParts.length === 1 ? whereParts[0] : and(...whereParts);

      const [entry] = await this.db
        .select()
        .from(schema)
        .where(whereCondition)
        .limit(1);

      if (!entry) {
        return {
          success: false,
          statusCode: 404,
          message: "Entry not found",
          data: null,
        };
      }

      // Resolved once and reused: relationship expansion below needs the same
      // language, so deriving it twice would let the two drift.
      const localeChain = this.resolveLocaleChain(
        params.locale,
        params.fallbackLocale
      );
      // i18n M4: resolve localized fields from the companion `_locales` table for the
      // requested language (with fallback) BEFORE relationship expansion / hooks, so every
      // downstream consumer sees the translated values. No-op for non-localized collections.
      await this.overlayLocalized(
        params.collectionName,
        "translation-load-failed",
        () =>
          this.populateLocalized(
            params.collectionName,
            [entry as Record<string, unknown>],
            localeChain,
            undefined,
            statusFilter?.values ?? null // i18n M6: per-locale published filter
          )
      );
      // `locale=all` → language-keyed values per localized field (admin/export).
      await this.overlayLocalized(
        params.collectionName,
        "translation-projection-failed",
        () =>
          this.populateLocalizedAll(
            params.collectionName,
            [entry as Record<string, unknown>],
            params.locale,
            undefined,
            statusFilter?.values ?? null // i18n M6: per-locale published filter
          )
      );
      // i18n M7: per-locale translation-status map for the admin per-language pills (opt-in).
      if (params.translationStatus) {
        await this.overlayLocalized(
          params.collectionName,
          "translation-overview-failed",
          () =>
            this.populateTranslationMeta(
              params.collectionName,
              [entry as Record<string, unknown>],
              undefined,
              statusFilter?.values ?? null // i18n M6: per-locale published filter
            )
        );
      }

      // Get collection metadata to identify relation fields and hooks
      const collection = await this.collectionService.getCollection(
        params.collectionName
      );
      const fields = ((
        (collection as Record<string, unknown>).schemaDefinition as
          | Record<string, unknown>
          | undefined
      )?.fields ||
        (collection as Record<string, unknown>).fields ||
        []) as FieldDefinition[];
      const storedHooks = this.hookService.getStoredHooks(
        collection as Record<string, unknown>
      );

      // Expand relationships with depth control
      let expandedEntry = await this.relationshipService.expandRelationships(
        entry,
        params.collectionName,
        fields,
        {
          depth: params.depth,
          // Same reasoning as the list path: a related row is redacted by its
          // own collection's field rules, for this caller.
          enforceFieldAccess: true,
          fieldAccessUser: params.fieldAccessUser,
          // Same deferral as the list path; this path runs the same pass.
          fieldAccessStage: "assembled" as const,
          user: params.user,
          overrideAccess: params.overrideAccess,
          // The bound, at the by-id path's TOP-LEVEL expansion. Omitting it
          // here leaves the relationship service with no predicate, so every
          // target is read fully trusted before the post-assembly pass runs.
          trusted: params.trusted,
          authenticatedScope: params.authenticatedScope,
          // As on the list path: the language a target collection's read rule is
          // evaluated in when its predicate names a localized field.
          locale: localeChain?.[0],
          // Only "read everything" propagates, and only when the caller
          // actually asked for it. Deriving this from the parent having
          // resolved to no filter would unfilter every target behind a
          // status-less collection.
          status: expansionStatusScope({
            status: params.status,
            overrideAccess: params.overrideAccess,
            bounded: narrows(params.trusted),
          }),
        }
      );

      // Populate component field data from comp_{slug} tables
      // Pass depth for relationship expansion within component data
      // Pass select to skip component fields excluded from selection (performance optimization)
      if (this.fieldGroupDataService) {
        expandedEntry = await this.fieldGroupDataService.populateComponentData({
          entry: expandedEntry,
          parentTable: getTableName(params.collectionName),
          fields: fields as FieldConfig[],
          depth: params.depth,
          select: params.select,
          // i18n: thread the read locale so an embedded localized component resolves
          // its translatable fields per language, and forward fallback control so a
          // no-fallback read (`?fallback-locale=none`) leaves untranslated embedded
          // fields blank rather than showing default-language text.
          locale: params.locale,
          fallbackLocale: params.fallbackLocale,
          // Same reasoning as the list path: a related row reached through a
          // component is judged by its own collection's field rules.
          access: {
            enforceFieldAccess: true,
            fieldAccessUser: params.fieldAccessUser,
            user: params.user,
            overrideAccess: params.overrideAccess,
            // Narrows that bypass per RELATED collection. Absent means
            // unchanged; dropping it restores the full bypass silently.
            trusted: assumedBound(params.trusted),
            authenticatedScope: params.authenticatedScope,
            // As on the list path: a component's relationship reaches a
            // collection that may scope reads by a localized field.
            locale: localeChain?.[0],
            // Only "read everything" propagates, and only when the caller
            // actually asked for it. Deriving this from the parent having
            // resolved to no filter would unfilter every target behind a
            // status-less collection.
            status: expansionStatusScope({
              status: params.status,
              overrideAccess: params.overrideAccess,
              bounded: narrows(params.trusted),
            }),
          },
        });
      }

      // On a trusted draft-view read, surface the working draft
      // (pending edits to a published document) in place of the live row, when
      // one exists. Placed AFTER the live assembly above so re-reading LIVE
      // relations/components/localized values by the shared entry id cannot
      // clobber the draft's values, and BEFORE the redaction/shaping below so
      // the snapshot's owner column, password values, and field-level read
      // access are stripped and enforced like any other read. Never surfaced for
      // a published-only or untrusted read: `statusFilter === null` excludes the
      // published default and `?status=published`, and `overrideAccess ||
      // routeAuthorized` excludes an anonymous caller passing `?status=all`.
      // The CHEAP half of the shared rule, with component schemas unresolved so
      // the registry reads stay off the common read path. With no schemas the
      // eligibility test can only be MORE permissive, so a `false` here is final
      // while a `true` is provisional — confirmed below against resolved schemas
      // before any draft is exposed.
      const draftEligible = resolveDraftOverlay({
        ...draftDocumentFacts({
          ...(collectionForStatus as DraftDocumentConfig),
          // Localization is read off the collection record, which is where the
          // read path already carries it.
          localized: (collection as { localized?: boolean }).localized,
        }),
        fields: fields as FieldConfig[],
        componentSchemas: null,
        includeWorkingDraft: params.includeWorkingDraft === true,
        requestedStatus: params.status,
        // The capability is probed below against the loaded row; this half asks
        // only whether the document and the request allow an overlay at all.
        callerMayEdit: true,
        requestLocale: params.locale ?? null,
        defaultLocale: this.localization?.defaultLocale ?? null,
      }).overlay;
      // Even with the opt-in, a pending draft is surfaced only to a caller
      // trusted to EDIT the document. `overrideAccess` attests that directly.
      // `routeAuthorized` is NOT trusted: on this read path the REST dispatcher
      // sets it from `!!user` after authorizing the READ, so it attests read, not
      // update — trusting it would leak drafts to a read-only authenticated
      // caller. Every non-override authenticated caller is instead judged by an
      // actual update-capability probe against the LOADED row, so an owner-only
      // update rule (which the coarse check passes pending a row-level predicate)
      // does not treat a non-owner reader as an editor.
      let draftView = false;
      // Set once a working draft is actually surfaced. When the draft predicate
      // was suppressed but nothing is overlaid, the loaded row is the published
      // one, which an explicit draft filter must not return (see the 404 below).
      let draftOverlaid = false;
      if (draftEligible) {
        if (params.overrideAccess === true) {
          draftView = true;
        } else if (params.user !== undefined) {
          const updateDenied = await this.accessService.checkCollectionAccess(
            params.collectionName,
            "update",
            params.user,
            entryId,
            entry as Record<string, unknown>,
            params.overrideAccess,
            // The route attested a read, never an update, so the update grant is
            // checked rather than assumed from `routeAuthorized`.
            false,
            params.authenticatedScope
          );
          draftView = !updateDenied;
        }
      }
      if (draftView) {
        const workingDraft = await new VersionsRepository(
          this.adapter
        ).findWorkingDraft(
          {
            scopeKind: "collection",
            scopeSlug: params.collectionName,
            entryId,
          },
          // The same key the store, the promote and the discard derive, from
          // the same function: an unlocalized document under the `locale IS
          // NULL` slot, a localized one under the language being read. A read
          // that looked elsewhere would report no pending change and serve the
          // published content as though the author had never saved.
          workingDraftLocale({
            documentLocalized:
              (collection as { localized?: boolean }).localized === true,
            requestLocale: params.locale ?? null,
            defaultLocale: this.localization?.defaultLocale ?? null,
          })
        );
        // Mirror the write gate's eligibility check before overlaying: a
        // component that turned localized or unresolvable after this draft was
        // written — or a password field that appeared on the collection or a
        // reachable component — makes the sidecar unpromotable by any write, so
        // the live row must not be shadowed by a draft nothing can complete.
        // Resolved only once a draft actually exists, to keep the registry reads
        // off the common read path; the schemas double as the prune filter below.
        const draftComponentSchemas = workingDraft
          ? await resolveComponentSchemas(fields as FieldConfig[])
          : null;
        // The CONFIRMING half, against resolved schemas and through the same
        // rule the write uses. It replaced an inline copy that additionally
        // refused `schema.localized` — a clause the write dropped when a
        // localized component became representable in a snapshot. The write held
        // those edits and this read declined to show them, so the author saw
        // their own save reported as successful and the old content returned.
        const draftShowable =
          draftComponentSchemas === null ||
          resolveDraftOverlay({
            collectionHasStatus: true,
            draftsVersioningEnabled: true,
            documentLocalized:
              (collection as { localized?: boolean }).localized === true,
            fields: fields as FieldConfig[],
            componentSchemas: draftComponentSchemas,
            includeWorkingDraft: true,
            requestedStatus: params.status,
            callerMayEdit: true,
            requestLocale: params.locale ?? null,
            defaultLocale: this.localization?.defaultLocale ?? null,
          }).overlay;
        if (workingDraft && draftShowable) {
          const rawSnapshot = workingDraft.snapshot as Record<string, unknown>;
          // Shape the snapshot to the current schema before exposing it. A field
          // removed or renamed while the draft was pending leaves a key the
          // snapshot still carries; the password strip and field read-access
          // below inspect only currently declared fields, so an obsolete value
          // would otherwise reach the afterRead hooks and the response even
          // though a live read of the same document no longer returns it. The
          // same schema-aware prune the promote path applies is reused, then the
          // identity and timestamp columns it holds back (a restore must not
          // resubmit them, a read carries them) are copied back from the snapshot.
          // Which system columns the row actually has, mirroring the promote and
          // restore paths: a plugin collection gets no synthesized slug/title, so
          // telling the prune those columns exist would keep an obsolete snapshot
          // key the current schema no longer declares. `status` is present because
          // the draft eligibility above required it.
          const declaredFields = fields as FieldConfig[];
          const isPluginCollection =
            (collection as { admin?: { isPlugin?: boolean } }).admin
              ?.isPlugin === true;
          const { payload: shapedDraft } = buildRestorePayload(
            rawSnapshot,
            declaredFields,
            {
              hasStatus: true,
              hasSlug:
                !isPluginCollection ||
                declaredFields.some(f => f.name === "slug"),
              hasTitle:
                !isPluginCollection ||
                declaredFields.some(f => f.name === "title"),
              componentSchemas: draftComponentSchemas ?? undefined,
              documentLocalized: false,
              localeUnknown: false,
            }
          );
          // Every system timestamp spelling, taken from the shared list rather than named here.
          // Naming them is why the first-publication marker was pruned from this view while an
          // ordinary read of the same document returned it.
          for (const key of ["id", ...SYSTEM_TIMESTAMP_KEYS]) {
            if (key in rawSnapshot) shapedDraft[key] = rawSnapshot[key];
          }
          let draftEntry = shapedDraft;
          // The snapshot stores top-level relations as ids (captured at depth 0),
          // so expand them at the requested depth to match a live read. The live
          // assembly forwards `params.depth` unconditionally and
          // `expandRelationships` applies its own default when it is undefined,
          // so guard only the explicit `depth === 0` (ids-only) case — otherwise
          // a draft read that omits depth would return bare ids while the live
          // read for the same request expands. Only relationship expansion runs
          // here, never component population: the snapshot already carries the
          // draft's own component values, and re-reading components from their
          // tables would replace the pending edits with live content.
          if (params.depth !== 0) {
            const expandOptions: Parameters<
              CollectionRelationshipService["expandRelationships"]
            >[3] = {
              depth: params.depth,
              enforceFieldAccess: true,
              fieldAccessUser: params.fieldAccessUser,
              // The overlaid draft is the document the post-assembly pass runs
              // over, so its related rows defer field rules for the same reason
              // the live read does. Without this a draft read hides a denied
              // sibling before the rule that masks on it has run.
              fieldAccessStage: "assembled" as const,
              user: params.user,
              overrideAccess: params.overrideAccess,
              // Narrows that bypass per RELATED collection. Absent means unchanged;
              // dropping it here would silently restore the full bypass.
              trusted: params.trusted,
              authenticatedScope: params.authenticatedScope,
              locale: localeChain?.[0],
              status: expansionStatusScope({
                status: params.status,
                overrideAccess: params.overrideAccess,
                bounded: narrows(params.trusted),
              }),
            };
            draftEntry = await this.relationshipService.expandRelationships(
              draftEntry,
              params.collectionName,
              fields,
              expandOptions
            );
            // The parent-schema expansion above does not traverse component
            // fields, so a relationship inside a draft component would stay an id
            // while a live read populates it through the component data service.
            // Expand those relations on the snapshot's own component values, so a
            // draft read matches a live read at depth > 0 without re-reading the
            // live component rows (which would replace the pending edits).
            draftEntry = await this.expandDraftComponentRelations(
              draftEntry,
              fields as FieldConfig[],
              draftComponentSchemas,
              expandOptions
            );
          }
          // Snapshot serialization turned Date values into ISO strings, but an
          // ordinary live read hands the afterRead hooks Drizzle-decoded Date
          // objects, so a hook that calls date methods would fail only for a
          // drafted entry. Rehydrate the system timestamps and every declared
          // date field — including those nested inside components — to Date
          // before the read pipeline runs below.
          rehydrateSystemTimestamps(draftEntry);
          rehydrateSnapshotDates(
            draftEntry,
            declaredFields,
            draftComponentSchemas
          );
          expandedEntry = draftEntry;
          draftOverlaid = true;
        }
      }

      // An explicit `status: "draft"` read that opted into the working draft
      // dropped the draft predicate above so the published main row could be
      // loaded for the overlay. When no draft was surfaced (none exists, it turned
      // ineligible, or the caller is not trusted to edit) AND the loaded row is not
      // itself a draft, the row is the published one the draft filter would never
      // have matched, so 404 rather than hand back content the caller did not ask
      // for. A never-published entry whose main row IS `draft` matches the filter
      // directly and is returned as loaded.
      if (
        suppressDraftStatusFilter &&
        !draftOverlaid &&
        !(statusFilter?.values ?? []).includes(
          (expandedEntry as { status?: unknown }).status as string
        )
      ) {
        return {
          success: false,
          statusCode: 404,
          message: "Entry not found",
          data: null,
        };
      }

      // Redact password hashes BEFORE any afterRead hook runs (a hook could
      // copy the hash elsewhere); the final redaction below is defense in
      // depth.
      const detailHasPassword = hasPasswordField(fields);
      if (detailHasPassword) {
        stripPasswordFieldValues(expandedEntry, fields);
      }
      // Always strip the system owner column (see listEntries).
      stripSystemOwnerField(expandedEntry);

      // Decode before any afterRead hook runs, for the same reason as the list
      // path: a hook is documented against the configured value, not the
      // storage encoding SQLite hands back.
      decodeJsonFieldValues([expandedEntry], fields, params.locale);

      // Same placement as the list path: a related row's own field hooks run
      // before this collection's afterRead hooks can copy an unmasked value onto
      // a root property, and before selection rebuilds the row without the
      // siblings a masking rule judges on. Every populated related row is
      // walked, including one the projection drops.
      //
      // The state is held here rather than left to the inline finalize so the
      // related rows can be sanitized twice: once now (so the source collection's
      // hooks below are handed already sanitized rows), and again after those
      // hooks (so a denied field one of them writes back onto a related row is
      // stripped before the response).
      const detailNestedState =
        this.relationshipService.createNestedHookState();
      const detailNestedAccess = {
        enforceFieldAccess: true,
        fieldAccessUser: params.fieldAccessUser,
        user: params.user,
        overrideAccess: params.overrideAccess,
        // Narrows that bypass per RELATED collection. Absent means unchanged;
        // dropping it here would silently restore the full bypass.
        trusted: assumedBound(params.trusted),
        authenticatedScope: params.authenticatedScope,
      };
      await this.relationshipService.applyNestedFieldHooks(
        expandedEntry,
        params.collectionName,
        detailNestedAccess,
        detailNestedState
      );
      await this.relationshipService.finalizeRelatedRows(
        detailNestedState,
        detailNestedAccess
      );

      // Execute afterRead hooks (code-registered)
      // Hooks can transform the fetched data
      const afterContext = this.hookService.buildHookContext({
        collection: params.collectionName,
        operation: "read" as const,
        data: expandedEntry,
        user: params.user,
        context: sharedContext,
      });

      const transformedData = await this.hookService.hookRegistry.execute(
        "afterRead",
        afterContext
      );
      const dataAfterCodeHooks = transformedData ?? expandedEntry;

      // A code hook may have RETURNED a reshaped related row carrying a denied
      // field; sanitize now, before the stored and field-level hooks run, so one
      // of them cannot read that field and copy it onto an allowed source key the
      // final pass no longer looks at. Idempotent over the shared walk state.
      await this.relationshipService.reprojectRelatedRows(
        [dataAfterCodeHooks],
        params.collectionName,
        detailNestedAccess,
        detailNestedState
      );

      // Execute stored afterRead hooks (UI-configured)
      const storedAfterResult =
        await this.hookService.storedHookExecutor.execute(
          "afterRead",
          storedHooks,
          this.hookService.buildPrebuiltHookContext(
            params.collectionName,
            "read",
            dataAfterCodeHooks,
            // eslint-disable-next-line @typescript-eslint/require-await
            async () => false,
            params.user,
            sharedContext
          )
        );
      let finalData = (storedAfterResult.data ?? dataAfterCodeHooks) as Record<
        string,
        unknown
      >;

      // Convert snake_case timestamp columns to their camelCase API form.
      finalData = convertTimestampsToCamelCase(finalData);

      // Defense in depth: re-strip after hooks in case a hook re-introduced
      // a password value under its declared key.
      if (detailHasPassword) {
        stripPasswordFieldValues(finalData, fields);
      }
      // Same defense in depth for the owner column.
      stripSystemOwnerField(finalData);

      // A stored hook may likewise have reintroduced a denied related field;
      // sanitize before the field-level hooks read the assembled document.
      await this.relationshipService.reprojectRelatedRows(
        [finalData],
        params.collectionName,
        detailNestedAccess,
        detailNestedState
      );

      // Field-level afterRead hooks + read access — same semantics as the list
      // path above: access is applied BEFORE the hooks and AGAIN after, sharing a
      // redactions store, so a denied source field is hidden from the hooks (a hook
      // cannot copy a denied sibling onto an allowed key selection now projects
      // last) while a conditional rule still judges against the whole row and a
      // hook-reintroduced denied field is caught.
      // Row trust and FIELD trust are separate questions and this read may
      // answer them differently. `overrideAccess` alone means both; a caller
      // that asked for field rules to be enforced keeps its row bypass and
      // gives up only the field one. Computed once, beside the two passes it
      // governs, so they cannot drift apart.
      const skipFieldRules =
        params.enforceFieldAccess === true ? false : params.overrideAccess;
      const detailSourceRedactions: ReadAccessRedactions = new WeakMap();
      await applyFieldReadAccess(
        {
          kind: "collection",
          slug: params.collectionName,
          entry: finalData,
          user: params.fieldAccessUser ?? params.user,
          overrideAccess: skipFieldRules,
        },
        detailSourceRedactions
      );
      await runFieldHooks({
        kind: "collection",
        slug: params.collectionName,
        phase: "afterRead",
        data: finalData,
        operation: "read",
        user: params.user,
      });
      await applyFieldReadAccess(
        {
          kind: "collection",
          slug: params.collectionName,
          entry: finalData,
          user: params.fieldAccessUser ?? params.user,
          overrideAccess: skipFieldRules,
        },
        detailSourceRedactions
      );

      // Authoritative related-row sanitization over the assembled response,
      // after EVERY source afterRead hook phase above (code, stored, and
      // field-level), for the reason given at the same point on the list path:
      // those hooks can write a denied target field back onto a related row or
      // return a reshaped document whose related rows are new objects, and the
      // root access pass sees only this collection's schema. Before selection, so
      // it judges whole rows with their sibling evidence intact.
      await this.relationshipService.reprojectRelatedRows(
        [finalData],
        params.collectionName,
        detailNestedAccess,
        detailNestedState
      );

      // Apply field selection if select parameter is provided. Last of the
      // sanitizing steps, so every hook and access pass above judged the whole
      // row rather than the projected slice.
      if (params.select && Object.keys(params.select).length > 0) {
        finalData = this.applyFieldSelection(finalData, params.select);
      }

      // Transform rich text fields to requested format (html, both)
      // Default is "json" which returns the Lexical JSON structure as-is
      if (params.richTextFormat && params.richTextFormat !== "json") {
        // Cast FieldDefinition[] to FieldConfig[] - they share the same structure
        // for the properties used by transformRichTextFields (name, type, fields)
        finalData = transformRichTextFields(
          finalData,
          fields as unknown as Parameters<typeof transformRichTextFields>[1],
          params.richTextFormat
        );
      }

      // Final owner-column strip at the response boundary — after the
      // field-level afterRead hooks, read access, and rich-text transform — so
      // nothing downstream can re-expose the creator's user id.
      stripSystemOwnerField(finalData);

      // Signal that the returned document is the pending working draft, not the
      // live row (draft/published split). The overlay keeps the draft's `status`
      // at the live parent's value, so an editor UI needs an explicit flag to show
      // an "unpublished changes" state. Set only when a draft was actually
      // surfaced; mirrors the synthetic `_translations` read-response convention.
      if (draftOverlaid) {
        finalData._isWorkingDraft = true;
      }

      return {
        success: true,
        statusCode: 200,
        message: "Entry fetched successfully",
        data: finalData,
      };
    } catch (error: unknown) {
      return {
        success: false,
        statusCode: 500,
        message:
          error instanceof Error ? error.message : "Failed to fetch entry",
        data: null,
        // A typed error keeps its own status and code. Hardcoding 500 reported
        // a read hook's refusal as a server fault, and told a caller nothing it
        // could act on.
        ...errorEnvelopeFields(error),
      };
    }
  }

  // ============================================================
  // PRIVATE HELPER METHODS
  // ============================================================

  /**
   * Expand relationship fields nested inside a working draft's component values,
   * using each component's own schema and WITHOUT re-reading the component rows.
   *
   * The parent-schema `expandRelationships` does not traverse component fields,
   * so a relationship inside a draft component would otherwise stay an id on a
   * draft read while a live read populates it. The draft snapshot already carries
   * the component values (re-reading them would replace the pending edits with
   * live content), so this walks and expands them in place.
   */
  private async expandDraftComponentRelations(
    entry: Record<string, unknown>,
    parentFields: FieldConfig[],
    componentSchemas: ComponentSchemas | null,
    options: Parameters<CollectionRelationshipService["expandRelationships"]>[3]
  ): Promise<Record<string, unknown>> {
    if (!componentSchemas) return entry;
    const out = { ...entry };
    for (const field of parentFields) {
      if (!isFieldGroupField(field)) continue;
      const name = (field as { name?: unknown }).name;
      if (typeof name !== "string" || !(name in out)) continue;
      out[name] = await this.expandComponentInstanceRelations(
        out[name],
        field,
        componentSchemas,
        options
      );
    }
    return out;
  }

  /**
   * Expand one component value, or each element when the field is repeatable or a
   * dynamic zone, resolving each instance against its own component schema.
   */
  private async expandComponentInstanceRelations(
    value: unknown,
    field: FieldConfig,
    componentSchemas: ComponentSchemas,
    options: Parameters<CollectionRelationshipService["expandRelationships"]>[3]
  ): Promise<unknown> {
    if (Array.isArray(value)) {
      return Promise.all(
        value.map(item =>
          this.expandComponentInstanceRelations(
            item,
            field,
            componentSchemas,
            options
          )
        )
      );
    }
    if (value === null || typeof value !== "object") return value;

    const instance = value as Record<string, unknown>;
    // A dynamic-zone row records the component it holds; a single-component field
    // takes it from the field's declared slug.
    // Asked rather than read: the stored spelling of this key changes with the storage
    // migration, and a row written under the other one would read as untagged.
    const tagged = readFieldGroupType(instance);
    const declared = (field as { component?: unknown }).component;
    const slug =
      typeof tagged === "string"
        ? tagged
        : typeof declared === "string"
          ? declared
          : undefined;
    if (slug === undefined) return instance;

    const schema = componentSchemas.get(slug);
    if (!schema || !schema.resolved) return instance;

    // Expand this component's own relationship fields, then recurse into any
    // component nested inside it.
    let expanded = await this.relationshipService.expandRelationships(
      instance,
      slug,
      schema.fields as unknown as FieldDefinition[],
      options
    );
    expanded = await this.expandDraftComponentRelations(
      expanded,
      schema.fields,
      componentSchemas,
      options
    );
    return expanded;
  }

  /**
   * Build WHERE condition for full-text search across multiple fields.
   *
   * Creates an OR condition across all searchable fields using LIKE/ILIKE
   * pattern matching. The search term is wrapped with wildcards for substring matching.
   *
   * @param schema - Drizzle schema for the collection
   * @param fields - Field names to search
   * @param query - Search query string
   * @param dialect - Database dialect (for ILIKE vs LIKE selection)
   * @returns Drizzle WHERE condition or undefined if no search
   */
  private buildSearchCondition(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Drizzle dynamic schema
    schema: any,
    fields: string[],
    query: string,
    dialect: string = "postgresql",
    localizedCtx?: LocalizedQueryContext | null
  ): ReturnType<typeof or> | undefined {
    if (!query || fields.length === 0) {
      return undefined;
    }

    // Normalize and escape the search query
    const searchTerm = `%${query.trim().replace(/%/g, "\\%").replace(/_/g, "\\_")}%`;

    // Build OR conditions for each searchable field. A localized searchable field lives in the
    // companion table (absent from the main schema); match it via a companion EXISTS on the
    // requested locale instead of silently dropping it. Non-localized fields keep the
    // main-table ILIKE/LIKE.
    const conditions = fields
      .map(fieldName => {
        const localizedField = localizedCtx?.localizedFields.find(
          f => f.name === fieldName
        );
        if (localizedCtx && localizedField) {
          const t = sql.identifier(localizedCtx.companionTableName);
          const col = sql.identifier(localizedField.column);
          const valueCondition =
            dialect === "postgresql"
              ? sql`${t}.${col} ILIKE ${searchTerm}`
              : sql`${t}.${col} LIKE ${searchTerm}`;
          return buildCompanionExists({
            companionTableName: localizedCtx.companionTableName,
            mainIdColumn: localizedCtx.mainIdColumn,
            locale: localizedCtx.locale,
            valueCondition,
            statusValues: localizedCtx.statusValues,
          });
        }
        const column = schema[fieldName];
        if (!column) return undefined; // not on main table and not localized → skip
        return dialect === "postgresql"
          ? ilike(column, searchTerm)
          : like(column, searchTerm);
      })
      .filter((c): c is NonNullable<typeof c> => c !== undefined);

    if (conditions.length === 0) {
      return undefined;
    }

    // Combine with OR: field1 LIKE '%query%' OR field2 LIKE '%query%' OR ...
    return or(...conditions);
  }

  /**
   * Convert adapter-drizzle WhereClause to Drizzle ORM SQL condition.
   *
   * This method converts the internal WhereClause format (from query-operators)
   * to Drizzle ORM conditions that can be used in queries.
   *
   * @param whereClause - The WhereClause from buildWhereClause()
   * @param schema - Drizzle schema for the collection
   * @param dialect - Database dialect for case sensitivity handling
   * @returns Drizzle SQL condition or undefined if no conditions
   */
  /**
   * Compile a filter, keeping this service's localized-field support.
   *
   * The translation itself is shared, so a stored constraint binds the same way
   * whether it reaches SQL through a list read or through a relationship
   * populating a row from the same collection.
   */
  private buildDrizzleCondition(
    whereClause: ReturnType<typeof buildWhereClause>,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Drizzle dynamic schema
    schema: any,
    dialect: string = "postgresql",
    localizedCtx?: LocalizedQueryContext | null
  ): ReturnType<typeof and> | undefined {
    return buildDrizzleCondition(
      whereClause,
      schema,
      dialect,
      localizedCtx,
      buildLocalizedWhereExists
    );
  }

  private async resolveComponentTableNames(
    componentFilters: ComponentFieldFilter[]
  ): Promise<Map<string, string>> {
    const resolved = new Map<string, string>();
    if (componentFilters.length === 0 || !this.fieldGroupDataService) {
      return resolved;
    }

    // Mirror the condition builder's own narrowing: a _componentType filter
    // pinned to one type queries only that table, so resolving the whole zone
    // would cost a round trip per unused component choice.
    const slugs = new Set(
      componentFilters.flatMap(f =>
        f.isComponentTypeFilter && typeof f.value === "string"
          ? [f.value]
          : f.componentSlugs
      )
    );

    // Resolved together rather than in sequence: these are independent point
    // lookups, and this runs on every list request carrying a component filter.
    const lookups = await Promise.all(
      [...slugs].map(async slug => ({
        slug,
        tableName:
          await this.fieldGroupDataService?.getComponentTableName(slug),
      }))
    );
    for (const { slug, tableName } of lookups) {
      if (tableName) resolved.set(slug, tableName);
    }
    return resolved;
  }

  /**
   * The physical discriminator column each named component table carries.
   *
   * 🔴 This predicate is built as raw SQL rather than through the table object,
   * so it does not get the runtime schema's stable property key: it emits the
   * column name it is handed. A `_componentType` filter must therefore be given
   * the name the table actually has, or it addresses a column the storage
   * migration has moved and the query fails instead of matching documents.
   */
  private async resolveComponentTypeColumns(
    filters: readonly ComponentFieldFilter[],
    tableNames: Iterable<string>
  ): Promise<Map<string, string>> {
    // Only a `_componentType` filter addresses the discriminator. Every other
    // component filter names a user column, so introspecting here would spend
    // per-table catalog queries — column and index reads, or a PRAGMA each on
    // SQLite — on a value nothing goes on to read.
    if (!filters.some(filter => filter.isComponentTypeFilter)) return new Map();

    const tables = [...new Set(tableNames)];
    if (tables.length === 0) return new Map();
    return resolveTypeColumns(this.adapter, tables);
  }

  private buildComponentFieldConditions(
    componentFilters: ComponentFieldFilter[],
    parentTableName: string,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Drizzle column reference
    parentIdColumn: any,
    dialect: string = "postgresql",
    componentTableNames: Map<string, string> = new Map(),
    componentTypeColumns: Map<string, string> = new Map()
  ): ReturnType<typeof and> | undefined {
    if (componentFilters.length === 0) {
      return undefined;
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Drizzle SQL condition accumulator
    const existsConditions: any[] = [];

    for (const filter of componentFilters) {
      // Convert component field path to snake_case for database column
      const columnName = toSnakeCase(filter.componentFieldPath);

      // 🔴 The discriminator's physical name is resolved PER TABLE, so the
      // condition is built inside the per-table loop below rather than once for
      // the filter. This predicate is raw SQL and does not go through the
      // runtime table object, so it emits whatever column name it is handed —
      // and a dynamic-zone filter can span several tables whose storage the
      // migration has moved independently.

      // For _componentType filter on dynamic zone, we may need to query multiple tables
      // But the filter value tells us which specific component type to look for
      // So we can be smart: if filtering by _componentType, only query that component's table
      const slugsToQuery =
        filter.isComponentTypeFilter && typeof filter.value === "string"
          ? [filter.value] // Only query the specific component type's table
          : filter.componentSlugs;

      // Generate EXISTS subquery for each component table
      // For multi-component fields, if entry has matching data in ANY table, it matches
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Drizzle SQL condition accumulator
      const tableExistsConditions: any[] = [];

      for (const slug of slugsToQuery) {
        // The registry records the physical name, which is the only source for
        // a component with a custom dbName; canonical resolution is the
        // fallback when the lookup was unavailable.
        const componentTableName =
          componentTableNames.get(slug) ?? resolveComponentTableName(slug);

        const dbColumnName = filter.isComponentTypeFilter
          ? (componentTypeColumns.get(componentTableName) ??
            STORAGE_FORMAT.columns.type)
          : columnName;
        const valueCondition = buildComponentValueCondition(
          filter,
          dbColumnName,
          dialect
        );
        // An operator with nothing to match — an empty `in` list, or one this
        // builder does not implement — contributes no condition for this table.
        if (valueCondition === undefined) continue;

        // Build EXISTS subquery:
        // EXISTS (SELECT 1 FROM comp_{slug}
        //         WHERE _parent_id = {parentIdColumn}
        //         AND _parent_table = {parentTableName}
        //         AND _parent_field = {fieldName}
        //         AND {valueCondition})
        const existsSubquery = sql`
          EXISTS (
            SELECT 1 FROM ${sql.identifier(componentTableName)}
            WHERE ${sql.identifier(STORAGE_FORMAT.columns.parentId)} = ${parentIdColumn}
            AND ${sql.identifier(STORAGE_FORMAT.columns.parentTable)} = ${parentTableName}
            AND ${sql.identifier(STORAGE_FORMAT.columns.parentField)} = ${filter.fieldName}
            AND ${valueCondition}
          )
        `;

        tableExistsConditions.push(existsSubquery);
      }

      // Combine table conditions with OR (match if any table has matching data)
      if (tableExistsConditions.length === 1) {
        existsConditions.push(tableExistsConditions[0]);
      } else if (tableExistsConditions.length > 1) {
        existsConditions.push(or(...tableExistsConditions));
      }
    }

    // Combine all EXISTS conditions with AND
    if (existsConditions.length === 0) {
      return undefined;
    }
    if (existsConditions.length === 1) {
      return existsConditions[0];
    }
    return and(...existsConditions);
  }

  /**
   * Apply field selection to filter entry data.
   *
   * Filters an entry object to only include fields specified in the select parameter.
   * The `id` field is always included regardless of selection.
   * Supports nested field selection using dot notation (e.g., "author.name").
   *
   * @param entry - The entry object to filter
   * @param select - Object with field names as keys and boolean values (true = include)
   * @returns Filtered entry with only selected fields
   *
   * @example
   * ```typescript
   * const entry = { id: '1', title: 'Hello', content: 'World', author: { id: '2', name: 'John' } };
   * const select = { title: true, 'author.name': true };
   * const result = applyFieldSelection(entry, select);
   * // Result: { id: '1', title: 'Hello', author: { name: 'John' } }
   * ```
   */
  private applyFieldSelection(
    entry: Record<string, unknown>,
    select: Record<string, boolean>
  ): Record<string, unknown> {
    // Get list of fields to include (where value is true)
    const selectedFields = Object.entries(select)
      .filter(([, include]) => include)
      .map(([field]) => field);

    // If no fields selected, return entry as-is
    if (selectedFields.length === 0) {
      return entry;
    }

    // Build result with only selected fields
    const result: Record<string, unknown> = {};

    // Always include id
    if (entry.id !== undefined) {
      result.id = entry.id;
    }

    // Always include the system timestamps, for consistency across responses. Taken from the
    // shared list rather than named one by one: this ran BEFORE camelCase conversion and knew
    // only the original two, so a selected read dropped the first-publication marker even when
    // the caller asked for it by name.
    for (const key of SYSTEM_TIMESTAMP_KEYS) {
      if (entry[key] !== undefined) {
        result[key] = entry[key];
      }
    }

    for (const fieldPath of selectedFields) {
      if (fieldPath === "id") {
        // Already handled above
        continue;
      }

      if (fieldPath.includes(".")) {
        // Handle nested field selection (e.g., "author.name")
        const [parentField, ...childParts] = fieldPath.split(".");
        const childPath = childParts.join(".");

        if (entry[parentField] !== undefined && entry[parentField] !== null) {
          const parentValue = entry[parentField];

          // Handle array of objects (e.g., hasMany relationships)
          if (Array.isArray(parentValue)) {
            if (!result[parentField]) {
              result[parentField] = parentValue.map(() => ({}));
            }
            parentValue.forEach((item, index) => {
              if (typeof item === "object" && item !== null) {
                const itemRecord = item as Record<string, unknown>;
                const resultArray = result[parentField] as Record<
                  string,
                  unknown
                >[];
                // Always include id in nested objects
                if (itemRecord.id !== undefined) {
                  resultArray[index].id = itemRecord.id;
                }
                // Get nested value using child path
                const nestedValue = this.getNestedValue(itemRecord, childPath);
                if (nestedValue !== undefined) {
                  this.setNestedValue(
                    resultArray[index],
                    childPath,
                    nestedValue
                  );
                }
              }
            });
          }
          // Handle single object (e.g., hasOne relationship)
          else if (typeof parentValue === "object") {
            const parentRecord = parentValue as Record<string, unknown>;
            if (!result[parentField]) {
              result[parentField] = {};
              // Always include id in nested objects
              if (parentRecord.id !== undefined) {
                (result[parentField] as Record<string, unknown>).id =
                  parentRecord.id;
              }
            }
            const nestedValue = this.getNestedValue(parentRecord, childPath);
            if (nestedValue !== undefined) {
              this.setNestedValue(
                result[parentField] as Record<string, unknown>,
                childPath,
                nestedValue
              );
            }
          }
        }
      } else {
        // Simple field selection
        if (entry[fieldPath] !== undefined) {
          result[fieldPath] = entry[fieldPath];
        }
      }
    }

    return result;
  }

  /**
   * Get a nested value from an object using dot notation path.
   *
   * @param obj - Source object
   * @param path - Dot-separated path (e.g., "author.name")
   * @returns The nested value or undefined
   */
  private getNestedValue(obj: Record<string, unknown>, path: string): unknown {
    const parts = path.split(".");
    let current: unknown = obj;

    for (const part of parts) {
      if (current === null || current === undefined) {
        return undefined;
      }
      if (typeof current !== "object") {
        return undefined;
      }
      current = (current as Record<string, unknown>)[part];
    }

    return current;
  }

  /**
   * Set a nested value in an object using dot notation path.
   *
   * @param obj - Target object to modify
   * @param path - Dot-separated path (e.g., "author.name")
   * @param value - Value to set
   */
  private setNestedValue(
    obj: Record<string, unknown>,
    path: string,
    value: unknown
  ): void {
    const parts = path.split(".");
    let current = obj;

    for (let i = 0; i < parts.length - 1; i++) {
      const part = parts[i];
      if (current[part] === undefined || current[part] === null) {
        current[part] = {};
      }
      current = current[part] as Record<string, unknown>;
    }

    current[parts[parts.length - 1]] = value;
  }

  /**
   * Apply field selection to an array of entries.
   *
   * @param entries - Array of entry objects
   * @param select - Object with field names as keys and boolean values
   * @returns Array of filtered entries
   */
  private applyFieldSelectionToArray(
    entries: Record<string, unknown>[],
    select: Record<string, boolean>
  ): Record<string, unknown>[] {
    return entries.map(entry => this.applyFieldSelection(entry, select));
  }
}
