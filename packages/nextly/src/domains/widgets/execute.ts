/**
 * Compile a validated widget query to a Direct API call and run it.
 *
 * Every read is `overrideAccess: false` plus the requesting user, which is the
 * same path a REST read takes. There is deliberately NO second enforcement
 * implementation -- keeping two in step is what fails, and it is what failed
 * for Strapi's homepage widgets (strapi#22921), where the widget's permission
 * gated the card while its query returned rows the viewer could not see.
 *
 * The caller arrives as the CANONICAL `ReadCaller` (`readCaller()`'s declared
 * return type), imported rather than re-declared. A local copy of that shape is
 * structurally assignable from the real one whether or not the two still agree,
 * because the property that carries an API key's own grant is OPTIONAL: rename
 * it upstream and the copy still compiles, `caller.authenticatedScope` reads
 * `undefined`, the `actor` spread below stops firing, and every widget read by a
 * narrowly scoped key is judged by the roles of whoever minted it instead.
 * Importing the declaration is what makes that rename a compile error here.
 *
 * @module domains/widgets/execute
 */

import { requireNextly } from "../../direct-api/nextly";
import type { FindArgs } from "../../direct-api/types/collections";
import { NextlyError } from "../../errors/nextly-error";
import type { ReadCaller } from "../../services/dashboard/readable-resources";
import type { WhereFilter } from "../collections/query/query-operators";

import { resolveExecutableSource } from "./executable-source";
import type { WidgetQuery } from "./query";
import type { WidgetResult, WidgetResultField } from "./result";
import {
  failUnavailableSourceOrOp,
  refuseUnconsumedQueryFields,
  sourceTarget,
  type WidgetSource,
} from "./sources";

export type { WidgetResult, WidgetResultField };

/** `["title","status"]` -> `{ title: true, status: true }`. */
function toSelect(
  fields: string[] | undefined
): Record<string, boolean> | undefined {
  if (!fields || fields.length === 0) return undefined;
  return Object.fromEntries(fields.map(field => [field, true]));
}

/**
 * The arguments every op shares: the caller WHOLE (never reduced to an id),
 * the caller's `where`, and the optional draft/published scope.
 *
 * There is deliberately NO `frameworkFilter` here. That flag short-circuits
 * both `assertFilterableFields` and `assertSortableField`
 * (`shared/lib/filterable-fields.ts`), the guards that refuse a filter or an
 * ORDER BY naming a field the caller may not read. It is for a `where` the
 * FRAMEWORK built -- a route resolving a page by its slug -- which addresses a
 * row rather than choosing probe values.
 *
 * A widget query is not that. It arrives VERBATIM from the request body of
 * `POST /api/dashboard/query` (`api/widget-query.ts`), so it is caller input,
 * not stored configuration: there is no widget lookup, no comparison against a
 * registered definition, and nothing gating who may author one. Exempting it
 * would hand any authenticated caller the exact oracle those guards exist to
 * close -- `count` with `{ id: { equals: X }, salary: { greater_than: N } }`
 * answers 1 or 0, and ~20 of those bisect a figure the caller may never read,
 * while `sort: "-salary"` leaks the same value by ordering. Nor can
 * `validateWidgetQuery` carry the exemption on its behalf: `built-in-sources.ts`
 * declares every field of every collection except type `password`, so its
 * allow-list includes precisely the read-ruled fields the guards protect.
 *
 * Without the flag a widget `where` naming a read-ruled field gets the same
 * named refusal (`FIELD_NOT_FILTERABLE`) every other caller gets, which is the
 * correct answer. If a genuinely trusted, stored-and-verified widget definition
 * ever exists, the exemption belongs at THAT seam, judged there.
 *
 * NOTE the field name: the Direct API calls it `actor`, not
 * `authenticatedScope` (that is the internal name one layer down). Verified
 * at direct-api/types/shared.ts:507. The conditional spread is `satisfies`-pinned
 * on the object literal, not on a return type, because TypeScript does not
 * excess-property-check through a spread -- an annotated return type would let
 * a renamed key compile and silently vanish.
 */
