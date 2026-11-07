/**
 * The two ways a component could still be taken from pages that use it, other
 * than Delete component, refused.
 *
 * ## A component's own delete goes through Delete component, or not at all
 *
 * Delete component fences the component, turns every copy into plain blocks,
 * checks under the fence that none is left, and only then deletes it. Any
 * other delete would skip all of that and leave every copy pointing at
 * nothing, so a `beforeDelete` hook refuses it unless:
 *
 * - its hook context carries a run id (set by the server-side caller of the
 *   Direct API, never read from a request body), and
 * - that id is the component's open `delete` run, at its `deleting` step.
 *
 * Registered after the Layout guard, so a component a Layout uses is refused
 * with the Layout named first: changing the Layout is what the author must do
 * either way. Inside a caller's transaction (a batch) it refuses without
 * reading, as the Layout guard does: a batch is never the delete's own write.
 *
 * ## Unpublishing a component documents place is refused
 *
 * A reader is served only published components, so unpublishing one takes it
 * off every page that places it as surely as deleting it would. The refusal
 * names the documents the person may read and counts the rest.
 *
 * The usage index answers first, and a use it names refuses. It is a hint,
 * maintained after commit, so its "none" is never taken as the answer: every
 * document is then read as stored, as the delete's own check reads it, within
 * a budget. A use found refuses; a walk that could not finish, or a document
 * it could not read, refuses too, saying the use can't be confirmed. Doubt
 * counts as use.
 *
 * A save placing the component while it is unpublished is not fenced here,
 * and need not be: placing an unpublished component is allowed by design
 * (`component-readiness-hook.ts`: publishing a page before its components is
 * an ordinary order of work, so the save reports and never refuses). Such a
 * save lands where a save made just after the unpublish lands anyway.
 *
 * Neither reaches a write that skips hooks, nor core's all-languages
 * lifecycle, which runs no collection hooks: the known limit of every guard a
 * plugin registers.
 *
 * @module component-delete/guards
 */
import { NextlyError } from "@nextlyhq/plugin-sdk";

import type { HostFinder } from "../fields/blocks-composition";
import { documentKeyOf } from "../host-rewrite/contract";
import type { FenceStore } from "../host-rewrite/fence";
import type { ComponentDeleteRewriteService } from "../host-rewrite/service";
import type { PersonReads } from "../layout-removal/layout-references";
import { unpublishes } from "../unpublish-write";

import { namedDocuments, type NamingDeps } from "./hosts";
import { COMPONENT_DELETE_CONTEXT_KEY } from "./job";
import {
  DELETE_THROUGH_THE_ACTION,
  NOT_IN_A_BATCH,
  unpublishRefusal,
} from "./words";

/** How many documents the walk before an unpublish reads at most. */
const UNPUBLISH_DOCUMENTS = 2000;

/** How long the walk before an unpublish reads for at most. */
const UNPUBLISH_MS = 10_000;

/**
 * Who places a component, read from every document as stored, within the
 * budget: the delete's own check, as the system, writing nothing. Any host it
 * would convert, and any it could not judge, counts as a use.
 */
export function storedUseCheck(
  service: () => Pick<ComponentDeleteRewriteService, "plan">
): (componentId: string) => Promise<UseCheck> {
  return async componentId => {
    const slice = await service().plan({
      componentId,
      // The walk reads as the system and, as a plan, writes nothing, so it
      // is made for nobody.
      caller: { caller: null, user: null },
      after: null,
      maxDocuments: UNPUBLISH_DOCUMENTS,
      deadline: new Date(Date.now() + UNPUBLISH_MS),
    });
    const keys = [
      ...new Set(
        [...slice.report.rewritten, ...slice.report.left.map(l => l.host)].map(
          host => documentKeyOf(host)
        )
      ),
    ];
    if (keys.length > 0) {
      return { kind: "used", keys, complete: slice.complete };
    }
    return slice.complete ? { kind: "unused" } : { kind: "unsure" };
  };
}

/** The plugin context the guards need, named structurally. */
export interface ComponentGuardContext {
  hooks: {
    on(
      type: string,
      collection: string,
      handler: (context: unknown) => unknown
    ): void;
  };
}

/** What the guards are wired with. */
export interface ComponentGuardArgs {
  readonly ctx: ComponentGuardContext;
  /** The RESOLVED collection components are stored in. */
  readonly components: string;
  readonly runs: () => Pick<FenceStore, "runFor">;
  /** The usage index's answer to who places a component; absent, none is asked. */
  readonly hostsOf?: () => HostFinder | undefined;
  /** Every document read as stored, within a budget: who places it. */
  readonly confirmUnused: (componentId: string) => Promise<UseCheck>;
}

/** What reading every document as stored found. */
export type UseCheck =
  | { readonly kind: "unused" }
  /**
   * The documents placing it, or that could not be judged; `complete` false
   * when the walk stopped before the last document, so there may be more.
   */
  | {
      readonly kind: "used";
      readonly keys: readonly string[];
      readonly complete: boolean;
    }
  /** The walk ran out of budget before the last document. */
  | { readonly kind: "unsure" };

/** The parts of a hook context the guards read. */
interface GuardHookContext {
  data?: unknown;
  originalData?: unknown;
  context?: Record<string, unknown>;
  executor?: unknown;
  user?: PersonReads["user"];
  req?: { nextly?: unknown };
}

