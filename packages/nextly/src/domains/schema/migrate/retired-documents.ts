/**
 * The deletion events of the documents a migration's drop takes with an entity's table: every
 * document a retired collection or Single held when its table was dropped ends its history with
 * exactly one `deleted` event, whether `migrate:create` wrote the drop or a person did, and however
 * the run stopped after it.
 *
 * Two steps, so a document is named once its table is gone. Before a migration file's first
 * statement the ids of every document in each entity main table the file drops are captured into
 * `nextly_meta` (`captureRetiredDocuments`): a head row naming the file and the entity, then the
 * ids in rows of at most `CHUNK` each, with how many `deleted` events each document had then.
 * Where the file runs in a transaction on PostgreSQL, the table is first locked as the drop locks
 * it, so a write by another instance either lands before the capture or waits for the drop and
 * fails; SQLite's one writer holds the same. MySQL commits at its first drop, and a file run
 * outside a transaction commits each statement, so there the capture is best effort: a document
 * another instance writes between the capture and the drop is not named (the documented limit).
 * Once the file's statements have run, a capture whose table still stands is forgotten
 * (`forgetCapturesOfStandingTables`): the drop took another table of that name.
 *
 * Then, once the file is recorded applied, every run records one `deleted` event for each captured
 * document whose deletions have not grown since the capture, and forgets the ids, one transaction
 * per row of ids (`recordRetiredDocumentEvents`). A run stopped part-way leaves the rest, and the
 * next run finishes it, with nothing pending; a document never gets a second event. A capture
 * whose file did not apply is forgotten where the entity's table still stands: nothing of it was
 * retired.
 *
 * @module domains/schema/migrate/retired-documents
 */
import { createHash } from "node:crypto";

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import type { SupportedDialect } from "@nextlyhq/adapter-drizzle/types";
import { and, eq, inArray, like, sql, type SQL } from "drizzle-orm";
import { z } from "zod";

import { loadedDialect } from "../../../database/dialect-tables";
import { contentEventsTables } from "../../../schemas/content-events";
import { recordWriteEvent } from "../../content-events/write-event";
import { SchemaEventsRepository } from "../events/schema-events-repository";
import {
  tablesCreatedBy,
  tablesDroppedBy as tablesTheListDrops,
} from "../ownership/drop-guard";
import { querySqlRows } from "../pipeline/classifier/count-helpers";
import { introspectTableNames } from "../pipeline/diff/introspect-live";
import { assertSchemaLockHeld } from "../pipeline/schema-lock";

import { readCoveredEntities } from "./entity-coverage";
import type { MigrationUnit } from "./migration-transaction";
import { tablesDroppedBy } from "./statement-targets";
import { reachStopPoint } from "./stop-points";

/** Every capture's `nextly_meta` keys start with this. */
const KEY_PREFIX = "retired_documents:";

/** The ids one stored row holds, so no row, read or transaction grows with the collection. */
export const CHUNK = 500;

/** The last part of a capture's head row's key. */
const HEAD = "head";

/** What a capture's head row holds: the file whose drop retires the entity, and the entity. */
const headSchema = z.object({
  file: z.string(),
  kind: z.enum(["collection", "single"]),
  slug: z.string(),
  /** The entity's main table, which the file drops. */
  table: z.string(),
});
type CaptureHead = z.infer<typeof headSchema>;

/** What a row of ids holds: each id, and the `deleted` events of those that had any then. */
const idsSchema = z.object({
  ids: z.array(z.string()),
  deletions: z.record(z.string(), z.number()),
});
type CapturedIds = z.infer<typeof idsSchema>;

/**
 * The tables a list of statements drops, lower-cased, as the drop guard reads them (a
 * schema-qualified name, a quoted one, a rename followed, `RESTRICT`); statement by statement in
 * the Builder's shape where the guard cannot read the list, which it then refuses on its own.
 */
export function tablesTheStatementsDrop(
  statements: readonly string[],
  dialect: SupportedDialect
): Set<string> {
  let names: readonly string[];
  try {
    names = tablesTheListDrops(statements, dialect);
  } catch {
    names = statements.flatMap(
      statement => tablesDroppedBy(statement, dialect) ?? []
    );
  }
  return new Set(names.map(name => name.toLowerCase()));
}

/**
 * The tables a list of statements leaves gone: those it drops (`tablesTheStatementsDrop`) and does
 * not create again under the same name. A table rebuilt in place (created under another name,
 * filled, dropped, the copy renamed back) is not among them: its documents live on.
 */
