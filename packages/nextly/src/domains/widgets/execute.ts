/**
 * Compile a validated widget query to a Direct API call and run it.
 *
 * Every read is `overrideAccess: false` plus the requesting user, which is the
 * same path a REST read takes. There is deliberately NO second enforcement
 * implementation -- keeping two in step is what fails, and it is what failed
 * for Strapi's homepage widgets (strapi#22921), where the widget's permission
 * gated the card while its query returned rows the viewer could not see.
 *
 * @module domains/widgets/execute
 */

import type { AuthenticatedScope } from "../../auth/authenticated-scope";
import { getNextly } from "../../direct-api/nextly";
import type { FindArgs } from "../../direct-api/types/collections";
import type { WhereFilter } from "../collections/query/query-operators";
import type { UserContext } from "../collections/services/collection-types";

import type { WidgetQuery } from "./query";
import { failUnavailableSourceOrOp, getSource } from "./sources";

/**
 * Who is asking, in the two shapes an access decision reads. Structurally the
 * return of `api/authenticated-read`'s `readCaller`; declared here so the
 * widget domain does not import from the API layer.
 */
export interface ReadCaller {
  user: UserContext;
  authenticatedScope?: AuthenticatedScope;
}

export type WidgetResult =
  | { op: "count"; total: number }
  | { op: "list"; items: Record<string, unknown>[] };

/** `collection:posts` -> `posts`. */
function sourceTarget(sourceId: string): string {
  const separator = sourceId.indexOf(":");
  return separator === -1 ? sourceId : sourceId.slice(separator + 1);
}

/** `["title","status"]` -> `{ title: true, status: true }`. */
function toSelect(
  fields: string[] | undefined
): Record<string, boolean> | undefined {
  if (!fields || fields.length === 0) return undefined;
  return Object.fromEntries(fields.map(field => [field, true]));
}

/**
 * Resolves `query.source` against the live registry, or fails loudly.
 *
 * Both refusals go through `failUnavailableSourceOrOp`, so a source that does
 * not exist and one that exists but is not executable answer the caller
 * identically -- the second would otherwise confirm the source is real. The
 * distinction survives in the log.
 */
function resolveExecutableSource(sourceId: string) {
  // Re-resolve rather than trusting the caller's copy: a source can be
  // deregistered between configuration and execution, and a query pointing at
  // a source that no longer exists must fail rather than fall through.
  const source = getSource(sourceId);
  if (!source) {
    failUnavailableSourceOrOp(`unknown source "${sourceId}" at execution`);
  }
  if (source.kind !== "collection") {
    failUnavailableSourceOrOp(
      `source "${sourceId}" has kind "${source.kind}", which is not executable yet; only collections are`
    );
  }
  return source;
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

async function runList(
  collection: string,
  query: WidgetQuery,
  caller: ReadCaller
): Promise<WidgetResult> {
  const select = toSelect(query.select);
  const result = await getNextly().find({
    collection,
    limit: query.limit,
    ...(query.sort ? { sort: query.sort } : {}),
    ...(select ? { select } : {}),
    ...sharedReadArgs(query, caller),
  });
  return {
    op: "list",
    items: result.items ?? [],
  };
}

export async function executeWidgetQuery(
  query: WidgetQuery,
  caller: ReadCaller
): Promise<WidgetResult> {
  const source = resolveExecutableSource(query.source);
  const collection = sourceTarget(source.id);

  if (query.op === "count") return runCount(collection, query, caller);
  if (query.op === "list") return runList(collection, query, caller);

  // Same refusal as every other source/op dead end, for the same reason: this
  // one is reachable only for an op a source DECLARED support for, so a
  // distinct message would say which sources declare which ops.
  failUnavailableSourceOrOp(
    `op "${query.op}" on source "${query.source}" is not implemented yet`
  );
}
