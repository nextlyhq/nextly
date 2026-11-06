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
 * names the documents the person may read and counts the rest, from the
 * usage index. Doubt counts as use: while the index is not whole, the count
 * is only a floor ("at least"), and an index that is not whole and found
 * nothing refuses as well, saying the use cannot be confirmed.
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
import type { PersonReads } from "../layout-removal/layout-references";
import { unpublishes } from "../unpublish-write";

import { namedDocuments, type NamingDeps } from "./hosts";
import { COMPONENT_DELETE_CONTEXT_KEY } from "./job";
import {
  DELETE_THROUGH_THE_ACTION,
  NOT_IN_A_BATCH,
  unpublishRefusal,
} from "./words";

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
}

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
  const id = idIn(hook.data) ?? idIn(hook.originalData);
  const token = hook.context?.[COMPONENT_DELETE_CONTEXT_KEY];
  if (id !== null && typeof token === "string" && token !== "") {
    const run = await args.runs().runFor(id, "delete");
    if (run !== null && run.id === token && run.phase === "deleting") return;
  }
  throw refusal(DELETE_THROUGH_THE_ACTION, "not-the-delete-action");
}

/** Refuse unpublishing a component any document places, or may place. */
async function refuseUnpublishWhileUsed(
  args: ComponentGuardArgs,
  hook: GuardHookContext
): Promise<void> {
  const hosts = args.hostsOf?.();
  // A host that renders components from a store of its own keeps no index of
  // them, so there is nothing to ask.
  if (hosts === undefined) return;
  if (hook.executor !== undefined) {
    throw refusal(
      "Components can't be unpublished as part of a batch, because whether a page uses one can't be checked safely there. Unpublish each one on its own.",
      "unpublish-batch"
    );
  }
  const id = idIn(hook.originalData) ?? idIn(hook.data);
  if (id === null) return;
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
  const complete = whole && found.complete;
  if (keys.length === 0 && complete) return;
  const named = await namesFor(hook, keys);
  throw refusal(
    unpublishRefusal({
      titles: named.titles,
      others: named.others,
      whole: complete,
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