function sharedReadArgs(query: WidgetQuery, caller: ReadCaller) {
  return {
    // `validateWidgetQuery` has already walked this clause -- every operator
    // and field name in it is one the query layer accepts -- so this is
    // asserting an invariant already established at validation, not
    // bypassing a check. `WidgetQuery.where` is typed as a plain record
    // because the widget domain does not depend on the Direct API's
    // operator vocabulary; only at this seam does it need the stricter shape.
    where: query.where as WhereFilter | undefined,
    overrideAccess: false as const,
    user: caller.user,
    ...(caller.authenticatedScope
      ? ({ actor: caller.authenticatedScope } satisfies Pick<
          FindArgs<string>,
          "actor"
        >)
      : {}),
    ...(query.status ? { status: query.status } : {}),
  };
}

async function runCount(
  collection: string,
  query: WidgetQuery,
  caller: ReadCaller
): Promise<WidgetResult> {
  const result = await requireNextly().count({
    collection,
    ...sharedReadArgs(query, caller),
  });
  return { op: "count", total: result.total };
}

/**
 * How many rows carry each distinct value of the query's group key.
 *
 * Reaches the row set through the same `sharedReadArgs` a count does, and the
 * domain that owns the rows resolves that set once for both. Nothing about
 * access is decided here.
 *
 * `truncated` is forwarded only when true, so a whole answer carries no field
 * at all rather than a `false` a reader has to interpret.
 */
async function runGroupBy(
  collection: string,
  query: WidgetQuery,
  caller: ReadCaller
): Promise<WidgetResult> {
  // `validateWidgetQuery` refuses a `groupBy` op without a key, so by the time
  // a query reaches execution the key is present. The fallback keeps that
  // assumption from becoming an unchecked cast.
  const groupBy = query.groupBy ?? "";
  const result = await requireNextly().group({
    collection,
    groupBy,
    // The query's own limit bounds the BUCKETS, which is what a limit means for
    // a grouped read: `validateWidgetQuery` clamps it and defaults it, so
    // ignoring it here let a card asking for two categories receive fifty.
    bucketLimit: query.limit,
    ...sharedReadArgs(query, caller),
  });
  return {
    op: "groupBy",
    buckets: result.buckets,
    ...(result.truncated ? { truncated: true } : {}),
  };
}

/**
 * How many rows fall in each interval of a recent window.
 *
 * Reaches the row set through the same `sharedReadArgs` a count does, and the
 * domain that owns the rows resolves that set once for all of them. Nothing
 * about access is decided here.
 */
async function runTimeseries(
  collection: string,
  query: WidgetQuery,
  caller: ReadCaller
): Promise<WidgetResult> {
  // `validateWidgetQuery` refuses a `timeseries` op carrying neither key, so by
  // the time a query reaches execution both are present. The fallbacks keep
  // that assumption from becoming an unchecked cast.
  const dateField = query.dateField ?? "";
  const interval = query.interval ?? "day";
  const result = await requireNextly().timeseries({
    collection,
    dateField,
    interval,
    // The query's own limit bounds the WINDOW, which is what a limit means for
    // a timeline: how many intervals come back. `validateWidgetQuery` clamps
    // and defaults it, so ignoring it here would let a card asking for a week
    // receive a month.
    intervals: query.limit,
    ...sharedReadArgs(query, caller),
  });
  return { op: "timeseries", points: result.points, interval: result.interval };
}

/**
 * The columns a caller may actually see, paired with the source's label.
 *
 * Derived from the ROWS that came back, not from the source declaration alone,
 * and that is an access-control decision rather than a tidiness one. A field
 * can carry its own `access.read` rule, and `applyFieldReadAccess` strips a
 * denied field from every row before selection runs -- so describing the
 * declared selection would have advertised a column no row can fill AND
 * disclosed the human label of a field this caller may not read. What survived
 * the read is the only honest answer to "what are the columns".
 *
 * Order comes from `select`, because that is the order the widget asked for and
 * a column order the admin should not have to invent. Duplicates are collapsed
 * first: `select: ["title", "title"]` is a legal query whose Direct API
 * projection is a single `{ title: true }`, so emitting two descriptors would
 * have a table draw two columns for one value.
 *
 * Nothing is described when nothing came back. With no rows there is no
 * evidence about which fields survived, and answering from the declaration
 * would put the disclosure back on the empty case -- which is exactly the case
 * a caller denied every selected field would see.
 */
