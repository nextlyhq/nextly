/**
 * A source whose rows are not a collection's, and the function that answers it.
 *
 * ## Why a resolver rather than a query compiler
 *
 * A collection source compiles to the Direct API, which is possible because a
 * collection IS a table and every access rule that governs it is expressible as
 * a filter. Nothing else Nextly knows works that way: a release is not a row in
 * a collection table, a translation gap is a relationship BETWEEN rows, and
 * both are governed by a service that already decides who may see them.
 *
 * 🔴 So a system source hands the question to that service rather than
 * rebuilding it. The resolver receives the caller and passes it on; it never
 * adds a `where` clause of its own. A second authorization implementation is
 * the specific defect this shape exists to prevent -- one that agrees with the
 * service on the day it is written and drifts afterwards, silently, because
 * both look correct in isolation.
 *
 * ## Why registration is PUSHED by the domain
 *
 * The releases domain registers its own source; this module knows nothing about
 * releases. Inverting that -- widgets importing every domain that has something
 * to publish -- would make this package depend on nearly the whole codebase to
 * offer a card, and would make a domain unable to ship a source without editing
 * a file it does not own. The collection sources already work this way.
 *
 * @module domains/widgets/system-sources
 */

import type { ReadCaller } from "../../services/dashboard/readable-resources";

import type { WidgetQuery } from "./query";
import type { WidgetResult } from "./result";
import { registerSource, type WidgetSource } from "./sources";

/**
 * Answers one system source's query, for one caller.
 *
 * Returns the same `WidgetResult` a collection query does, so the archetypes
 * that draw a count or a list need no branch for where the rows came from.
 */
export type SystemSourceResolver = (
  query: WidgetQuery,
  caller: ReadCaller
) => Promise<WidgetResult>;

/**
 * The resolvers, pinned where every other boot-time widget store is.
 *
 * On `globalThis` so they survive the module re-evaluation Next.js and
 * Turbopack perform, matching the source store beside them.
 */
const globalForResolvers = globalThis as unknown as {
  __nextly_systemResolvers?: Map<string, SystemSourceResolver>;
};

function resolvers(): Map<string, SystemSourceResolver> {
  globalForResolvers.__nextly_systemResolvers ??= new Map();
  return globalForResolvers.__nextly_systemResolvers;
}

/**
 * Publish a system source and the function that answers it, together.
 *
 * 🔴 One call, because the two halves are useless apart and dangerous apart in
 * one direction: a source registered without a resolver is discoverable, passes
 * validation, and fails only when a reader puts the card on their dashboard.
 * Registering them separately makes that state reachable through ordinary
 * refactoring; this signature makes it unrepresentable.
 *
 * The source goes through `registerSource`, the same door a collection source
 * uses, so its shape is validated by the same rules and a duplicate id is
 * refused the same way.
 */
export function registerSystemSource(
  source: WidgetSource,
  resolve: SystemSourceResolver
): void {
  registerSource(source);
  resolvers().set(source.id, resolve);
}

/** The resolver for `sourceId`, or `undefined` when nothing answers it. */
export function systemResolver(
  sourceId: string
): SystemSourceResolver | undefined {
  return resolvers().get(sourceId);
}

/**
 * Forget every registered resolver.
 *
 * For tests, which register sources into a store that outlives a single file.
 * Paired with `clearSources`: clearing one and not the other leaves a resolver
 * addressable under an id no source claims, or a source nothing can answer.
 */
export function clearSystemResolvers(): void {
  resolvers().clear();
}
