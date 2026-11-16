/**
 * The hooks a Single's update runs before it writes, for every write that is
 * an update of it: a save through `update`, and a publish of every language.
 *
 * Each phase is one function both call, so a publish of every language
 * cannot come to ask a site's rules something a save does not, or to skip
 * them: a hook that refuses a publish through a save of one language refuses
 * a publish of every language too. A hook refuses by throwing, before
 * anything is written.
 *
 * @module domains/singles/services/single-before-update
 */

import { NextlyError } from "../../../errors/nextly-error";
import type { HookRegistry } from "../../../hooks/hook-registry";
import type { ResolvedRequestFacts } from "../../../hooks/request-facts";
import { runFieldHooks } from "../../../shared/lib/field-level-registry";
import type { UserContext } from "../types";

import {
  buildSingleHookContext,
  getSingleHookCollection,
  resolveNextlyForHooks,
} from "./single-query-service";

/** What every before-phase of one update of a Single is told. */
export interface SingleBeforeHookCall {
  slug: string;
  /** The document's id. */
  id: string;
  /** The document as it is stored, which the write compares against. */
  originalData: Record<string, unknown>;
  user?: UserContext;
  /** One context for every hook of the write, before and after it. */
  context: Record<string, unknown>;
  req: ResolvedRequestFacts;
}

/**
 * `beforeOperation`: may reshape the write's data, and may refuse it.
 * Answers the data to carry on with.
 */
export async function runSingleBeforeOperation(
  hookRegistry: HookRegistry,
  call: SingleBeforeHookCall,
  data: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const collection = getSingleHookCollection(call.slug);
  if (!hookRegistry.hasHooks("beforeOperation", collection)) return data;
  const result = await hookRegistry.executeBeforeOperation({
    collection,
    operation: "update",
    args: { data, id: call.id },
    user: call.user ?? undefined,
    context: call.context,
    req: { ...call.req, nextly: resolveNextlyForHooks() },
  });
  return result?.data ?? data;
}

/**
 * One of the Single's own phases, `beforeUpdate` (before validation) or
 * `beforeChange` (after it): may reshape the data, and may refuse it.
 */
export async function runSingleBeforeHooks(
  hookRegistry: HookRegistry,
  phase: "beforeUpdate" | "beforeChange",
  call: SingleBeforeHookCall,
  data: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const collection = getSingleHookCollection(call.slug);
  if (!hookRegistry.hasHooks(phase, collection)) return data;
  const modified: unknown = await hookRegistry.execute(
    phase,
    buildSingleHookContext({
      collection,
      operation: "update",
      data,
      originalData: call.originalData,
      user: call.user ?? undefined,
      context: call.context,
      req: call.req,
    })
  );
  return modified === undefined ? data : (modified as Record<string, unknown>);
}

/**
 * The before hooks a status change of the Single (`update` with a body of
 * `status` alone) runs, run once for a publish of every language, in the
 * order a save runs them: `beforeOperation`, `beforeUpdate`, the fields'
 * `beforeValidate`, `beforeChange`, then the fields' `beforeChange`, each
 * handed `{ status }` against the document as stored.
 *
 * The publish writes each language's status and nothing else, so what a
 * hook makes of the data is not written. A hook that takes the status away
 * or names another one refuses the publish as a conflict, rather than being
 * ignored: the write would otherwise report a move the hook decided against.
 */
export async function runSingleStatusMoveBeforeHooks(
  hookRegistry: HookRegistry | undefined,
  call: SingleBeforeHookCall,
  status: string
): Promise<void> {
  let data: Record<string, unknown> = { status };
  if (hookRegistry !== undefined) {
    data = await runSingleBeforeOperation(hookRegistry, call, data);
    data = await runSingleBeforeHooks(hookRegistry, "beforeUpdate", call, data);
  }
  await runFieldHooks({
    kind: "single",
    slug: call.slug,
    phase: "beforeValidate",
    data,
    operation: "update",
    user: call.user,
  });
  if (hookRegistry !== undefined) {
    data = await runSingleBeforeHooks(hookRegistry, "beforeChange", call, data);
  }
  await runFieldHooks({
    kind: "single",
    slug: call.slug,
    phase: "beforeChange",
    data,
    operation: "update",
    user: call.user,
  });
  if (data.status !== status) {
    throw NextlyError.conflict({
      reason: "state",
      message:
        `Publishing every language of '${call.slug}' was refused: after the ` +
        `Single's hooks ran, the write no longer carries the status ` +
        `'${status}'. Nothing was changed.`,
      logContext: {
        cause: "every-language-publish-status-changed-by-hook",
        single: call.slug,
      },
    });
  }
}
