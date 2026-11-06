/**
 * Delete component: turn every copy of a component into plain blocks, then
 * delete it. The one way a component is deleted (`guards.ts`).
 *
 * ## The steps, as the run's row records them
 *
 * 1. **Open** (`preflight`). Inserting the run's row is the fence: from now on
 *    no write may add a copy (`host-rewrite/fence.ts`). Opened by a person core's
 *    own delete gate lets delete THIS component (`mayDeleteEntry`), asked
 *    again before every step.
 * 2. **Check before converting** (`preflight`, a slice per step, its cursor on
 *    the row). Every host is judged as the conversion would judge it, writing
 *    nothing. Anything that would stop the delete part way stops it here, with
 *    no host changed: a copy that can't be converted (a locked area's starting
 *    blocks, a setting that installs the component), a host that can't be read
 *    or written where it is, a Layout using it, a collection the person may
 *    not change at all. Stopped, the fence comes down and the answer lists why.
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
 * 6. **Deleted** (`deleted`): the row stays for good, as the tombstone that
 *    refuses any save still holding the component, however long it was held.
 *
 * ## Who it runs as, and when it runs
 *
 * Every write is the person's who started it, made in their own requests:
 * nothing in core lets a background job act as a stored person. So each call
 * of the delete route by that person carries the delete on by one step, and
 * the dialog calls it until it is finished. Closing the dialog pauses the
 * delete; calling again resumes it. Anyone else is refused while it runs.
 * The sweep (`sweep.ts`) only finishes a delete that stopped after its write;
 * it never writes a host or deletes a component.
 *
 * @module component-delete/job
 */
import { NextlyError } from "@nextlyhq/plugin-sdk";
import type { Nextly } from "nextly";

import type {
  HostAddress,
  LeftReason,
  RewriteReport,
} from "../host-rewrite/contract";
import { documentKeyOf } from "../host-rewrite/contract";
import type { DeletionRun, FenceStore } from "../host-rewrite/fence";
import type { HostProgress } from "../host-rewrite/progress";
import {
  runStarterOf,
  type ComponentDeleteRewriteService,
  type PlanSlice,
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

/** How many documents one step judges or converts at most. */
export const STEP_DOCUMENTS = 25;

/** How long one step judges or converts for at most. */
export const STEP_MS = 8000;

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
  /** Whether core's delete gate lets the caller delete THIS component. */
  readonly mayDeleteIt: () => Promise<boolean>;
  readonly now: () => Date;
}

/** What one call answers: the envelope's message and item. */
export interface ComponentDeleteAnswer {
  readonly message: string;
  readonly item: ComponentDeleteResult;
}

/**
 * A dry run: what deleting would do over one slice of the documents, changing
 * nothing, and the delete already open, if any.
 */
export async function planComponentDelete(
  deps: ComponentDeleteDeps,
  after: string | null
): Promise<ComponentDeleteAnswer> {
  await requireReadable(deps);
  const [mayDelete, run] = await Promise.all([
    deps.mayDeleteIt(),
    deps.runs.runFor(deps.componentId, "delete"),
  ]);
  const judged = await judge(deps, after);
  const found = sizeOf(judged.plan.convert) + sizeOf(judged.plan.drafts) > 0;
  const status = judged.blocked
    ? "refused"
    : found
      ? "used"
      : judged.plan.complete
        ? "none"
        : "counting";
  return answer(deps, status, {
    mayDelete,
    run: runInfo(deps, run),
    plan: judged.plan,
    ...(judged.layouts === undefined ? {} : { layouts: judged.layouts }),
    ...(judged.left.length === 0 ? {} : { left: judged.left }),
  });
}

/** Start the delete, or carry the caller's own on by one step. */
export async function stepComponentDelete(
  deps: ComponentDeleteDeps
): Promise<ComponentDeleteAnswer> {
  const held = await deps.runs.runFor(deps.componentId, "delete");
  // Once the component is gone, its run answers for it: there is nothing
  // left to read or to authorize.
  if (held !== null && isMine(deps, held) && afterTheDelete(held)) {
    return carryOn(deps, held);
  }
  await requireReadable(deps);
  if (held !== null && !isMine(deps, held)) throw someoneElse(deps);
  // A precondition of every step, judged for THIS component by core's own
  // gate: a rule that lets the caller delete some components does not let
  // them convert the copies of one it refuses. A delete they had open stops,
  // with nothing further converted.
  if (!(await deps.mayDeleteIt())) {
    if (held !== null) await deps.runs.close(deps.componentId, "delete");
    throw NextlyError.forbidden({
      logContext: {
        reason: "component-delete-not-granted",
        componentId: deps.componentId,
      },
    });
  }
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

/** The open delete's progress, changing nothing. */
export async function componentDeleteProgress(
  deps: ComponentDeleteDeps
): Promise<ComponentDeleteAnswer> {
  const run = await deps.runs.runFor(deps.componentId, "delete");
  if (run !== null && afterTheDelete(run) && isMine(deps, run)) {
    return answer(deps, "done", { mayDelete: true, run: runInfo(deps, run) });
  }
  await requireReadable(deps);
  const mayDelete = await deps.mayDeleteIt();
  if (run === null) return answer(deps, "idle", { mayDelete, run: null });
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
    case "deleted":
      return answer(deps, "done", { mayDelete: true, run: runInfo(deps, run) });
    default:
      return convert(deps, run);
  }
}

/**
 * Step 2, one slice: stop with nothing changed, go on to the next slice, or,
 * once the last is judged, go on to convert.
 */
async function preflight(
  deps: ComponentDeleteDeps,
  run: DeletionRun
): Promise<ComponentDeleteAnswer> {
  const judged = await judge(deps, run.cursor);
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
  // Each move is from `preflight`, so a slice a second request of the same
  // person judged first is simply judged again.
  if (!judged.plan.complete) {
    await deps.runs.advance(run.id, "preflight", "preflight", judged.plan.next);
    return answer(deps, "preflight", {
      mayDelete: true,
      run: { yours: true, step: "preflight" },
      progress: progressOf([]),
    });
  }
  await deps.runs.advance(run.id, "preflight", "converting", null);
  return answer(deps, "running", {
    mayDelete: true,
    run: { yours: true, step: "converting" },
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
 * Step 5: delete the component as the person, then leave the tombstone. A
 * delete that failed leaves the component and takes the fence down, unless
 * it committed before failing, which a read tells.
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
    "deleted",
    deps.now().toISOString()
  );
  return answer(deps, "done", {
    mayDelete: true,
    run: { yours: true, step: "deleted" },
  });
}

/** What the check before converting found, over one slice. */
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

/** Judge one slice of the hosts as the delete would, writing nothing. */
async function judge(
  deps: ComponentDeleteDeps,
  after: string | null
): Promise<Judged> {
  const slice: PlanSlice = await deps.rewrite.plan({
    componentId: deps.componentId,
    caller: deps.caller,
    after,
    maxDocuments: STEP_DOCUMENTS,
    deadline: new Date(deps.now().getTime() + STEP_MS),
  });
  const { report } = slice;
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
      complete: slice.complete,
      next: slice.next,
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

/** How many documents a list holds, named or not. */
function sizeOf(list: DocumentList): number {
  return list.named.length + list.unreadable + list.more;
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
function keysOf(hosts: readonly HostAddress[]): string[] {
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
  return run.phase === "deleting" || run.phase === "deleted";
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
