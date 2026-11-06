/**
 * Delete component: turn every copy of a component into plain blocks, then
 * delete it. The one way a component is deleted (`delete-guard.ts`).
 *
 * ## The steps, as the run's row records them
 *
 * 1. **Open** (`preflight`). Inserting the run's row is the fence: from now on
 *    no write may add a copy (`host-rewrite/fence.ts`). Opened by a person who
 *    may read the component and holds the right to delete components.
 * 2. **Check before converting.** Every host is judged as the conversion
 *    would judge it, writing nothing. Anything that would stop the delete
 *    part way stops it here, with no host changed: a copy that can't be
 *    converted (a locked area's starting blocks, a setting that installs the
 *    component), a host that can't be read or written where it is, a Layout
 *    using it, a collection the person may not change at all. Stopped, the
 *    fence comes down and the answer lists why.
 * 3. **Convert** (`converting`, `final`, `done`): the host rewrite, a bounded
 *    tick per request, as the person. Its two walks end with every host read
 *    again under the fence.
 * 4. **Finished with documents left** (a pending draft, a host that kept
 *    changing, one the person may not change after all): the fence comes down
 *    and the component is kept. Starting again picks up there: what was
 *    converted reads as unchanged.
 * 5. **Delete** (`deleting`): moved from `done` by compare-and-set, so a save
 *    re-queueing a document since sends the run back instead
 *    (`host-rewrite/in-transaction.ts`). The component is deleted as the
 *    person, the run's id in the hook context, which the delete guard
 *    requires.
 * 6. **Settle** (`settling`): the run stays {@link SETTLE_MS} after the
 *    delete, refusing saves made from a copy that still holds the component,
 *    then is closed. No fence lasts beyond that: restoring an old version
 *    shows the missing-component placeholder.
 *
 * ## Who it runs as, and when it runs
 *
 * Every write is the person's who started it, made in their own requests:
 * nothing in core lets a background job act as a stored person. So each call
 * of the delete route by that person carries the delete on by one step, and
 * the dialog calls it until it is finished. Closing the dialog pauses the
 * delete; calling again resumes it. Anyone else is refused while it runs.
 * The sweep (`sweep.ts`) only closes settled runs and finishes a delete that
 * stopped after its write; it never writes a host or deletes a component.
 *
 * @module component-delete/job
 */
import { NextlyError } from "@nextlyhq/plugin-sdk";
import type { Nextly } from "nextly";

import type { LeftReason, RewriteReport } from "../host-rewrite/contract";
import { documentKeyOf } from "../host-rewrite/contract";
import type { DeletionRun, FenceStore } from "../host-rewrite/fence";
import type { HostProgress } from "../host-rewrite/progress";
import {
  runStarterOf,
  type ComponentDeleteRewriteService,
  type RewriteCaller,
} from "../host-rewrite/service";

import type {
  ComponentDeleteResult,
  DeletePlan,
  DeleteProgress,
  DocumentList,
  LeftDocument,
  LeftDocumentReason,
} from "./contract";
import { namedDocuments, type NamingDeps } from "./hosts";
import { leftWords, MESSAGES, SOMEONE_ELSE_IS_DELETING } from "./words";

/** The hook-context key the delete's own write carries the run's id under. */
export const COMPONENT_DELETE_CONTEXT_KEY = "pageBuilder.componentDelete";

/** How long a run stays after the delete, refusing saves from stale copies. */
export const SETTLE_MS: number = 2 * 60 * 1000;

/** How many documents one step converts at most. */
const STEP_DOCUMENTS = 25;

/** How long one step converts for at most. */
const STEP_MS = 8000;

/** What the delete needs, injected so a test can drive it. */
export interface ComponentDeleteDeps extends NamingDeps {
  readonly componentId: string;
  /** The component store: its collection. */
  readonly components: string;
  /** The caller, as the rewrite takes them. */
  readonly caller: RewriteCaller;
  readonly rewrite: ComponentDeleteRewriteService;
  readonly runs: Pick<FenceStore, "runFor" | "advance" | "close">;
  readonly nextly: Pick<Nextly, "find" | "findByID" | "delete">;
  /** May the caller do `action` on `resource`; `anyEntry` as `caller.can` takes it. */
  readonly may: (
    action: string,
    resource: string,
    anyEntry: boolean
  ) => Promise<boolean>;
  readonly now: () => Date;
}

