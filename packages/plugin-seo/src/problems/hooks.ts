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
  /** The collection's slug, or a Single's hook key (`single:<slug>`). */
  collection?: string;
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
 * The key a saved document's type is kept under where SEO is added to it:
 * a collection's slug, or a Single's `single:<slug>`, which is also the key
 * its hooks are named by. Nothing for any other type.
 */
function seoTypeKeyOf(
  checks: ProblemChecks,
  context: SavedContext
): string | undefined {
  const key = context.collection;
  if (key === undefined) return undefined;
  if (checks.targets.includes(key)) return key;
  return checks.singles.some(slug => singleKey(slug) === key) ? key : undefined;
}

/**
 * Check each page of the types SEO is added to after it is saved, a
 * Single's included, and forget it after it is deleted. After the save, so a
 * failed check can never undo the save, and the check reads the address the
 * save recorded.
 *
 * Heard on every type and kept to the ones with SEO as each save is made, so
 * a type that gets SEO after the plugin started, as a development reload
 * can give one, is checked too.
 */
export function watchSaves(ctx: PluginContext, checks: ProblemChecks): void {
  const saved = (context: SavedContext) => {
    const key = seoTypeKeyOf(checks, context);
    const id = idOf(context);
    if (key !== undefined && id !== undefined) {
      onceDurable(context, () => recheckSaved(ctx, checks, key, id));
    }
  };
  // A Single is never created or deleted by a person: its save is an
  // update, its hooks named by its key.
  ctx.hooks.on("afterCreate", "*", saved);
  ctx.hooks.on("afterUpdate", "*", saved);
  ctx.hooks.on("afterDelete", "*", (context: SavedContext) => {
    const key = seoTypeKeyOf(checks, context);
    const id = idOf(context);
    if (key !== undefined && checks.targets.includes(key) && id !== undefined) {
      onceDurable(context, () => forgetDeleted(ctx, key, id));
    }
  });
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