function describeSelectedFields(
  query: WidgetQuery,
  source: WidgetSource,
  items: Record<string, unknown>[]
): WidgetResultField[] | undefined {
  if (!query.select || query.select.length === 0) return undefined;
  if (items.length === 0) return undefined;

  const survived = new Set<string>();
  for (const item of items) {
    for (const key of Object.keys(item)) survived.add(key);
  }

  // The whole declared field, not just its label: the renderer needs the TYPE
  // to present a value rather than print it, and looking the label up here
  // while leaving the type behind is what made a date cross as an ISO string.
  const declared = new Map(source.fields.map(field => [field.name, field]));

  const described: WidgetResultField[] = [];
  const taken = new Set<string>();
  for (const name of query.select) {
    if (taken.has(name)) continue;
    taken.add(name);
    if (!survived.has(name)) continue;
    const field = declared.get(name);
    described.push({
      name,
      ...(field?.label !== undefined && { label: field.label }),
      ...(field?.type !== undefined && { type: field.type }),
    });
  }

  return described.length > 0 ? described : undefined;
}

async function runList(
  collection: string,
  query: WidgetQuery,
  caller: ReadCaller,
  source: WidgetSource
): Promise<WidgetResult> {
  const select = toSelect(query.select);
  const result = await requireNextly().find({
    collection,
    limit: query.limit,
    ...(query.sort ? { sort: query.sort } : {}),
    ...(select ? { select } : {}),
    ...sharedReadArgs(query, caller),
  });
  const items = result.items ?? [];
  const fields = describeSelectedFields(query, source, items);
  return {
    op: "list",
    items,
    ...(fields && { fields }),
  };
}

/**
 * What a single source does with each field of a widget query.
 *
 * Exhaustive over `keyof WidgetQuery`, for the reason the versions source's
 * table is: a field added to the query has to be decided for this source or
 * `check-types` fails here. A single answers a fixed question -- its one
 * document -- so nothing that chooses or orders rows applies, and each of
 * those is refused by name rather than accepted and dropped. `limit` is
 * consumed rather than refused because validation supplies one on every
 * query, and a bound of at least one is satisfied by the one row there is.
 */
const SINGLE_QUERY_FIELD_USE: Record<
  keyof WidgetQuery,
  "consumed" | "refused"
> = {
  source: "consumed",
  op: "consumed",
  select: "consumed",
  status: "consumed",
  limit: "consumed",
  where: "refused",
  sort: "refused",
  groupBy: "refused",
  dateField: "refused",
  interval: "refused",
};

/**
 * A single's document, as a list of one row.
 *
 * Read through the same Direct API a REST read takes, with the caller and
 * `overrideAccess: false`, so the single's own access rules -- code-defined
 * ones included -- decide the answer, and a reader the rule refuses gets the
 * refusal rather than a filtered document. A read this path makes is the
 * read the admin's editor makes: a single that has never been written is
 * materialized with its defaults on the way, which is the product's meaning
 * of a single existing.
 *
 * `select` is applied HERE, after the read. The Direct API declares the
 * option and the singles read does not consume it, so the document arrives
 * whole and the projection is this function's; the fields the caller may not
 * read were already withheld by the read itself. A `status` that names no
 * document -- a draft-only single asked for `published` -- is an empty list,
 * not an error: the card says "Nothing yet", which is true.
 */
/**
 * Whether `error` is the singles read saying THIS single answers no document
 * -- the one `NOT_FOUND` that means an empty list rather than a failed card.
 *
 * Read off the `publicData.single` the read attaches to its own refusal, and
 * matched against the slug this query named. A `NOT_FOUND` raised inside the
 * read for something else -- a `beforeRead` hook, a related document -- carries
 * no such claim, or claims another single, and stays the failure it is: the
 * Direct API surfaces it, and a card drawn over it would say "Nothing yet"
 * about a document that exists.
 */
