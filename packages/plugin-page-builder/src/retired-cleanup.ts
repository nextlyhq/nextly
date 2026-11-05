/**
 * Removing a component's retired field values from every document that still
 * holds them.
 *
 * Every write already strips them (`retired-exposure-hooks`), and the resolver
 * never draws them, so what is left is in documents nobody has saved since the
 * removal went live: published pages and their working drafts, Singles, other
 * components and patterns, in every language. This walks every one of them
 * with the host rewrite (`host-rewrite`), under one `strip-retired` run per
 * component, and takes the values out with {@link stripRetiredStep}.
 *
 * ## Owed by what the retired table says
 *
 * A pass reads every component's retired ids and compares them with what that
 * component's run last walked the site for. A finished run is kept, and its
 * cursor, which no walk reads once a run is done, records a fingerprint of the
 * ids it walked for; a run still walking keeps the fingerprint it judges with
 * in a progress row of its own. A component with no run, or whose run walked
 * or is walking for other ids, is walked (again). So a retirement recorded by
 * any path, the publish's own record or a repair from history, is cleaned
 * without that path starting anything, and a pass that stops at its budget
 * resumes where the run stopped.
 *
 * ## As the system
 *
 * No person starts the run: it follows from a publish, after its commit, and
 * that publish's author may not be able to update every document placing the
 * component. Run as them, those documents would keep the values for ever. What
 * is taken out is never shown to anybody, and is exactly what anybody's own
 * save of the document takes out already, so every write is made as the
 * system.
 *
 * ## A write racing the walk
 *
 * The rewrite's compare-and-swap covers a save made between its read of a
 * document and its write. A save whose strip ran before the retirement was
 * recorded, but that commits after the walk has passed its document, would put
 * a value back unseen. So after every committed write, a document still
 * holding a component's retired values sends that component's run back to its
 * converting walk ({@link registerRetiredCleanupCheck}); the final walk that
 * follows reads every document again.
 *
 * ## What it leaves
 *
 * The documents the rewrite leaves are logged and tried again, at a growing
 * interval: a live row holding values under a pending working draft (the draft
 * is stripped, and publishing it puts that live), a value under a named group
 * or in a repeater (stripped at the document's next save), a document that
 * kept changing. Layouts are not hosts here: a Layout's areas name a component
 * and hold no placement values.
 *
 * @module retired-cleanup
 */
import {
  componentIdsIn,
  componentReferencesIn,
  isPlainRecord,
  stripRetiredExposures,
  type BlockDocument,
  type DocumentLimits,
  type RetiredByComponent,
  type RetiredExposures,
} from "@nextlyhq/blocks-engine";
import { and, eq } from "@nextlyhq/plugin-sdk/db";
import type { PluginDatabase } from "@nextlyhq/plugin-sdk/schema";

import { asDocument } from "./component-store-source";
import type {
  HostStep,
  RewriteReport,
  StoredForm,
} from "./host-rewrite/contract";
import {
  fenceStore,
  type DeletionRun,
  type RunPhase,
} from "./host-rewrite/fence";
import { progressStore } from "./host-rewrite/progress";
import { rewriteHosts } from "./host-rewrite/rewrite";
import type { RewriteInstall } from "./host-rewrite/service";
import {
  siteHostReader,
  siteHostSource,
  siteHostWriter,
  type RewriteSite,
} from "./host-rewrite/site";
import { storedHash } from "./host-rewrite/stored-hash";
import { withoutOwnRetired } from "./retired-exposure-hooks";
import { componentDeletionHosts, componentDeletions } from "./schema/tables";

/** Who a `strip-retired` run is recorded as started by: no person. */
const RETIRED_CLEANUP_STARTER = "system:retired-fields";

/** The name the cleanup is contributed under, as a plugin service. */
export const RETIRED_CLEANUP_SERVICE = "retiredFieldsCleanup";

