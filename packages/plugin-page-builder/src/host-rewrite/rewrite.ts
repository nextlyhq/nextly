/**
 * Walking every host of a component and rewriting each with a step.
 *
 * A run has two walks. The CONVERTING walk visits the documents the usage
 * index names first, then every document on the site, skipping those its
 * progress rows say are finished, and rewrites what the step says to. The
 * FINAL walk then reads every document again, trusting no progress row, so a
 * document a wrong row skipped, or one re-queued by a write made while the run
 * was open, is rewritten there. A run is finished only when the final walk has
 * reached the end; a write that re-queues a document during it sends the run
 * back to its converting walk.
 *
 * Every write is made by the writer the run is walked with (as the person the
 * run belongs to, or as the system for a run no one person owns), writes only
 * the blocks field, and carries the hash of the value it was computed from, so
 * a write that would overwrite somebody's edit is refused and the host is read
 * again (core's conditional write, judged under the write's own row lock).
 * Doubt never reads as "nothing to do": a host that cannot be read, read to
 * the end, or addressed is reported as left.
 *
 * @module host-rewrite/rewrite
 * @experimental
 */
import { NextlyError, storedValueHash } from "@nextlyhq/plugin-sdk";

import {
  documentKeyOf,
  type HostAddress,
  type HostForm,
  type HostStep,
  type LeftHost,
  type LeftReason,
  type RewriteReport,
  type StepOutcome,
} from "./contract";
import type { RunPhase } from "./fence";
import type { ProgressStore } from "./progress";
import { scannedOutcomes } from "./scan";

/** How a host's value can be reached. */
export type HostAccess =
  /** At a fixed top-level path: read, judged and written. */
  | "write"
  /** At a fixed path inside a named group: read and judged, never written. */
  | "read"
  /** Somewhere in the row, per repeater row: every blocks value found is judged. */
  | "scan";

/** One host of a document, and how it can be reached. */
export interface HostCandidate {
  readonly host: HostAddress;
  readonly access: HostAccess;
  /** For a `scan`: the paths whose values have hosts of their own. */
  readonly excluded?: readonly (readonly string[])[];
  /**
   * Read in this language only because whether the value is stored per
   * language is unknown: the same value read in two languages may be one
   * stored value. Absent where the value is known to be stored per language,
   * or where there is no language.
   */
  readonly maybeShared?: true;
}

/** One document and its hosts: every blocks field, in every language. */
export interface HostDocument {
  readonly key: string;
  readonly hosts: readonly HostCandidate[];
}

/** Where the hosts come from. */
export interface HostSource {
  /** Every document holding blocks, in a stable order, after `cursor`. */
  documents(cursor: string | null): AsyncIterable<HostDocument>;
  /** The cursor that resumes the walk after `document`. */
  cursorOf(document: HostDocument): string;
  /** Documents to visit first. A hint only: every one is in the walk too. */
  hinted(): Promise<readonly HostDocument[]>;
  /** Hosts outside every walk that hold the component (Layouts naming it). */
  outside(): Promise<readonly LeftHost[]>;
}

/** One stored form as read: a value, or nothing stored. */
export type ReadValue =
  | { readonly kind: "value"; readonly value: unknown }
  | { readonly kind: "absent" };

/** A host's stored forms. */
export interface HostRead {
  /** The live row's value. */
  readonly published: ReadValue;
  /** The pending working draft's value, or `null` when there is none. */
  readonly draft: ReadValue | null;
  /**
   * The public state the live row is in, as stored (`published`, or whatever
   * the collection's workflow calls a public state), or `null` when the row is
   * not public. Writing a public row means publishing it again in that state.
   */
  readonly liveState: string | null;
  /**
   * The row's version as this read gave it, which the write made from the
   * read sends back; absent from a server that issues none.
   */
  readonly rev?: string;
}

/** Reads one host's stored forms, as the system. Throws when it cannot. */
export type HostReader = (host: HostAddress) => Promise<HostRead>;