function singleAnswersNoDocument(error: unknown, slug: string): boolean {
  if (!NextlyError.is(error) || error.code !== "NOT_FOUND") return false;
  const about = error.publicData;
  return about !== undefined && "single" in about && about.single === slug;
}

async function runSingle(
  slug: string,
  query: WidgetQuery,
  caller: ReadCaller,
  source: WidgetSource
): Promise<WidgetResult> {
  refuseUnconsumedQueryFields(query, SINGLE_QUERY_FIELD_USE, source.id);
  let document: Record<string, unknown> | undefined;
  try {
    document = await requireNextly().findSingle({
      slug,
      overrideAccess: false as const,
      user: caller.user,
      ...(caller.authenticatedScope
        ? ({ actor: caller.authenticatedScope } satisfies Pick<
            FindArgs<string>,
            "actor"
          >)
        : {}),
      ...(query.status ? { status: query.status } : {}),
    });
  } catch (error) {
    if (!singleAnswersNoDocument(error, slug)) throw error;
    document = undefined;
  }
  const items =
    document === undefined ? [] : [projectedTo(document, query.select)];
  const fields = describeSelectedFields(query, source, items);
  return { op: "list", items, ...(fields && { fields }) };
}

/**
 * The document reduced to the selected names; the whole document for none.
 *
 * 🔴 OWN properties. `name in document` walks the prototype chain, and a
 * single may declare a field the validator permits and `Object.prototype`
 * also answers for -- `toString`, `constructor`. A field the READ removed for
 * this caller then read as present, and the projection answered with the
 * inherited function: a direct caller received it, and `describeSelectedFields`
 * advertised the column from it while HTTP's JSON dropped the value, so the
 * card was told to expect a field it would never be sent.
 */
function projectedTo(
  document: Record<string, unknown>,
  select: readonly string[] | undefined
): Record<string, unknown> {
  if (!select || select.length === 0) return document;
  return Object.fromEntries(
    select
      .filter(name => Object.prototype.hasOwnProperty.call(document, name))
      .map(name => [name, document[name]])
  );
}

export async function executeWidgetQuery(
  query: WidgetQuery,
  caller: ReadCaller
): Promise<WidgetResult> {
  const executable = resolveExecutableSource(query.source);

  // 🔴 Handed to the domain that owns the rows, WITH the caller, and nothing is
  // added on the way. A system source's authorization lives in its service --
  // `ReleasesService.find` asks its own `authorize` before it reads -- so a
  // filter applied here would be a second implementation of a rule this module
  // cannot see, agreeing on the day it is written and drifting afterwards.
  if (executable.kind === "system") {
    return executable.resolve(query, caller);
  }

  const source = executable.source;

  // A single answers `list` alone; validation refuses every other op before
  // it gets here, and the arm refuses again rather than falling into the
  // collection ops with a slug that names no collection.
  if (executable.kind === "single") {
    if (query.op === "list") {
      return runSingle(sourceTarget(source.id), query, caller, source);
    }
    failUnavailableSourceOrOp(
      `op "${query.op}" on source "${query.source}" is not implemented; a single answers "list" alone`
    );
  }

  const collection = sourceTarget(source.id);

  if (query.op === "count") return runCount(collection, query, caller);
  if (query.op === "list") return runList(collection, query, caller, source);
  if (query.op === "groupBy") return runGroupBy(collection, query, caller);
  if (query.op === "timeseries") {
    return runTimeseries(collection, query, caller);
  }

  // Every declared op now has an arm, so the compiler narrows `query.op` to
  // `never` here. The guard STAYS: a request body is untyped, and an op added
  // to the vocabulary without an arm would otherwise fall out of this function
  // returning `undefined` rather than being refused. Widened through a `string`
  // binding rather than a cast, so adding an op keeps this compiling while the
  // arms above are what decide whether it is reachable.
  const unimplemented: string = query.op;
  failUnavailableSourceOrOp(
    `op "${unimplemented}" on source "${query.source}" is not implemented yet`
  );
}
