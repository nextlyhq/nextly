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

import { getNextly } from "../../direct-api/nextly";
import type { FindArgs } from "../../direct-api/types/collections";
import type { ReadCaller } from "../../services/dashboard/readable-resources";
import type { WhereFilter } from "../collections/query/query-operators";

import { resolveExecutableSource } from "./executable-source";
import type { WidgetQuery } from "./query";
import type { WidgetResult, WidgetResultField } from "./result";
import {
  failUnavailableSourceOrOp,
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
  const result = await getNextly().count({
    collection,
    ...sharedReadArgs(query, caller),
  });
  return { op: "count", total: result.total };
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

  const labels = new Map<string, string | undefined>(
    source.fields.map(field => [field.name, field.label])
  );

  const described: WidgetResultField[] = [];
  const taken = new Set<string>();
  for (const name of query.select) {
    if (taken.has(name)) continue;
    taken.add(name);
    if (!survived.has(name)) continue;
    const label = labels.get(name);
    described.push({ name, ...(label !== undefined && { label }) });
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
  const result = await getNextly().find({
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
  const collection = sourceTarget(source.id);

  if (query.op === "count") return runCount(collection, query, caller);
  if (query.op === "list") return runList(collection, query, caller, source);

  // Same refusal as every other source/op dead end, for the same reason: this
  // one is reachable only for an op a source DECLARED support for, so a
  // distinct message would say which sources declare which ops.
  failUnavailableSourceOrOp(
    `op "${query.op}" on source "${query.source}" is not implemented yet`
  );
}
