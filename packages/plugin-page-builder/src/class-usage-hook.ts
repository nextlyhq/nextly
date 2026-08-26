/**
 * Wiring class-usage maintenance to every write.
 *
 * One registration on the wildcard, not one per collection. The set of
 * collections is not known when a plugin is wired — the Schema Builder creates
 * them at runtime, and a blocks field can be added to an existing one — so a
 * list captured at registration would silently stop covering the collections
 * that matter most. The wildcard is resolved when the hook executes, and the
 * filter is applied inside against the collection's LIVE configuration.
 *
 * ## Why every failure is swallowed
 *
 * Collection `after*` hooks run once the write has COMMITTED. A throw here is
 * reported to the caller as a failed save for a document that is already on
 * disk, so an author is told their work was lost when it was not. An index that
 * disagrees with a document is recoverable by a rebuild; that false error is
 * not recoverable at all.
 *
 * Nothing therefore escapes, including the failures that are this module's own
 * fault. They are handed to the logger, which is the only channel a hook has
 * that cannot fail the write.
 *
 * @module class-usage-hook
 */
import type { DocumentLimits } from "@nextlyhq/blocks-engine";
import type { HookContext } from "nextly";

import { blocksFieldsOf } from "./class-usage-blocks-fields";
import {
  classUsageDocumentReader,
  classUsageIndexStore,
  type ClassUsageDirectApi,
} from "./class-usage-runtime";
import { reconcileWrittenDocument } from "./class-usage-write";

/**
 * The phases maintenance runs on.
 *
 * `afterCreate` and `afterUpdate` only. A publish, a draft save and a restore
 * all arrive as one of those two, so the pair covers every path that changes a
 * document's blocks. Deletion is deliberately absent: removing a document's
 * rows is a different reconciliation — there is no document left to derive
 * from — and it is built separately rather than bolted here.
 */
const MAINTAINED_PHASES = ["afterCreate", "afterUpdate"] as const;

/**
 * A hook context, as core defines it.
 *
 * Imported rather than described. A hand-written record type accepted this
 * package's own fake and rejected the real `HookContext`, which carries no
 * index signature — the mismatch only surfaced when the registration was
 * finally wired to a real plugin context.
 */
type UnknownRecord = HookContext<unknown>;

/**
 * The plugin context this needs, named structurally.
 *
 * Only the three capabilities used are declared, rather than importing the full
 * plugin context: it keeps what this module can reach legible, and a later edit
 * reaching for a service it should not have shows up as a type error here
 * rather than passing unnoticed.
 */
export interface ClassUsagePluginContext {
  hooks: {
    on(
      type: string,
      collection: string,
      handler: (context: UnknownRecord) => unknown
    ): void;
  };
  services: {
    collections: {
      getCollection(name: string, context: unknown): Promise<unknown>;
    };
  };
  logger?: {
    error?: (message: string, meta?: Record<string, unknown>) => void;
  };
}

/** How a collection's draft split is resolved. Injected so tests need no registry. */
export interface DraftSplitResolver {
  (collection: unknown): Promise<{ eligible: boolean }>;
}

/**
 * Register maintenance for every collection.
 *
 * `limits` and `locales` are read through functions rather than captured, for
 * the same reason the collection is: a host can reconfigure either, and a value
 * captured here would keep deriving rows under bounds the renderer no longer
 * applies.
 */
export function registerClassUsageMaintenance(args: {
  ctx: ClassUsagePluginContext;
  /** The collection whose rows this maintains. */
  indexCollection: string;
  /** Resolves whether a collection keeps a working draft beside its published row. */
  draftSplit: DraftSplitResolver;
  /** The site's configured locales, read per call. */
  locales: () => readonly string[];
  /** The bounds rows are derived under, read per call. */
  limits: () => DocumentLimits;
}): void {
  const handler = (context: UnknownRecord) => maintain(args, context);
  for (const phase of MAINTAINED_PHASES) {
    args.ctx.hooks.on(phase, "*", handler);
  }
}

/**
 * One write's maintenance, with every failure captured.
 *
 * Returns nothing on every path. An `after*` hook's return value is ignored, so
 * answering anything would be a value nothing reads — and a caller tempted to
 * read one would be building on a result that is `undefined` whenever this
 * fails, which is exactly when they would want it.
 */
async function maintain(
  args: Parameters<typeof registerClassUsageMaintenance>[0],
  context: UnknownRecord
): Promise<void> {
  try {
    const work = await planMaintenance(args, context);
    if (work === null) return;
    const report = await reconcileWrittenDocument(work);
    reportFailures(args.ctx.logger, report);
  } catch (error) {
    // Including anything this module got wrong. The write has committed, so the
    // only alternative to swallowing is telling the author their save failed.
    args.ctx.logger?.error?.(
      "[page-builder] class-usage maintenance did not run for this write",
      { error }
    );
  }
}