export function tablesTheStatementsRetire(
  statements: readonly string[],
  dialect: SupportedDialect
): Set<string> {
  const created = new Set(
    tablesCreatedBy(statements, dialect).map(name => name.toLowerCase())
  );
  return new Set(
    [...tablesTheStatementsDrop(statements, dialect)].filter(
      name => !created.has(name)
    )
  );
}

/**
 * Before `unit`'s first statement (`from` 0), on `db`: captures the documents of each collection
 * or Single whose main table `statements` drop. `locking` where `db` is the unit's transaction, on
 * PostgreSQL: the table is locked as the drop will lock it. Nothing for a later try, a
 * `migrate:down` unit, or a file that drops no entity's main table.
 */
export async function captureRetiredDocuments(
  db: unknown,
  dialect: SupportedDialect,
  unit: MigrationUnit,
  statements: readonly string[],
  from: number,
  locking: boolean
): Promise<void> {
  if (from > 0 || unit.direction === "down") return;
  const dropped = tablesTheStatementsRetire(statements, dialect);
  if (dropped.size === 0) return;
  const retiring = (await readCoveredEntities(db, dialect)).filter(
    entity =>
      entity.excluded !== true &&
      entity.kind !== "fieldGroup" &&
      dropped.has(entity.table.toLowerCase())
  );
  if (retiring.length === 0) return;
  // Only a table still there is read: a statement naming a missing table aborts the transaction on
  // PostgreSQL.
  const standing = await standingTables(
    db,
    dialect,
    retiring.map(entity => entity.table)
  );
  for (const entity of retiring) {
    if (!standing.has(entity.table.toLowerCase())) continue;
    const head: CaptureHead = {
      file: unit.source,
      kind: entity.kind as CaptureHead["kind"],
      slug: entity.slug,
      table: entity.table,
    };
    if (locking && dialect === "postgresql") {
      // The mode the drop takes, taken first: a write waits for the file's transaction, which
      // drops the table, so none lands unnamed, and no lock is upgraded behind a waiting writer.
      await runStatement(
        db,
        dialect,
        sql`LOCK TABLE ${sql.identifier(head.table)} IN ACCESS EXCLUSIVE MODE`
      );
    }
    await captureOne(db, dialect, head);
  }
}

/** Captures one entity's documents: any capture an earlier attempt left replaced, then its rows. */
async function captureOne(
  db: unknown,
  dialect: SupportedDialect,
  head: CaptureHead
): Promise<void> {
  const prefix = entityPrefix(head);
  await forgetPrefix(db, dialect, prefix);
  await store(db, dialect, `${prefix}${HEAD}`, head);
  let after: unknown;
  for (let n = 0; ; n += 1) {
    const page = await querySqlRows<{ id: unknown }>(
      db,
      dialect,
      sql`SELECT ${sql.identifier("id")} FROM ${sql.identifier(head.table)}${
        after === undefined
          ? sql``
          : sql` WHERE ${sql.identifier("id")} > ${after}`
      } ORDER BY ${sql.identifier("id")} LIMIT ${sql.raw(String(CHUNK))}`
    );
    if (page.length === 0) return;
    const ids = page.map(row => String(row.id));
    const captured: CapturedIds = {
      ids,
      deletions: Object.fromEntries(
        await deletionCounts(db, dialect, head, ids)
      ),
    };
    await store(db, dialect, `${prefix}${String(n)}`, captured);
    if (page.length < CHUNK) return;
    after = page[page.length - 1].id;
  }
}

/**
 * Once `unit`'s statements have run, on `db`, the unit's own transaction where it has one: the
 * captures it made whose table still stands are forgotten, since its drop took another table of
 * that name (one in another schema). Nothing for a file that drops no table.
 */
export async function forgetCapturesOfStandingTables(
  db: unknown,
  dialect: SupportedDialect,
  unit: MigrationUnit,
  statements: readonly string[]
): Promise<void> {
  if (unit.direction === "down") return;
  if (tablesTheStatementsDrop(statements, dialect).size === 0) return;
  if ((await standingTables(db, dialect, ["nextly_meta"])).size === 0) return;
  const heads = await readHeads(
    db,
    dialect,
    `${KEY_PREFIX}${hashOf(unit.source)}:`
  );
  if (heads.length === 0) return;
  const standing = await standingTables(
    db,
    dialect,
    heads.map(({ head }) => head.table)
  );
  for (const { head } of heads) {
    if (standing.has(head.table.toLowerCase())) {
      await forgetPrefix(db, dialect, entityPrefix(head));
    }
  }
}