/** One write a rewrite makes. */
export interface HostWrite {
  readonly host: HostAddress;
  readonly value: unknown;
  /** `publish` puts the value live; `save` stores it as the form it was read from. */
  readonly mode: "save" | "publish";
  /** The public state a `publish` keeps the row in: the one it was read in. */
  readonly publishAs?: string;
  /** The form the value was computed from, and its hash. */
  readonly expected: { readonly form: HostForm; readonly hash: string };
  /**
   * The row's version as it was read: sent with the write, so a save of the
   * row since the read refuses the write, which the run reports as changed.
   */
  readonly rev?: string;
}

/** What a write came to. Anything unexpected is thrown. */
export type WriteResult =
  | { readonly kind: "written" }
  | { readonly kind: "changed" }
  | { readonly kind: "forbidden" }
  | { readonly kind: "refused"; readonly detail: string };

/** Makes one write as the person the run belongs to. */
export type HostWriter = (write: HostWrite) => Promise<WriteResult>;

/**
 * A run as the walk reads it: which walk it is on, and where its final walk
 * stopped. Every kind of run is walked by these alone, so a component's runs
 * and a breakpoint removal's share one walk.
 */
export interface WalkedRun {
  readonly id: string;
  readonly phase: RunPhase;
  /** Where the final walk stopped, or `null` before it started. */
  readonly cursor: string | null;
}

/**
 * The table a run is moved through, narrowed to what the walk asks of it: the
 * run read again by id, and a phase moved by compare-and-set (see
 * `FenceStore.advance` for the contract each store keeps).
 */
export interface RunStore {
  runById(runId: string): Promise<WalkedRun | null>;
  advance(
    runId: string,
    from: RunPhase,
    to: RunPhase,
    cursor: string | null
  ): Promise<boolean>;
}

/** Everything a run is walked with. */
export interface RewriteDeps {
  readonly fence: RunStore;
  readonly progress: Pick<
    ProgressStore,
    "record" | "settledAmong" | "reopenLeft"
  >;
  readonly source: HostSource;
  readonly read: HostReader;
  /**
   * Makes each write as the person the run belongs to. Whether they may update
   * (or publish) a host is decided by that write's own access gate, which has
   * the entry in hand; a refusal leaves the host as `not-permitted`.
   */
  readonly write: HostWriter;
}

/** What one call of {@link rewriteHosts} is asked to do. */
export interface RewriteArgs {
  /**
   * The run to walk, by its id: the run the caller has already checked it may
   * walk. Only that run is read again, for its current phase; a run opened in
   * its place since, under the same component, is a different id and is not
   * walked.
   */
  readonly runId: string;
  readonly step: HostStep;
  /** How many times one host is read again after a concurrent edit. */
  readonly maxAttempts?: number;
  /** How many documents this call may visit before it stops to resume later. */
  readonly maxDocuments?: number;
  /** When this call stops to resume later. */
  readonly deadline?: Date;
  /**
   * Judge every host and write nothing: the report says what a real run would
   * rewrite and leave. Progress and phase are untouched.
   */
  readonly dryRun?: boolean;
}

/** How many times a host changing under the rewrite is read again by default. */
const DEFAULT_ATTEMPTS = 3;

/** What processing one host came to. */
type HostResult =
  | { readonly kind: "rewritten" | "unchanged" }
  | {
      readonly kind: "left";
      readonly reason: LeftReason;
      readonly detail?: string;
    };

/** The report being built over one call. */
interface Tally {
  rewritten: HostAddress[];
  statuses: { host: HostAddress; status: string }[];
  unchanged: HostAddress[];
  left: LeftHost[];
  caught: HostAddress[];
  visited: number;
}

/** The context one call walks with. */
interface Walk {
  readonly deps: RewriteDeps;
  readonly args: RewriteArgs;
  readonly tally: Tally;
  readonly run: WalkedRun;
}

/**
 * Rewrite every host of a component with `step`, resuming the run where it
 * stopped. Call it again until the report says `finished`.
 *
 * @experimental
 */
