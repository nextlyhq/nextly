/**
 * The update hooks a Single's committed write runs, for every write that is
 * an update of it: a save through `update`, and a publish of every language.
 *
 * One function for both, so a publish of every language cannot come to tell
 * its hooks something a save does not, or to skip them: before it existed a
 * publish of every language ran none, and every integration that follows a
 * Single through its saves (a search index, a content date, a problem check)
 * kept what it last saw.
 *
 * @module domains/singles/services/single-after-update
 */

import type { HookRegistry } from "../../../hooks/hook-registry";
import type { ResolvedRequestFacts } from "../../../hooks/request-facts";
import type { UserContext } from "../types";

import {
  buildSingleHookContext,
  getSingleHookCollection,
} from "./single-query-service";

/**
 * Run a Single's `afterUpdate` hooks (its own `afterChange`, and every hook
 * heard on all types) over the document as the write committed it. Called
 * once the write is durable. Answers what the hooks returned in place of the
 * document, or `undefined` where none ran or none returned one.
 */
export async function runSingleAfterUpdateHooks(
  hookRegistry: HookRegistry,
  args: {
    slug: string;
    /** The document as the write left it. */
    data: Record<string, unknown>;
    /** The document as it stood before the write. */
    originalData: Record<string, unknown> | undefined;
    user?: UserContext;
    /** The context the write's earlier hooks shared, if any ran. */
    context: Record<string, unknown>;
    req: ResolvedRequestFacts;
  }
): Promise<Record<string, unknown> | undefined> {
  const collection = getSingleHookCollection(args.slug);
  if (!hookRegistry.hasHooks("afterUpdate", collection)) return undefined;
  const transformed: unknown = await hookRegistry.execute(
    "afterUpdate",
    buildSingleHookContext({
      collection,
      operation: "update",
      data: args.data,
      originalData: args.originalData,
      user: args.user ?? undefined,
      context: args.context,
      req: args.req,
    })
  );
  return transformed === undefined
    ? undefined
    : (transformed as Record<string, unknown>);
}
