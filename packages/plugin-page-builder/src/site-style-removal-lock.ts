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
 * ## Read fresh, outside the transaction where there is an outside
 *
 * The stored documents are read through the Direct API, as the routes'
 * rescan reads them, not through the write's `db` or `readStored`. On
 * PostgreSQL and MySQL those would read on the write's own transaction, and a
 * Single's write reads at its transaction's isolation: under MySQL's default,
 * REPEATABLE READ, every read answers from the snapshot its first read took,
 * which is before this handler runs, so a page committed after that snapshot
 * and before the lock was taken would be missed. The lock's compare-and-set
 * refuses such a snapshot only when that page wrote the lock row. The Direct
 * API's reads run on pooled connections instead, since this flow's
 * transaction already holds its own (`TransactionFrame.connected`) and the
 * reads hand no executor (`DrizzleAdapter.select` falls back to
 * `getDrizzle()`, the pool's handle), each in a transaction of its own that
 * sees what had committed when it ran. On SQLite the same reads run on the one
 * connection, inside this write's transaction: a plain statement waits for no
 * turn there, only `transaction()` and sessions do, and `BEGIN IMMEDIATE` let
 * this write in only once every other writer had finished, so everything
 * committed is seen.
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
  type PluginContext,
} from "@nextlyhq/plugin-sdk";

import { holdCompositionGraph } from "./composition-graph-lock";
import { refuseStoredUses, type StoredUse } from "./shared-style-rescan";
import {
  SITE_STYLE_SLUG,
  droppedSharedStyles,
  droppedVariables,
} from "./site-style-storage";
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

/** What the removal is judged with. */
export interface SiteStyleRemovalLockSetup {
  /**
   * The identities of the variables the site's code supplies, read per
   * write: dropping a stored override of one resets it and removes nothing.
   */
  readonly suppliedVariables: () => ReadonlySet<string>;
  /** The ids of the shared styles the site's code supplies, likewise. */
  readonly suppliedClasses: () => ReadonlySet<string>;
  /**
   * Every stored document still naming any of the variables, read through
   * the Direct API by the walk the remove route's rescan makes.
   */
  readonly variableUses: (
    ids: readonly string[]
  ) => Promise<readonly StoredUse[]>;
  /** Every stored document still applying any of the shared styles, likewise. */
  readonly sharedStyleUses: (
    ids: readonly string[]
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
 * stored document still uses, read under the lock. A write dropping neither
 * takes no lock and reads nothing: what it drops is compared from the two
 * stored forms in hand.
 */
export async function refuseRemovalsInUse(
  write: Pick<
    InTransactionContext,
    "operation" | "data" | "originalData" | "db"
  >,
  setup: SiteStyleRemovalLockSetup,
  dialect: PluginContext["dialect"]
): Promise<void> {
  const data = write.data;
  if (write.operation !== "update" || data === undefined) return;
  const before = write.originalData;
  // A section the written document does not carry is one the write left.
  const variables = Object.hasOwn(data, "tokens")
    ? droppedVariables(
        before?.tokens,
        data.tokens,
        setup.suppliedVariables()
      ).map(variable => variable.id)
    : [];
  const classes = Object.hasOwn(data, "classes")
    ? droppedSharedStyles(
        before?.classes,
        data.classes,
        setup.suppliedClasses()
      )
    : [];
  if (variables.length === 0 && classes.length === 0) return;

  // The lock first, then the read: what the read sees is everything a page
  // write holding the lock before this one committed.
  await holdCompositionGraph(write.db, dialect);
  const found = await readWithinOrRefuse(
    async () => ({
      variables:
        variables.length > 0 ? await setup.variableUses(variables) : [],
      classes: classes.length > 0 ? await setup.sharedStyleUses(classes) : [],
    }),
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