export async function rewriteHosts(
  deps: RewriteDeps,
  args: RewriteArgs
): Promise<RewriteReport> {
  const run = await deps.fence.runById(args.runId);
  if (run === null) {
    throw NextlyError.notFound({
      logContext: { reason: "host-rewrite-no-run", runId: args.runId },
    });
  }
  const tally: Tally = {
    rewritten: [],
    statuses: [],
    unchanged: [],
    left: [],
    caught: [],
    visited: 0,
  };
  if (args.dryRun === true) {
    const dry: Walk = { deps, args, run, tally };
    return report(dry, await dryWalk(dry));
  }
  const resumed = run.phase === "done" ? await retryLeft(deps, run) : run;
  const walk: Walk = { deps, args, run: resumed ?? run, tally };
  if (resumed === null) return report(walk, true);
  if (walk.run.phase === "converting" && !(await convertingWalk(walk))) {
    return report(walk, false);
  }
  return report(walk, await finalWalk(walk));
}

/** The report a call answers with. */
function report(walk: Walk, finished: boolean): RewriteReport {
  return {
    rewritten: walk.tally.rewritten,
    unchanged: walk.tally.unchanged,
    left: walk.tally.left,
    caughtByFinalWalk: walk.tally.caught,
    statuses: walk.tally.statuses,
    finished,
  };
}

/** Whether this call's budget is spent. */
function spent(walk: Walk): boolean {
  const { maxDocuments, deadline } = walk.args;
  if (maxDocuments !== undefined && walk.tally.visited >= maxDocuments)
    return true;
  return deadline !== undefined && Date.now() >= deadline.getTime();
}

/** Every document once, written nowhere. Answers whether it reached the end. */
async function dryWalk(walk: Walk): Promise<boolean> {
  for await (const document of walk.deps.source.documents(null)) {
    await visit(walk, document, false);
  }
  walk.tally.left.push(...(await walk.deps.source.outside()));
  return true;
}

/** How many documents the converting walk asks the progress about at once. */
const PROGRESS_PAGE = 100;

/**
 * The converting walk: the hinted documents, then every document, each once,
 * skipping those recorded as finished. Answers whether it reached the end.
 *
 * Which ones are finished is asked of the progress table a page of documents
 * at a time, by their keys, so a step reads the rows of the documents it
 * passes rather than every row the run has recorded.
 */
async function convertingWalk(walk: Walk): Promise<boolean> {
  const { deps, run } = walk;
  const seen = new Set<string>();
  const visitPage = async (page: readonly HostDocument[]): Promise<boolean> => {
    if (page.length === 0) return true;
    const settled = await deps.progress.settledAmong(
      run.id,
      page.map(document => document.key)
    );
    for (const document of page) {
      if (seen.has(document.key) || settled.has(document.key)) continue;
      if (spent(walk)) return false;
      seen.add(document.key);
      await visit(walk, document, true);
    }
    return true;
  };
  const hinted = await deps.source.hinted();
  for (let at = 0; at < hinted.length; at += PROGRESS_PAGE) {
    if (!(await visitPage(hinted.slice(at, at + PROGRESS_PAGE)))) return false;
  }
  let page: HostDocument[] = [];
  for await (const document of deps.source.documents(null)) {
    page.push(document);
    if (page.length < PROGRESS_PAGE) continue;
    if (!(await visitPage(page))) return false;
    page = [];
  }
  if (!(await visitPage(page))) return false;
  // From the converting walk only: a write re-queueing a document meanwhile
  // leaves the phase as it is, which is what it would set.
  await deps.fence.advance(run.id, "converting", "final", null);
  return true;
}

/**
 * The final walk: every document again from where it stopped, trusting no
 * progress row. Answers whether it reached the end.
 */
async function finalWalk(walk: Walk): Promise<boolean> {
  const { deps, run } = walk;
  const cursor = run.phase === "final" ? run.cursor : null;
  for await (const document of deps.source.documents(cursor)) {
    if (spent(walk)) return false;
    const before = walk.tally.rewritten.length;
    await visit(walk, document, true);
    walk.tally.caught.push(...walk.tally.rewritten.slice(before));
    // Moved only while the run is still on its final walk. A write re-queueing
    // a document sent it back to converting, and this walk then stops: the
    // final walk starts again once the converting walk has read that document.
    const cursorAfter = deps.source.cursorOf(document);
    if (!(await deps.fence.advance(run.id, "final", "final", cursorAfter))) {
      return false;
    }
  }
  // Recorded BEFORE the run is marked done, so a later call, or a reader of
  // its progress, sees what still blocks it even when this call's own report
  // is lost.
  const outside = await deps.source.outside();
  for (const left of outside) {
    await deps.progress.record(
      run.id,
      documentKeyOf(left.host),
      "left",
      left.reason
    );
  }
  walk.tally.left.push(...outside);
  return deps.fence.advance(run.id, "final", "done", null);
}

