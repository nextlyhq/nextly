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

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import {
  eq,
  ne,
  gt,
  gte,
  lt,
  lte,
  and,
  or,
  like,
  ilike,
  inArray,
  notInArray,
  isNull,
  isNotNull,
  sql,
  asc,
  desc,
} from "drizzle-orm";

import { transformRichTextFields } from "@nextly/lib/field-transform";
import type { RichTextOutputFormat } from "@nextly/lib/rich-text-html";
import type { FieldDefinition } from "@nextly/schemas/dynamic-collections";

import type { FieldConfig } from "../../../collections/fields/types";
import { getFilterRegistry, FilterSeams } from "../../../filters";
import { toSnakeCase } from "../../../lib/case-conversion";
import {
  resolveStatusFilter,
  type StatusOption,
} from "../../../lib/status-filter";
import type {
  CollectionFileManager,
  CompanionSchema,
} from "../../../services/collection-file-manager";
import type { CollectionRelationshipService } from "../../../services/collections/collection-relationship-service";
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
import type { ComponentDataService } from "../../../services/components/component-data-service";
import type { Logger } from "../../../services/shared";
import { BaseService } from "../../../shared/base-service";
import { convertTimestampsToCamelCase } from "../../../shared/lib/case-conversion";
import {
  applyFieldReadAccess,
  runFieldHooks,
} from "../../../shared/lib/field-level-registry";
import {
  hasPasswordField,
  stripPasswordFieldValues,
} from "../../../shared/lib/password-fields";
import {
  buildPaginatedResponse,
  clampLimit,
  calculateOffset,
  PAGINATION_DEFAULTS,
} from "../../../types/pagination";
import type { PaginatedResponse } from "../../../types/pagination";
import type { DynamicCollectionService } from "../../dynamic-collections";
import {
  buildCompanionExists,
  buildLocalizedOrderExpr,
  buildTranslationStatusCondition,
  populateCompanionFields,
  populateCompanionFieldsAllLocales,
  populateTranslationStatus,
  type LocalizedFieldRef,
  type TranslationStatusFilter,
  type TranslationFilterState,
} from "../../i18n/companion-join";
import type { SanitizedLocalizationConfig } from "../../i18n/config/types";
import {
  isValidLocale,
  resolveFallbackChain,
  resolveRequestedLocale,
} from "../../i18n/resolve-locale";

import type { CollectionAccessService } from "./collection-access-service";
import type { CollectionHookService } from "./collection-hook-service";
import type { CollectionServiceResult, UserContext } from "./collection-types";
import {
  getTableName,
  getSearchableFields,
  getMinSearchLength,
  isJsonFieldType,
} from "./collection-utils";

/**
 * Localized-query context (i18n M4c) threaded into the search/where builders so a localized
 * field filters via a companion EXISTS on the requested locale instead of being silently
 * dropped. `null`/absent → non-localized behavior (unchanged).
 */
