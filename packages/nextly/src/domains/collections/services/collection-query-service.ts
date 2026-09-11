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
import {
  eq,
  and,
  or,
  like,
  ilike,
  sql,
  asc,
  desc,
  gte,
  lt,
  type SQL,
  type SQLWrapper,
} from "drizzle-orm";

import { transformRichTextFields } from "@nextly/lib/field-transform";
import type { RichTextOutputFormat } from "@nextly/lib/rich-text-html";
import type { FieldDefinition } from "@nextly/schemas/dynamic-collections";

import type { AuthenticatedScope } from "../../../auth/authenticated-scope";
import { isFieldGroupField } from "../../../collections/fields/guards";
import type { FieldConfig } from "../../../collections/fields/types";
import { errorEnvelopeFields } from "../../../errors/from-service-envelope";
import { NextlyError } from "../../../errors/nextly-error";
import { getFilterRegistry, FilterSeams } from "../../../filters";
import {
  resolveRequestFacts,
  type ResolvedRequestFacts,
} from "../../../hooks/request-facts";
import { toCamelCase, toSnakeCase } from "../../../lib/case-conversion";
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
import { addressableFields } from "../../../shared/addressable-fields";
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
  assertGroupableField,
  assertSortableField,
  filterSearchableFields,
} from "../../../shared/lib/filterable-fields";
import {
  hasPasswordField,
  isPasswordFieldName,
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
import { extractFieldGroupReferences } from "../../field-groups/storage/field-group-field-type";
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
import { EVERY_TRANSLATION, NO_FALLBACK } from "../../i18n/locale-selector";
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
import {
  DEFAULT_DECIMAL_SCALE,
  getColumnDescriptor,
  getSystemColumnDescriptors,
  type ColumnDescriptor,
  type SupportedDialect,
} from "../../schema/services/field-column-descriptor";
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
import { groupKeyDeclarationProblem } from "../query/group-key-declaration";
import {
  timeseriesBoundOperand,
  timeseriesBucketExpression,
  timeseriesWindowIsStorable,
} from "../query/timeseries-bucket";
import {
  bucketStartToDbText,
  intervalAfter,
  intervalWindow,
  isTimeseriesInterval,
  type TimeseriesInterval,
} from "../query/timeseries-interval";

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
/**
 * A collection's fields as they are ADDRESSED on this table, with unnamed
 * presentational containers flattened into the level they sit in.
 *
 * Deliberately not `collectionFieldsFor`, which answers a different question:
 * the top-level declarations, which is what the draft overlay and the filter
 * assembly need. A field nested in an unnamed group gets a column at THIS
 * level, so the runtime schema has it and the widget source advertises it,
 * while the top-level array never mentions it. Judging a group key from the
 * top-level array therefore found no declaration for a column that exists --
 * leaving a date field refused as storing no date, and a decimal grouped
 * without the scale its author declared.
 *
 * Uses the shared walk rather than a second traversal, at its default setting,
 * which treats every unnamed container as transparent. That is what core's own
 * callers use and is a superset of the narrower view the source builder takes,
 * so a column that exists always has a declaration here.
 *
 * NOT COVERED BY A TEST IN THIS SUITE, stated rather than left to look
 * covered. An unnamed container is a REGISTRY shape: the code-first config
 * refuses a field without a name (FIELD_NAME_REQUIRED), so `defineCollection`
 * cannot build the case and the harness these tests use builds collections
 * that way. Reverting this call to `collectionFieldsFor` fails nothing here.
 * What IS pinned is the other half of the mismatch --
 * `collection-sources.test.ts` proves the source publishes such a field as a
 * top-level date, so a guard reading the top-level array refuses something the
 * source advertised.
 */
function addressedFieldsFor(collection: unknown): FieldDefinition[] {
  return addressableFields(
    collectionFieldsFor(collection)
  ) as unknown as FieldDefinition[];
}

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

/**
 * How many buckets one grouped read may return.
 *
 * A group key with unbounded cardinality -- an id, a title, a timestamp --
 * produces one bucket per row, so an uncapped GROUP BY is a full table read
 * wearing an aggregate's name. The cap bounds the ANSWER, never the scan: the
 * database groups every matching row and this decides how many of the finished
 * buckets travel back.
 */
export const MAX_GROUP_BUCKETS = 50;

/**
 * How many intervals one timeseries may cover, and how many it covers by default.
 *
 * A timeseries is bounded by its WINDOW rather than by a cap on the answer, so
 * this bounds the read itself: the window's start becomes a lower bound on the
 * date column, which an index can serve. 366 covers a year of days without
 * letting an hourly request walk an unbounded history.
 */
export const MAX_TIMESERIES_INTERVALS = 366;
export const DEFAULT_TIMESERIES_INTERVALS = 30;

/**
 * Refuse a window anchor that is not a real instant.
 *
 * `new Date("nonsense")` is a `Date` the type accepts and whose `getTime()` is
 * `NaN`, so it survives to build bucket starts that render as `Invalid Date`.
 * What happens next differs per dialect -- MySQL refuses it while building the
 * bound, PostgreSQL and SQLite carry it into the statement or into
 * `toISOString`, which throws -- so the same bad input answers a named 400 on
 * one database and a generic 500 on the others.
 *
 * Checked inside the plan, so it lands after authorization and BEFORE the read
 * hooks: `beforeOperation` and `beforeRead` are ordinary user code that writes
 * audit rows and spends rate-limit budget, and a request that was never going
 * to be answered must not charge the caller for it.
 */
function assertUsableWindowAnchor(now: Date | undefined): void {
  if (now === undefined) return;
  if (now instanceof Date && Number.isFinite(now.getTime())) return;
  throw NextlyError.validation({
    errors: [
      {
        path: "now",
        code: "TIMESERIES_WINDOW_INVALID",
        message: "The instant a timeseries window ends at must be a real date.",
      },
    ],
  });
}

/**
 * How many rows the database grouped into each bucket, keyed by its label.
 *
 * A row whose bucket is not text is dropped rather than coerced: every dialect
 * renders the bucket as a fixed-width string, so anything else means the
 * expression did not run as written and a coerced key would silently match no
 * generated interval.
 */
function countedByBucket(
  rows: Array<{ bucket: unknown; total: number | string | null }>
): Map<string, number> {
  const counted = new Map<string, number>();
  for (const row of rows) {
    if (typeof row.bucket === "string") {
      counted.set(row.bucket, Number(row.total ?? 0));
    }
  }
  return counted;
}

/**
 * The ends of the window the dialect can actually compare against, or
 * `undefined` when the window cannot contain a storable instant at all.
 *
 * Both ends compare the COLUMN rather than the bucketing expression, so an
 * index over the date can serve them; no index covers a computed value. A bound
 * the dialect cannot represent is OMITTED: on MySQL an out-of-range operand
 * renders as NULL, and `column >= NULL` matches nothing, so the predicate meant
 * to bound the scan would empty the answer. Omitting it is sound because the
 * column cannot store an instant outside that range.
 *
 * Whether the read happens at all is decided from the RAW endpoints rather than
 * from how many of them rendered. Dropping both ends means the window either
 * misses the storable range or surrounds it, and the two want opposite answers:
 * the first has nothing to read, while the second must scan unbounded because
 * every stored row falls inside it.
 *
 * Answers the OPERANDS rather than the comparisons, so the comparison is built
 * where the column still carries the type the schema gave it.
 */
function windowScope(
  window: Date[],
  interval: TimeseriesInterval,
  dialect: SupportedDialect
): { from?: Date | SQL; to?: Date | SQL } | undefined {
  const start = window[0];
  const end = intervalAfter(window[window.length - 1], interval);
  if (!timeseriesWindowIsStorable(start, end, dialect)) return undefined;
  const from = timeseriesBoundOperand(start, dialect);
  const to = timeseriesBoundOperand(end, dialect);
  return {
    ...(from === undefined ? {} : { from }),
    ...(to === undefined ? {} : { to }),
  };
}

/**
 * The read this timeline resolves its rows through.
 *
 * The date key travels as `groupBy`, so every refusal a grouped read already
 * makes applies unchanged: a field carrying a read rule, any spelling of it,
 * the owner column, a key naming no column. The two `require` flags move the
 * timeline's own preconditions inside the plan, where they land after
 * collection authorization and before the read hooks.
 *
 * `releaseNow` takes the REQUEST's clock, never the window anchor. Whether a
 * scheduled release has happened is a fact about the world at the moment of the
 * read, where the anchor is a reporting parameter the caller chooses -- so
 * anchoring a window on a future instant would make a draft scheduled for that
 * date count as published, and a timeline could then report rows an ordinary
 * read still hides. They are the same instant whenever the caller states no
 * anchor of its own, which is what keeps a release becoming due mid-read from
 * leaving the labels describing a later window than the row filter admitted.
 */
function timelineReadPlanRequest(
  params: FilteredReadParams & { dateField: string; interval: unknown },
  anchor: Date,
  requestNow: Date
): FilteredReadParams {
  return {
    ...params,
    groupBy: params.dateField,
    requireTimestampGroupKey: true,
    requireBucketableInterval: true,
    now: anchor,
    releaseNow: params.releaseNow ?? requestNow,
  };
}

/**
 * The refusals a timeline makes before the read hooks run.
 *
 * Grouped into one step because they share a reason as well as a position:
 * each rejects a request that was never going to be answered, and
 * `beforeOperation` and `beforeRead` are ordinary user code that writes audit
 * rows and spends rate-limit budget. They sit after collection authorization,
 * so an untrusted caller naming a bad interval gets the access refusal rather
 * than a detailed validation response that confirms the collection exists.
 */
function assertTimelinePreconditions(params: FilteredReadParams): void {
  assertUsableWindowAnchor(params.now);
  if (params.requireBucketableInterval === true) {
    assertBucketableInterval(params.interval);
  }
}

/** The interval, refused unless an expression exists for it. */
function assertBucketableInterval(value: unknown): TimeseriesInterval {
  if (isTimeseriesInterval(value)) return value;
  throw NextlyError.validation({
    errors: [
      {
        path: "interval",
        code: "TIMESERIES_INTERVAL_UNSUPPORTED",
        message: `"${String(value)}" is not an interval a timeseries can bucket by.`,
      },
    ],
  });
}

/**
 * How many intervals the window covers, within the documented bound.
 *
 * `Number.isFinite` first, for the reason the bucket cap checks it: `Math.trunc`,
 * `Math.max` and `Math.min` all PRESERVE `NaN`, so a computed count arriving as
 * one would reach the window builder and throw rather than fall back to the
 * documented default.
 */
function boundedIntervalCount(requested: unknown): number {
  if (!Number.isFinite(requested)) return DEFAULT_TIMESERIES_INTERVALS;
  return Math.min(
    Math.max(1, Math.trunc(requested as number)),
    MAX_TIMESERIES_INTERVALS
  );
}

/**
 * Refuse a timeline over a column that does not store a date.
 *
 * Judged by the column's declared SHAPE rather than by the field's type name,
 * so a plugin field storing a timestamp is bucketable on the same terms as a
 * built-in one.
 */
function assertDateColumn(
  descriptor: ColumnDescriptor | undefined,
  dateField: string
): void {
  if (descriptor?.kind === "timestamp") return;
  throw NextlyError.validation({
    errors: [
      {
        path: `dateField.${dateField}`,
        code: "FIELD_NOT_A_DATE",
        message: `"${dateField}" does not store a date, so its rows cannot be placed on a timeline.`,
      },
    ],
  });
}

/** How many rows fall in each interval of a window, oldest interval first. */
interface TimeseriesPoints {
  points: { start: string; count: number }[];
  interval: TimeseriesInterval;
}

/** Distinct values of one field with how many rows carry each. */
interface GroupedRows {
  buckets: { value: string | null; count: number }[];
  /**
   * Whether buckets were left out because the cap was reached.
   *
   * Reported for the reason `atLeast` is reported on a bounded count: a chart
   * that silently omits categories reads as the whole picture, and a reader
   * acts on the category it shows as largest.
   */
  truncated: boolean;
}

/**
 * Everything a filtered read needs to settle the row set a caller is allowed
 * to see.
 *
 * Named rather than written inline at each call, because more than one
 * operation asks this same question and differs only in what it computes over
 * the rows the answer settles on. Two copies of the list would be two places
 * for a filter to be added to one read and forgotten on the other, and the
 * reads would then describe different row sets while looking alike.
 */
interface FilteredReadParams {
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
   * Enforce FIELD-level read rules even on a read that is otherwise trusted.
   *
   * Carried on the aggregate surface for the same reason the row scope is: the
   * search narrowing drops searchable fields the caller may not read, and an
   * aggregate resolved without this trusts every one of them. The page would
   * then match on a narrowed set of fields while the total beside it matched on
   * all of them — and `search=<guess>` against a withheld field becomes a
   * probe whose answer is the count.
   */
  enforceFieldAccess?: boolean;
  /**
   * The instant a timeseries window ends at, when the caller named one.
   *
   * Carried on the shared params so the plan can refuse an unusable one before
   * the read hooks run, rather than after.
   */
  now?: Date;
  /**
   * The interval a timeseries buckets by, when this read is one.
   *
   * Carried on the shared params so the plan can refuse an unusable one after
   * collection authorization and before the read hooks, rather than before
   * either.
   */
  interval?: unknown;
  /** Whether the plan must refuse an interval it has no expression for. */
  requireBucketableInterval?: boolean;
  /**
   * Refuse the group key unless the column it names stores a date.
   *
   * Carried on the params rather than checked by the caller after the fact, so
   * the refusal happens inside the plan and therefore before the read hooks
   * run. A timeline is the only read that needs it; a count and a bucket set
   * group whatever scalar they were given.
   */
  requireTimestampGroupKey?: boolean;
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
  /** The HTTP request behind this operation, when one produced it. */
  request?: Request;
  /**
   * The field whose distinct values become buckets.
   *
   * Judged by `assertQueryReadable` alongside `where` and `sort`, because the
   * bucket set IS the distinct values of the column: grouping by a field the
   * caller may not read hands back the whole value set at once, where a
   * `where` yields it one probe at a time.
   */
  groupBy?: string;
}

/**
 * Refuse a group key that would disclose by grouping, or that names nothing.
 *
 * The owner column is stripped from responses and excluded from sort, because
 * ordering by it lets a caller target rows by creator; grouping by it is that
 * disclosure in one request -- a bucket per author with how much each wrote.
 * `assertGroupableField` does not reach it: that guard judges fields carrying
 * a read rule, and this is a system column carrying none.
 *
 * An unresolved column is refused rather than skipped, which is the deliberate
 * difference from the sort path. A dropped ORDER BY returns the right rows in
 * the wrong order; a dropped GROUP BY collapses every bucket into one row and
 * answers with a single total that reads exactly like a real one.
 */
function assertGroupKeyUsable(
  groupBy: string,
  column: unknown,
  declaredFields: FieldDefinition[]
): FieldDefinition | undefined {
  const snake = toSnakeCase(groupBy);
  const isOwner =
    groupBy === "created_by" ||
    groupBy === "createdBy" ||
    snake === "created_by";
  if (isOwner) {
    throw NextlyError.validation({
      errors: [
        {
          path: `groupBy.${groupBy}`,
          code: "FIELD_NOT_GROUPABLE",
          message:
            "Rows cannot be grouped by their creator. The buckets would report how many rows each user owns.",
        },
      ],
    });
  }
  // Resolved BEFORE the missing-column refusal below, because a declared field
  // can legitimately have no column on this table and the reason matters more
  // than the absence.
  const spelled = new Set([
    groupBy,
    toSnakeCase(groupBy),
    toCamelCase(groupBy),
  ]);
  const declared = declaredFields.find(field => spelled.has(field.name));

  const declaredProblem = groupKeyDeclarationProblem(declared, groupBy);
  if (declaredProblem !== undefined) {
    throw NextlyError.validation({
      errors: [
        {
          path: `groupBy.${groupBy}`,
          code: "FIELD_NOT_GROUPABLE",
          message: declaredProblem,
        },
      ],
    });
  }

  if (!column) {
    throw NextlyError.validation({
      errors: [
        {
          path: `groupBy.${groupBy}`,
          code: "FIELD_NOT_GROUPABLE",
          message: `"${groupBy}" is not a column on this collection, so there is nothing to group by.`,
        },
      ],
    });
  }

  // A password value never leaves the server, and the strip that enforces that
  // works on ROWS. An aggregate returns none, so a bucket label would carry the
  // stored hash out through a path with nothing on it to clear the value.
  // `assertGroupableField` does not reach this: it judges fields carrying an
  // `access.read` rule, and a password field's guarantee comes from its type.
  if (isPasswordFieldName(declaredFields, groupBy)) {
    throw NextlyError.validation({
      errors: [
        {
          path: `groupBy.${groupBy}`,
          code: "FIELD_NOT_GROUPABLE",
          message:
            "A password field cannot be grouped by. Its stored value never leaves the server, and buckets would carry it as their labels.",
        },
      ],
    });
  }

  // Handed back rather than looked up again by the caller. The declaration is
  // what decides how a bucket's value is rendered -- a decimal's scale, a
  // date's interval -- and a second lookup is a second answer that has to
  // agree with this one.
  return declared;
}

/**
 * Bucket rows as the wire carries them.
 *
 * Annotated rather than inferred because the group column is resolved from a
 * dynamic schema, so the select cannot describe its own row shape. A date
 * travels as ISO rather than through the platform's default rendering, so the
 * same row groups to the same label on every runtime.
 */
/**
 * One bucket's label, keeping values distinct that the database kept distinct.
 *
 * A JSON-backed column (`json`, `repeater`, `group`, `blocks`, a `hasMany`
 * relationship) comes back from PostgreSQL and MySQL as an object or an array.
 * `String()` renders every object as `[object Object]` and flattens arrays to
 * lossy comma-joined text, so two buckets the database grouped apart would
 * arrive wearing the same label — a chart that silently merges categories and
 * whose numbers no longer add up to the rows behind them.
 *
 * A date travels as ISO rather than through the platform's default rendering,
 * so the same row groups to the same label on every runtime.
 */
function decimalLabel(value: unknown, scale: number): string | undefined {
  // PostgreSQL and MySQL hand a decimal back as text precisely because it can
  // exceed what a double holds, so the text is never parsed to re-render it.
  // SQLite builds its numeric columns to read back as a JS number, which is the
  // one adapter whose decimal arrives already parsed; its own rendering is
  // taken rather than a fixed-point one.
  const text =
    typeof value === "string"
      ? value.trim()
      : typeof value === "number" && Number.isFinite(value)
        ? String(value)
        : undefined;
  if (text === undefined) return undefined;

  const match = /^(-?\d+)(?:\.(\d*))?$/.exec(text);
  if (!match) return undefined;
  const [, whole, fraction = ""] = match;

  // PADS up to the declared scale and never truncates below what the value
  // carries. Rounding to the scale would merge buckets the database kept
  // apart: SQLite's NUMERIC affinity is best-effort and does not enforce the
  // declared scale, so a column declared with scale 2 can hold 1.001 and 1.002
  // as two distinct groups -- and labelling both "1.00" hands back separate
  // counts under one label, which is the merge a bucket label exists to avoid.
  //
  // Two values that genuinely differ therefore still label differently on
  // different adapters, because they ARE different: PostgreSQL rounds 1.001 to
  // 1.00 on write while SQLite stores it whole. Making the labels agree by
  // discarding digits would report data that is not there.
  const padded = fraction.padEnd(Math.max(0, scale), "0");
  return padded === "" ? whole : `${whole}.${padded}`;
}

/**
 * The label the column's DECLARATION decides, where it decides one.
 *
 * Only a decimal has one today: the same stored value reaches this as the
 * number 1 on SQLite and the string "1.00" on the other two, so a rendering
 * chosen from the value alone would label identical data differently per
 * adapter.
 */
function declaredLabel(
  value: unknown,
  descriptor?: ColumnDescriptor
): string | undefined {
  if (descriptor?.kind !== "decimal") return undefined;
  return decimalLabel(value, descriptor.scale ?? DEFAULT_DECIMAL_SCALE);
}

/** The label a scalar renders to, or `undefined` when the value is structured. */
function scalarLabel(value: unknown): string | undefined {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string") return value;
  if (
    typeof value === "number" ||
    typeof value === "boolean" ||
    typeof value === "bigint"
  ) {
    return String(value);
  }
  return undefined;
}

function bucketLabel(
  value: unknown,
  descriptor?: ColumnDescriptor
): string | null {
  if (value == null) return null;
  // The declaration is asked first: it is the only source that knows the
  // author's intent for the value, where the renderings below know only its
  // runtime shape.
  const declared = declaredLabel(value, descriptor);
  if (declared !== undefined) return declared;
  const scalar = scalarLabel(value);
  if (scalar !== undefined) return scalar;
  // Everything else is structured. `JSON.stringify` answers `undefined` for a
  // value it cannot represent, which becomes the null bucket rather than the
  // string "undefined" sitting among real labels.
  return JSON.stringify(value) ?? null;
}

function toBuckets(
  rows: Array<{
    value: unknown;
    total: number | string | null;
  }>,
  descriptor?: ColumnDescriptor
): Array<{ value: string | null; count: number }> {
  return rows.map(row => ({
    value: bucketLabel(row.value, descriptor),
    count: Number(row.total ?? 0),
  }));
}

/**
 * A Drizzle table as this service reads it: columns addressed by name.
 *
 * Narrower than `any` on purpose. The helpers below index this to build
 * conditions, so `any` would drop checking from every one of those lookups and
 * from the values handed to the query builder — which is what the repository
 * prohibits rather than the dynamism itself. The value is genuinely dynamic
 * (the table is built from user schema at runtime) and genuinely a column map,
 * and this says exactly that.
 */
type DynamicSchema = Record<string, SQLWrapper | undefined>;

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
    if (!this.localization || locale === EVERY_TRANSLATION) return null;
    const requested = resolveRequestedLocale(this.localization, locale);
    // A per-request opt-out disables fallback: return the requested language only.
    if (fallbackLocale === false || fallbackLocale === NO_FALLBACK) {
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
    if (!this.localization || locale !== EVERY_TRANSLATION || rows.length === 0)
      return;
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
    groupBy?: string;
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
    // A group key discloses by a third route: the buckets it returns ARE the
    // distinct values of the column, so grouping by a field the caller may not
    // read hands back the value set directly rather than one probe at a time.
    //
    // 🔴 WITHOUT `frameworkFilter`. That flag attests that a `where` was built
    // by the framework from a route it was asked to render, which is a claim
    // about the FILTER and says nothing about a grouping key travelling beside
    // it. Forwarding it here would let a framework-built read publish the
    // distinct values of a field its caller may not read — the exemption
    // widening past the thing it was granted for. Trust still exempts, because
    // `overrideAccess` is a claim about the caller rather than about one clause.
    assertGroupableField("collection", params.collectionName, params.groupBy, {
      overrideAccess: opts.overrideAccess,
    });
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
    /** What the core resolved about the request behind this read. */
    requestFacts: ResolvedRequestFacts;
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
            req: params.requestFacts,
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
            req: params.requestFacts,
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
    /** What the core resolved about the request behind this read. */
    requestFacts: ResolvedRequestFacts;
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
            req: params.requestFacts,
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
            req: params.requestFacts,
          })
        );

        return resolvedId;
      }
    );
  }

  private buildLocalizedQueryContext(
    companion: CompanionSchema | null,
    localeChain: string[] | null,
    schema: DynamicSchema,
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

  /**
   * The coarse collection-level read gate, asked once for every read verb.
   *
   * Returns the refusal envelope to hand straight back, or `null` to continue.
   * Generic in the payload only because the three verbs answer with different
   * shapes; the decision itself is one question and must not become three.
   */
  private denyCollectionRead<T>(params: {
    collectionName: string;
    accessUser?: UserContext;
    /** Present only on the by-id path, which names the row it is judging. */
    entryId?: string;
    overrideAccess?: boolean;
    routeAuthorized?: boolean;
    authenticatedScope?: AuthenticatedScope;
  }): Promise<CollectionServiceResult<T> | null> {
    return this.accessService.checkCollectionAccess<T>(
      params.collectionName,
      "read",
      params.accessUser,
      params.entryId,
      undefined,
      params.overrideAccess,
      params.routeAuthorized,
      // A scoped API key is judged on its own read grant, so the session
      // super-admin bypass does not apply to a super-admin-owned key here.
      params.authenticatedScope
    );
  }

  /**
   * Which rows this caller may see, and in which lifecycle state.
   *
   * The two questions travel together on every read path — a listing, its
   * total, and a read by id all narrow by the stored read rule AND by the
   * Draft/Published filter, and both answers refuse by returning fewer rows
   * rather than by raising, so the by-id path reports a row it may not see as a
   * 404 rather than confirming it exists with a 403.
   *
   * The loaded collection comes back with them because every caller needs it
   * next and re-reading it is a second metadata round trip.
   */
  private async resolveRowScope(params: {
    collectionName: string;
    accessUser?: UserContext;
    overrideAccess?: boolean;
    authenticatedScope?: AuthenticatedScope;
    status?: StatusOption;
    /**
     * The document a by-id read names, forwarded so a custom rule deciding FROM
     * the id is asked about the same document the coarse gate judged. A listing
     * or an aggregate leaves it absent, which is the honest answer there.
     */
    entryId?: string;
  }): Promise<{
    accessConstraint: Record<string, unknown> | null;
    statusFilter: ReturnType<typeof resolveStatusFilter>;
    collection: unknown;
  }> {
    const accessConstraint = await this.accessService.getAccessQueryConstraint(
      params.collectionName,
      params.accessUser,
      params.overrideAccess,
      // Scope the owner filter too: without this a super-admin-owned scoped key
      // takes the session bypass and reads past its own grant, the predicate
      // having been lifted before it ever reached SQL.
      params.authenticatedScope,
      params.entryId
    );

    // `resolveStatusFilter` returns null when the collection has no status
    // column, the caller is trusted with no explicit choice, or explicit was
    // 'all'. Callers guard on `schema.status` before using the value, so a
    // collection with status disabled is never filtered on a missing column.
    const collection = await this.collectionService.getCollection(
      params.collectionName
    );
    const statusFilter = resolveStatusFilter({
      collectionHasStatus: (collection as { status?: boolean }).status === true,
      overrideAccess: params.overrideAccess === true,
      explicit: params.status,
    });

    return { accessConstraint, statusFilter, collection };
  }

  /**
   * The free-text search predicate, or `undefined` when the request has none.
   *
   * Returns an UNSATISFIABLE predicate rather than nothing when every
   * searchable field carries a read rule this caller fails: adding no condition
   * would match every otherwise-visible row, which is the opposite of a
   * narrowed search and a worse answer than the leak the narrowing closes.
   */
  private async resolveSearchCondition(params: {
    collectionName: string;
    search?: string;
    overrideAccess?: boolean;
    enforceFieldAccess?: boolean;
    schema: DynamicSchema;
    localizedCtx: LocalizedQueryContext | null;
  }): Promise<ReturnType<typeof and> | undefined> {
    if (!params.search) return undefined;

    const collectionMeta = await this.collectionService.getCollection(
      params.collectionName
    );
    if (params.search.trim().length < getMinSearchLength(collectionMeta)) {
      return undefined;
    }

    // Narrowed, not refused: the caller never named a column, so dropping the
    // ones they may not read answers what they asked. Leaving them in lets
    // `search=<guess>` probe a hidden value through which rows come back.
    const searchableFields = this.searchableFieldsFor(
      params.collectionName,
      collectionMeta,
      fieldTrustOf(params)
    );
    if (searchableFields.length === 0) return sql`1 = 0`;

    // localizedCtx routes localized searchable fields to a companion EXISTS
    // instead of dropping them.
    return this.buildSearchCondition(
      params.schema,
      searchableFields,
      params.search,
      this.queryDialect,
      params.localizedCtx
    );
  }

  /**
   * The caller's own filter, as SQL — component predicates first, then whatever
   * remains of the plain `where`.
   *
   * Component paths (`seo.metaTitle`) become EXISTS subqueries against the
   * `comp_` tables, so they are lifted out before the generic where-builder,
   * which has no way to express them and would otherwise drop them silently.
   * The component table names and discriminator columns are returned as well as
   * used: the list path resolves them here and hands them to its own count, so
   * one request costs one registry lookup rather than two.
   */
  // Flagged on CRAP only (cyclomatic 12, cognitive 10 are both under their
  // thresholds); CRAP multiplies complexity by MISSING coverage, and the
  // coverage term here is estimated rather than measured. It is covered: the
  // where-clause, component-filter and search tests in collection-query.test.ts
  // all run through here, and removing the access predicate this method's
  // sibling adds turns four tests red. The logic itself is not new — it was
  // inlined in `listEntries` (cyclomatic 87) and `countEntries` (44), both
  // critical, and lifting it out is what let those drop to 46 and 14.
  // fallow-ignore-next-line complexity
  private async resolveFilterConditions(params: {
    collectionName: string;
    /** The filter with the language and geo keys already removed. */
    where: WhereFilter | undefined;
    schema: DynamicSchema;
    localizedCtx: LocalizedQueryContext | null;
    resolvedComponentTables?: Map<string, string>;
    resolvedComponentTypeColumns?: Map<string, string>;
  }): Promise<{
    conditions: SQLWrapper[];
    componentTables: Map<string, string>;
    componentTypeColumns: Map<string, string>;
  }> {
    const conditions: SQLWrapper[] = [];
    if (!params.where) {
      return {
        conditions,
        componentTables: params.resolvedComponentTables ?? new Map(),
        componentTypeColumns: params.resolvedComponentTypeColumns ?? new Map(),
      };
    }

    const collection = await this.collectionService.getCollection(
      params.collectionName
    );
    const fields = ((
      (collection as Record<string, unknown>).schemaDefinition as
        | Record<string, unknown>
        | undefined
    )?.fields ||
      (collection as Record<string, unknown>).fields ||
      []) as Array<{
      name: string;
      type: string;
      component?: string;
      components?: string[];
    }>;

    const { componentFilters, cleanedWhere } = extractComponentFieldConditions(
      params.where,
      fields
    );

    const componentTables =
      params.resolvedComponentTables ??
      (await this.resolveComponentTableNames(componentFilters));
    const componentTypeColumns =
      params.resolvedComponentTypeColumns ??
      (await this.resolveComponentTypeColumns(
        componentFilters,
        componentTables.values()
      ));

    const componentCondition = this.buildComponentFieldConditions(
      componentFilters,
      getTableName(params.collectionName),
      params.schema.id,
      this.queryDialect,
      componentTables,
      componentTypeColumns
    );
    if (componentCondition) conditions.push(componentCondition);

    // What remains once the language, geo and component keys have each been
    // taken by the machinery that can express them.
    if (cleanedWhere) {
      const whereCondition = this.buildDrizzleCondition(
        buildWhereClause(cleanedWhere),
        params.schema,
        this.queryDialect,
        params.localizedCtx
      );
      if (whereCondition) conditions.push(whereCondition);
    }

    return { conditions, componentTables, componentTypeColumns };
  }

  /**
   * Turn a settled read request into the SQL conditions that answer it.
   *
   * `listEntries` and `countEntries` are one read: the list asks this service
   * for its own total, and a total taken under a different predicate than the
   * rows describes rows the page correctly withheld. They were two copies of
   * this sequence, kept in step by forwarding fourteen parameters from one to
   * the other, and every one of those forwards was added after the copies had
   * already come apart — a trusted reader whose drafts were listed and not
   * counted, a scoped key shown the unscoped total beside filtered rows, a
   * component-filtered page whose total counted the rows it excluded.
   *
   * So the predicate is built once and both queries are built from it. The
   * order is load-bearing and is the reason this is one method rather than
   * several: the status filter is resolved BEFORE the localized context, so
   * per-locale EXISTS checks constrain by the same status; the `_translated`
   * key is stripped BEFORE the geo and component extractors, which drop object
   * keys they do not recognize.
   */
  // Flagged on CRAP only (cyclomatic 11, cognitive 10 are both under their
  // thresholds); CRAP multiplies complexity by MISSING coverage, and the
  // coverage term here is estimated rather than measured. Every read in
  // collection-query.test.ts and collection-read-access-parity.test.ts reaches
  // this method, and three separate mutations of it were confirmed to turn
  // tests red: dropping the access predicate (4 red), dropping the status
  // filter, and dropping the search condition.
  //
  // The sequence is not new code. It was written TWICE — inline in
  // `listEntries` (cyclomatic 87, critical) and again in `countEntries` (44,
  // critical) — and the two had already drifted apart repeatedly. Holding it in
  // one method is what took those two to 46 and 14, and the whole file from 256
  // cyclomatic to 213.
  // fallow-ignore-next-line complexity
  private async resolveReadConditions(params: {
    collectionName: string;
    /** The filter the read hooks settled on, not the caller's raw one. */
    where: WhereFilter | undefined;
    search?: string;
    status?: StatusOption;
    overrideAccess?: boolean;
    enforceFieldAccess?: boolean;
    /** The user access is judged for — absent when the read is trusted. */
    accessUser?: UserContext;
    authenticatedScope?: AuthenticatedScope;
    schema: DynamicSchema;
    companion: CompanionSchema | null;
    localeChain: string[] | null;
    /**
     * Whether to pull geo operators out of the filter.
     *
     * They are evaluated in memory over rows already fetched, so only a read
     * that HAS rows can apply them. A count has none, and refuses a geo filter
     * before reaching here rather than answering a total that ignores it.
     */
    extractGeo: boolean;
    /**
     * The instant this read resolves a due release against.
     *
     * Taken from the caller rather than read here, because the rows and the
     * total beside them are two calls into this method and a release becoming
     * due between them would let one response carry pre-release rows next to a
     * post-release count.
     */
    releaseNow: Date;
    /**
     * The language filter, when the caller already stripped `_translated` from
     * the filter it forwarded. Otherwise it is taken from `where` here.
     */
    translationFilter?: TranslationStatusFilter;
    /** Component resolutions already made for this same request. */
    resolvedComponentTables?: Map<string, string>;
    resolvedComponentTypeColumns?: Map<string, string>;
  }): Promise<{
    /** The accumulated WHERE terms, in the order they were added. */
    conditions: SQLWrapper[];
    localizedCtx: LocalizedQueryContext | null;
    statusFilter: ReturnType<typeof resolveStatusFilter>;
    /** Geo operators to apply in memory; always empty when `extractGeo` is false. */
    geoFilters: ReturnType<typeof extractGeoFilters>["geoFilters"];
    /** The filter with the language and geo keys removed, for a caller that forwards it. */
    whereAfterGeo: WhereFilter | undefined;
    componentTables: Map<string, string>;
    componentTypeColumns: Map<string, string>;
    translationFilter: TranslationStatusFilter | null;
  }> {
    const conditions: SQLWrapper[] = [];
    const { schema, companion, localeChain } = params;

    // Row scope: the stored read rule's predicate and the Draft/Published
    // filter. The predicate is applied last, but resolved here so a rule that
    // refuses is judged against the same request as everything else.
    const { accessConstraint, statusFilter } = await this.resolveRowScope({
      collectionName: params.collectionName,
      accessUser: params.accessUser,
      overrideAccess: params.overrideAccess,
      authenticatedScope: params.authenticatedScope,
      status: params.status,
    });
    // The lifecycle predicate: the resolved status set, widened by whatever a
    // due release has made public as of this read's instant. Built here rather
    // than at each call site so the rows and the total beside them cannot
    // disagree about which documents a release has revealed.
    const releaseCondition = statusCondition({
      filter: statusFilter,
      statusColumn: schema.status,
      idColumn: schema.id,
      decisions: await this.releaseDecisions(
        params.collectionName,
        statusFilter,
        params.releaseNow
      ),
    });
    if (releaseCondition) conditions.push(releaseCondition);

    // AFTER the status filter, so localized where/search EXISTS checks
    // constrain by the per-locale status too — a published read must not match
    // a draft translation.
    const localizedCtx = this.buildLocalizedQueryContext(
      companion,
      localeChain,
      schema,
      statusFilter?.values
    );

    const searchCondition = await this.resolveSearchCondition({
      collectionName: params.collectionName,
      search: params.search,
      overrideAccess: params.overrideAccess,
      enforceFieldAccess: params.enforceFieldAccess,
      schema,
      localizedCtx,
    });
    if (searchCondition) conditions.push(searchCondition);

    // The `_translated` language filter comes out FIRST: the geo and component
    // extractors below drop object-valued keys they do not recognize, so it has
    // to be removed before them and turned into a companion EXISTS/NOT EXISTS.
    //
    // Applied whether or not a `where` survives it. When it is the ONLY filter
    // the caller forwards `where: undefined` with the key already stripped and
    // passes the filter itself, and applying it only alongside a `where` would
    // over-count exactly then.
    const extracted = this.extractTranslationStatusFilter(params.where);
    const translationFilter = params.translationFilter ?? extracted.filter;
    if (translationFilter) {
      const translationCondition =
        await this.buildTranslationStatusFilterCondition(
          params.collectionName,
          translationFilter,
          schema.id,
          companion
        );
      if (translationCondition) conditions.push(translationCondition);
    }

    // Geo operators cannot be translated to SQL across dialects, so a path with
    // rows lifts them out and applies them in memory.
    const { geoFilters, cleanedWhere: whereAfterGeo } = params.extractGeo
      ? extractGeoFilters(extracted.cleanedWhere)
      : { geoFilters: [], cleanedWhere: extracted.cleanedWhere };

    const filter = await this.resolveFilterConditions({
      collectionName: params.collectionName,
      where: whereAfterGeo,
      schema,
      localizedCtx,
      resolvedComponentTables: params.resolvedComponentTables,
      resolvedComponentTypeColumns: params.resolvedComponentTypeColumns,
    });
    conditions.push(...filter.conditions);
    const { componentTables, componentTypeColumns } = filter;

    const accessCondition = this.accessConstraintCondition(
      params.collectionName,
      accessConstraint,
      schema,
      localizedCtx
    );
    if (accessCondition) conditions.push(accessCondition);

    return {
      conditions,
      localizedCtx,
      statusFilter,
      geoFilters,
      whereAfterGeo,
      componentTables,
      componentTypeColumns,
      translationFilter: translationFilter ?? null,
    };
  }

  /**
   * Remove the values that never leave the server: password hashes, and the
   * owner column holding the creator's stable user id.
   *
   * One call rather than two decisions at each point, because the two are not
   * independent — every place that has a reason to clear one has the same
   * reason to clear the other, and the pipeline below runs it three times. The
   * owner strip is unconditional while the password strip is not: a collection
   * without a password field has no hash to clear, but every collection carries
   * `created_by`, and a document readable by non-creators must not disclose it.
   */
  private redactServerOnlyFields(
    rows: Record<string, unknown>[],
    fields: FieldDefinition[]
  ): void {
    const clearsPasswords = hasPasswordField(fields);
    for (const row of rows) {
      if (clearsPasswords) stripPasswordFieldValues(row, fields);
      stripSystemOwnerField(row);
    }
  }

  /**
   * Run the read-response pipeline over assembled rows: redact, hook, redact
   * again, project, transform.
   *
   * The ORDER is the security contract, and it is why this is one method rather
   * than a shape each read path arranges for itself. Every step is placed
   * against a specific way a value escapes:
   *
   * 1. password hashes and the owner column go BEFORE any hook, so no hook is
   *    handed a value it could copy onto a key the later passes do not watch;
   * 2. JSON columns are decoded before the hooks, which are documented against
   *    the configured value rather than SQLite's storage encoding;
   * 3. related rows run their OWN collection's field hooks and access before
   *    this collection's hooks can observe them, sharing one walk state for the
   *    whole batch — batch expansion hands the same row object to several
   *    parents, so a per-row pass would run a shared row's hooks once per
   *    reference;
   * 4. after each source hook phase (code, stored, field-level) the related
   *    rows are re-sanitized, because a hook can write a denied target field
   *    back onto one, and the root access pass knows only this collection's
   *    schema;
   * 5. field access runs BEFORE the field hooks and AGAIN after, sharing a
   *    redactions store, so a hook cannot read a denied sibling while a
   *    conditional rule still judges against the whole row;
   * 6. selection runs LAST of the sanitizing steps, so every pass above judged
   *    a whole row rather than a projected slice.
   *
   * `listEntries` and `getEntry` each had a copy of this, one looping and one
   * on a single document, and the copies had already drifted: the detail path
   * stripped the owner column after the stored hooks and the list path did not.
   * Both are handed an array here — a detail read is a batch of one — so the
   * order cannot be arranged differently for one of them again.
   */
  // Flagged on CRAP only (cyclomatic 12, cognitive 11 are both under their
  // thresholds); CRAP multiplies complexity by MISSING coverage, and the
  // coverage term here is estimated rather than measured. It is covered on both
  // paths: deleting the final owner-column strip turns two tests red (one for
  // the listing, one for the read by id) and skipping field selection turns a
  // third red.
  //
  // The count resists further splitting for a reason worth stating: the ORDER
  // of these passes is the security contract, and a reader has to be able to
  // see it as one sequence. It replaces two copies of that sequence — inline in
  // `listEntries` (cyclomatic 87) and `getEntry` (64), both critical — which
  // had already diverged on where the owner column is cleared.
  // fallow-ignore-next-line complexity
  private async finalizeReadRows(params: {
    rows: Record<string, unknown>[];
    /**
     * True for a read by id, whose afterRead handlers are handed the DOCUMENT
     * rather than the page. The only per-path difference this method keeps, and
     * it is kept because it is a published contract rather than drift — see the
     * hook section below.
     */
    single?: boolean;
    collectionName: string;
    fields: FieldDefinition[];
    storedHooks: ReturnType<CollectionHookService["getStoredHooks"]>;
    sharedContext: Record<string, unknown>;
    /**
     * What the hooks may learn about the request that made this read — a
     * visitor or a server. Resolved once by the caller and handed to every hook
     * phase here, so the `afterRead` phases see the same facts the `beforeRead`
     * phases did.
     */
    requestFacts: ResolvedRequestFacts;
    user?: UserContext;
    fieldAccessUser?: UserContext;
    overrideAccess?: boolean;
    enforceFieldAccess?: boolean;
    trusted?: TrustBound;
    authenticatedScope?: AuthenticatedScope;
    select?: Record<string, boolean>;
    richTextFormat?: RichTextOutputFormat;
    locale?: string;
  }): Promise<Record<string, unknown>[]> {
    const { rows, collectionName, fields } = params;

    // (1) Before any afterRead hook — collection, stored, or field-level — so a
    // hook receiving the hash cannot copy it into an allowed property the later
    // redaction does not look at. The final strip below stays as defense in
    // depth.
    this.redactServerOnlyFields(rows, fields);

    // (2) On SQLite these columns come back as strings, and a hook is
    // documented against the configured value.
    decodeJsonFieldValues(rows, fields, params.locale);

    // (3) One state for the whole batch — see the docblock on sharing.
    const nestedState = this.relationshipService.createNestedHookState();
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
    for (const row of rows) {
      await this.relationshipService.applyNestedFieldHooks(
        row,
        collectionName,
        nestedAccess,
        nestedState
      );
    }
    // Once, after the whole batch: the walk already applied field access to each
    // related row before its parent's hooks; this re-applies it (restoring the
    // removed evidence and re-judging the current content) to strip a denied
    // field a parent hook reintroduced, mutated or added, then rebuilds labels
    // from the survivors.
    await this.relationshipService.finalizeRelatedRows(
      nestedState,
      nestedAccess
    );

    // What an afterRead handler is handed, and what it may hand back.
    //
    // This is NOT the array-vs-single difference the rest of this method
    // flattens away — it is each read verb's PUBLISHED hook contract. A handler
    // registered on a list receives the page as an array; one on a read by id
    // receives the document, and reads `ctx.data.<field>` off it directly. Give
    // the by-id path a one-element array instead and every such handler sees
    // `undefined` for every field, silently: the hook still runs, still returns,
    // and only the values go missing.
    const toPayload = (rowSet: Record<string, unknown>[]): unknown =>
      params.single ? rowSet[0] : rowSet;
    const toRows = (
      returned: unknown,
      fallback: Record<string, unknown>[]
    ): Record<string, unknown>[] => {
      if (returned === undefined || returned === null) return fallback;
      return params.single
        ? [returned as Record<string, unknown>]
        : (returned as Record<string, unknown>[]);
    };

    // Code-registered afterRead hooks, which may transform the data wholesale.
    const transformed = await this.hookService.hookRegistry.execute(
      "afterRead",
      this.hookService.buildHookContext({
        collection: collectionName,
        operation: "read" as const,
        data: toPayload(rows),
        user: params.user,
        context: params.sharedContext,
        req: params.requestFacts,
      })
    );
    const afterCodeHooks = toRows(transformed, rows);

    // (4) A code hook may have RETURNED a reshaped related row carrying a denied
    // field; sanitize before the stored and field-level hooks run, so one of
    // them cannot read that field and copy it onto an allowed source key the
    // final pass no longer looks at. The authoritative pass is idempotent over
    // the shared walk state, so running it after each source phase is safe.
    await this.relationshipService.reprojectRelatedRows(
      afterCodeHooks,
      collectionName,
      nestedAccess,
      nestedState
    );

    // Stored afterRead hooks (UI-configured).
    const storedAfterResult = await this.hookService.storedHookExecutor.execute(
      "afterRead",
      params.storedHooks,
      this.hookService.buildPrebuiltHookContext({
        collection: collectionName,
        operation: "read",
        data: toPayload(afterCodeHooks),
        // The signature wants a thenable; `async` on a body with nothing to
        // await only asked for a suppression.
        queryDatabase: () => Promise.resolve(false),
        req: params.requestFacts,
        user: params.user,
        sharedContext: params.sharedContext,
      })
    );
    let finalData = toRows(storedAfterResult.data, afterCodeHooks);

    // Snake_case timestamp columns to their camelCase API form.
    finalData = finalData.map(row => convertTimestampsToCamelCase(row));

    // Defense in depth: re-strip after the hooks, in case one reintroduced a
    // password value under its declared key, or the owner column. The detail
    // path already did both here while the list path did only the password —
    // the stricter of the two is kept, so a field-level hook below cannot
    // observe an owner id on either path.
    this.redactServerOnlyFields(finalData, fields);

    // A stored hook may likewise have reintroduced a denied related field;
    // sanitize before the field-level hooks read the assembled document.
    await this.relationshipService.reprojectRelatedRows(
      finalData,
      collectionName,
      nestedAccess,
      nestedState
    );

    // (5) Row trust and FIELD trust are separate questions and this read may
    // answer them differently. `overrideAccess` alone means both; a caller that
    // asked for field rules to be enforced keeps its row bypass and gives up
    // only the field one. Computed once, beside the two passes it governs, so
    // they cannot drift apart.
    const skipFieldRules =
      params.enforceFieldAccess === true ? false : params.overrideAccess;
    for (const row of finalData) {
      const sourceRedactions: ReadAccessRedactions = new WeakMap();
      const target = {
        kind: "collection" as const,
        slug: collectionName,
        entry: row,
        user: params.fieldAccessUser ?? params.user,
        overrideAccess: skipFieldRules,
      };
      await applyFieldReadAccess(target, sourceRedactions);
      await runFieldHooks({
        kind: "collection",
        slug: collectionName,
        phase: "afterRead",
        data: row,
        operation: "read",
        user: params.user,
      });
      await applyFieldReadAccess(target, sourceRedactions);
    }

    // Authoritative related-row sanitization over the assembled response, after
    // EVERY source afterRead hook phase above. Before selection, so it judges
    // whole rows with their sibling evidence intact.
    await this.relationshipService.reprojectRelatedRows(
      finalData,
      collectionName,
      nestedAccess,
      nestedState
    );

    // (6) Last of the sanitizing steps.
    if (params.select && Object.keys(params.select).length > 0) {
      finalData = this.applyFieldSelectionToArray(finalData, params.select);
    }

    if (params.richTextFormat && params.richTextFormat !== "json") {
      // FieldDefinition[] and FieldConfig[] share the structure
      // `transformRichTextFields` reads (name, type, fields).
      const fieldConfig = fields as unknown as Parameters<
        typeof transformRichTextFields
      >[1];
      finalData = finalData.map(row =>
        transformRichTextFields(row, fieldConfig, params.richTextFormat)
      );
    }

    // Final owner-column strip at the response boundary — after every afterRead
    // hook, field-level read access and transform — so nothing downstream can
    // re-expose the creator's user id.
    for (const row of finalData) stripSystemOwnerField(row);

    return finalData;
  }

  /**
   * The dialect the where/search builders compile for, asked once rather than
   * recomputed at each call site — one of the copies had already drifted to
   * recomputing it inline where its twin used a hoisted local.
   *
   * Deliberately the adapter's own `dialect` rather than `BaseService.dialect`,
   * which reads `getCapabilities().dialect`. Every builder here has always used
   * this one, and swapping the source is a behaviour change this extraction is
   * not the place to make.
   */
  private get queryDialect(): string {
    return this.adapter?.dialect || "postgresql";
  }

  /**
   * Translate the stored read rule's query constraint into a SQL condition, for
   * whichever read is asking.
   *
   * All three read verbs narrow rows by the same rule, so they must translate
   * it the same way — through the same builder the caller's own `where` goes
   * through. It is a full filter predicate: an owner-only read emits one field,
   * but a custom rule can return any supported operator across several fields,
   * and reducing it to a single equality binds less than the rule states. A
   * list that filters and a read-by-id that does not is not a milder version of
   * the same rule, it is the id-iteration leak the predicate exists to close.
   *
   * Returns `undefined` when the rule imposes no predicate. Refuses — rather
   * than narrowing partially — when the constraint cannot be fully expressed.
   */
  private accessConstraintCondition(
    collectionName: string,
    accessConstraint: Record<string, unknown> | null,
    schema: DynamicSchema,
    localizedCtx: LocalizedQueryContext | null
  ): ReturnType<typeof and> | undefined {
    if (!accessConstraint) return undefined;

    // Refuse before translating: a partially translatable constraint yields a
    // non-empty condition that binds less than the rule requires.
    const untranslatable = describeUntranslatableConstraint(
      accessConstraint,
      name => Object.prototype.hasOwnProperty.call(schema, name),
      name => Boolean(localizedCtx?.localizedFields.some(f => f.name === name))
    );
    // Explicitly against null: a reason can be any string, and an empty one
    // would read as success.
    if (untranslatable !== null) {
      // Logged here rather than left on the error: the callers flatten this
      // into a result envelope, so the reason would otherwise never reach
      // operator logs and every refusal would look alike.
      this.logger.warn("Refused an untranslatable access constraint", {
        collection: collectionName,
        reason: untranslatable,
      });
      throw NextlyError.forbidden({
        logContext: {
          collection: collectionName,
          reason: "untranslatable-access-constraint",
          reason_detail: untranslatable,
        },
      });
    }

    // Members that cannot narrow anything are removed before translation, so
    // the "translated to nothing" check below judges only what was meant to
    // restrict. A constraint made up entirely of them restricts nothing, and
    // the rule already allowed the caller.
    const restricting = stripNoOpConstraintMembers(accessConstraint);
    if (Object.keys(restricting).length === 0) return undefined;

    const accessCondition = this.buildDrizzleCondition(
      buildWhereClause(restricting as WhereFilter),
      schema,
      this.queryDialect,
      localizedCtx
    );
    if (!accessCondition) {
      // A constraint that translates to nothing would widen the read to every
      // row. Fail closed instead: the rule asked to narrow.
      throw NextlyError.forbidden({
        logContext: {
          collection: collectionName,
          reason: "untranslatable-access-constraint",
        },
      });
    }
    return accessCondition;
  }

  /**
   * The relationship-expansion bounds for a read by id, asked once for both
   * documents that path can return.
   *
   * `getEntry` expands twice — the live row, and the working draft when the
   * overlay surfaces one — and every option here is a BOUND the relationship
   * service applies to each target it reads: which pass redacts a related row,
   * how far the caller's trust carries per target collection, the language a
   * target's read rule is evaluated in, and the status scope. An option missing
   * from one of the two calls does not fail, it WIDENS that expansion, so the
   * two cannot be kept in step by hand.
   */
  private buildDetailExpansionOptions(
    params: {
      depth?: number;
      fieldAccessUser?: UserContext;
      user?: UserContext;
      overrideAccess?: boolean;
      trusted?: TrustBound;
      authenticatedScope?: AuthenticatedScope;
      status?: StatusOption;
    },
    localeChain: string[] | null
  ): Parameters<CollectionRelationshipService["expandRelationships"]>[3] {
    return {
      depth: params.depth,
      // A related row is redacted by its OWN collection's field rules, for this
      // caller, and that pass is deferred until the document is assembled: run
      // earlier it would hide a denied sibling before the rule that masks on it
      // has been evaluated.
      enforceFieldAccess: true,
      fieldAccessUser: params.fieldAccessUser,
      fieldAccessStage: "assembled" as const,
      user: params.user,
      overrideAccess: params.overrideAccess,
      // The bound at this path's TOP-LEVEL expansion. Absent means unchanged,
      // so omitting it leaves the relationship service with no predicate and
      // every target is read fully trusted before the post-assembly pass runs.
      trusted: params.trusted,
      authenticatedScope: params.authenticatedScope,
      // The language a target collection's read rule is evaluated in when its
      // predicate names a localized field.
      locale: localeChain?.[0],
      // Only "read everything" propagates, and only when the caller actually
      // asked for it. Deriving this from the parent having resolved to no
      // filter would unfilter every target behind a status-less collection.
      status: expansionStatusScope({
        status: params.status,
        overrideAccess: params.overrideAccess,
        bounded: narrows(params.trusted),
      }),
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
    /** The HTTP request behind this operation, when one produced it. */
    request?: Request;
  }): Promise<CollectionServiceResult<PaginatedResponse<unknown>>> {
    try {
      // Determine the effective user for access control
      // When overrideAccess is true, skip all access checks even if user is provided
      const accessUser = params.overrideAccess ? undefined : params.user;

      // 1. Check collection-level access FIRST
      const accessDenied = await this.denyCollectionRead<
        PaginatedResponse<unknown>
      >({
        collectionName: params.collectionName,
        accessUser,
        overrideAccess: params.overrideAccess,
        routeAuthorized: params.routeAuthorized,
        authenticatedScope: params.authenticatedScope,
      });
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
        localeChain ||
        params.locale === EVERY_TRANSLATION ||
        params.translationStatus
          ? await this.fileManager.loadCompanionSchema(params.collectionName)
          : null;

      // Shared context between all hooks in this request
      // Seed with caller's context if provided (e.g., from Direct API)
      const sharedContext: Record<string, unknown> = { ...params.context };
      // Resolved once for the whole read, so every hook phase is told the same
      // thing about the caller and none of them re-reads a header.
      const requestFacts = resolveRequestFacts(params.request);

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
        requestFacts,
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

      // ONE instant for this read. Each release lookup taking its own
      // `new Date()` let a release become due between the row query and a
      // sibling condition, so one response could carry pre-release rows beside
      // a post-release count.
      const readNow = new Date();

      // The predicate this request resolves to. The count below is built from
      // the SAME result, so the total cannot describe a different row set than
      // the page.
      const {
        conditions: whereConditions,
        localizedCtx,
        statusFilter,
        geoFilters,
        whereAfterGeo,
        componentTables,
        componentTypeColumns,
        translationFilter,
      } = await this.resolveReadConditions({
        collectionName: params.collectionName,
        releaseNow: readNow,
        where: listQueryWhere,
        search: params.search,
        status: params.status,
        overrideAccess: params.overrideAccess,
        enforceFieldAccess: params.enforceFieldAccess,
        accessUser,
        authenticatedScope: params.authenticatedScope,
        schema,
        companion,
        localeChain,
        // This path has rows to evaluate them over.
        extractGeo: true,
      });
      const hasGeoFilters = geoFilters.length > 0;

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
            // Forwarded for the same reason `overrideAccess` is: the total has
            // to answer under the field trust the page answered under, or the
            // count matches on searchable fields the rows were narrowed by.
            enforceFieldAccess: params.enforceFieldAccess,
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

      // The read-response pipeline. `getEntry` runs the same one over its
      // single document.
      const finalData = await this.finalizeReadRows({
        rows: expandedEntries,
        collectionName: params.collectionName,
        fields,
        storedHooks,
        sharedContext,
        // The same facts the beforeRead phases were given, so a hook cannot
        // learn one thing about the request on the way in and another on
        // the way out.
        requestFacts,
        user: params.user,
        fieldAccessUser: params.fieldAccessUser,
        overrideAccess: params.overrideAccess,
        enforceFieldAccess: params.enforceFieldAccess,
        trusted: params.trusted,
        authenticatedScope: params.authenticatedScope,
        select: params.select,
        richTextFormat: params.richTextFormat,
        locale: params.locale,
      });

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
   * Refuse a geo predicate on a read that returns no rows to test it against.
   *
   * `listEntries` evaluates geo operators in memory over the rows it fetched.
   * An aggregate has no rows, and `buildWhereClause` emits no SQL for them, so
   * leaving one in place would answer over every candidate the geo filter was
   * meant to exclude -- a number that looks ordinary and counts the wrong set.
   */
  private refuseGeoInAggregate(
    collectionName: string,
    where: WhereFilter | undefined
  ): void {
    const { geoFilters } = extractGeoFilters(where);
    if (geoFilters.length === 0) return;
    throw NextlyError.invalidInput({
      message:
        "A geo filter cannot be counted. Geo predicates are evaluated over fetched rows, so they apply to a list but not to a count; remove the geo operator or take the total from the list instead.",
      logContext: {
        collection: collectionName,
        operators: geoFilters.map(f => f.operator),
      },
    });
  }

  /**
   * The filter a read actually runs, after the read hooks have had it.
   *
   * A standalone read runs them for the reason it mirrors every other
   * `listEntries` filter: its answer has to describe the rows a list would
   * return. Skipped when `listEntries` already ran them and forwarded what
   * they settled on, so one request never runs them twice.
   */
  private async hookSettledWhere(
    params: FilteredReadParams
  ): Promise<WhereFilter | undefined> {
    if (params.readHooksAlreadyRan) return params.where;
    return this.resolveReadWhere({
      collectionName: params.collectionName,
      where: params.where,
      user: params.user,
      sharedContext: { ...params.context },
      requestFacts: resolveRequestFacts(params.request),
    });
  }

  /**
   * The key this schema carries for a group-by, once it has earned the right
   * to name one.
   *
   * Answers the KEY rather than the column so the caller reads the column out
   * of the schema itself, where its type is in scope: a column handed back
   * through here would arrive widened and need a cast the compiler could not
   * check.
   *
   * Runs before the read hooks. `beforeOperation` and `beforeRead` are
   * ordinary user code that records audit entries and spends rate-limit
   * budget, and a key that was never going to be accepted should not make them
   * run. Collection authorization still comes first: whether the collection is
   * readable at all outranks what was asked of it.
   */
  /**
   * The dialect a grouped read builds its expressions for.
   *
   * Narrowed to the supported union here rather than read loosely at each use:
   * the bucketing expressions are chosen by exhaustive comparison, so a value
   * outside the union has to be refused rather than silently falling through
   * to whichever branch happens to be last.
   */
  private groupDialect(): SupportedDialect {
    const dialect = this.adapter?.dialect;
    return dialect === "mysql" || dialect === "sqlite" ? dialect : "postgresql";
  }

  /**
   * The column shape a group key resolves to, from the module that already owns
   * the field-to-column mapping for every dialect.
   */
  private groupKeyDescriptor(
    field: FieldDefinition | undefined,
    columnKey: string | undefined
  ): ColumnDescriptor | undefined {
    const dialect = this.groupDialect();
    if (field !== undefined) {
      return getColumnDescriptor(field, dialect, "collection") ?? undefined;
    }
    if (columnKey === undefined) return undefined;

    // `created_at` and `updated_at` are INJECTED rather than declared, so they
    // never appear in the author's field list and the lookup above cannot see
    // them -- while they are the two columns a timeline is most often drawn
    // over. Resolved through the canonical system-column descriptors rather
    // than by naming them here, so a system column added there is bucketable
    // without a second edit.
    //
    // The option set is the widest one deliberately. It decides which columns
    // are INJECTED, and whether this collection has the column is already
    // settled: the key reached here only by resolving against the runtime
    // schema's own properties. What is wanted from this call is the column's
    // SHAPE, which does not vary with the option set.
    const system = getSystemColumnDescriptors(dialect, {
      hasTitleField: false,
      hasSlugField: false,
      hasStatus: true,
    }).find(column => column.name === toSnakeCase(columnKey));
    if (system === undefined) return undefined;
    return {
      name: system.name,
      dialectType: system.dialectType,
      ...(system.length === undefined ? {} : { length: system.length }),
      nullable: system.nullable,
      kind: system.kind,
    };
  }

  /**
   * The window as points, taking each interval's count from what was grouped.
   *
   * Built from the WINDOW rather than from the rows, so the answer carries one
   * point per interval whether or not the database grouped that interval --
   * which is what makes a quiet stretch read as zero rather than disappear.
   */
  private timeseriesAnswer(
    window: Date[],
    interval: TimeseriesInterval,
    counted: Map<string, number>
  ): CollectionServiceResult<TimeseriesPoints> {
    return {
      success: true,
      statusCode: 200,
      message: "Timeseries retrieved successfully",
      data: {
        interval,
        points: window.map(start => ({
          start: start.toISOString(),
          count: counted.get(bucketStartToDbText(start)) ?? 0,
        })),
      },
    };
  }

  /**
   * The answer for a window no stored row can fall in: every interval, zero.
   *
   * Shaped exactly like a queried answer, because a caller cannot tell the two
   * apart and should not have to -- zero means no rows either way.
   */
  private emptyTimeseries(
    window: Date[],
    interval: TimeseriesInterval
  ): CollectionServiceResult<TimeseriesPoints> {
    // Through the same assembly a queried answer uses, with nothing counted, so
    // the two cannot drift into different shapes.
    return this.timeseriesAnswer(window, interval, new Map());
  }

  /**
   * The group key's column shape, with every refusal that depends on it made.
   *
   * Runs BEFORE the read hooks, for the reason the key itself is validated
   * before them: `beforeOperation` and `beforeRead` are ordinary user code that
   * records audit entries and spends rate-limit budget, so a request that was
   * never going to be answered must not charge the caller for work or leave a
   * trail of reads that did not happen.
   */
  private settledGroupDescriptor(
    params: FilteredReadParams,
    groupKey: { key?: string; field?: FieldDefinition }
  ): ColumnDescriptor | undefined {
    const descriptor = this.groupKeyDescriptor(groupKey.field, groupKey.key);
    if (params.requireTimestampGroupKey === true) {
      assertDateColumn(descriptor, params.groupBy ?? "");
    }
    return descriptor;
  }

  private async validatedGroupKey(
    params: FilteredReadParams,
    schema: DynamicSchema
  ): Promise<{ key?: string; field?: FieldDefinition }> {
    const groupBy = params.groupBy;
    if (groupBy === undefined) return {};
    // OWN properties only: `schema` is an ordinary object, so a key like
    // `toString` resolves to a prototype method rather than `undefined`, which
    // read as a column and failed inside the query builder as a 500 where the
    // contract promises a named refusal.
    const key = [groupBy, toSnakeCase(groupBy)].find(name =>
      Object.prototype.hasOwnProperty.call(schema, name)
    );
    const field = assertGroupKeyUsable(
      groupBy,
      key === undefined ? undefined : schema[key],
      addressedFieldsFor(
        await this.collectionService.getCollection(params.collectionName)
      )
    );
    return { key, field };
  }

  /**
   * The locale chain this read resolves against, and the companion table its
   * localized values live in.
   *
   * Loaded together because the companion is only worth reading when there IS
   * a chain — or when the caller asked for every locale — and the two are read
   * as one pair by everything downstream. Mirrors `listEntries` so a
   * locale-scoped search or filter describes the SAME rows the page returns.
   */
  private async localeScope(params: FilteredReadParams): Promise<{
    localeChain: ReturnType<CollectionQueryService["resolveLocaleChain"]>;
    companion: Awaited<
      ReturnType<CollectionFileManager["loadCompanionSchema"]>
    > | null;
  }> {
    const localeChain = this.resolveLocaleChain(
      params.locale,
      params.fallbackLocale
    );
    const companion =
      localeChain || params.locale === EVERY_TRANSLATION
        ? await this.fileManager.loadCompanionSchema(params.collectionName)
        : null;
    return { localeChain, companion };
  }

  private async resolveReadPlan<TData>(params: FilteredReadParams) {
    const accessUser = params.overrideAccess ? undefined : params.user;

    // 1. Check collection-level access FIRST, through the same member the
    // listing and the read by id go through. An aggregate asking this question
    // for itself is a second implementation of it: the id, scope and
    // route-attestation arguments would then have to be kept in step by hand,
    // and a count that authorized differently from the list it summarises is
    // exactly the disagreement this service is being shaped to make
    // impossible. No entry id, because an aggregate names no single row.
    const accessDenied = await this.denyCollectionRead<TData>({
      collectionName: params.collectionName,
      accessUser,
      overrideAccess: params.overrideAccess,
      routeAuthorized: params.routeAuthorized,
      // Same scope judgement as listEntries, so a read cannot describe rows
      // the key itself is not allowed to list.
      authenticatedScope: params.authenticatedScope,
    });
    if (accessDenied) {
      return { allowed: false as const, denied: accessDenied };
    }

    // A count is a cleaner oracle than a listing, not a lesser one: "how many
    // rows carry this value" answers 1 or 0 without returning a row at all.
    // A bucket set is the same oracle with more places to read it.
    this.assertQueryReadable(params);

    const schema = await this.fileManager.loadDynamicSchema(
      params.collectionName
    );

    // BEFORE the hooks. A refused group key is refused whatever the hooks
    // settle on, and `beforeOperation`/`beforeRead` are ordinary user code:
    // they record audit entries and spend rate-limit budget. Running them for
    // a request that was never going to be answered charges the caller for
    // work and leaves a trail of reads that did not happen. Authorization
    // stays first, because whether the collection is readable at all outranks
    // what was asked of it.
    // Resolved HERE, where the schema's own column type is in scope, and
    // carried on the plan. Re-resolving it at the point of use was a second
    // lookup that had to agree with this one, which is the seam this whole
    // module exists to remove.
    const groupKey =
      params.groupBy === undefined
        ? {}
        : await this.validatedGroupKey(params, schema);
    const groupColumn =
      groupKey.key === undefined ? undefined : schema[groupKey.key];
    // The column's SHAPE, from the module that already owns the field-to-column
    // mapping for every dialect. Resolved here beside the column so a bucket is
    // rendered from the author's declaration -- a decimal's scale, which the
    // adapters otherwise disagree about -- rather than from whatever the driver
    // happened to hand back.
    assertTimelinePreconditions(params);

    const groupDescriptor = this.settledGroupDescriptor(params, groupKey);

    const countWhere = await this.hookSettledWhere(params);

    this.refuseGeoInAggregate(params.collectionName, countWhere);

    const { localeChain, companion } = await this.localeScope(params);

    // The predicate, from the one method that builds it. An aggregate that
    // assembled its own filters beside `listEntries` would answer a question
    // no read can check, and the two would drift the first time a condition
    // was added to one of them. A count and a bucket set enter here as the
    // same read the page runs, minus the rows.
    const { conditions: whereConditions } = await this.resolveReadConditions({
      collectionName: params.collectionName,
      // The enclosing read's instant when this is its continuation, and this
      // read's own clock when it was called directly, so a release becoming
      // due mid-request cannot put pre-release rows beside a post-release
      // total.
      releaseNow: params.releaseNow ?? new Date(),
      where: countWhere,
      search: params.search,
      status: params.status,
      overrideAccess: params.overrideAccess,
      // The same field trust the page resolved under, so the search narrows
      // this aggregate by the fields it narrowed the rows by.
      enforceFieldAccess: params.enforceFieldAccess,
      accessUser,
      authenticatedScope: params.authenticatedScope,
      schema,
      companion,
      localeChain,
      // An aggregate has no rows to evaluate a geo predicate over, and
      // `refuseGeoInAggregate` above refused one rather than answering over
      // the candidates it was meant to exclude.
      extractGeo: false,
      // Stripped from the `where` `listEntries` forwards, so it is passed
      // separately or the aggregate would find nothing and over-count.
      translationFilter: params.translationFilter,
      // Resolved once for this request by the caller; see the parameters.
      resolvedComponentTables: params.resolvedComponentTables,
      resolvedComponentTypeColumns: params.resolvedComponentTypeColumns,
    });

    return {
      allowed: true as const,
      schema,
      whereConditions,
      groupColumn,
      groupDescriptor,
    };
  }

  async countEntries(
    params: FilteredReadParams
  ): Promise<CollectionServiceResult<{ totalDocs: number }>> {
    try {
      const plan = await this.resolveReadPlan<{ totalDocs: number }>(params);
      if (!plan.allowed) return plan.denied;
      const { schema, whereConditions } = plan;

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
   * How many rows carry each distinct value of one field, over exactly the
   * rows a `countEntries` with the same request would have counted.
   *
   * Shares `resolveReadPlan` with the count rather than assembling its own
   * filters. An aggregate that built its own could describe a wider row set
   * than a count of the same query, which is the shape of the aggregate
   * permission failures reported against other systems: a rule narrowed the
   * rows and the aggregate counted past it.
   *
   * Ranking and the cap both happen IN THE DATABASE, after grouping is
   * complete, so the cap decides only which finished buckets travel back and
   * never which rows were aggregated. A cap applied to the SCAN instead --
   * reading part of the table and grouping whatever it saw -- can reorder the
   * buckets themselves, making the largest one whichever the read order
   * reached first. That answer is indistinguishable from the true one and
   * wrong in the direction a reader acts on.
   *
   * One row past the cap is fetched so "there are more" is observed rather
   * than assumed, then dropped before answering.
   */
  async groupEntries(
    params: FilteredReadParams & { groupBy: string; bucketLimit?: number }
  ): Promise<CollectionServiceResult<GroupedRows>> {
    try {
      const plan = await this.resolveReadPlan<GroupedRows>(params);
      if (!plan.allowed) return plan.denied;
      const { schema, whereConditions } = plan;

      // OWN properties only. `schema` is an ordinary object, so a key like
      // `toString` resolves to a prototype method rather than `undefined`,
      // which read as a column and reached the query builder -- answering a
      // 500 where the contract promises a named `FIELD_NOT_GROUPABLE`.
      // Resolved and approved by the plan, before the read hooks ran. Read
      // from there rather than looked up again: two lookups that must agree is
      // exactly the seam this service keeps removing.
      const column = plan.groupColumn;

      // `Number.isFinite` first, because `Math.trunc`, `Math.max` and
      // `Math.min` all PRESERVE `NaN`: a computed bucket limit that arrived as
      // one would reach the query builder as `.limit(NaN)` and fail the read
      // rather than fall back to the documented bound.
      const requestedCap = params.bucketLimit;
      const cap = Number.isFinite(requestedCap)
        ? Math.min(
            Math.max(1, Math.trunc(requestedCap as number)),
            MAX_GROUP_BUCKETS
          )
        : MAX_GROUP_BUCKETS;

      let query = this.db
        .select({ value: column, total: sql<number>`count(*)` })
        .from(schema);

      if (whereConditions.length > 0) {
        query = query.where(
          whereConditions.length === 1
            ? whereConditions[0]
            : and(...whereConditions)
        );
      }

      const rows = await query
        .groupBy(column)
        // The value breaks ties, so two buckets of equal size come back in a
        // fixed order and the cap cannot drop a different one per request.
        //
        // NULL is placed explicitly, before the value is compared. Left to the
        // dialect, `ORDER BY <col>` puts NULL last on PostgreSQL and first on
        // MySQL and SQLite -- so with a cap and enough equally sized buckets,
        // the adapters return DIFFERENT BUCKET SETS rather than the same set
        // in a different order: one drops the null bucket, the others keep it.
        // `IS NULL` sorts false before true everywhere, which puts the null
        // bucket last on all three.
        .orderBy(desc(sql`count(*)`), sql`${column} IS NULL`, asc(column))
        .limit(cap + 1);

      return {
        success: true,
        statusCode: 200,
        message: "Buckets retrieved successfully",
        data: {
          buckets: toBuckets(rows.slice(0, cap), plan.groupDescriptor),
          truncated: rows.length > cap,
        },
      };
    } catch (error: unknown) {
      const message =
        error instanceof Error ? error.message : "Failed to group entries";
      this.logger.error("Error grouping entries", {
        collectionName: params.collectionName,
        error: message,
      });
      return {
        success: false,
        // Mirrors countEntries: a refused access constraint is a 403 and a
        // refused group key a 400, not a server fault.
        statusCode: NextlyError.is(error) ? error.statusCode : 500,
        message,
        data: null,
        ...errorEnvelopeFields(error),
      };
    }
  }

  /**
   * How many rows fall in each interval of a recent window.
   *
   * A timeseries is a grouped read whose key is a bucketing EXPRESSION over a
   * date column rather than the column itself, so it reaches its rows through
   * the same `resolveReadPlan` a count and a bucket set do. Assembling its own
   * filters would let it describe a wider row set than a count of the same
   * request -- the shape of the aggregate permission failures reported against
   * other systems, where a rule narrowed the rows and the aggregate counted
   * past it.
   *
   * The window bounds the READ, not the answer. Its oldest interval start
   * becomes a lower bound on the date column itself, which an index can serve;
   * comparing the bucketing expression instead would be correct and would scan
   * the table, because no index covers a computed value.
   *
   * Intervals with no rows are returned with a count of zero rather than
   * omitted. A `GROUP BY` cannot report a bucket it never grouped, so a quiet
   * day is simply absent -- and a line drawn through the gap reads as steady
   * activity rather than none, which is wrong in the direction a reader acts on.
   */
  async timeseriesEntries(
    params: FilteredReadParams & {
      dateField: string;
      interval: TimeseriesInterval;
      intervals?: number;
      /**
       * The instant the window ends at, defaulting to now.
       *
       * Taken from the caller for the reason `releaseNow` is: a window and the
       * rows it describes have to be settled against ONE clock. Two reads of
       * the system clock either side of a fixture write can straddle midnight,
       * which moves every point one interval and is a real intermittent
       * failure rather than a hypothetical one.
       *
       * It is also the honest way to ask for a window that is not "now" -- a
       * report as of a period end, rather than as of whenever it happened to
       * run.
       */
      now?: Date;
    }
  ): Promise<CollectionServiceResult<TimeseriesPoints>> {
    try {
      const count = boundedIntervalCount(params.intervals);

      // ONE clock for the whole read. `releaseScope` takes its own `new Date()`
      // while the plan resolves, and the window used to take a second one
      // afterwards -- so a scheduled release or a bucket boundary passing
      // between them left the labels describing a later window than the row
      // filter admitted.
      //
      // The two are read from the same instant rather than from the same
      // VALUE. Release visibility asks what has actually been published by now,
      // which is not something a caller may choose; the anchor is the end of
      // the window it asked to report on, which is. They coincide -- closing
      // the straddle -- for every caller that states no anchor of its own.
      const requestNow = new Date();
      const anchor = params.now ?? requestNow;

      // The date key travels as `groupBy`, so every refusal a grouped read
      // already makes applies unchanged: a field carrying a read rule, any
      // spelling of it, the owner column, a key naming no column.
      //
      // The interval is judged INSIDE the plan, after collection
      // authorization: refused here, an untrusted caller naming a bad interval
      // would get a detailed validation response for a collection the same
      // request with a good interval answers with an access refusal -- which
      // tells them the collection exists.
      const plan = await this.resolveReadPlan<TimeseriesPoints>(
        timelineReadPlanRequest(params, anchor, requestNow)
      );
      if (!plan.allowed) return plan.denied;
      const { schema, whereConditions } = plan;
      const column = plan.groupColumn;

      const interval = assertBucketableInterval(params.interval);
      const window = intervalWindow(anchor, interval, count);
      const dialect = this.groupDialect();
      const bucket = timeseriesBucketExpression(column, interval, dialect);

      // Built here, where the column keeps the type the schema gave it, so the
      // comparison needs no cast the compiler cannot check.
      const scope = windowScope(window, interval, dialect);
      // `undefined` means the window does not overlap what the column can
      // store, so no row can fall in it and there is nothing to ask.
      if (scope === undefined) return this.emptyTimeseries(window, interval);
      const bounds = [
        ...(scope.from === undefined ? [] : [gte(column, scope.from)]),
        ...(scope.to === undefined ? [] : [lt(column, scope.to)]),
      ];

      const rows = await this.db
        .select({ bucket, total: sql<number>`count(*)` })
        .from(schema)
        // BOTH ends of the window bound the SCAN, as comparisons on the COLUMN
        // rather than on the bucketing expression, so an index over the date can
        // serve them; no index covers a computed value.
        //
        // The upper bound is not symmetry. A date field holds future values --
        // a scheduled publication, an event date -- and bounded only below, the
        // database groups every one of them into buckets the answer then throws
        // away, so the documented interval cap would bound the answer while the
        // read walked the rest of the table.
        //
        // Neither bound can change the answer: the points are built from the
        // window, and a bucket outside it is never looked up.
        // A bound the dialect cannot represent is OMITTED rather than
        // rendered. On MySQL an out-of-range operand becomes NULL, and
        // `column >= NULL` matches nothing -- so a predicate meant to bound the
        // scan would empty the answer instead. Omitting it is sound: the column
        // cannot store an instant outside that range, so the bound excludes no
        // row that could exist.
        .where(and(...whereConditions, ...bounds))
        // The SAME expression in the SELECT and the GROUP BY. MySQL's
        // `only_full_group_by` refuses a `GROUP BY` that differs from the
        // selected expression, so these cannot be spelled apart.
        //
        // No ORDER BY: the answer is assembled from the window in chronological
        // order and each interval's count is looked up by key, so the order
        // rows arrive in cannot reach the result.
        .groupBy(bucket);

      const counted = countedByBucket(rows);

      return this.timeseriesAnswer(window, interval, counted);
    } catch (error: unknown) {
      const message =
        error instanceof Error ? error.message : "Failed to build timeseries";
      this.logger.error("Error building timeseries", {
        collectionName: params.collectionName,
        error: message,
      });
      return {
        success: false,
        // Mirrors groupEntries: a refused access constraint is a 403 and a
        // refused date key a 400, not a server fault.
        statusCode: NextlyError.is(error) ? error.statusCode : 500,
        message,
        data: null,
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
    /** The HTTP request behind this operation, when one produced it. */
    request?: Request;
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
      const accessDenied = await this.denyCollectionRead({
        collectionName: params.collectionName,
        accessUser,
        entryId: params.entryId,
        overrideAccess: params.overrideAccess,
        routeAuthorized: params.routeAuthorized,
        authenticatedScope: params.authenticatedScope,
      });
      if (accessDenied) {
        return accessDenied;
      }

      const schema = await this.fileManager.loadDynamicSchema(
        params.collectionName
      );

      // Shared context between all hooks in this request
      const sharedContext: Record<string, unknown> = { ...params.context };
      // Resolved once for the whole read, so every hook phase is told the same
      // thing about the caller and none of them re-reads a header.
      const requestFacts = resolveRequestFacts(params.request);

      // `beforeOperation` runs first and may rewrite the id, then `beforeRead`
      // sees the id it settled on.
      const entryId = await this.resolveReadEntryId({
        collectionName: params.collectionName,
        entryId: params.entryId,
        user: params.user,
        sharedContext,
        requestFacts,
      });

      // Fold the stored read rule's predicate into the SQL WHERE clause. A
      // caller the rule excludes gets a 404 (same response shape as a
      // non-existent ID), not a 403, so IDOR-by-iteration leaks nothing about
      // which IDs exist.
      //
      // The same question `listEntries` and `countEntries` ask, through the
      // same method. This path used to ask `getOwnerConstraint` instead, which
      // answers only `owner-only` and returns a flat `{field, value}` pair: the
      // two agree for an owner-only rule and nowhere else, so a `custom` rule
      // returning a query constraint narrowed every listing and left a read by
      // id unfiltered — the row was withheld from the list and reachable by
      // guessing its id.
      //
      // The Draft/Published filter comes back with it, and the same
      // 404-not-403 reasoning covers it: a public caller asking for a draft
      // entry by id gets a 404, never a hint that it exists.
      const {
        accessConstraint,
        statusFilter,
        collection: collectionForStatus,
      } = await this.resolveRowScope({
        collectionName: params.collectionName,
        accessUser,
        overrideAccess: params.overrideAccess,
        authenticatedScope: params.authenticatedScope,
        status: params.status,
        // The SETTLED id — the row this read will actually return, which is
        // the subject a predicate has to be about. A custom rule may decide
        // from it, so resolving without it asks that rule about no document at
        // all and a rule allowing exactly one row denies every read of it.
        //
        // NOT the id the coarse gate above was given. That one ran before
        // `resolveReadEntryId`, so it judged the id as REQUESTED, and a
        // `beforeOperation` hook may have rewritten it since. The order is
        // deliberate and stays: that resolution runs `beforeOperation` and
        // `beforeRead`, which are ordinary user code that records audit entries
        // and spends rate-limit budget, and running them for a request
        // authorization was going to refuse charges the caller for work and
        // leaves a trail of reads that did not happen.
        //
        // The two subjects therefore differ exactly when a hook rewrites the
        // id, and both must pass: the requested id at the gate, the settled one
        // here, where `getAccessQueryConstraint` RAISES a denial rather than
        // returning an absent predicate. That is the fail-closed direction —
        // a rewrite can narrow what a caller reaches and never widen it.
        entryId,
      });

      const idCondition = eq(schema.id, entryId);
      // The languages this read resolves through, and the companion those
      // values live in. Resolved HERE, above the predicate, rather than beside
      // the overlay further down: a stored rule may name a LOCALIZED field,
      // whose column exists only on the companion, and the shared translator
      // recognises such a field only when it is given this context. Without it
      // the by-id path refuses a constraint the listing binds — the same rule
      // answering 403 here and returning rows there, which is the divergence
      // this service exists to not have.
      //
      // BOTH are reused below — the chain by the overlays and the relationship
      // expansion, the companion by the three overlays that would otherwise
      // load it again. `loadCompanionSchema` fetches metadata BEFORE it
      // consults its cache, so each of those is a query rather than a lookup,
      // and resolving here without passing it on would have added them to
      // every localized read by id.
      const { localeChain, companion } = await this.localeScope(params);
      // Translated through the shared builder, so a multi-member or
      // non-`equals` predicate binds here exactly as it binds a listing, and a
      // localized member becomes the same companion EXISTS.
      const accessCondition =
        this.accessConstraintCondition(
          params.collectionName,
          accessConstraint,
          schema,
          this.buildLocalizedQueryContext(
            companion,
            localeChain,
            schema,
            statusFilter?.values
          )
        ) ?? null;
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
        accessCondition,
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

      // `localeChain` and `companion` were resolved above the access predicate,
      // which needs the same pair to judge a rule naming a localized field.
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
            [entry as Record<string, unknown>],
            params.locale,
            companion,
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
              companion,
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
        this.buildDetailExpansionOptions(params, localeChain)
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
            // The same bounds the live row above was expanded under: the draft
            // is the document the post-assembly pass runs over, so it defers
            // field rules and carries the caller's trust exactly as the live
            // read does.
            const expandOptions = this.buildDetailExpansionOptions(
              params,
              localeChain
            );
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

      // The read-response pipeline, over a batch of one. Same order, same
      // passes, same shared walk state as the listing above.
      const [finalData] = await this.finalizeReadRows({
        rows: [expandedEntry],
        // afterRead handlers on a read by id receive the document itself.
        single: true,
        collectionName: params.collectionName,
        fields,
        storedHooks,
        sharedContext,
        // The same facts the beforeRead phases were given, so a hook cannot
        // learn one thing about the request on the way in and another on
        // the way out.
        requestFacts,
        user: params.user,
        fieldAccessUser: params.fieldAccessUser,
        overrideAccess: params.overrideAccess,
        enforceFieldAccess: params.enforceFieldAccess,
        trusted: params.trusted,
        authenticatedScope: params.authenticatedScope,
        select: params.select,
        richTextFormat: params.richTextFormat,
        locale: params.locale,
      });

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
    // Either spelling for the single-mode fallback, on the same rule the
    // write and the diff resolve references by.
    const declared = extractFieldGroupReferences(field).single;
    const slug = typeof tagged === "string" ? tagged : declared;
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
