/**
 * The parts no step has moved yet that stand in a review stage: where a collection's workflow
 * starts in a review stage, a part of a document that has no review state and is not live waits
 * there for whoever may approve it, from the moment its document was created. The waiting list
 * reads them beside its review states, in one order (`waiting-cursor`).
 *
 * Whether a part is unmoved is the condition the list's stage filter keeps it by
 * (`unmovedPartCondition`), so the two never disagree. They are read a collection at a time, each
 * in its own table's order: the millisecond its document was created in, then the document's id as
 * the database orders it, then the part (the shared part, then each language as the site lists
 * them). A read goes on from a position by comparing in the database alone, so a page never
 * repeats or skips a part, even where many documents share one second.
 *
 * @module domains/workflows/unmoved-parts
 * @experimental
 */
import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import type { SupportedDialect } from "@nextlyhq/adapter-drizzle/types";
import { sql, type SQL } from "drizzle-orm";

import { appLocalization } from "../i18n/configured-locales";
import {
  systemColumnDriverValue,
  systemColumnFromDriverValue,
} from "../schema/services/runtime-schema-generator";
import { partLivenessInputs } from "../versions/part-liveness";

import { entityOf } from "./implicit-stage";
import { unmovedPartCondition } from "./stage-condition";
import type { WaitingPosition } from "./waiting-cursor";

/**
 * A part no step has moved yet, in its workflow's first stage.
 *
 * @experimental
 */
export interface UnmovedPart {
  scopeSlug: string;
  entryId: string;
  part: string | null;
  stage: string;
  /** The millisecond its document was created in: it has stood in the first stage since. */
  createdAt: Date;
  /** Its place among the parts one read returned, in the read's order. */
  seq: number;
}

/**
 * A collection whose workflow starts in a review stage, and that stage.
 *
 * @experimental
 */
export interface UnmovedScope {
  slug: string;
  stage: string;
}

/**
 * Whether `dialect` keeps a document's creation in whole seconds (SQLite's integer timestamp,
 * MySQL's `timestamp`); PostgreSQL keeps microseconds.
 */
function keepsWholeSeconds(dialect: SupportedDialect): boolean {
  return dialect !== "postgresql";
}

/**
 * The millisecond a creation time falls in, as the database orders it: the time itself where it is
 * kept in whole seconds, truncated to the millisecond on PostgreSQL. Reading, ordering and every
 * bound compare by it, so the database's order and a position's agree.
 */
function createdBucket(dialect: SupportedDialect, column: SQL): SQL {
  return keepsWholeSeconds(dialect)
    ? column
    : sql`date_trunc('milliseconds', ${column})`;
}

/** Created in millisecond `ms` or later: the bound rounded up to what the column can hold. */
function createdAtOrAfter(
  dialect: SupportedDialect,
  column: SQL,
  ms: number
): SQL {
  const bound = keepsWholeSeconds(dialect) ? Math.ceil(ms / 1000) * 1000 : ms;
  // Encoded as the collection's own `created_at` column encodes it, so the comparison means the
  // same on every dialect, whatever the server's time zone.
  return sql`${column} >= ${systemColumnDriverValue(dialect, "created_at", new Date(bound))}`;
}

/**
 * The documents of collection `slug` past `after` in the waiting list's order, as a condition on
 * the read, and the one document whose parts may be partly behind it (read, then trimmed).
 * Review states come before unmoved parts of their moment, and collections by their slug.
 */
function pastCondition(
  dialect: SupportedDialect,
  slug: string,
  columns: { createdAt: SQL; id: SQL },
  after: WaitingPosition | undefined
): { where: SQL | undefined; boundary: string | undefined } {
  if (after === undefined) return { where: undefined, boundary: undefined };
  const at = after.enteredAt.getTime();
  const from = (ms: number) => createdAtOrAfter(dialect, columns.createdAt, ms);
  if (after.source === "state" || slug > after.scopeSlug) {
    return { where: from(at), boundary: undefined };
  }
  if (slug < after.scopeSlug) {
    return { where: from(at + 1), boundary: undefined };
  }
  // The position's own collection: a later millisecond, or its millisecond from its document on.
  return {
    where: sql`(${from(at + 1)} OR (${from(at)} AND NOT ${from(at + 1)} AND ${columns.id} >= ${after.entryId}))`,
    boundary: after.entryId,
  };
}

/**
 * A document's creation time as a statement returned it: decoded as its `created_at` column decodes
 * it, and where the driver hands that column a timestamp's text (as it does a statement's, on
 * PostgreSQL and MySQL), read as the UTC wall time the column stores. Undefined for anything else.
 */
function createdAtOf(
  dialect: SupportedDialect,
  driverValue: unknown
): Date | undefined {
  const decoded = systemColumnFromDriverValue(
    dialect,
    "created_at",
    driverValue
  );
  const at =
    typeof decoded === "string"
      ? new Date(
          /[zZ]|[+-]\d\d:?\d\d$/.test(decoded)
            ? decoded.replace(" ", "T")
            : `${decoded.replace(" ", "T")}Z`
        )
      : decoded;
  return at instanceof Date && !Number.isNaN(at.getTime()) ? at : undefined;
}