/** What a run did with the captures it found. */
export interface RetiredDocumentEvents {
  /** Each entity whose documents' deletion events were recorded, as `<kind> <slug>`. */
  recorded: string[];
  /** Each capture left for a later run, as `<kind> <slug>`: its file is not recorded applied and its table is gone. */
  left: string[];
}

/**
 * Records the deletion events every capture still owes, one transaction per row of ids, under the
 * caller's schema lock, which each transaction asks for before its writes and before its commit.
 * Answers which entities' events went and which captures wait.
 */
export async function recordRetiredDocumentEvents(
  adapter: DrizzleAdapter
): Promise<RetiredDocumentEvents> {
  const dialect = adapter.getCapabilities().dialect;
  const db = adapter.getDrizzle();
  const result: RetiredDocumentEvents = { recorded: [], left: [] };
  if ((await standingTables(db, dialect, ["nextly_meta"])).size === 0) {
    return result;
  }
  for (const { head } of await readHeads(db, dialect, KEY_PREFIX)) {
    const name = `${head.kind} ${head.slug}`;
    const prefix = entityPrefix(head);
    const applied = await new SchemaEventsRepository(db, dialect).isFileApplied(
      head.file
    );
    if (!applied) {
      // The file did not apply: where the entity's table stands, nothing of it was retired, and a
      // run that applies the file captures again.
      if ((await standingTables(db, dialect, [head.table])).size > 0) {
        await forgetPrefix(db, dialect, prefix);
      } else {
        result.left.push(name);
      }
      continue;
    }
    for (const key of await idKeys(db, dialect, prefix)) {
      await adapter.transaction(async tx => {
        await assertSchemaLockHeld();
        const captured = await readIds(tx.getDrizzle(), dialect, key);
        if (captured !== undefined) {
          await recordDeletions(tx, adapter, dialect, head, captured);
        }
        await reachStopPoint(`${name}: recorded deletion events`);
        await forgetKey(tx.getDrizzle(), dialect, key);
        // The commit is what lands the events: refused, and undone, by a run that lost the lock.
        await assertSchemaLockHeld();
      });
    }
    await forgetKey(db, dialect, `${prefix}${HEAD}`);
    result.recorded.push(name);
  }
  return result;
}

/**
 * Records, on `tx`, the deletion event of each of `captured`'s documents whose `deleted` events
 * have not grown since the capture: one that grew was deleted meanwhile, its event recorded then.
 * Counted, not timed, so no two hosts' clocks are compared.
 */
async function recordDeletions(
  tx: Parameters<typeof recordWriteEvent>[0],
  adapter: DrizzleAdapter,
  dialect: SupportedDialect,
  head: CaptureHead,
  captured: CapturedIds
): Promise<void> {
  const now = await deletionCounts(
    tx.getDrizzle(),
    dialect,
    head,
    captured.ids
  );
  for (const id of captured.ids) {
    if ((now.get(id) ?? 0) > (captured.deletions[id] ?? 0)) continue;
    await recordWriteEvent(
      tx,
      { adapter },
      {
        subject: { kind: head.kind, slug: head.slug, id },
        kind: "deleted",
        actor: { type: "system" },
      }
    );
  }
}

/** How many `deleted` events each of `ids` has, for those that have any. */
async function deletionCounts(
  db: unknown,
  dialect: SupportedDialect,
  head: CaptureHead,
  ids: readonly string[]
): Promise<Map<string, number>> {
  const events = contentEventsTables(dialect).nextlyContentEvents;
  const rows = await querySqlRows<{ subject_id: unknown; deletions: unknown }>(
    db,
    dialect,
    sql`SELECT ${events.subjectId} AS ${sql.identifier("subject_id")}, COUNT(*) AS ${sql.identifier("deletions")} FROM ${events} WHERE ${and(
      eq(events.subjectKind, head.kind),
      eq(events.subjectSlug, head.slug),
      eq(events.kind, "deleted"),
      inArray(events.subjectId, [...ids])
    )} GROUP BY ${events.subjectId}`
  );
  return new Map(
    rows.map(row => [String(row.subject_id), Number(row.deletions)])
  );
}

/** The key every row of `head`'s capture starts with: the file's hash, then the entity's. */
function entityPrefix(head: CaptureHead): string {
  return `${KEY_PREFIX}${hashOf(head.file)}:${hashOf(`${head.kind}:${head.slug}`)}:`;
}

/** A short hash of `text`, so a key stays within what `nextly_meta` holds on MySQL. */
function hashOf(text: string): string {
  return createHash("sha256").update(text).digest("hex").slice(0, 32);
}