/** What the step strips, and where the component's own definition is. */
export interface StripRetiredStepArgs {
  readonly componentId: string;
  readonly retired: RetiredExposures;
  readonly limits: DocumentLimits;
  /** Where component definitions are stored, so the component's own drops them too. */
  readonly store: { readonly collection: string; readonly field: string };
}

/** Said for a stored value that is not a blocks document. */
const UNREADABLE =
  "This content could not be read as blocks, so the values of the component's removed fields could not be taken out of it.";

/** Said for a document too large to read to the end. */
const TOO_LARGE =
  "This content is too large to read to the end, so the values of the component's removed fields could not all be taken out of it.";

/**
 * The step a `strip-retired` run walks with: the component's retired values
 * taken out of each placement of it, and, in the component's own definition,
 * out of its `exposed` list, its slots and its variants.
 *
 * Refuses a value it cannot read, or cannot read to the end: an `unchanged`
 * for it would end the run with values still in place. Idempotent, as the
 * contract asks: its own output holds nothing retired, so it answers
 * `unchanged` to it.
 */
export function stripRetiredStep(args: StripRetiredStepArgs): HostStep {
  const byComponent: RetiredByComponent = new Map([
    [args.componentId, args.retired],
  ]);
  return (stored, form) => {
    const document = asDocument(stored);
    if (document === null) return { kind: "refuse", reason: UNREADABLE };
    if (!componentReferencesIn(document, args.limits.maxNodes).complete) {
      return { kind: "refuse", reason: TOO_LARGE };
    }
    const placements = stripRetiredExposures(
      document,
      byComponent,
      args.limits
    );
    const self = isOwnDefinition(args, form)
      ? withoutOwnRetired(placements.document, args.retired)
      : { document: placements.document, removed: 0 };
    if (placements.removed + self.removed === 0) return { kind: "unchanged" };
    // In the encoding it was read in, so a value stored as text stays text.
    return {
      kind: "rewritten",
      value:
        typeof stored === "string"
          ? JSON.stringify(self.document)
          : self.document,
    };
  };
}

/** Whether a stored form is the component's own definition. */
function isOwnDefinition(
  args: StripRetiredStepArgs,
  form: StoredForm
): boolean {
  const { host } = form;
  return (
    host.kind === "collection" &&
    host.slug === args.store.collection &&
    host.id === args.componentId &&
    host.path.length === 1 &&
    host.path[0] === args.store.field
  );
}

/**
 * What a finished run keeps in its cursor: the fingerprint of the retired ids
 * it walked the site for, and, when it left documents, when they are next
 * tried and how many times they have been.
 */
interface Cleaned {
  readonly cleaned: string;
  readonly retryAt?: number;
  readonly retries?: number;
}

/** A done run's cursor, read strictly: anything else was never settled. */
function cleanedOf(cursor: string | null): Cleaned | null {
  if (cursor === null) return null;
  try {
    const parsed = JSON.parse(cursor) as Partial<Cleaned> | null;
    if (typeof parsed?.cleaned !== "string") return null;
    return {
      cleaned: parsed.cleaned,
      ...(typeof parsed.retryAt === "number"
        ? { retryAt: parsed.retryAt }
        : {}),
      ...(typeof parsed.retries === "number"
        ? { retries: parsed.retries }
        : {}),
    };
  } catch {
    return null;
  }
}

/** The fingerprint of a component's retired ids, whatever order they are read in. */
function fingerprintOf(retired: RetiredExposures): Promise<string> {
  return storedHash({
    properties: [...retired.properties].sort(),
    slots: [...retired.slots].sort(),
  });
}

/**
 * The progress key a run's own row is kept under: the fingerprint of the ids
 * the walk in progress judges with, in its `reason`. No document's key holds
 * the separator first, so it is never a host's.
 */
const WALKING_FOR = "\u001Fwalking-for";