/** Register both guards on the component store, by its RESOLVED slug. */
export function registerComponentGuards(args: ComponentGuardArgs): void {
  args.ctx.hooks.on("beforeDelete", args.components, async context => {
    await admitDelete(args, context as GuardHookContext);
  });
  // `beforeChange`, not `beforeUpdate`: it runs after every `beforeUpdate`
  // hook, so a status another hook sets is the status judged.
  args.ctx.hooks.on("beforeChange", args.components, async context => {
    if (!unpublishes(context)) return;
    await refuseUnpublishWhileUsed(args, context as GuardHookContext);
  });
}

/** Let through only the delete's own write, at its delete step. */
async function admitDelete(
  args: ComponentGuardArgs,
  hook: GuardHookContext
): Promise<void> {
  if (hook.executor !== undefined) throw refusal(NOT_IN_A_BATCH, "batch");
  if (await isTheDeleteStep(args, hook)) return;
  throw refusal(DELETE_THROUGH_THE_ACTION, "not-the-delete-action");
}

/**
 * Whether this delete is the delete action's own: its hook context carries the
 * id of the component's open `delete` run, and that run is at `deleting`.
 */
async function isTheDeleteStep(
  args: ComponentGuardArgs,
  hook: GuardHookContext
): Promise<boolean> {
  const id = idIn(hook.data) ?? idIn(hook.originalData);
  const token = tokenIn(hook.context);
  if (id === null || token === null) return false;
  const run = await args.runs().runFor(id, "delete");
  return run !== null && run.id === token && run.phase === "deleting";
}

/** The run id a hook context carries for the delete action, or null. */
function tokenIn(context: Record<string, unknown> | undefined): string | null {
  const token = context?.[COMPONENT_DELETE_CONTEXT_KEY];
  return typeof token === "string" && token !== "" ? token : null;
}

/** Refuse unpublishing a component any document places, or may place. */
async function refuseUnpublishWhileUsed(
  args: ComponentGuardArgs,
  hook: GuardHookContext
): Promise<void> {
  if (hook.executor !== undefined) {
    throw refusal(
      "Components can't be unpublished as part of a batch, because whether a page uses one can't be checked safely there. Unpublish each one on its own.",
      "unpublish-batch"
    );
  }
  const id = idIn(hook.originalData) ?? idIn(hook.data);
  if (id === null) return;
  const indexed = await indexedHosts(args.hostsOf?.(), id);
  if (indexed.keys.length > 0) {
    throw await usedRefusal(hook, indexed.keys, indexed.whole);
  }
  const confirmed = await args.confirmUnused(id);
  if (confirmed.kind === "unused") return;
  if (confirmed.kind === "used") {
    // "At least N" where the walk stopped early.
    throw await usedRefusal(hook, confirmed.keys, confirmed.complete);
  }
  throw refusal(
    unpublishRefusal({ titles: [], others: 0, whole: false }),
    "unpublish-unconfirmed"
  );
}

/** The documents the usage index says place the component, and if it is whole. */
async function indexedHosts(
  hosts: HostFinder | undefined,
  id: string
): Promise<{ keys: string[]; whole: boolean }> {
  if (hosts === undefined) return { keys: [], whole: false };
  const [whole, found] = await Promise.all([
    hosts.whole(),
    hosts.placing([id]),
  ]);
  const keys = [
    ...new Set(
      found.hosts.map(host =>
        documentKeyOf(
          host.single === true
            ? { kind: "single", slug: host.slug }
            : { kind: "collection", slug: host.slug, id: host.id }
        )
      )
    ),
  ];
  return { keys, whole: whole && found.complete };
}

/** The refusal naming the documents that place it. */
async function usedRefusal(
  hook: GuardHookContext,
  keys: readonly string[],
  whole: boolean
): Promise<NextlyError> {
  const named = await namesFor(hook, keys);
  return refusal(
    unpublishRefusal({
      titles: named.titles,
      others: named.others,
      whole,
    }),
    "unpublish-used"
  );
}

/**
 * The documents named to the person the hook runs as, through the Direct API
 * the request carries; every one counted where there is neither.
 */
async function namesFor(
  hook: GuardHookContext,
  keys: readonly string[]
): Promise<{ titles: string[]; others: number }> {
  const nextly = hook.req?.nextly as NamingDeps["nextly"] | undefined;
  if (nextly === undefined || hook.user === undefined) {
    return { titles: [], others: keys.length };
  }
  const list = await namedDocuments(
    { nextly, asPerson: { overrideAccess: false, user: hook.user } },
    keys
  );
  return {
    titles: list.named.map(document => document.title),
    others: list.unreadable + list.more,
  };
}

/** A refusal an author sees: a typed conflict carrying the words. */
function refusal(message: string, reason: string): NextlyError {
  return NextlyError.conflict({
    reason: "state",
    message,
    logContext: { reason: `component-guard-${reason}` },
  });
}

/** A row's non-empty string `id`, or null. */
function idIn(row: unknown): string | null {
  if (typeof row !== "object" || row === null) return null;
  const id = (row as { id?: unknown }).id;
  return typeof id === "string" && id !== "" ? id : null;
}