interface LocalizedQueryContext {
  companionTableName: string;
  /** Localized fields with both the camelCase name (matching) and snake_case column (SQL). */
  localizedFields: LocalizedFieldRef[];
  /** The main table's `id` column (Drizzle) — the companion `_parent` correlation target. */
  mainIdColumn: unknown;
  /** The locale to filter on (the requested locale — chain head). */
  locale: string;
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
    private readonly componentDataService?: ComponentDataService,
    /**
     * Normalized localization config (i18n M4). When set and a collection is localized,
     * reads resolve translatable fields from the companion `_locales` table for the
     * requested locale with fallback. Absent → non-localized behavior (unchanged).
     */
    private readonly localization?: SanitizedLocalizationConfig
  ) {
    super(adapter, logger);
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
  private async populateLocalizedAll(
    collectionName: string,
    rows: Record<string, unknown>[],
    locale: string | undefined,
    preloaded?: CompanionSchema | null
  ): Promise<void> {
    if (!this.localization || locale !== "all" || rows.length === 0) return;
    const companion =
      preloaded ?? (await this.fileManager.loadCompanionSchema(collectionName));
    if (!companion) return;
    await populateCompanionFieldsAllLocales({
      db: this.db as never,
      companionTable: companion.table,
      localizedFields: companion.localizedFields,
      rows,
      locales: this.localization.locales.map(l => l.code),
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
    preloaded?: CompanionSchema | null
  ): Promise<void> {
    if (!this.localization || rows.length === 0) return;
    const companion =
      preloaded ?? (await this.fileManager.loadCompanionSchema(collectionName));
    if (!companion) return;
    await populateTranslationStatus({
      db: this.db as never,
      companionTable: companion.table,
      localizedFields: companion.localizedFields,
      rows,
      locales: this.localization.locales.map(l => l.code),
      defaultLocale: this.localization.defaultLocale,
      hasStatus: companion.hasStatus,
    });
  }

  /**
   * Pull the reserved `_translated` key (i18n M7 language filter) out of a where object, returning
   * the validated filter and a cleaned where without it (so the generic where-builder never sees
   * it). Shape: `{ _translated: { locale, state } }`, state ∈ missing|translated|draft|published.
   */
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
    const states: TranslationFilterState[] = [
      "missing",
      "translated",
      "draft",
      "published",
    ];
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
    statusFilterValue?: string | null
  ): Promise<void> {
    if (!localeChain || rows.length === 0) return;
    const companion =
      preloaded ?? (await this.fileManager.loadCompanionSchema(collectionName));
    if (!companion) return;
    await populateCompanionFields({
      db: this.db as never,
      companionTable: companion.table,
      localizedFields: companion.localizedFields,
      rows,
      localeChain,
      statusValue:
        companion.hasStatus && statusFilterValue
          ? statusFilterValue
          : undefined,
    });
  }

  /**
   * Build a companion EXISTS condition for a where-filter on a localized field (i18n M4c).
   * Maps the where operator to a SQL predicate on the companion column for the requested locale.
   * Returns `undefined` for operators not supported over the companion (caller falls through).
   */
  private buildLocalizedWhereExists(
    ctx: LocalizedQueryContext,
    column: string,
    op: string,
    value: unknown,
    dialect: string
  ): ReturnType<typeof sql> | undefined {
    const t = sql.identifier(ctx.companionTableName);
    const col = sql.identifier(column);
    let valueCondition: ReturnType<typeof sql> | undefined;
    switch (op) {
      case "=":
        valueCondition = sql`${t}.${col} = ${value}`;
        break;
      case "!=":
        valueCondition = sql`${t}.${col} <> ${value}`;
        break;
      case ">":
        valueCondition = sql`${t}.${col} > ${value}`;
        break;
      case ">=":
        valueCondition = sql`${t}.${col} >= ${value}`;
        break;
      case "<":
        valueCondition = sql`${t}.${col} < ${value}`;
        break;
      case "<=":
        valueCondition = sql`${t}.${col} <= ${value}`;
        break;
      case "LIKE":
        valueCondition = sql`${t}.${col} LIKE ${value}`;
        break;
      case "ILIKE":
        valueCondition =
          dialect === "postgresql"
            ? sql`${t}.${col} ILIKE ${value}`
            : sql`${t}.${col} LIKE ${value}`;
        break;
      case "IS NULL": {
        // A localized field is absent for the locale when no companion row holds
        // a value — an untranslated entry usually has no companion row at all.
        // Match those with NOT EXISTS(row with a value) rather than
        // EXISTS(col IS NULL), which would require a companion row to exist.
        const present = buildCompanionExists({
          companionTableName: ctx.companionTableName,
          mainIdColumn: ctx.mainIdColumn,
          locale: ctx.locale,
          valueCondition: sql`${t}.${col} IS NOT NULL`,
        });
        return sql`NOT ${present}`;
      }
      case "IS NOT NULL":
        valueCondition = sql`${t}.${col} IS NOT NULL`;
        break;
      case "IN":
        if (Array.isArray(value) && value.length > 0) {
          // Expand the array into an SQL list; a bare array bind would emit
          // `col IN $1` and compare against the whole array as one value.
          const inList = sql.join(
            value.map(v => sql`${v}`),
            sql`, `
          );
          valueCondition = sql`${t}.${col} IN (${inList})`;
        }
        break;
      case "NOT IN":
        if (Array.isArray(value) && value.length > 0) {
          // Expand into an SQL list, mirroring the IN case; without this the
          // localized not_in filter is silently dropped and excludes nothing.
          const notInList = sql.join(
            value.map(v => sql`${v}`),
            sql`, `
          );
          valueCondition = sql`${t}.${col} NOT IN (${notInList})`;
        }
        break;
      default:
        return undefined;
    }
    if (!valueCondition) return undefined;
    return buildCompanionExists({
      companionTableName: ctx.companionTableName,
      mainIdColumn: ctx.mainIdColumn,
      locale: ctx.locale,
      valueCondition,
    });
  }

  /**
   * Build the localized-query context for the search/where builders, or `null` when the
   * collection isn't localized. Uses the requested locale (chain head) for EXISTS filtering.
   */
  private buildLocalizedQueryContext(
    companion: CompanionSchema | null,
    localeChain: string[] | null,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Drizzle dynamic schema
    schema: any
  ): LocalizedQueryContext | null {
    if (!companion || !localeChain || localeChain.length === 0) return null;
    return {
      companionTableName: companion.companionTableName,
      localizedFields: companion.localizedFields,
      mainIdColumn: schema.id,
      locale: localeChain[0],
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
     * The route middleware already ran the RBAC gate for the authorizing
     * operation, so skip only that redundant re-check while still evaluating
     * the stored read rules (owner-only filter, custom queries). Used by the
     * bulk-by-query writers to enumerate their targets: the route authorized
     * the write, so an update/delete-only key must not be rejected by a read
     * RBAC gate here — but owner-only scoping must still apply.
     */
    routeAuthorized?: boolean;
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
        params.routeAuthorized
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
      const localizedCtx = this.buildLocalizedQueryContext(
        companion,
        localeChain,
        schema
      );

      // Shared context between all hooks in this request
      // Seed with caller's context if provided (e.g., from Direct API)
      const sharedContext: Record<string, unknown> = { ...params.context };

      // Execute beforeOperation hooks FIRST (before operation-specific hooks)
      // Can modify operation arguments or throw to abort
      const beforeOpArgs =
        await this.hookService.hookRegistry.executeBeforeOperation({
          collection: params.collectionName,
          operation: "read",
          args: { where: {} }, // List operations can have where clause modified
          user: params.user
            ? { id: params.user.id, email: params.user.email }
            : undefined,
          context: sharedContext,
        });

      // Extract modified where clause if returned (for future query filtering)
      const whereFromHook = beforeOpArgs?.where;

      // Execute beforeRead hooks
      // Hooks can be used to modify query parameters or add filters
      const beforeContext = this.hookService.buildHookContext({
        collection: params.collectionName,
        operation: "read" as const,
        data: whereFromHook ?? {}, // Pass where clause as data for beforeRead
        user: params.user,
        context: sharedContext,
      });

      await this.hookService.hookRegistry.execute("beforeRead", beforeContext);

      // D63 seam: let plugins transform the structured list-query `where`.
      // Guarded by hasFilters so default behavior (no plugins) is unchanged —
      // we do NOT activate the dormant beforeOperation `whereFromHook` path here.
      const filterRegistry = getFilterRegistry();
      const listQueryWhere = filterRegistry.hasFilters(
        FilterSeams.CollectionsListQuery
      )
        ? await filterRegistry.applyFilters(
            FilterSeams.CollectionsListQuery,
            params.where ?? {},
            {
              collection: params.collectionName,
              userId: params.user?.id,
              search: params.search,
              limit: params.limit,
            }
          )
        : params.where;

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
          params.overrideAccess
        );

      // Apply access constraint if present
      if (accessConstraint) {
        const accessField = Object.keys(accessConstraint)[0];
        const accessValue = (
          accessConstraint[accessField] as { equals?: unknown }
        )?.equals;
        if (accessField && accessValue) {
          whereConditions.push(eq(schema[accessField], accessValue));
        }
      }

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
      if (statusFilter && schema.status) {
        whereConditions.push(eq(schema.status, statusFilter.value));
      }

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
          const searchableFields = getSearchableFields(collectionMeta);

          if (searchableFields.length > 0) {
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
      const componentCondition = this.buildComponentFieldConditions(
        componentFilters,
        tableName,
        schema.id,
        dialect
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

        // Try both camelCase and snake_case versions of the field name
        // This handles both user-defined fields (often camelCase) and system fields (snake_case in DB)
        const column = schema[sortField] || schema[sortFieldSnake];

        if (localizedSortField && companion && localeChain) {
          const orderExpr = buildLocalizedOrderExpr({
            companionTableName: companion.companionTableName,
            mainIdColumn: schema.id,
            column: localizedSortField.column,
            localeChain,
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
            // Re-attach the translation filter so the count applies the same
            // companion predicate as the rows (countEntries re-extracts it);
            // geo operators stay excluded via cleanedWhere. Without this the
            // language filter paginates against the unfiltered total.
            where: translationFilter
              ? ({
                  ...(cleanedWhere ?? {}),
                  _translated: translationFilter,
                } as WhereFilter)
              : cleanedWhere,
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
            // The count must answer the same access question as the rows, or a
            // route-authorized update/delete-only caller gets its read gate
            // denied here and totalDocs silently falls back to 0 — breaking the
            // bulk-by-query limit guard and pagination.
            routeAuthorized: params.routeAuthorized,
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
      await this.populateLocalized(
        params.collectionName,
        entries,
        localeChain,
        companion,
        statusFilter?.value ?? null // i18n M6: per-locale published filter
      );
      // `locale=all` → language-keyed values per localized field (admin/export).
      await this.populateLocalizedAll(
        params.collectionName,
        entries,
        params.locale,
        companion
      );
      // i18n M7: per-locale translation-status map for the admin overview (opt-in).
      if (params.translationStatus) {
        await this.populateTranslationMeta(
          params.collectionName,
          entries,
          companion
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

      // Use batch expansion to avoid N+1 queries for better scalability
      // Pass depth parameter for relationship population control
      let expandedEntries =
        await this.relationshipService.batchExpandRelationships(
          entries,
          params.collectionName,
          fields,
          { depth: params.depth }
        );

      // Batch-populate component field data from comp_{slug} tables
      // Uses WHERE _parent_id IN (...) for N+1 prevention
      // Pass depth for relationship expansion within component data
      // Pass select to skip component fields excluded from selection (performance optimization)
      if (this.componentDataService) {
        expandedEntries =
          await this.componentDataService.populateComponentDataMany({
            entries: expandedEntries,
            parentTable: getTableName(params.collectionName),
            fields: fields as FieldConfig[],
            depth: params.depth,
            select: params.select,
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

      // Apply field selection if select parameter is provided
      // This filters the response to only include requested fields
      if (params.select && Object.keys(params.select).length > 0) {
        finalData = this.applyFieldSelectionToArray(
          finalData as Record<string, unknown>[],
          params.select
        );
      }

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

      // Deserialize JSON fields (richtext, blocks, array, group, json) for all entries
      finalData = (finalData as Record<string, unknown>[]).map(entry => {
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

        return entry;
      });

      // Field-level afterRead hooks + read access (code-first functions
      // resolved via the field-level registry): hooks may transform values;
      // fields whose access.read denies are stripped from the response.
      for (const entry of finalData as Record<string, unknown>[]) {
        await runFieldHooks({
          kind: "collection",
          slug: params.collectionName,
          phase: "afterRead",
          data: entry,
          operation: "read",
          user: params.user,
        });
        await applyFieldReadAccess({
          kind: "collection",
          slug: params.collectionName,
          entry,
          user: params.user,
          overrideAccess: params.overrideAccess,
        });
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
      return {
        success: false,
        statusCode: isNotFound ? 404 : 500,
        message,
        data: null,
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
   * Note: Hooks are NOT executed for count operations as there is no
   * document data to transform. This provides optimal performance.
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
    /** Search query to filter entries by searchable fields */
    search?: string;
    /** Where clause for advanced filtering */
    where?: WhereFilter;
    /** When true, bypass all access control checks */
    overrideAccess?: boolean;
    /**
     * The route middleware already ran the RBAC gate for the authorizing
     * operation; skip only that redundant re-check while stored read rules
     * (owner-only filter) still apply. Mirrors listEntries so the count
     * beside a route-authorized enumeration answers the same question and
     * does not fall back to 0 for update/delete-only callers.
     */
    routeAuthorized?: boolean;
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
        params.routeAuthorized
      );
      if (accessDenied) {
        return accessDenied;
      }

      const schema = await this.fileManager.loadDynamicSchema(
        params.collectionName
      );

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
      const localizedCtx = this.buildLocalizedQueryContext(
        companion,
        localeChain,
        schema
      );

      // Build count query using Drizzle
      // Start with a base count query
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Drizzle SQL condition accumulator
      const whereConditions: any[] = [];

      // Get access query constraint (e.g., for owner-only filtering)
      const accessConstraint =
        await this.accessService.getAccessQueryConstraint(
          params.collectionName,
          accessUser,
          params.overrideAccess
        );

      // Apply access constraint if present
      if (accessConstraint) {
        const accessField = Object.keys(accessConstraint)[0];
        const accessValue = (
          accessConstraint[accessField] as { equals?: unknown }
        )?.equals;
        if (accessField && accessValue) {
          whereConditions.push(eq(schema[accessField], accessValue));
        }
      }

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
      if (statusFilter && schema.status) {
        whereConditions.push(eq(schema.status, statusFilter.value));
      }

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
          const searchableFields = getSearchableFields(collectionMeta);

          if (searchableFields.length > 0) {
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

      // Apply where clause if provided
      if (params.where) {
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

        // i18n M7: pull the `_translated` language filter out before the component extractor
        // (which drops unrecognized object keys), for count==list parity.
        const {
          filter: countTranslationFilter,
          cleanedWhere: whereWithoutTranslation,
        } = this.extractTranslationStatusFilter(params.where);
        if (countTranslationFilter) {
          const translationCondition =
            await this.buildTranslationStatusFilterCondition(
              params.collectionName,
              countTranslationFilter,
              schema.id
            );
          if (translationCondition) whereConditions.push(translationCondition);
        }

        // Extract component field conditions (e.g., 'seo.metaTitle')
        const { componentFilters, cleanedWhere } =
          extractComponentFieldConditions(
            whereWithoutTranslation,
            fieldsForFilters
          );

        // Get the table name for component subqueries
        const tableName = getTableName(params.collectionName);

        // Build component field EXISTS conditions
        const componentCondition = this.buildComponentFieldConditions(
          componentFilters,
          tableName,
          schema.id,
          dialect
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
        statusCode: 500,
        message,
        data: null,
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
        params.overrideAccess
      );
      if (accessDenied) {
        return accessDenied;
      }

      const schema = await this.fileManager.loadDynamicSchema(
        params.collectionName
      );

      // Shared context between all hooks in this request
      const sharedContext: Record<string, unknown> = { ...params.context };

      // Execute beforeOperation hooks FIRST (before operation-specific hooks)
      // Can modify operation arguments (id) or throw to abort
      const beforeOpArgs =
        await this.hookService.hookRegistry.executeBeforeOperation({
          collection: params.collectionName,
          operation: "read",
          args: { id: params.entryId },
          user: params.user
            ? { id: params.user.id, email: params.user.email }
            : undefined,
          context: sharedContext,
        });

      // Use modified id if returned by beforeOperation
      const entryId = beforeOpArgs?.id ?? params.entryId;

      // Execute beforeRead hooks
      // Hooks can be used to modify query parameters or add filters
      const beforeContext = this.hookService.buildHookContext({
        collection: params.collectionName,
        operation: "read" as const,
        data: { entryId },
        user: params.user,
        context: sharedContext,
      });

      await this.hookService.hookRegistry.execute("beforeRead", beforeContext);

      // When read access is `owner-only`, fold the ownership
      // predicate into the SQL WHERE clause. A non-owner gets a 404
      // (same response shape as a non-existent ID), not a 403, so
      // IDOR-by-iteration leaks nothing about which IDs exist.
      const ownerConstraint = await this.accessService.getOwnerConstraint(
        params.collectionName,
        "read",
        accessUser,
        params.overrideAccess
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
      const statusCondition =
        statusFilter && schema.status
          ? eq(schema.status, statusFilter.value)
          : null;
      const whereParts = [idCondition, ownerCondition, statusCondition].filter(
        (c): c is NonNullable<typeof c> => c !== null
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

      // i18n M4: resolve localized fields from the companion `_locales` table for the
      // requested language (with fallback) BEFORE relationship expansion / hooks, so every
      // downstream consumer sees the translated values. No-op for non-localized collections.
      await this.populateLocalized(
        params.collectionName,
        [entry as Record<string, unknown>],
        this.resolveLocaleChain(params.locale, params.fallbackLocale),
        undefined,
        statusFilter?.value ?? null // i18n M6: per-locale published filter
      );
      // `locale=all` → language-keyed values per localized field (admin/export).
      await this.populateLocalizedAll(
        params.collectionName,
        [entry as Record<string, unknown>],
        params.locale
      );
      // i18n M7: per-locale translation-status map for the admin per-language pills (opt-in).
      if (params.translationStatus) {
        await this.populateTranslationMeta(params.collectionName, [
          entry as Record<string, unknown>,
        ]);
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
        { depth: params.depth }
      );

      // Populate component field data from comp_{slug} tables
      // Pass depth for relationship expansion within component data
      // Pass select to skip component fields excluded from selection (performance optimization)
      if (this.componentDataService) {
        expandedEntry = await this.componentDataService.populateComponentData({
          entry: expandedEntry,
          parentTable: getTableName(params.collectionName),
          fields: fields as FieldConfig[],
          depth: params.depth,
          select: params.select,
        });
      }

      // Redact password hashes BEFORE any afterRead hook runs (a hook could
      // copy the hash elsewhere); the final redaction below is defense in
      // depth.
      const detailHasPassword = hasPasswordField(fields);
      if (detailHasPassword) {
        stripPasswordFieldValues(expandedEntry, fields);
      }

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

      // Apply field selection if select parameter is provided
      // This filters the response to only include requested fields
      if (params.select && Object.keys(params.select).length > 0) {
        finalData = this.applyFieldSelection(finalData, params.select);
      }

      // Convert snake_case timestamp columns to their camelCase API form.
      finalData = convertTimestampsToCamelCase(finalData);

      // Defense in depth: re-strip after hooks in case a hook re-introduced
      // a password value under its declared key.
      if (detailHasPassword) {
        stripPasswordFieldValues(finalData, fields);
      }

      // Deserialize JSON fields (richtext, blocks, array, group, json) for response
      fields.forEach(field => {
        if (
          isJsonFieldType(field.type, field) &&
          finalData[field.name] &&
          typeof finalData[field.name] === "string"
        ) {
          try {
            finalData[field.name] = JSON.parse(finalData[field.name] as string);
          } catch {
            // If parsing fails, keep as string
          }
        }
      });

      // Field-level afterRead hooks + read access — same semantics as the
      // list path above.
      await runFieldHooks({
        kind: "collection",
        slug: params.collectionName,
        phase: "afterRead",
        data: finalData,
        operation: "read",
        user: params.user,
      });
      await applyFieldReadAccess({
        kind: "collection",
        slug: params.collectionName,
        entry: finalData,
        user: params.user,
        overrideAccess: params.overrideAccess,
      });

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
      };
    }
  }

  // ============================================================
  // PRIVATE HELPER METHODS
  // ============================================================

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
  private buildDrizzleCondition(
    whereClause: ReturnType<typeof buildWhereClause>,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Drizzle dynamic schema
    schema: any,
    dialect: string = "postgresql",
    localizedCtx?: LocalizedQueryContext | null
  ): ReturnType<typeof and> | undefined {
    if (!whereClause) {
      return undefined;
    }

    // Helper to build condition from a single WhereCondition
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic where clause structure
    const buildSingleCondition = (condition: any): any => {
      // Check if it's a nested WhereClause (has and/or)
      if (condition.and || condition.or) {
        return this.buildDrizzleCondition(
          condition,
          schema,
          dialect,
          localizedCtx
        );
      }

      // It's a WhereCondition
      const { column, op, value } = condition;

      // Get the column from schema (handle dot notation for nested fields)
      const columnParts = column.split(".");

      // i18n M4c: a filter on a localized field targets the companion table (absent from the
      // main schema). Resolve it to a companion EXISTS on the requested locale so the filter
      // takes effect instead of being silently skipped.
      const localizedWhereField = localizedCtx?.localizedFields.find(
        f => f.name === columnParts[0]
      );
      if (localizedCtx && localizedWhereField) {
        const localizedCond = this.buildLocalizedWhereExists(
          localizedCtx,
          localizedWhereField.column,
          op,
          value,
          dialect
        );
        if (localizedCond) return localizedCond;
      }

      const schemaColumn = schema[columnParts[0]];

      if (!schemaColumn) {
        // Column doesn't exist in schema, skip this condition
        return undefined;
      }

      switch (op) {
        case "=":
          return eq(schemaColumn, value);
        case "!=":
          return ne(schemaColumn, value);
        case ">":
          return gt(schemaColumn, value);
        case ">=":
          return gte(schemaColumn, value);
        case "<":
          return lt(schemaColumn, value);
        case "<=":
          return lte(schemaColumn, value);
        case "LIKE":
          return like(schemaColumn, value);
        case "ILIKE":
          // Use ILIKE for PostgreSQL, LIKE for others
          if (dialect === "postgresql") {
            return ilike(schemaColumn, value);
          }
          return like(schemaColumn, value);
        case "IN":
          if (Array.isArray(value) && value.length > 0) {
            return inArray(schemaColumn, value);
          }
          return undefined;
        case "NOT IN":
          if (Array.isArray(value) && value.length > 0) {
            return notInArray(schemaColumn, value);
          }
          return undefined;
        case "IS NULL":
          return isNull(schemaColumn);
        case "IS NOT NULL":
          return isNotNull(schemaColumn);
        default:
          return undefined;
      }
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Drizzle SQL condition accumulator
    const conditions: any[] = [];

    // Handle AND conditions
    if (whereClause.and && Array.isArray(whereClause.and)) {
      const andConditions = whereClause.and
        .map(buildSingleCondition)
        .filter(Boolean);
      if (andConditions.length > 0) {
        conditions.push(and(...andConditions));
      }
    }

    // Handle OR conditions
    if (whereClause.or && Array.isArray(whereClause.or)) {
      const orConditions = whereClause.or
        .map(buildSingleCondition)
        .filter(Boolean);
      if (orConditions.length > 0) {
        conditions.push(or(...orConditions));
      }
    }

    // Return combined conditions
    if (conditions.length === 0) {
      return undefined;
    }
    if (conditions.length === 1) {
      return conditions[0];
    }
    return and(...conditions);
  }

  /**
   * Build EXISTS subquery conditions for component field filters.
   *
   * Generates SQL EXISTS subqueries to filter entries based on component field values.
   * Each component filter results in an EXISTS clause against the component data table.
   *
   * @param componentFilters - Component field filters extracted from where clause
   * @param parentTableName - Name of the parent table (e.g., 'dc_pages')
   * @param parentIdColumn - Reference to the parent table's id column
   * @param dialect - Database dialect for operator handling
   * @returns Combined Drizzle SQL condition or undefined if no filters
   *
   * @example
   * ```typescript
   * // For filter: { 'seo.metaTitle': { contains: 'About' } }
   * // Generates: EXISTS (SELECT 1 FROM comp_seo WHERE _parent_id = dc_pages.id AND _parent_table = 'dc_pages' AND meta_title ILIKE '%About%')
   * ```
   */
  private buildComponentFieldConditions(
    componentFilters: ComponentFieldFilter[],
    parentTableName: string,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Drizzle column reference
    parentIdColumn: any,
    dialect: string = "postgresql"
  ): ReturnType<typeof and> | undefined {
    if (componentFilters.length === 0) {
      return undefined;
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Drizzle SQL condition accumulator
    const existsConditions: any[] = [];

    for (const filter of componentFilters) {
      // Convert component field path to snake_case for database column
      const columnName = toSnakeCase(filter.componentFieldPath);

      // Handle _componentType filter specially (already snake_case)
      const dbColumnName = filter.isComponentTypeFilter
        ? "_component_type"
        : columnName;

      // Build the value condition based on operator
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
          if (inValues.length === 0) continue;
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
          if (notInValues.length === 0) continue;
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
          // Unknown operator, skip
          continue;
      }

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
        const componentTableName = `comp_${slug}`;

        // Build EXISTS subquery:
        // EXISTS (SELECT 1 FROM comp_{slug}
        //         WHERE _parent_id = {parentIdColumn}
        //         AND _parent_table = {parentTableName}
        //         AND _parent_field = {fieldName}
        //         AND {valueCondition})
        const existsSubquery = sql`
          EXISTS (
            SELECT 1 FROM ${sql.identifier(componentTableName)}
            WHERE _parent_id = ${parentIdColumn}
            AND _parent_table = ${parentTableName}
            AND _parent_field = ${filter.fieldName}
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

    // Always include timestamps for consistency across responses
    if (entry.created_at !== undefined) {
      result.created_at = entry.created_at;
    }
    if (entry.updated_at !== undefined) {
      result.updated_at = entry.updated_at;
    }
    if (entry.createdAt !== undefined) {
      result.createdAt = entry.createdAt;
    }
    if (entry.updatedAt !== undefined) {
      result.updatedAt = entry.updatedAt;
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