/**
 * A finished run asked again. With nothing left, there is nothing to do, and
 * `null` says so. With documents it left, those may since have been resolved
 * (a draft published or discarded, a Layout edited), so each is marked pending
 * and the run goes back to its converting walk, which reads them again, and
 * then to a final walk over everything. Answers the run as it now stands.
 */
async function retryLeft(
  deps: RewriteDeps,
  run: WalkedRun
): Promise<WalkedRun | null> {
  if (!(await deps.progress.reopenLeft(run.id))) return null;
  return { ...run, phase: "converting", cursor: null };
}

/** One document: every host in it, then its recorded state. */
async function visit(
  walk: Walk,
  document: HostDocument,
  writes: boolean
): Promise<void> {
  walk.tally.visited += 1;
  let state: "rewritten" | "unchanged" | "left" = "unchanged";
  let reason: string | undefined;
  for (const candidate of document.hosts) {
    const result = await processHost(walk, candidate, writes);
    if (result.kind === "left") {
      walk.tally.left.push({
        host: candidate.host,
        reason: result.reason,
        ...(result.detail === undefined ? {} : { detail: result.detail }),
      });
      state = "left";
      reason ??= result.reason;
    } else if (result.kind === "rewritten") {
      walk.tally.rewritten.push(candidate.host);
      if (state === "unchanged") state = "rewritten";
    } else {
      walk.tally.unchanged.push(candidate.host);
    }
  }
  if (writes) {
    await walk.deps.progress.record(walk.run.id, document.key, state, reason);
  }
}

/** What one read of a host says to do. */
type Decision =
  | { readonly kind: "done"; readonly result: HostResult }
  | {
      readonly kind: "write";
      readonly write: HostWrite;
      /** Whether the live row is left holding what the step would change. */
      readonly liveLeft: boolean;
    };

/** One host, read and judged, written when it must be, retried on a race. */
async function processHost(
  walk: Walk,
  candidate: HostCandidate,
  writes: boolean
): Promise<HostResult> {
  const attempts = walk.args.maxAttempts ?? DEFAULT_ATTEMPTS;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const result = await attemptHost(walk, candidate, writes);
    if (result !== AGAIN) return result;
  }
  return { kind: "left", reason: "changed" };
}

/** What an attempt answers when the host changed under its write. */
const AGAIN = Symbol("read the host again");

/** One read, judgement and (when it must) write of a host. */
async function attemptHost(
  walk: Walk,
  candidate: HostCandidate,
  writes: boolean
): Promise<HostResult | typeof AGAIN> {
  let read: HostRead;
  try {
    read = await walk.deps.read(candidate.host);
  } catch (error) {
    return { kind: "left", reason: "unreadable", detail: messageOf(error) };
  }
  const decision = await decide(walk.args.step, candidate, read);
  if (decision.kind === "done") return decision.result;
  if (candidate.access !== "write") {
    return { kind: "left", reason: "unaddressable" };
  }
  if (decision.write.publishAs !== undefined) {
    walk.tally.statuses.push({
      host: candidate.host,
      status: decision.write.publishAs,
    });
  }
  if (!writes) return written(decision);
  return writtenBy(await walk.deps.write(decision.write), decision);
}

/** What a write's result comes to for its host. */
function writtenBy(
  result: WriteResult,
  decision: Extract<Decision, { kind: "write" }>
): HostResult | typeof AGAIN {
  if (result.kind === "changed") return AGAIN;
  if (result.kind === "forbidden") {
    return { kind: "left", reason: "not-permitted" };
  }
  if (result.kind === "refused") {
    return { kind: "left", reason: "write-refused", detail: result.detail };
  }
  return written(decision);
}

/** What a host that was (or in a dry run would be) written comes to. */
function written(decision: Extract<Decision, { kind: "write" }>): HostResult {
  return decision.liveLeft
    ? { kind: "left", reason: "pending-draft" }
    : { kind: "rewritten" };
}