/** What one call answers: the envelope's message and item. */
export interface ComponentDeleteAnswer {
  readonly message: string;
  readonly item: ComponentDeleteResult;
}

/**
 * A dry run: what deleting would do, changing nothing, and the delete already
 * open, if any.
 */
export async function planComponentDelete(
  deps: ComponentDeleteDeps
): Promise<ComponentDeleteAnswer> {
  await requireReadable(deps);
  const [mayDelete, run] = await Promise.all([
    deps.may("delete", deps.components, true),
    deps.runs.runFor(deps.componentId, "delete"),
  ]);
  const judged = await judge(deps);
  const status = judged.blocked
    ? "refused"
    : judged.plan.convert.named.length +
          judged.plan.convert.unreadable +
          judged.plan.convert.more +
          judged.plan.drafts.named.length +
          judged.plan.drafts.unreadable +
          judged.plan.drafts.more ===
        0
      ? "none"
      : "used";
  return {
    message: MESSAGES[status],
    item: {
      componentId: deps.componentId,
      status,
      mayDelete,
      run: runInfo(deps, run),
      plan: judged.plan,
      ...(judged.layouts === undefined ? {} : { layouts: judged.layouts }),
      ...(judged.left.length === 0 ? {} : { left: judged.left }),
    },
  };
}

/** Start the delete, or carry the caller's own on by one step. */
export async function stepComponentDelete(
  deps: ComponentDeleteDeps
): Promise<ComponentDeleteAnswer> {
  const held = await deps.runs.runFor(deps.componentId, "delete");
  // Once the component is gone, its run answers for it: there is nothing
  // left to read.
  if (held !== null && isMine(deps, held) && afterTheDelete(held)) {
    return carryOn(deps, held);
  }
  await requireReadable(deps);
  if (!(await deps.may("delete", deps.components, true))) {
    throw NextlyError.forbidden({
      logContext: { reason: "component-delete-not-granted" },
    });
  }
  if (held !== null && !isMine(deps, held)) throw someoneElse(deps);
  const run =
    held ??
    (
      await deps.rewrite.open(
        deps.componentId,
        deps.caller,
        "delete",
        "preflight"
      )
    ).run;
  if (!isMine(deps, run)) throw someoneElse(deps);
  return carryOn(deps, run);
}

/** The open delete's progress, changing nothing but a settled run's close. */
export async function componentDeleteProgress(
  deps: ComponentDeleteDeps
): Promise<ComponentDeleteAnswer> {
  const run = await deps.runs.runFor(deps.componentId, "delete");
  if (run === null || !(isMine(deps, run) && afterTheDelete(run))) {
    await requireReadable(deps);
  }
  const mayDelete = await deps.may("delete", deps.components, true);
  if (run === null) {
    return answer(deps, "idle", { mayDelete, run: null });
  }
  if (afterTheDelete(run)) {
    await closeIfSettled(deps, run);
    return answer(deps, "done", { mayDelete, run: runInfo(deps, run) });
  }
  return answer(deps, run.phase === "preflight" ? "preflight" : "running", {
    mayDelete,
    run: runInfo(deps, run),
    progress: progressOf(await deps.rewrite.progress(deps.componentId)),
  });
}

/** One step of the caller's own run, by the phase it is at. */
async function carryOn(
  deps: ComponentDeleteDeps,
  run: DeletionRun
): Promise<ComponentDeleteAnswer> {
  switch (run.phase) {
    case "preflight":
      return preflight(deps, run);
    case "deleting":
      return deleteIt(deps, run);
    case "settling":
      await closeIfSettled(deps, run);
      return answer(deps, "done", { mayDelete: true, run: runInfo(deps, run) });
    default:
      return convert(deps, run);
  }
}

