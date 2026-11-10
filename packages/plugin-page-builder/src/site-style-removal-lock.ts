/**
 * A write of the site style that removes a variable or a shared style takes
 * the composition graph lock inside its own transaction and reads the stored
 * documents once more under it, so a page cannot commit a first use of what
 * the write removes.
 *
 * A page write that ADDS a reference to a variable or a shared style the site
 * does not define is refused, but the field's validation judges it before the
 * page's transaction opens. Two writes made at once could each pass: the page
 * judged while the variable is still defined, the removal judged while no page
 * uses it yet. Both are judged again under the one lock: the page write against
 * the site's definitions read then (`composition-rejudge`), and the removal
 * here, against the stored documents read then. Whichever holds the lock first
 * commits before the other is judged:
 *
 * - The removal first. The page write waits at the lock, then reads the
 *   site's definitions after the removal committed, and is refused its first
 *   use of what is gone.
 * - The page first. The removal waits at the lock, then finds the page the
 *   page write committed, and is refused as in use; rolled back whole, it
 *   removes nothing.
 *
 * Every write of the Single that drops one is judged, whatever made it: the
 * remove routes, the Variables panel's whole-section save, an undo, an import
 * and its take-back. The routes' own checks before the write stay, as the
 * early refusal that names a document; this is the one made where nothing can
 * commit in between.
 *
 * ## A shared style's variables, inside the one Single
 *
 * A shared style naming a variable races its removal inside the Single
 * itself: a shared-style save adding a `$token` is judged before its
 * transaction (`site-style-storage`), against the variables as they then
 * stand. Both are writes of the one row, and every write of a Single locks
 * its row before it stores anything, so the second waits for the first to
 * commit; what each is judged against here is `data`, the document as this
 * write leaves it, built from the row its update stored. So no graph lock is
 * needed between the two, and none is taken for them:
 *
 * - A write whose shared styles ADD a variable the document as it leaves it
 *   does not define is refused, as the guard before the transaction refuses
 *   it (`undefinedSharedStyleVariables`), with the same code.
 * - A write dropping a variable a shared style in that document still names
 *   is refused as in use, as the remove route's check refuses it
 *   (`sharedStyleReasons`), before the lock is asked for.
 *
 * ## Read on the write's own transaction
 *
 * The stored documents are read on this write's transaction, by the same
 * walk the routes' rescan makes (`stored-documents-on-transaction`), so on a
 * pool of one connection the read takes none of its own while the write
 * holds the only one. Which collections and Singles hold a blocks field is
 * read from the registry on the same transaction.
 *
 * No read under the graph lock takes a row lock (`UNLOCKED_READ`). This
 * write holds the Single's row, from its UPDATE, before it asks for the graph
 * lock, as a page save holds its page's row before it does. A row-locking
 * read of a page under the graph lock would wait for that save's row while
 * the save waits for the graph lock, and the two would wait on each other
 * until the database refused one. So every read is a plain one, and what it
 * sees is this write's isolation. Per dialect:
 *
 * - PostgreSQL. The read is at READ COMMITTED, as the page writes are: each
 *   read sees the latest commit and waits on no row lock. A page write that
 *   held the graph lock before this one committed before it was granted, so
 *   its page is seen.
 * - MySQL. A Single's write keeps REPEATABLE READ, so the reads answer from
 *   the transaction's snapshot. A page write that committed after that
 *   snapshot changed a blocks value, so it took the graph lock and wrote the
 *   lock row, and the lock's compare-and-set refuses this write before it
 *   reads (`holdCompositionGraph`): refused as {@link DESIGN_CHANGED}, with
 *   the cause the remove routes read the Single again and retry on
 *   (`isGraphSnapshotRefusal`), and the retry finds the page.
 * - SQLite. One connection, on which every read runs inside this write's
 *   open transaction, which `BEGIN IMMEDIATE` let in only once every other
 *   writer had finished: everything committed is seen.
 *
 * ## How long the lock is held
 *
 * The lock is a row lock taken by an UPDATE (or the INSERT of a missing row)
 * on PostgreSQL and MySQL, held until the transaction commits or rolls back;
 * on SQLite the transaction's own `BEGIN IMMEDIATE` holds every other writer
 * off for as long. No session-level lock is taken, so a rolled-back write
 * leaves nothing held. The read walks every stored document while every page
 * write waits at the lock, so it is bounded ({@link REMOVAL_RESCAN_MS}): a
 * read that fails or does not answer in time refuses the removal, which then
 * removes nothing, and never holds the lock open.
 *
 * @module site-style-removal-lock
 */
import {
  NextlyError,
  type InTransactionContext,
  type PluginCollectionTransaction,
  type PluginContext,
} from "@nextlyhq/plugin-sdk";

