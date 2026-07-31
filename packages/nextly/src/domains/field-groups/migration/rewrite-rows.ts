/**
 * Applies a document rewrite to every row of a table, in bounded batches.
 *
 * Two of the columns this migration rewrites belong to ledgers — content history
 * and the event outbox — whose row counts grow with a site's activity rather
 * than with its schema. Reading one of those into memory and updating it in a
 * single transaction would make upgrade time and upgrade memory a function of
 * how long a site has been running, so the work is cut into batches that each
 * commit on their own.
 *
 * Rows are walked by primary key, taking the next batch after the last id seen.
 * That is a keyset walk rather than an offset one on purpose: `OFFSET` re-reads
 * and discards everything before it, which turns a full pass into quadratic work
 * exactly on the tables that made batching necessary.
 *
 * The ordering the walk depends on is not self-verifying — the adapter drops an
 * `orderBy` whose column it cannot resolve rather than refusing, and a primary
 * key's collation is the database's business, not this module's. So completeness
 * is not claimed from having walked the table. It is checked afterwards, by
 * rescanning for anything the walk did not reach, which is what
 * `findUnrewrittenRow` is for.
 *
 * @module domains/field-groups/migration/rewrite-rows
 */

import type {
  TransactionContext,
  WhereClause,
} from "@nextlyhq/adapter-drizzle/types";

import { NextlyError } from "../../../errors/nextly-error";
import type { MetaService } from "../../meta/services/meta-service";

import {
  clearBatchCursor,
  readBatchCursor,
  writeBatchCursor,
} from "./batch-cursor";
import type { MigrationSession } from "./session";

/**
 * Rows per batch.
 *
 * Smaller than a row-count batch would usually be, because every row carries a
 * whole JSON document: an entry snapshot or a delivery envelope, not a handful
 * of scalars. The bound that matters here is bytes held at once, and a few
 * hundred documents is a transaction a database will not notice and a buffer a
 * process will not feel.
 */
const BATCH_SIZE = 200;

/**
 * The property a row's primary key arrives under.
 *
 * Fixed rather than configurable, and that is the point: the adapter resolves an
 * `orderBy` against the ORM's property names and **silently drops** a clause it
 * cannot resolve, leaving an unordered walk that skips rows without saying so. A
 * parameter would be one more place to get that wrong. Every table this
 * migration rewrites names its primary key `id`, so there is nothing to vary.
 */
const ID_PROPERTY = "id";

/** A table whose stored documents this migration rewrites. */
export interface RowRewriteTarget {
  /** Table name, as the ORM declares it. */
  readonly table: string;
  /**
   * Property holding the document to rewrite.
   *
   * The ORM's property name, not the column's: reads and writes go through the
   * typed CRUD path so the driver's JSON encoding stays the ORM's problem, and
   * that path speaks property names.
   */
  readonly documentProperty: string;
}

/** How one stored document becomes its rewritten self. Must be idempotent. */
export type DocumentRewrite = (document: unknown) => unknown;

/** One row, reduced to the two things a rewrite needs. */
interface DocumentRow {
  id: string;
  document: unknown;
}

/**
 * Rewrite every row of `target`, resuming from wherever a previous run stopped.
 *
 * Safe to call again after a crash at any point: the rewrite is idempotent, rows
 * that no longer need it are left untouched, and a cursor that did not survive
 * only costs a second pass.
 */
export async function rewriteRowsInBatches(args: {
  session: MigrationSession;
  meta: MetaService;
  migrationId: string;
  stepId: string;
  target: RowRewriteTarget;
  rewrite: DocumentRewrite;
}): Promise<void> {
  const { session, meta, migrationId, stepId, target, rewrite } = args;

  let after = await readBatchCursor(meta, { migrationId, stepId });

  for (;;) {
    const from = after;
    // Read and written inside one transaction so no row is rewritten against a
    // value another writer replaced between the read and the write.
    const reached = await session.inTransaction(async ctx => {
      const rows = await readBatch(ctx, target, from);
      let last: string | null = null;
      for (const row of rows) {
        last = row.id;
        const rewritten = rewrite(row.document);
        // Rows already carrying the target vocabulary are skipped rather than
        // rewritten to themselves. That is what makes a resumed pass cheap, and
        // what keeps a second run from touching every row it has already done.
        if (!documentDiffers(row.document, rewritten)) continue;
        await ctx.update(
          target.table,
          { [target.documentProperty]: rewritten },
          whereRowId(row.id)
        );
      }
      return last;
    });

    if (reached === null) break;
    after = reached;
    // Recorded only now, with the batch committed. A cursor written inside the
    // transaction would be rolled back with it and stay honest, but one written
    // before the commit could outlive a batch that failed and step the next run
    // past rows nothing rewrote.
    await writeBatchCursor(meta, { migrationId, stepId, after: reached });
  }

  await clearBatchCursor(meta, { stepId });
}