/** Step 2: judge every host; stop with nothing changed, or go on to convert. */
async function preflight(
  deps: ComponentDeleteDeps,
  run: DeletionRun
): Promise<ComponentDeleteAnswer> {
  const judged = await judge(deps);
  if (judged.blocked) {
    await deps.runs.close(deps.componentId, "delete");
    return answer(deps, "refused", {
      mayDelete: true,
      run: null,
      plan: judged.plan,
      ...(judged.layouts === undefined ? {} : { layouts: judged.layouts }),
      left: judged.left,
    });
  }
  // Lost only to a second request of the same person that moved it first.
  await deps.runs.advance(run.id, "preflight", "converting", null);
  return answer(deps, "running", {
    mayDelete: true,
    run: { yours: true, step: "converting" },
    plan: judged.plan,
    progress: progressOf([]),
  });
}

/** Steps 3 and 4: one bounded tick of the conversion, and what follows it. */
async function convert(
  deps: ComponentDeleteDeps,
  run: DeletionRun
): Promise<ComponentDeleteAnswer> {
  const report = await deps.rewrite.rewrite({
    componentId: deps.componentId,
    caller: deps.caller,
    maxDocuments: STEP_DOCUMENTS,
    deadline: new Date(deps.now().getTime() + STEP_MS),
  });
  const rows = await deps.rewrite.progress(deps.componentId);
  if (!report.finished) {
    return answer(deps, "running", {
      mayDelete: true,
      run: runInfo(deps, run),
      progress: progressOf(rows),
    });
  }
  const left = rows.filter(row => row.state === "left");
  if (left.length > 0) {
    const named = await leftDocuments(deps, left, report);
    await deps.runs.close(deps.componentId, "delete");
    return answer(deps, "partly-done", {
      mayDelete: true,
      run: null,
      left: named,
      progress: progressOf(rows),
    });
  }
  if (!(await deps.runs.advance(run.id, "done", "deleting", null))) {
    // A save re-queued a document after the final walk: convert it first.
    return answer(deps, "running", {
      mayDelete: true,
      run: runInfo(deps, run),
      progress: progressOf(rows),
    });
  }
  return deleteIt(deps, { ...run, phase: "deleting" });
}

/**
 * Step 5: delete the component as the person, then settle. A delete that
 * failed leaves the component and takes the fence down, unless it committed
 * before failing, which a read tells.
 */
async function deleteIt(
  deps: ComponentDeleteDeps,
  run: DeletionRun
): Promise<ComponentDeleteAnswer> {
  if (await componentExists(deps)) {
    try {
      await deps.nextly.delete({
        collection: deps.components,
        id: deps.componentId,
        ...deps.asPerson,
        context: { [COMPONENT_DELETE_CONTEXT_KEY]: run.id },
      });
    } catch (error) {
      if (await componentExists(deps)) {
        await deps.runs.close(deps.componentId, "delete");
        throw error;
      }
    }
  }
  await deps.runs.advance(
    run.id,
    "deleting",
    "settling",
    deps.now().toISOString()
  );
  return answer(deps, "done", {
    mayDelete: true,
    run: { yours: true, step: "settling" },
  });
}

/** Close a settled run whose window has passed. */
async function closeIfSettled(
  deps: Pick<ComponentDeleteDeps, "runs" | "now" | "componentId">,
  run: DeletionRun
): Promise<void> {
  if (run.phase !== "settling" || !settled(run, deps.now())) return;
  await deps.runs.close(deps.componentId, "delete");
}

/** Whether a settling run's window has passed. Unreadable times have. */
export function settled(run: Pick<DeletionRun, "cursor">, now: Date): boolean {
  const deletedAt = Date.parse(run.cursor ?? "");
  return Number.isNaN(deletedAt) || now.getTime() - deletedAt >= SETTLE_MS;
}