/** What one read of a host says to do, by its forms and how it is reached. */
async function decide(
  step: HostStep,
  candidate: HostCandidate,
  read: HostRead
): Promise<Decision> {
  if (candidate.access === "scan") {
    return { kind: "done", result: await scannedHost(step, candidate, read) };
  }
  return read.draft === null
    ? decideLive(step, candidate, read)
    : decideWithDraft(step, candidate, read, read.draft);
}

/** A host with no pending draft: its one stored form, written where it lives. */
async function decideLive(
  step: HostStep,
  candidate: HostCandidate,
  read: HostRead
): Promise<Decision> {
  if (read.published.kind === "absent") {
    return { kind: "done", result: { kind: "unchanged" } };
  }
  const form: HostForm = read.liveState === null ? "draft" : "published";
  const outcome = await step(read.published.value, {
    host: candidate.host,
    form,
  });
  const settled = settledBy(outcome);
  if (settled !== undefined) return { kind: "done", result: settled };
  if (outcome.kind !== "rewritten")
    return { kind: "done", result: { kind: "unchanged" } };
  return {
    kind: "write",
    liveLeft: false,
    write: {
      host: candidate.host,
      value: outcome.value,
      ...(read.liveState === null
        ? { mode: "save" as const }
        : { mode: "publish" as const, publishAs: read.liveState }),
      // The stored value exactly as read, which the conditional write hashes
      // again under its row lock.
      expected: { form, hash: await storedValueHash(read.published) },
      ...(read.rev === undefined ? {} : { rev: read.rev }),
    },
  };
}

/**
 * A live row with a pending draft. The draft is rewritten; the live row cannot
 * be written without putting the draft live, so when it holds what the step
 * would change the host is left for its author to publish or discard.
 */
async function decideWithDraft(
  step: HostStep,
  candidate: HostCandidate,
  read: HostRead,
  draft: ReadValue
): Promise<Decision> {
  const live =
    read.published.kind === "value"
      ? await step(read.published.value, {
          host: candidate.host,
          form: "published",
        })
      : ({ kind: "unchanged" } as const);
  const liveSettled = settledBy(live);
  if (liveSettled !== undefined) return { kind: "done", result: liveSettled };
  const liveLeft = live.kind === "rewritten";
  if (draft.kind === "absent") {
    return {
      kind: "done",
      result: liveLeft
        ? { kind: "left", reason: "pending-draft" }
        : { kind: "unchanged" },
    };
  }
  const outcome = await step(draft.value, {
    host: candidate.host,
    form: "draft",
  });
  const settled = settledBy(outcome);
  if (settled !== undefined) return { kind: "done", result: settled };
  if (outcome.kind !== "rewritten") {
    return {
      kind: "done",
      result: liveLeft
        ? { kind: "left", reason: "pending-draft" }
        : { kind: "unchanged" },
    };
  }
  return {
    kind: "write",
    liveLeft,
    write: {
      host: candidate.host,
      value: outcome.value,
      mode: "save",
      expected: { form: "draft", hash: await storedValueHash(draft) },
      ...(read.rev === undefined ? {} : { rev: read.rev }),
    },
  };
}

/** The result a refusal settles a host with; `undefined` for any other outcome. */
function settledBy(outcome: StepOutcome): HostResult | undefined {
  return outcome.kind === "refuse"
    ? { kind: "left", reason: "refused", detail: outcome.reason }
    : undefined;
}

/** A host found by scanning its row: every blocks value in it, judged only. */
async function scannedHost(
  step: HostStep,
  candidate: HostCandidate,
  read: HostRead
): Promise<HostResult> {
  const forms: { form: HostForm; value: ReadValue }[] = [
    {
      form: read.liveState === null ? "draft" : "published",
      value: read.published,
    },
    ...(read.draft === null
      ? []
      : [{ form: "draft" as const, value: read.draft }]),
  ];
  for (const { form, value } of forms) {
    if (value.kind === "absent") continue;
    const found = await scannedOutcomes(
      step,
      value.value,
      { host: candidate.host, form },
      candidate.excluded
    );
    if (found !== "unchanged") return { kind: "left", reason: found };
  }
  return { kind: "unchanged" };
}

/** An error's message, for a report. */
function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