/** Every capture's head under `prefix`, with its key; a row that cannot be read as one is passed over. */
async function readHeads(
  db: unknown,
  dialect: SupportedDialect,
  prefix: string
): Promise<{ key: string; head: CaptureHead }[]> {
  const { nextlyMeta } = loadedDialect(dialect).tables;
  const rows = await (db as MetaDatabase)
    .select({ key: nextlyMeta.key, value: nextlyMeta.value })
    .from(nextlyMeta)
    .where(like(nextlyMeta.key, `${prefix}%:${HEAD}`));
  return rows.flatMap(row => {
    const head = parsed(headSchema, row.value);
    return head === undefined ? [] : [{ key: String(row.key), head }];
  });
}

/** The keys of the rows of ids under `prefix`. */
async function idKeys(
  db: unknown,
  dialect: SupportedDialect,
  prefix: string
): Promise<string[]> {
  const { nextlyMeta } = loadedDialect(dialect).tables;
  const rows = await (db as MetaDatabase)
    .select({ key: nextlyMeta.key })
    .from(nextlyMeta)
    .where(like(nextlyMeta.key, `${prefix}%`));
  return rows
    .map(row => String(row.key))
    .filter(key => !key.endsWith(`:${HEAD}`));
}

/** The row of ids under `key`, read on `db`; undefined when it is gone or cannot be read. */
async function readIds(
  db: unknown,
  dialect: SupportedDialect,
  key: string
): Promise<CapturedIds | undefined> {
  const { nextlyMeta } = loadedDialect(dialect).tables;
  const [row] = await (db as MetaDatabase)
    .select({ value: nextlyMeta.value })
    .from(nextlyMeta)
    .where(eq(nextlyMeta.key, key));
  return row === undefined ? undefined : parsed(idsSchema, row.value);
}

/** A stored value read back by `schema` (JSON text on SQLite, parsed on the others), or undefined. */
function parsed<T>(schema: z.ZodType<T>, value: unknown): T | undefined {
  let json: unknown = value;
  if (typeof value === "string") {
    try {
      json = JSON.parse(value);
    } catch {
      return undefined;
    }
  }
  const result = schema.safeParse(json);
  return result.success ? result.data : undefined;
}

/** Stores `value` under `key`, on `db`. */
async function store(
  db: unknown,
  dialect: SupportedDialect,
  key: string,
  value: unknown
): Promise<void> {
  const { nextlyMeta } = loadedDialect(dialect).tables;
  await (db as MetaDatabase).insert(nextlyMeta).values({
    key,
    value: JSON.stringify(value),
    updatedAt: new Date(),
  });
}

/** Forgets the row under `key`, on `db`. */
async function forgetKey(
  db: unknown,
  dialect: SupportedDialect,
  key: string
): Promise<void> {
  const { nextlyMeta } = loadedDialect(dialect).tables;
  await (db as MetaDatabase).delete(nextlyMeta).where(eq(nextlyMeta.key, key));
}

/** Forgets every row under `prefix`, on `db`. */
async function forgetPrefix(
  db: unknown,
  dialect: SupportedDialect,
  prefix: string
): Promise<void> {
  const { nextlyMeta } = loadedDialect(dialect).tables;
  await (db as MetaDatabase)
    .delete(nextlyMeta)
    .where(like(nextlyMeta.key, `${prefix}%`));
}

/** Which of `tables` are there, lower-cased. */
async function standingTables(
  db: unknown,
  dialect: SupportedDialect,
  tables: readonly string[]
): Promise<Set<string>> {
  const found = await introspectTableNames(db, dialect, [...tables]);
  return new Set(found.map(name => name.toLowerCase()));
}

/** Runs a statement that returns no rows, as each dialect's Drizzle handle runs one. */
function runStatement(
  db: unknown,
  dialect: SupportedDialect,
  statement: SQL
): Promise<unknown> {
  // SQLite's handle answers at once; the others answer with a promise.
  return Promise.resolve(
    dialect === "sqlite"
      ? (db as { run(q: SQL): unknown }).run(statement)
      : (db as { execute(q: SQL): Promise<unknown> }).execute(statement)
  );
}

/** The `nextly_meta` handle this module reads and writes through. */
interface MetaDatabase {
  select(fields: Record<string, unknown>): {
    from(table: unknown): {
      where(condition: SQL | undefined): PromiseLike<Record<string, unknown>[]>;
    };
  };
  insert(table: unknown): {
    values(values: Record<string, unknown>): PromiseLike<unknown>;
  };
  delete(table: unknown): { where(condition: SQL): PromiseLike<unknown> };
}