/** The first retry of documents a run left, and the longest wait between two. */
const FIRST_RETRY_MS = 15 * 60 * 1000;
const LONGEST_RETRY_MS = 24 * 60 * 60 * 1000;

/** How long after its `retries`-th try a left document is tried again. */
function retryAfter(retries: number): number {
  return Math.min(FIRST_RETRY_MS * 2 ** retries, LONGEST_RETRY_MS);
}

/** Both conditions, as one. `and` is typed as possibly empty; two never are. */
function both(
  first: NonNullable<ReturnType<typeof and>>,
  second: NonNullable<ReturnType<typeof and>>
): NonNullable<ReturnType<typeof and>> {
  return and(first, second) ?? first;
}

/**
 * The two moves a `strip-retired` run makes that a `delete` run does not:
 * settling a finished run with what it walked for, and sending one back to its
 * converting walk.
 */
function cleanupRuns(
  db: Pick<PluginDatabase, "transaction" | "update" | "table" | "select">
) {
  return {
    /** The fingerprint the run's walk in progress judges with, if recorded. */
    walkingFor: async (runId: string): Promise<string | null> => {
      const h = db.table(componentDeletionHosts);
      const row = await db
        .select(componentDeletionHosts)
        .where(both(eq(h.deletionId, runId), eq(h.hostKey, WALKING_FOR)))
        .first();
      return row?.reason ?? null;
    },
    /** Back to the converting walk, from `from` only. Answers whether it moved. */
    restart: async (runId: string, from: RunPhase): Promise<boolean> => {
      const t = db.table(componentDeletions);
      // Every move changes the phase, so MySQL, which counts changed rows,
      // counts the row matched too.
      const moved = await db
        .update(componentDeletions, { phase: "converting", cursor: null })
        .where(both(eq(t.id, runId), eq(t.phase, from)));
      return moved > 0;
    },
    /**
     * Record what a done run walked for, and drop its progress when it left
     * nothing. Changes nothing when the run is no longer done: a committed
     * write sent it back to be walked again.
     */
    settle: (runId: string, cleaned: Cleaned, clear: boolean) =>
      db.transaction(async tx => {
        const t = tx.table(componentDeletions);
        const cursor = JSON.stringify(cleaned);
        await tx
          .update(componentDeletions, { cursor })
          .where(both(eq(t.id, runId), eq(t.phase, "done")));
        // Read back rather than counted: MySQL counts a cursor already held
        // as no row at all.
        const run = await tx
          .select(componentDeletions)
          .where(eq(t.id, runId))
          .first();
        if (run?.phase !== "done" || run.cursor !== cursor) return false;
        if (clear) {
          const h = tx.table(componentDeletionHosts);
          await tx
            .delete(componentDeletionHosts)
            .where(eq(h.deletionId, runId));
        }
        return true;
      }),
  };
}

/** One component's walk in a pass. */
export interface ComponentCleanup {
  readonly componentId: string;
  readonly report: RewriteReport;
}

/** What one pass did. */
export interface CleanupPass {
  /** The components walked in this pass, with what each walk did. */
  readonly walked: readonly ComponentCleanup[];
  /** Whether every component owed a walk was walked to the end. */
  readonly finished: boolean;
}

/** What one pass is allowed. */
export interface CleanupBudget {
  /** When the pass stops, to resume on the next. */
  readonly deadline?: Date;
  /** How many documents one component's walk may visit in this pass. */
  readonly maxDocuments?: number;
}

/**
 * The cleanup, as the plugin offers it.
 *
 * @experimental
 */
export interface RetiredCleanupService {
  /** Walk every component owed a walk, until done or the budget is spent. */
  advance(budget?: CleanupBudget): Promise<CleanupPass>;
  /**
   * A committed write still holds this component's retired values: send its
   * run back to its converting walk, so it reads every document again.
   */
  walkAgain(componentId: string): Promise<void>;
}