import {
  GRAPH_SNAPSHOT_RACED,
  holdCompositionGraph,
  isGraphSnapshotRefusal,
} from "./composition-graph-lock";
import {
  refuseStoredUses,
  stoppedBy,
  type StoredDocuments,
  type StoredUse,
} from "./shared-style-rescan";
import { removalRefusalOf } from "./shared-styles-routes";
import type { SiteStyleData } from "./site-style";
import {
  SITE_STYLE_SLUG,
  droppedSharedStyles,
  droppedVariables,
  sharedStylesOverCode,
  undefinedSharedStyleVariables,
  undefinedSharedStyleVariablesRefusal,
  variableGuardsJudge,
  type NamedVariable,
} from "./site-style-storage";
import { sharedStyleReasons } from "./variables-routes";
import { readWithinOrRefuse, type UnreadReason } from "./within-time";

/**
 * How long the removal's read of the stored documents may take under the lock
 * before the removal is refused. Longer than a page write's read of the
 * site's definitions, since this one walks every document the builder opens.
 */
export const REMOVAL_RESCAN_MS = 30_000;

/**
 * What a removal is told when the stored documents could not be read under
 * the lock: refused, to try again, with nothing removed.
 */
export const DESIGN_CHANGED = "The design changed while removing. Try again.";

/** The write the removal is judged on, as the in-transaction phase hands it. */
export type SiteStyleWrite = Pick<
  InTransactionContext,
  | "operation"
  | "data"
  | "originalData"
  | "db"
  | "transaction"
  | "readStored"
  | "user"
  | "context"
>;

/** What the removal is judged with. */
export interface SiteStyleRemovalLockSetup {
  /**
   * The identities of the variables the site's code supplies, read per
   * write: dropping a stored override of one resets it and removes nothing.
   */
  readonly suppliedVariables: () => ReadonlySet<string>;
  /** The ids of the shared styles the site's code supplies, likewise. */
  readonly suppliedClasses: () => ReadonlySet<string>;
  /** The code's site style, which the stored sections resolve over. */
  readonly defaults: () => SiteStyleData | undefined;
  /**
   * The Single's document as stored, read on the write's transaction: the
   * section a written document does not carry is the stored one.
   */
  readonly siteStyleOn: (
    transaction: PluginCollectionTransaction
  ) => Promise<unknown>;
  /** The stored documents, read on the write's own transaction. */
  readonly documentsOn: (write: SiteStyleWrite) => StoredDocuments;
  /**
   * Every stored document in `documents` still naming any of the variables,
   * by the walk the remove route's rescan makes.
   */
  readonly variableUses: (
    ids: readonly string[],
    documents: StoredDocuments
  ) => Promise<readonly StoredUse[]>;
  /** Every stored document still applying any of the shared styles, likewise. */
  readonly sharedStyleUses: (
    ids: readonly string[],
    documents: StoredDocuments
  ) => Promise<readonly StoredUse[]>;
}

/**
 * Judge every write of the site style that drops a variable or a shared style
 * under the composition graph lock. The Single is named as the host renamed
 * it, the way the in-transaction phase names a Single's write.
 */
export function registerSiteStyleRemovalLock(
  ctx: Pick<PluginContext, "hooks" | "dialect" | "self">,
  setup: SiteStyleRemovalLockSetup
): void {
  const slug = ctx.self.singles[SITE_STYLE_SLUG] ?? SITE_STYLE_SLUG;
  ctx.hooks.onInTransaction(`single:${slug}`, write =>
    refuseRemovalsInUse(write, setup, ctx.dialect)
  );
}

/**
 * Refuse a write of the site style that drops a variable or a shared style a
 * stored document still uses, read under the lock, or whose shared styles
 * add or keep a variable the document as it leaves it does not define. A
 * write dropping neither takes no lock and reads no document: what it drops
 * is compared from the two stored forms in hand.
 */
