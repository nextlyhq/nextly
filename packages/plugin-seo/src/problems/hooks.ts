/**
 * Keeping the problem list current as pages change: a saved page is checked
 * again, and a deleted one forgotten, each marking the full check out of
 * date where the change can alter another page's result.
 *
 * @module problems/hooks
 */
import type { PluginContext } from "@nextlyhq/plugin-sdk";

import { isRecord } from "../plain-values";

import { forgetDeleted, recheckSaved, type ProblemChecks } from "./check";
import { singleKey } from "./page-types";

/** What a hook the checks are started from is handed, as far as they read it. */
interface SavedContext {
  data?: unknown;
  /**
   * Runs an effect once the write is durable: after its transaction commits,
   * where it is made on one, or at once. Absent on a context built by hand.
   */
  afterCommit?: (effect: () => unknown) => Promise<void>;
}

/** The id of the document a hook was handed, as text. */
export function idOf(context: SavedContext): string | undefined {
  const id = isRecord(context.data) ? context.data.id : undefined;
  return typeof id === "string" || typeof id === "number"
    ? String(id)
    : undefined;
}

/**
 * Check each page of the types SEO is added to after it is saved, a
 * Single's included, and forget it after it is deleted. After the save, so a failed check can
 * never undo the save, and the check reads the address the save recorded.
 */
export function watchSaves(ctx: PluginContext, checks: ProblemChecks): void {
  for (const slug of checks.targets) {
    const saved = (context: SavedContext) => {
      const id = idOf(context);
      if (id !== undefined) {
        onceDurable(context, () => recheckSaved(ctx, checks, slug, id));
      }
    };
    ctx.hooks.on("afterCreate", slug, saved);
    ctx.hooks.on("afterUpdate", slug, saved);
    ctx.hooks.on("afterDelete", slug, (context: SavedContext) => {
      const id = idOf(context);
      if (id !== undefined) {
        onceDurable(context, () => forgetDeleted(ctx, slug, id));
      }
    });
  }
  // A Single is never created or deleted by a person: its save is an
  // update, its hooks named by its key.
  for (const slug of checks.singles) {
    const key = singleKey(slug);
    ctx.hooks.on("afterUpdate", key, (context: SavedContext) => {
      const id = idOf(context);
      if (id !== undefined) {
        onceDurable(context, () => recheckSaved(ctx, checks, key, id));
      }
    });
  }
}

/**
 * Start `start` once the write the hook belongs to is durable. A save made on
 * a transaction runs its after-hooks inside it: a check started there would
 * read the page before the transaction commits, and make its own writes on
 * the transaction's connection beside the transaction's, where on PostgreSQL
 * and MySQL the two name the same savepoint and either can fail. Held until
 * the commit, it runs outside the transaction and reads what was saved.
 */
function onceDurable(context: SavedContext, start: () => void): void {
  if (context.afterCommit === undefined) {
    start();
    return;
  }
  void context.afterCommit(start);
}