/** What the cleanup reads the site through. */
export interface RetiredCleanupDeps {
  /** The installed site, as the host rewrite reads it. */
  readonly install: () => RewriteInstall;
  /** Every component's retired ids. */
  readonly retired: () => Promise<RetiredByComponent>;
  readonly logger: {
    warn(message: string, meta?: Record<string, unknown>): void;
  };
  /** The live clock, injected so a test can move it. */
  readonly clock?: () => number;
}

/** The cleanup over the installed plugin, resolved per call. */
export function retiredCleanupService(
  deps: RetiredCleanupDeps
): RetiredCleanupService {
  const now = deps.clock ?? (() => Date.now());
  const stores = () => {
    const installed = deps.install();
    return {
      installed,
      fence: fenceStore(installed.db, installed.dialect),
      progress: progressStore(installed.db, installed.dialect),
      runs: cleanupRuns(installed.db),
    };
  };
  return {
    advance: async (budget = {}) => {
      const parts = stores();
      const retired = await deps.retired();
      const walked: ComponentCleanup[] = [];
      for (const componentId of [...retired.keys()].sort()) {
        if (
          budget.deadline !== undefined &&
          now() >= budget.deadline.getTime()
        ) {
          return { walked, finished: false };
        }
        const ids = retired.get(componentId);
        if (ids === undefined) continue;
        const report = await walkComponent(parts, deps, now, budget, {
          componentId,
          retired: ids,
        });
        if (report === null) continue;
        walked.push({ componentId, report });
        if (!report.finished) return { walked, finished: false };
      }
      return { walked, finished: true };
    },
    walkAgain: async componentId => {
      const { fence, runs } = stores();
      const run = await fence.runFor(componentId, "strip-retired");
      // No run yet: the next pass opens one, and walks every document. A run
      // on its converting walk reads every document in the final walk after.
      if (run === null || run.phase === "converting") return;
      // From both, in order, so a run that moved from its final walk to done
      // between the read and the first move is still sent back.
      await runs.restart(run.id, "final");
      await runs.restart(run.id, "done");
    },
  };
}

/** The stores one pass works through. */
type PassStores = {
  readonly installed: RewriteInstall;
  readonly fence: ReturnType<typeof fenceStore>;
  readonly progress: ReturnType<typeof progressStore>;
  readonly runs: ReturnType<typeof cleanupRuns>;
};

/**
 * One component's walk, or `null` when it is owed none: its run walked for
 * these very ids and has nothing to try again yet.
 */
async function walkComponent(
  parts: PassStores,
  deps: RetiredCleanupDeps,
  now: () => number,
  budget: CleanupBudget,
  owed: { readonly componentId: string; readonly retired: RetiredExposures }
): Promise<RewriteReport | null> {
  const fingerprint = await fingerprintOf(owed.retired);
  const due = await dueRun(parts, owed.componentId, fingerprint, now());
  if (due === null) return null;
  const { installed } = parts;
  const site: RewriteSite = {
    ...installed.site,
    componentId: owed.componentId,
    hints: () => installed.hints(owed.componentId),
    identity: () => Promise.resolve({ overrideAccess: true } as const),
  };
  const source = siteHostSource(site);
  const report = await rewriteHosts(
    {
      fence: parts.fence,
      progress: parts.progress,
      // No Layout holds a placement's values, so none is a host to leave.
      source: { ...source, outside: () => Promise.resolve([]) },
      read: siteHostReader(site),
      write: siteHostWriter(site),
    },
    {
      runId: due.run.id,
      step: stripRetiredStep({
        componentId: owed.componentId,
        retired: owed.retired,
        limits: installed.limits(),
        store: installed.store,
      }),
      ...(budget.deadline === undefined ? {} : { deadline: budget.deadline }),
      ...(budget.maxDocuments === undefined
        ? {}
        : { maxDocuments: budget.maxDocuments }),
    }
  );
  if (report.finished) {
    await settle(parts, deps, now, {
      componentId: owed.componentId,
      runId: due.run.id,
      fingerprint,
      retries: due.retries,
    });
  }
  return report;
}