/** What the check before converting found. */
interface Judged {
  readonly plan: DeletePlan;
  readonly layouts?: DocumentList;
  readonly left: readonly LeftDocument[];
  readonly blocked: boolean;
}

/** The reasons a document left by the check stops the delete before it starts. */
const STOPS: ReadonlySet<LeftReason> = new Set<LeftReason>([
  "refused",
  "unreadable",
  "unaddressable",
  "write-refused",
  "changed",
  "not-permitted",
  "layout",
]);

/** Judge every host as the delete would, writing nothing. */
async function judge(deps: ComponentDeleteDeps): Promise<Judged> {
  const report = await deps.rewrite.plan({
    componentId: deps.componentId,
    caller: deps.caller,
  });
  const convertKeys = keysOf(report.rewritten);
  const draftKeys = keysOf(
    report.left.filter(left => left.reason === "pending-draft").map(l => l.host)
  );
  const rights = await rightsOver(deps, [...convertKeys, ...draftKeys]);
  // One entry per document and reason: a document with two hosts left for
  // one reason is one place to go.
  const stopping = new Map<string, LeftReason>();
  for (const left of report.left) {
    if (!STOPS.has(left.reason)) continue;
    const key = documentKeyOf(left.host);
    if (!stopping.has(key)) stopping.set(key, left.reason);
  }
  for (const key of rights.refused) {
    if (!stopping.has(key)) stopping.set(key, "not-permitted");
  }
  const layoutKeys = [...stopping]
    .filter(([, reason]) => reason === "layout")
    .map(([key]) => key);
  const others = [...stopping].filter(([, reason]) => reason !== "layout");
  const left = await leftDocumentsOf(
    deps,
    others.map(([key, reason]) => ({ key, reason }))
  );
  return {
    plan: {
      convert: await namedDocuments(deps, convertKeys),
      drafts: await namedDocuments(deps, draftKeys),
      mayBeRefused: rights.maybe,
    },
    ...(layoutKeys.length === 0
      ? {}
      : { layouts: await namedDocuments(deps, layoutKeys) }),
    left,
    blocked: stopping.size > 0,
  };
}

/**
 * Which documents the person may not change at all (their collection refuses
 * them every update), and how many they may be refused (a rule over the
 * entry decides), by collection. Publishing a live one is judged by its own
 * write alone: a collection with no publish workflow has no grant to ask.
 */
async function rightsOver(
  deps: ComponentDeleteDeps,
  keys: readonly string[]
): Promise<{ refused: string[]; maybe: number }> {
  const bySlug = new Map<string, string[]>();
  for (const key of new Set(keys)) {
    const slug = slugOfKey(key);
    if (slug === undefined) continue;
    bySlug.set(slug, [...(bySlug.get(slug) ?? []), key]);
  }
  const refused: string[] = [];
  let maybe = 0;
  for (const [slug, inSlug] of bySlug) {
    if (!(await deps.may("update", slug, true))) {
      refused.push(...inSlug);
      continue;
    }
    if (!(await deps.may("update", slug, false))) maybe += inSlug.length;
  }
  return { refused, maybe };
}

/** The documents the hosts belong to, once each, in the order found. */
function keysOf(
  hosts: readonly RewriteReport["rewritten"][number][]
): string[] {
  return [...new Set(hosts.map(host => documentKeyOf(host)))];
}

/** The collection or Single slug a document key names. */
function slugOfKey(key: string): string | undefined {
  const [, slug] = key.split("\u001F");
  return slug === undefined || slug === "" ? undefined : slug;
}

/** The documents a finished run left, named for the person, with why. */
async function leftDocuments(
  deps: ComponentDeleteDeps,
  rows: readonly HostProgress[],
  report: RewriteReport
): Promise<LeftDocument[]> {
  // This call's own report knows the reason of a document it left itself;
  // the row holds the first reason recorded for it.
  const fromReport = new Map(
    report.left.map(left => [documentKeyOf(left.host), left.reason] as const)
  );
  return leftDocumentsOf(
    deps,
    rows.map(row => ({
      key: row.documentKey,
      reason: reasonOf(fromReport.get(row.documentKey) ?? row.reason),
    }))
  );
}