/** The parts of a document, in the order the list reads them: the shared part, then each language. */
function partsOf(localized: boolean, locales: readonly string[]) {
  return [null, ...(localized ? locales : [])] as (string | null)[];
}

/** The unmoved parts of one collection past `after`, at most `limit`, in its order. */
async function readScope(
  adapter: DrizzleAdapter,
  scope: UnmovedScope,
  limit: number,
  after: WaitingPosition | undefined
): Promise<Omit<UnmovedPart, "seq">[]> {
  const entity = await entityOf({
    scopeKind: "collection",
    scopeSlug: scope.slug,
  });
  // A collection gone from the registry holds nothing; one without the draft/published lifecycle
  // has every part live, so none stands unmoved.
  if (!entity || entity.status !== true) return [];
  const dialect = adapter.dialect;
  const localization = appLocalization();
  const locales = (localization?.locales ?? []).map(locale => locale.code);
  const parts = partsOf(entity.localized === true, locales);
  const main = sql.identifier(entity.tableName);
  const columns = {
    id: sql`${main}.${sql.identifier("id")}`,
    createdAt: sql`${main}.${sql.identifier("created_at")}`,
    status: sql`${main}.${sql.identifier("status")}`,
  };
  const liveness = await partLivenessInputs({
    adapter,
    scopeKind: "collection",
    entity,
    withLanguages: entity.localized === true,
  });
  const unmoved = parts.map(part =>
    unmovedPartCondition({
      dialect,
      collectionName: scope.slug,
      entryId: columns.id,
      status: columns.status,
      defaultLocale: localization?.defaultLocale ?? null,
      liveness,
      part,
    })
  );
  const past = pastCondition(dialect, scope.slug, columns, after);
  const where = sql.join(
    [
      sql`(${sql.join(unmoved, sql` OR `)})`,
      ...(past.where ? [past.where] : []),
    ],
    sql` AND `
  );
  const bucket = createdBucket(dialect, columns.createdAt);
  // One document more than the parts asked for: the position's own document may have every part
  // behind it, and each other document holds at least one.
  const rows = await adapter.queryStatement<Record<string, unknown>>(
    sql`SELECT ${columns.id} AS ${sql.identifier("id")}, ${bucket} AS ${sql.identifier("created_at")}, ${sql.join(
      unmoved.map(
        (condition, index) =>
          sql`CASE WHEN ${condition} THEN 1 ELSE 0 END AS ${sql.identifier(`unmoved_${index}`)}`
      ),
      sql`, `
    )} FROM ${main} WHERE ${where} ORDER BY ${bucket} ASC, ${columns.id} ASC LIMIT ${limit + 1}`
  );
  const behind =
    after?.source === "unmoved" ? parts.indexOf(after.part) : undefined;
  const found: Omit<UnmovedPart, "seq">[] = [];
  for (const row of rows) {
    const entryId = String(row.id);
    const createdAt = createdAtOf(dialect, row.created_at);
    if (createdAt === undefined) continue;
    for (const [index, part] of parts.entries()) {
      if (Number(row[`unmoved_${index}`]) !== 1) continue;
      // The position's document: only its parts after the position's part.
      if (
        entryId === past.boundary &&
        behind !== undefined &&
        index <= behind
      ) {
        continue;
      }
      found.push({
        scopeSlug: scope.slug,
        entryId,
        part,
        stage: scope.stage,
        createdAt,
      });
    }
  }
  return found.slice(0, limit);
}

/**
 * The unmoved parts in `scopes` past `after`, at most `limit`, in the waiting list's order: by the
 * millisecond their document was created in, then collection, then each collection's own order.
 * Bounded: each collection is read for at most `limit` parts.
 *
 * @experimental
 */
export async function readUnmovedParts(
  adapter: DrizzleAdapter,
  scopes: readonly UnmovedScope[],
  limit: number,
  after: WaitingPosition | undefined
): Promise<UnmovedPart[]> {
  const merged: Omit<UnmovedPart, "seq">[] = [];
  // Each collection's parts are in its own order already; a stable sort by time and collection
  // keeps that order within one collection's millisecond.
  for (const scope of [...scopes].sort((a, b) => compare(a.slug, b.slug))) {
    merged.push(...(await readScope(adapter, scope, limit, after)));
  }
  return merged
    .map((part, index) => ({ part, index }))
    .sort(
      (a, b) =>
        a.part.createdAt.getTime() - b.part.createdAt.getTime() ||
        compare(a.part.scopeSlug, b.part.scopeSlug) ||
        a.index - b.index
    )
    .slice(0, limit)
    .map(({ part }, seq) => ({ ...part, seq }));
}

/** Code-unit order, the order a position compares collection slugs in. */
function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * Where an unmoved part stands in the waiting list's order.
 *
 * @experimental
 */
export function unmovedPosition(part: UnmovedPart): WaitingPosition {
  return {
    source: "unmoved",
    enteredAt: part.createdAt,
    scopeSlug: part.scopeSlug,
    entryId: part.entryId,
    part: part.part,
  };
}