/**
 * The id of the first row the rewrite would still change, or `undefined`.
 *
 * The postcondition check for a batched rewrite, and the reason the cursor is
 * allowed to be an optimisation: this walks the whole table regardless of where
 * any run stopped, so the worst a wrong cursor can do is fail the step rather
 * than pass one that skipped rows.
 *
 * Returns the offending id rather than a boolean so a refusal can name it.
 */
export async function findUnrewrittenRow(args: {
  session: MigrationSession;
  target: RowRewriteTarget;
  rewrite: DocumentRewrite;
}): Promise<string | undefined> {
  const { session, target, rewrite } = args;

  let after: string | null = null;
  for (;;) {
    const from = after;
    const outcome = await session.inTransaction(async ctx => {
      const rows = await readBatch(ctx, target, from);
      let last: string | null = null;
      for (const row of rows) {
        last = row.id;
        if (documentDiffers(row.document, rewrite(row.document))) {
          return { found: row.id, last };
        }
      }
      return { found: undefined, last };
    });

    if (outcome.found !== undefined) return outcome.found;
    if (outcome.last === null) return undefined;
    after = outcome.last;
  }
}

/** One page of rows, ordered by primary key, after `from`. */
async function readBatch(
  ctx: TransactionContext,
  target: RowRewriteTarget,
  from: string | null
): Promise<DocumentRow[]> {
  const rows = await ctx.select<Record<string, unknown>>(target.table, {
    columns: [ID_PROPERTY, target.documentProperty],
    ...(from === null
      ? {}
      : { where: { and: [{ column: ID_PROPERTY, op: ">", value: from }] } }),
    orderBy: [{ column: ID_PROPERTY, direction: "asc" }],
    limit: BATCH_SIZE,
  });
  return rows.map(row => toDocumentRow(row, target));
}

/**
 * Read a projected property, refusing when the row does not carry it.
 *
 * A projection naming a property the table does not have comes back without that
 * key, and a rewrite of `undefined` returns `undefined` unchanged — so the step
 * would write nothing, and the check that reads the same absent property would
 * agree it had nothing left to do. That is a rewrite reporting a success it
 * never attempted, so an absent property refuses here instead.
 *
 * Shared with the callers that rewrite bounded tables in one transaction, so
 * every read-modify-write in this migration fails the same way on a name that
 * does not resolve.
 */
export function requireProperty(
  row: Record<string, unknown>,
  args: { table: string; property: string }
): unknown {
  if (!(args.property in row)) {
    throw NextlyError.internal({
      logContext: {
        reason: "row rewrite target names a property the table does not have",
        table: args.table,
        property: args.property,
      },
    });
  }
  return row[args.property];
}

/**
 * A row's primary key, refusing anything a rewrite cannot address a row by.
 *
 * The keyset walk compares this value in the database and carries it in the
 * cursor, and every write-back names it, so an id that is not a non-empty string
 * is something this module cannot order, resume from, or target.
 */
export function requireRowId(
  row: Record<string, unknown>,
  table: string
): string {
  const id = row[ID_PROPERTY];
  if (typeof id !== "string" || id.length === 0) {
    throw NextlyError.internal({
      logContext: {
        reason: "row rewrite requires a non-empty string primary key",
        table,
      },
    });
  }
  return id;
}

/** Address one row by its primary key. */
export function whereRowId(id: string): WhereClause {
  return { and: [{ column: ID_PROPERTY, op: "=", value: id }] };
}

/** Narrow a projected row to the id and document a batched rewrite works on. */
function toDocumentRow(
  row: Record<string, unknown>,
  target: RowRewriteTarget
): DocumentRow {
  const document = requireProperty(row, {
    table: target.table,
    property: target.documentProperty,
  });
  return { id: requireRowId(row, target.table), document };
}

/**
 * Whether a rewrite changed anything.
 *
 * Compared as serialized JSON because the rewriters rebuild their structures
 * key by key in the order they read them, so a document they left alone
 * serializes identically to what went in. That makes this a change test rather
 * than a shape test, and it costs one pass over a document that is about to be
 * written anyway.
 *
 * Exported because a step's postcondition asks the same question its run does:
 * two implementations of "did this need rewriting" would eventually disagree,
 * and the disagreement would read as a step that ran and then failed itself.
 */
export function documentDiffers(before: unknown, after: unknown): boolean {
  return JSON.stringify(before) !== JSON.stringify(after);
}