/** Left documents, named where the person may read them. */
async function leftDocumentsOf(
  deps: ComponentDeleteDeps,
  found: readonly {
    readonly key: string;
    readonly reason: LeftDocumentReason;
  }[]
): Promise<LeftDocument[]> {
  const named = await namedDocuments(
    deps,
    found.map(entry => entry.key)
  );
  const byKey = new Map(
    named.named.map(document => [documentKeyOf(document), document] as const)
  );
  return found.map(entry => ({
    document: byKey.get(entry.key) ?? null,
    reason: entry.reason,
    words: leftWords(entry.reason),
  }));
}

/** A recorded reason, read strictly: one nobody can classify was unreadable. */
function reasonOf(value: string | null | undefined): LeftDocumentReason {
  return value !== null && value !== undefined && LEFT_REASONS.has(value)
    ? (value as LeftDocumentReason)
    : "unreadable";
}

const LEFT_REASONS: ReadonlySet<string> = new Set<LeftDocumentReason>([
  "refused",
  "pending-draft",
  "not-permitted",
  "unreadable",
  "unaddressable",
  "changed",
  "write-refused",
  "layout",
]);

/** The progress rows, counted. */
function progressOf(rows: readonly HostProgress[]): DeleteProgress {
  const count = (state: HostProgress["state"]) =>
    rows.filter(row => row.state === state).length;
  return {
    converted: count("rewritten"),
    unchanged: count("unchanged"),
    left: count("left"),
    pending: count("pending"),
  };
}

/** Whether the run is at or past its delete. */
function afterTheDelete(run: DeletionRun): boolean {
  return run.phase === "deleting" || run.phase === "settling";
}

/** Whether the caller started this run. */
function isMine(deps: ComponentDeleteDeps, run: DeletionRun): boolean {
  return run.startedBy === runStarterOf(deps.caller);
}

/** The run as an answer reports it. */
function runInfo(
  deps: ComponentDeleteDeps,
  run: DeletionRun | null
): ComponentDeleteResult["run"] {
  return run === null ? null : { yours: isMine(deps, run), step: run.phase };
}

/** The refusal for a second person. */
function someoneElse(deps: ComponentDeleteDeps): NextlyError {
  return NextlyError.conflict({
    reason: "state",
    message: SOMEONE_ELSE_IS_DELETING,
    logContext: {
      reason: "component-delete-busy",
      componentId: deps.componentId,
    },
  });
}

/** An answer of `status`, with its message. */
function answer(
  deps: ComponentDeleteDeps,
  status: ComponentDeleteResult["status"],
  rest: Omit<ComponentDeleteResult, "componentId" | "status">
): ComponentDeleteAnswer {
  return {
    message: messageOf(status),
    item: { componentId: deps.componentId, status, ...rest },
  };
}

function messageOf(status: ComponentDeleteResult["status"]): string {
  switch (status) {
    case "partly-done":
      return MESSAGES.partlyDone;
    case "preflight":
      return MESSAGES.running;
    default:
      return MESSAGES[status];
  }
}

/**
 * Refuse a component the caller may not read, or that does not exist: read
 * as them, so a hidden one answers as missing before anything is read past
 * their access.
 */
async function requireReadable(deps: ComponentDeleteDeps): Promise<void> {
  const found = await deps.nextly.find({
    collection: deps.components,
    where: { id: { equals: deps.componentId } },
    status: "all",
    limit: 1,
    depth: 0,
    ...deps.asPerson,
  });
  if (found.items.length === 0) throw NextlyError.notFound();
}

/** Whether the component still exists, read as the system. */
async function componentExists(deps: ComponentDeleteDeps): Promise<boolean> {
  const found = await deps.nextly.find({
    collection: deps.components,
    where: { id: { equals: deps.componentId } },
    status: "all",
    limit: 1,
    depth: 0,
    overrideAccess: true,
  });
  return found.items.length > 0;
}