export async function refuseRemovalsInUse(
  write: SiteStyleWrite,
  setup: SiteStyleRemovalLockSetup,
  dialect: PluginContext["dialect"]
): Promise<void> {
  const data = write.data;
  if (write.operation !== "update" || data === undefined) return;
  const before = write.originalData;
  const section = sectionAfter(write, setup);
  await refuseUndefinedSharedStyleVariables(write, setup, section);
  // A section the written document does not carry is one the write left.
  const dropped = Object.hasOwn(data, "tokens")
    ? droppedVariables(before?.tokens, data.tokens, setup.suppliedVariables())
    : [];
  const variables = dropped.map(variable => variable.id);
  const classes = Object.hasOwn(data, "classes")
    ? droppedSharedStyles(
        before?.classes,
        data.classes,
        setup.suppliedClasses()
      )
    : [];
  if (variables.length === 0 && classes.length === 0) return;
  // Judged from the Single as this write leaves it, before the lock: no
  // other document is asked, and no page can change it.
  await refuseVariablesSharedStylesName(dropped, setup, section);

  // The lock first, then the read: what the read sees is everything a page
  // write holding the lock before this one committed.
  try {
    await holdCompositionGraph(write.db, dialect);
  } catch (error) {
    // A page write took the lock and committed after this write's
    // transaction first read (a Single's write keeps MySQL's REPEATABLE
    // READ): said in the removal's own words rather than the lock's, which
    // speak of components. The cause stays, so the remove routes read the
    // Single again and try once more, as for a replaced version, and the
    // retry finds the page and refuses as in use.
    if (!isGraphSnapshotRefusal(error)) throw error;
    throw NextlyError.conflict({
      reason: "state",
      message: DESIGN_CHANGED,
      ...(error instanceof Error ? { cause: error } : {}),
      logContext: { cause: GRAPH_SNAPSHOT_RACED },
    });
  }
  const found = await readWithinOrRefuse(
    async signal => {
      // Each walk stops reading once its time has run out.
      const documents = stoppedBy(setup.documentsOn(write), signal);
      return {
        variables:
          variables.length > 0
            ? await setup.variableUses(variables, documents)
            : [],
        classes:
          classes.length > 0
            ? await setup.sharedStyleUses(classes, documents)
            : [],
      };
    },
    REMOVAL_RESCAN_MS,
    designChanged
  );
  // The routes' own in-use refusal, naming no document: the write's author
  // is not a caller this can ask what they may open.
  if (variables.length > 0) {
    await refuseStoredUses(
      variables,
      { uses: () => Promise.resolve(found.variables) },
      "variableIds"
    );
  }
  if (classes.length > 0) {
    await refuseStoredUses(
      classes,
      { uses: () => Promise.resolve(found.classes) },
      "classIds"
    );
  }
}

/** One section of the Single as this write leaves it. */
type SectionAfter = (name: "tokens" | "classes") => Promise<unknown>;

/**
 * The Single's sections as this write leaves them: the written document's,
 * which the in-transaction phase builds from the row the update stored, so
 * it holds what a write committed before this one got the Single's row lock.
 * A section the document does not carry is the stored one, read on the
 * transaction, once, and only when asked.
 */
function sectionAfter(
  write: SiteStyleWrite,
  setup: SiteStyleRemovalLockSetup
): SectionAfter {
  let stored: Promise<unknown> | undefined;
  return async name => {
    const data = write.data;
    if (data !== undefined && Object.hasOwn(data, name)) return data[name];
    stored ??= setup.siteStyleOn(write.transaction);
    const doc = await stored;
    return typeof doc === "object" && doc !== null
      ? (doc as Record<string, unknown>)[name]
      : undefined;
  };
}

/**
 * Refuse a write whose shared styles ADD a variable the Single, as this write
 * leaves it, does not define: the guard before the transaction's judgement
 * (`sharedStyleVariableGuard`), made again on what the write stored, after
 * any write it waited for at the Single's row lock committed. A reference the
 * shared styles held before this write is kept, as there.
 *
 * Judged for the writes that guard judges and no others: a write made as
 * nobody (server code, an import's take-back) is trusted to say what the site
 * is, as is the variables remove route's own. This phase is not told a
 * write's principal, so a plugin principal's write with no user counts as
 * one made as nobody here; the guard before the transaction still judged it.
 */
async function refuseUndefinedSharedStyleVariables(
  write: SiteStyleWrite,
  setup: SiteStyleRemovalLockSetup,
  section: SectionAfter
): Promise<void> {
  if (!variableGuardsJudge({ user: write.user, context: write.context })) {
    return;
  }
  const added = undefinedSharedStyleVariables(setup.defaults(), {
    classes: await section("classes"),
    held: write.originalData?.classes,
    tokens: await section("tokens"),
  });
  if (added.length > 0) throw undefinedSharedStyleVariablesRefusal(added);
}

/**
 * Refuse dropping a variable a shared style still names, in the site's
 * shared styles as this write leaves them (the code's and the stored ones,
 * merged): the remove route's own reasons and in-use refusal, filed on the
 * tokens section as the Single's guard files them. Every write is judged, as
 * every removal under the lock is.
 */
async function refuseVariablesSharedStylesName(
  dropped: readonly NamedVariable[],
  setup: SiteStyleRemovalLockSetup,
  section: SectionAfter
): Promise<void> {
  if (dropped.length === 0) return;
  const reasons = sharedStyleReasons(
    dropped,
    sharedStylesOverCode(setup.defaults(), await section("classes"))
  );
  if (reasons.length === 0) return;
  throw removalRefusalOf(
    reasons,
    { variableIds: dropped.map(variable => variable.id) },
    () => "tokens"
  );
}

/**
 * The retryable refusal of a removal whose stored documents could not be read
 * under the lock, in time or at all: never taken for a read finding nothing.
 */
function designChanged(why: UnreadReason, error?: unknown): NextlyError {
  return NextlyError.conflict({
    reason: "state",
    message: DESIGN_CHANGED,
    ...(error instanceof Error ? { cause: error } : {}),
    logContext: { cause: `removal-rescan-${why}` },
  });
}
