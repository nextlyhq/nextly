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

/** The id of the document a hook was handed, as text. */
function idOf(context: { data?: unknown }): string | undefined {
  const id = isRecord(context.data) ? context.data.id : undefined;
  return typeof id === "string" || typeof id === "number"
    ? String(id)
    : undefined;
}

/**
 * Check each page of the types SEO is added to after it is saved, and
 * forget it after it is deleted. After the save, so a failed check can
 * never undo the save, and the check reads the address the save recorded.
 */
export function watchSaves(ctx: PluginContext, checks: ProblemChecks): void {
  for (const slug of checks.targets) {
    const saved = (context: { data?: unknown }) => {
      const id = idOf(context);
      if (id !== undefined) recheckSaved(ctx, checks, slug, id);
    };
    ctx.hooks.on("afterCreate", slug, saved);
    ctx.hooks.on("afterUpdate", slug, saved);
    ctx.hooks.on("afterDelete", slug, (context: { data?: unknown }) => {
      const id = idOf(context);
      if (id !== undefined) forgetDeleted(ctx, slug, id);
    });
  }
}
