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
import { NextlyError } from "../../errors/nextly-error";
import type { WhereFilter } from "../collections/query/query-operators";
import type { UserContext } from "../collections/services/collection-types";

import type { WidgetQuery } from "./query";
import { getSource } from "./sources";

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

/** Resolves `query.source` against the live registry, or fails loudly. */
function resolveExecutableSource(sourceId: string) {
  // Re-resolve rather than trusting the caller's copy: a source can be
  // deregistered between configuration and execution, and a query pointing at
  // a source that no longer exists must fail rather than fall through.
  const source = getSource(sourceId);
  if (!source) {
    throw NextlyError.invalidInput({
      message: `Widget query names unknown source "${sourceId}"`,
    });
  }
  if (source.kind !== "collection") {
    throw NextlyError.invalidInput({
      message: `Source kind "${source.kind}" is not executable yet; only collections are.`,
    });
  }
  return source;
}

/**
 * The arguments every op shares: the caller WHOLE (never reduced to an id),
 * the framework-authored `where` exempted from the probe guard, and the
 * optional draft/published scope.
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
    // `frameworkFilter: true` exempts this `where` from the guard that refuses
    // a filter naming a field the caller may not read. It is correct here and
    // only here: the guard's subject is a caller CHOOSING probe values to
    // bisect a hidden value, and this `where` is stored configuration written
    // by someone who already held permission to configure it, replayed
    // verbatim. It addresses; it does not probe. Authoring a widget is
    // therefore a stronger permission than viewing one, and is gated
    // separately.
    frameworkFilter: true as const,
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

  throw NextlyError.invalidInput({
    message: `Widget op "${query.op}" is not implemented yet.`,
  });
}
