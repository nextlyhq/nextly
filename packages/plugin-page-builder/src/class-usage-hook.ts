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
 * ## How a failure is reported
 *
 * By RAISING it, which is the supported way. `after*` is a side-effect phase,
 * and the hook registry already knows what that means: it catches the throw,
 * keeps the committed write, logs, runs the remaining handlers, and records a
 * warning the REST and Direct API responses carry back to the caller
 * (`hook-registry.ts:794`, `side-effect-warnings.ts`).
 *
 * So the caller learns the safety index is stale and can act on it. Swallowing
 * the failure here would bypass all of that: the operation would report plain
 * success, and a stale index is precisely the state in which a class a page
 * still renders reads as unused and can be deleted.
 *
 * The reason a throw is safe is the reason this only runs on the post-commit
 * path at all — see the transaction guard below. On the transactional path the
 * hook runs BEFORE the caller commits, where a throw would mean something else
 * entirely, and maintenance does not run there.
 *
 * @module class-usage-hook
 */
import type { DocumentLimits } from "@nextlyhq/blocks-engine";
import type { HookContext } from "nextly";

import { blocksFieldsOf } from "./class-usage-blocks-fields";
import { forgetDeletedDocument } from "./class-usage-maintenance";
import {
  classUsageDocumentReader,
  classUsageIndexStore,
  type ClassUsageDirectApi,
} from "./class-usage-runtime";
import { reconcileWrittenDocument } from "./class-usage-write";
import { requestContextFor, writeTargetOf } from "./write-target";

/**
 * The phases maintenance runs on.
 *
 * `afterCreate` and `afterUpdate` only. A publish, a draft save and a restore
 * all arrive as one of those two, so the pair covers every path that changes a
 * document's blocks. Deletion is not one of them: there is no document left to
 * derive rows from, so it is not a reconciliation at all and runs its own
 * handler below.
 */
const MAINTAINED_PHASES = ["afterCreate", "afterUpdate"] as const;

/**
 * The phases that FORGET a document.
 *
 * Separate from maintenance because the two share nothing but their guards.
 * Reconciliation reads a document and computes a difference; this one has no
 * document to read and removes everything the id owned.
 */
const FORGOTTEN_PHASES = ["afterDelete"] as const;

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

  const forgetHandler = (context: UnknownRecord) => forget(args, context);
  for (const phase of FORGOTTEN_PHASES) {
    args.ctx.hooks.on(phase, "*", forgetHandler);
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
  const work = await planMaintenance(args, context);
  if (work === null) return;

  const report = await reconcileWrittenDocument(work);
  if (report.failures.length === 0) return;

  // Every subject is attempted before this raises. Reconciliation is
  // per-subject and idempotent, so stopping at the first failure would leave
  // the later subjects stale as well as the failed one — turning one
  // recoverable disagreement into several for no gain.
  reportFailures(args.ctx.logger, report);
  throw new Error(
    `[page-builder] class-usage maintenance failed for ` +
      `${report.failures.length} of ${report.subjects} subject(s) on ` +
      `"${work.collection.slug}" ${work.documentId}. The index disagrees with ` +
      `the document until a rebuild runs.`
  );
}

/**
 * Drop the rows of a document that has just been deleted.
 *
 * Shares every guard a write goes through — `writeTargetOf` answers the
 * transaction, the Single namespace, this plugin's own index and the missing
 * Direct API identically here, and a delete is exactly as unable to run on a
 * pre-commit transactional path as a save is.
 *
 * It does NOT consult the collection's configuration, and that is deliberate
 * rather than an omission. Maintenance asks which blocks fields a collection
 * has because it must derive rows for each; this has nothing to derive and
 * removes by id. Asking anyway would be worse than wasteful: a blocks field
 * REMOVED from a collection after its rows were written would make the
 * collection look untracked, and every row that field ever owned would survive
 * the delete with no document left to reconcile it against and no sweep that
 * visits it. The class it referenced would then be undeletable for ever.
 *
 * Skipping the read also means an untracked collection pays one indexed query
 * per delete instead of a registry read, which is the cheaper of the two.
 */
async function forget(
  args: Parameters<typeof registerClassUsageMaintenance>[0],
  context: UnknownRecord
): Promise<void> {
  const target = writeTargetOf<ClassUsageDirectApi>(context, {
    excluded: [args.indexCollection],
  });
  if (target === null) return;

  try {
    await forgetDeletedDocument({
      store: classUsageIndexStore(target.nextly, args.indexCollection),
      scope: "collection",
      entity: target.slug,
      entityKey: target.documentId,
    });
  } catch (failure) {
    // Raised for the same reason maintenance raises: `after*` is a side-effect
    // phase whose throw the registry converts into a warning the caller
    // receives, and the delete itself is already committed. Swallowing would
    // report a clean deletion while the document's rows stay behind, counting
    // towards classes nothing renders — and those rows name a document that no
    // longer exists, so no later write reconciles them.
    args.ctx.logger?.error?.(
      "[page-builder] class-usage rows survived a deleted document; " +
        "they count towards their classes until a rebuild runs",
      { collection: target.slug, documentId: target.documentId, error: failure }
    );
    throw new Error(
      `[page-builder] class-usage could not forget "${target.slug}" ` +
        `${target.documentId}. Its rows still count towards their classes ` +
        `until a rebuild runs.`,
      { cause: failure }
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
  const target = writeTargetOf<ClassUsageDirectApi>(context, {
    excluded: [args.indexCollection],
  });
  if (target === null) return null;

  const collection = (await args.ctx.services.collections.getCollection(
    target.slug,
    requestContextFor(context)
  )) as { fields?: unknown; localized?: unknown };

  if (blocksFieldsOf(collection).length === 0) return null;

  const split = await args.draftSplit(collection);

  return {
    store: classUsageIndexStore(target.nextly, args.indexCollection),
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