/**
 * The run a component is owed a walk under, opened when it has none, and sent
 * back to its converting walk when it last walked for other ids; with how many
 * times its left documents have been tried. `null` when nothing is owed.
 */
async function dueRun(
  parts: PassStores,
  componentId: string,
  fingerprint: string,
  at: number
): Promise<{ readonly run: DeletionRun; readonly retries: number } | null> {
  const { fence, progress, runs } = parts;
  const walkFor = async (run: DeletionRun) => {
    await progress.record(run.id, WALKING_FOR, "unchanged", fingerprint);
    return { run, retries: 0 };
  };
  const run = await fence.runFor(componentId, "strip-retired");
  if (run === null) {
    const opened = await fence.open(
      componentId,
      "strip-retired",
      RETIRED_CLEANUP_STARTER
    );
    return walkFor(opened.run);
  }
  if (run.phase !== "done") {
    if ((await runs.walkingFor(run.id)) === fingerprint) {
      return { run, retries: 0 };
    }
    // Walking for other ids. A final walk part-judged with them starts again
    // after a converting walk; a converting walk is followed by a final one
    // that reads every document with these.
    await runs.restart(run.id, "final");
    const restarted = await fence.runById(run.id);
    return restarted === null ? null : walkFor(restarted);
  }
  const cleaned = cleanedOf(run.cursor);
  if (cleaned?.cleaned !== fingerprint) {
    // Walked for other ids, or finished without being settled: every
    // document is read again for these.
    await runs.restart(run.id, "done");
    const restarted = await fence.runById(run.id);
    return restarted === null ? null : walkFor(restarted);
  }
  if (cleaned.retryAt === undefined || at < cleaned.retryAt) return null;
  // A done run walked again reads the documents it left first.
  return { run, retries: cleaned.retries ?? 0 };
}

/** Settle a finished run, saying what it left. */
async function settle(
  parts: PassStores,
  deps: RetiredCleanupDeps,
  now: () => number,
  finished: {
    readonly componentId: string;
    readonly runId: string;
    readonly fingerprint: string;
    readonly retries: number;
  }
): Promise<void> {
  // From the run's own record rather than this call's report: a run walked
  // over several passes left documents in each.
  const left = (await parts.progress.all(finished.runId)).filter(
    row => row.state === "left" && row.documentKey !== WALKING_FOR
  );
  const cleaned: Cleaned =
    left.length === 0
      ? { cleaned: finished.fingerprint }
      : {
          cleaned: finished.fingerprint,
          retries: finished.retries + 1,
          retryAt: now() + retryAfter(finished.retries),
        };
  await parts.runs.settle(finished.runId, cleaned, left.length === 0);
  if (left.length === 0) return;
  deps.logger.warn(
    `[page-builder] ${String(left.length)} document(s) still hold values of ` +
      `fields component "${finished.componentId}" no longer has. They are ` +
      "never shown, are removed when each is next saved, and are tried again.",
    {
      componentId: finished.componentId,
      left: left.map(row => ({
        document: row.documentKey,
        reason: row.reason,
      })),
    }
  );
}

/** The plugin capabilities the check needs, named structurally. */
export interface RetiredCleanupCheckContext {
  hooks: {
    on(
      type: string,
      collection: string,
      handler: (context: unknown) => unknown
    ): void;
  };
  logger: { error(message: string, meta?: Record<string, unknown>): void };
}