/**
 * What this write needs reconciled, or null when it needs nothing.
 *
 * Separated from doing it so the decision to act is one readable sequence, and
 * so the order of the two expensive steps is visible: the blocks-field filter
 * runs BEFORE the draft-split question, which reaches the component registry.
 * Every untracked collection would otherwise pay for that read on every save.
 */
async function planMaintenance(
  args: Parameters<typeof registerClassUsageMaintenance>[0],
  context: UnknownRecord
): Promise<Parameters<typeof reconcileWrittenDocument>[0] | null> {
  const target = writeTargetOf(context, args.indexCollection);
  if (target === null) return null;

  const collection = (await args.ctx.services.collections.getCollection(
    target.slug,
    requestContextFor(context)
  )) as { fields?: unknown; localized?: unknown };

  if (blocksFieldsOf(collection).length === 0) return null;

  const split = await args.draftSplit(collection);

  return {
    store: classUsageIndexStore(target.nextly),
    read: classUsageDocumentReader(target.nextly),
    collection: {
      slug: target.slug,
      fields: collection.fields,
      localized: collection.localized,
      hasDrafts: split.eligible,
    },
    documentId: target.documentId,
    locales: args.locales(),
    limits: args.limits(),
  };
}

/**
 * The three things a write must supply before anything is read, or null.
 *
 * Grouped because they share an answer — there is nothing to maintain — and
 * because all three are cheap. Doing them together keeps the registry read
 * behind every one of them.
 */
function writeTargetOf(
  context: UnknownRecord,
  indexCollection: string
): { slug: string; nextly: ClassUsageDirectApi; documentId: string } | null {
  // A hook running inside a CALLER-OWNED transaction is handed that
  // transaction's executor, and it runs BEFORE the caller commits. Maintenance
  // reaches the database through the pooled Direct API, which cannot join that
  // transaction — so on a small pool it can stall waiting for the connection
  // the transaction is holding, and on a large one it reads a database that
  // does not yet contain the write it was called for.
  //
  // Deriving rows from that read would record the document's PREVIOUS classes,
  // or none at all for a create, and then report success. Skipping is the only
  // honest option available: there is no post-commit hook to defer to, and the
  // rebuild is what repairs a subject a write bypassed.
  if (context.executor !== undefined) return null;

  const slug = context.collection;
  if (typeof slug !== "string" || slug.length === 0) return null;
  // This plugin's own index table is written BY this hook. Reconciling it would
  // recurse: every row inserted is a create on that collection, which fires
  // this again.
  if (slug === indexCollection) return null;

  const nextly = directApiOf(context);
  const documentId = documentIdOf(context);
  if (nextly === null || documentId === null) return null;

  return { slug, nextly, documentId };
}

/** Say which subjects were left disagreeing with the document, and why. */
function reportFailures(
  logger: ClassUsagePluginContext["logger"],
  report: { failures: { subject: unknown; failure?: unknown }[] }
): void {
  for (const failure of report.failures) {
    logger?.error?.(
      "[page-builder] class-usage maintenance failed for a subject; " +
        "the index disagrees with the document until a rebuild runs",
      { subject: failure.subject, error: failure.failure }
    );
  }
}

/** The Direct API a hook was handed, or null when it was handed none. */
function directApiOf(context: UnknownRecord): ClassUsageDirectApi | null {
  const req = context.req;
  if (typeof req !== "object" || req === null) return null;
  const nextly = (req as { nextly?: unknown }).nextly;
  // Absent rather than broken: a hook can run on a path that supplies no Direct
  // API, and there is no maintenance to do without one.
  return typeof nextly === "object" && nextly !== null
    ? (nextly as ClassUsageDirectApi)
    : null;
}

/**
 * The written document's id, which is the `entityKey` of every row it owns.
 *
 * Read from the AFTER data, which is the record as saved. Without a usable id
 * there is no addressable subject, so the write is left unmaintained rather
 * than filed under a key nothing can reconcile.
 */
function documentIdOf(context: UnknownRecord): string | null {
  const data = context.data;
  if (typeof data !== "object" || data === null) return null;
  const id = (data as { id?: unknown }).id;
  return typeof id === "string" && id.length > 0 ? id : null;
}

/**
 * The request context forwarded to the config read.
 *
 * Carries the acting user so the read is made as the request that triggered it
 * rather than anonymously. Reading a collection's own configuration is not the
 * privileged part — the index writes are, and those are explicitly made as the
 * system inside the store.
 */
function requestContextFor(context: UnknownRecord): unknown {
  return { user: context.user };
}