/** What the check is wired with. */
export interface RetiredCleanupCheckArgs {
  readonly ctx: RetiredCleanupCheckContext;
  readonly retired: (
    componentIds: readonly string[]
  ) => Promise<RetiredByComponent>;
  readonly cleanup: () => Pick<RetiredCleanupService, "walkAgain">;
  readonly limits: () => DocumentLimits;
  /**
   * Where component definitions are stored: a write there is also judged for
   * the component's OWN retired ids, which its `exposed` list, slots and
   * variants may carry back.
   */
  readonly store: { readonly collection: string; readonly field: string };
}

/**
 * Register the check after every committed create and update: a document
 * still holding a component's retired values sends that component's run back
 * to be walked again.
 *
 * Not inside a caller's transaction, whose hooks run before it commits: the
 * stored value is not yet the one a later read sees, and the run's table is
 * not written from inside another transaction. Such a write's own strip ran
 * inside it.
 */
export function registerRetiredCleanupCheck(
  args: RetiredCleanupCheckArgs
): void {
  for (const phase of ["afterCreate", "afterUpdate"] as const) {
    args.ctx.hooks.on(phase, "*", context => checkWrite(args, context));
  }
}

/** The check itself. Never throws: the write has committed. */
async function checkWrite(
  args: RetiredCleanupCheckArgs,
  context: unknown
): Promise<void> {
  const fields = context as {
    collection?: unknown;
    data?: unknown;
    executor?: unknown;
  };
  if (fields.executor !== undefined || !isPlainRecord(fields.data)) return;
  // Asked of the values first, so a write carrying no document, which is most
  // of them, reads nothing.
  const documents = documentsIn(fields.data, 0);
  if (documents.length === 0) return;
  try {
    const limits = args.limits();
    const own = ownDefinitionOf(args, fields.collection, fields.data);
    const placed = new Set<string>(own === null ? [] : [own.componentId]);
    for (const document of documents) {
      for (const id of componentIdsIn(document.nodes, limits.maxNodes)) {
        placed.add(id);
      }
    }
    if (placed.size === 0) return;
    const retired = await args.retired([...placed]);
    for (const [componentId, ids] of retired) {
      const one: RetiredByComponent = new Map([[componentId, ids]]);
      const holds =
        documents.some(
          document => stripRetiredExposures(document, one, limits).removed > 0
        ) ||
        (own?.componentId === componentId &&
          withoutOwnRetired(own.document, ids).removed > 0);
      if (holds) await args.cleanup().walkAgain(componentId);
    }
  } catch (error) {
    args.ctx.logger.error(
      `[page-builder] a write to "${String(fields.collection)}" that may ` +
        "hold values of removed component fields was not checked; they are " +
        "never shown, and are removed when the document is next saved.",
      { collection: fields.collection, error }
    );
  }
}

/**
 * The written component definition and its id, for a write to the component
 * store; `null` for any other write.
 */
function ownDefinitionOf(
  args: Pick<RetiredCleanupCheckArgs, "store">,
  collection: unknown,
  data: Record<string, unknown>
): { readonly componentId: string; readonly document: BlockDocument } | null {
  if (collection !== args.store.collection) return null;
  const id = data.id;
  const document = asDocument(data[args.store.field]);
  if (document === null) return null;
  if (typeof id === "string" && id !== "") {
    return { componentId: id, document };
  }
  return typeof id === "number" ? { componentId: String(id), document } : null;
}

/** How deep a written row's groups are looked into, as the strip looks. */
const MAX_GROUP_DEPTH = 16;

/**
 * Every blocks document a written row holds: its values, decoded where they
 * are text, and those inside its groups. Only read, so no declaration is
 * needed to tell which fields they are.
 */
function documentsIn(
  value: Record<string, unknown>,
  depth: number
): BlockDocument[] {
  const found: BlockDocument[] = [];
  for (const inner of Object.values(value)) {
    const document = asDocument(inner);
    if (document !== null) {
      found.push(document);
    } else if (depth < MAX_GROUP_DEPTH && isPlainRecord(inner)) {
      found.push(...documentsIn(inner, depth + 1));
    }
  }
  return found;
}
