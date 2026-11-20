/**
 * The deletion events of the documents a migration's drop takes with an entity's table: every
 * document a retired collection or Single held when its table was dropped ends its history with
 * exactly one `deleted` event, whether `migrate:create` wrote the drop or a person did, and however
 * the run stopped after it.
 *
 * Two steps, so a document is named once its table is gone. Before a migration file's first
 * statement, in its own transaction, the ids of every document in each entity main table the file
 * drops are captured into `nextly_meta`, one row per file and entity, with when they were captured
 * (`captureRetiredDocuments`). On PostgreSQL the table is locked first, so a write by another
 * instance either lands before the capture or waits for the drop and fails; SQLite's one writer
 * holds the same. MySQL commits at its first drop, so there the capture is best effort: a
 * document another instance writes between the capture and the drop is not named (the documented
 * limit of the dialect). The capture commits or rolls back with the file's drops.
 *
 * Then, once the file is recorded applied, every run records one `deleted` event for each captured
 * document that has none since the capture, and forgets the capture, in one transaction per entity
 * (`recordRetiredDocumentEvents`). A run stopped part-way leaves the capture, and the next run
 * finishes it, with nothing pending; a document never gets a second event. A capture whose file did
 * not apply is forgotten where the entity's table still stands: nothing of it was retired.
 *
 * @module domains/schema/migrate/retired-documents
 */
import { createHash } from "node:crypto";

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import type { SupportedDialect } from "@nextlyhq/adapter-drizzle/types";
import { and, eq, gte, like, sql, type SQL } from "drizzle-orm";

import { loadedDialect } from "../../../database/dialect-tables";
import { contentEventsTables } from "../../../schemas/content-events";
import { recordWriteEvent } from "../../content-events/write-event";
import { SchemaEventsRepository } from "../events/schema-events-repository";
import { querySqlRows } from "../pipeline/classifier/count-helpers";
import { introspectTableNames } from "../pipeline/diff/introspect-live";

import { readCoveredEntities } from "./entity-coverage";
import type { MigrationUnit } from "./migration-transaction";
import { tablesDroppedBy } from "./statement-targets";
import { reachStopPoint } from "./stop-points";

/** Every capture's `nextly_meta` key starts with this. */
const KEY_PREFIX = "retired_documents:";

/** The longest key `nextly_meta` holds on MySQL. */
const MAX_KEY_LENGTH = 191;

/** One entity's documents a file's drop takes, as captured before the drop. */
export interface RetiredDocuments {
  /** The migration file whose drop takes them, as the ledger names it. */
  file: string;
  kind: "collection" | "single";
  slug: string;
  /** The entity's main table, which the file drops. */
  table: string;
  /** Every document's id the table held at the capture. */
  ids: string[];
  /** When they were captured: a `deleted` event since then names a document already. */
  capturedAt: string;
}

/**
 * Before `unit`'s first statement (`from` 0), on `db`, its transaction where it runs in one:
 * captures the documents of each collection or Single whose main table `statements` drop. Nothing
 * for a later try, a `migrate:down` unit, or a file that drops no entity's main table.
 */
export async function captureRetiredDocuments(
  db: unknown,
  dialect: SupportedDialect,
  unit: MigrationUnit,
  statements: readonly string[],
  from: number
): Promise<void> {
  if (from > 0 || unit.direction === "down") return;
  const dropped = new Set(
    statements.flatMap(statement => tablesDroppedBy(statement, dialect) ?? [])
  );
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
  const standing = new Set(
    (
      await introspectTableNames(
        db,
        dialect,
        retiring.map(entity => entity.table)
      )
    ).map(name => name.toLowerCase())
  );
  for (const entity of retiring) {
    if (!standing.has(entity.table.toLowerCase())) continue;
    await captureOne(db, dialect, {
      file: unit.source,
      kind: entity.kind as RetiredDocuments["kind"],
      slug: entity.slug,
      table: entity.table,
      ids: [],
      capturedAt: new Date().toISOString(),
    });
  }
}

/** Captures one entity's documents: its table locked first on PostgreSQL, then its ids stored. */
async function captureOne(
  db: unknown,
  dialect: SupportedDialect,
  capture: RetiredDocuments
): Promise<void> {
  if (dialect === "postgresql") {
    // Writes wait for the file's transaction, which drops the table, so none lands unnamed.
    await runStatement(
      db,
      dialect,
      sql`LOCK TABLE ${sql.identifier(capture.table)} IN SHARE MODE`
    );
  }
  const rows = await querySqlRows<{ id: unknown }>(
    db,
    dialect,
    sql`SELECT ${sql.identifier("id")} FROM ${sql.identifier(capture.table)}`
  );
  const ids = rows.map(row => String(row.id));
  const { nextlyMeta } = loadedDialect(dialect).tables;
  const key = captureKey(capture);
  // A capture a rolled-back attempt of the same file left is replaced by this one.
  await (db as MetaDatabase).delete(nextlyMeta).where(eq(nextlyMeta.key, key));
  await (db as MetaDatabase).insert(nextlyMeta).values({
    key,
    value: JSON.stringify({ ...capture, ids }),
    updatedAt: new Date(),
  });
}

/** The `nextly_meta` key of `capture`, kept within the length MySQL holds. */
function captureKey(capture: RetiredDocuments): string {
  const key = `${KEY_PREFIX}${capture.file}:${capture.kind}:${capture.slug}`;
  if (key.length <= MAX_KEY_LENGTH) return key;
  return `${KEY_PREFIX}${createHash("sha256").update(key).digest("hex")}`;
}

/** What a run did with the captures it found. */
export interface RetiredDocumentEvents {
  /** Each entity whose documents' deletion events were recorded, as `<kind> <slug>`. */
  recorded: string[];
  /** Each capture left for a later run, as `<kind> <slug>`: its file is not recorded applied and its table is gone. */
  left: string[];
}

/**
 * Records the deletion events every capture still owes, one transaction per entity, under the
 * caller's schema lock. Answers which entities' events went and which captures wait.
 */
export async function recordRetiredDocumentEvents(
  adapter: DrizzleAdapter
): Promise<RetiredDocumentEvents> {
  const dialect = adapter.getCapabilities().dialect;
  const result: RetiredDocumentEvents = { recorded: [], left: [] };
  for (const { key, capture } of await readCaptures(adapter, dialect)) {
    const name = `${capture.kind} ${capture.slug}`;
    const applied = await new SchemaEventsRepository(
      adapter.getDrizzle(),
      dialect
    ).isFileApplied(capture.file);
    if (!applied) {
      // The file did not apply: where the entity's table stands, nothing of it was retired, and a
      // run that applies the file captures again.
      if (await tableStands(adapter, dialect, capture.table)) {
        await forget(adapter.getDrizzle(), dialect, key);
      } else {
        result.left.push(name);
      }
      continue;
    }
    await adapter.transaction(async tx => {
      for (const id of capture.ids) {
        await recordDeletionOnce(tx, adapter, dialect, capture, id);
      }
      await reachStopPoint(`${name}: recorded deletion events`);
      await forget(tx.getDrizzle(), dialect, key);
    });
    result.recorded.push(name);
  }
  return result;
}

/** Records `id`'s deletion event on `tx`, unless one was recorded since the capture. */
async function recordDeletionOnce(
  tx: Parameters<typeof recordWriteEvent>[0],
  adapter: DrizzleAdapter,
  dialect: SupportedDialect,
  capture: RetiredDocuments,
  id: string
): Promise<void> {
  const { nextlyContentEvents } = contentEventsTables(dialect);
  const subject = { kind: capture.kind, slug: capture.slug, id };
  const [already] = await querySqlRows<{ id: unknown }>(
    tx.getDrizzle(),
    dialect,
    sql`SELECT ${sql.identifier("id")} FROM ${nextlyContentEvents} WHERE ${and(
      eq(nextlyContentEvents.subjectKind, capture.kind),
      eq(nextlyContentEvents.subjectSlug, capture.slug),
      eq(nextlyContentEvents.subjectId, id),
      eq(nextlyContentEvents.kind, "deleted"),
      gte(nextlyContentEvents.occurredAt, new Date(capture.capturedAt))
    )} LIMIT 1`
  );
  if (already !== undefined) return;
  await recordWriteEvent(
    tx,
    { adapter },
    { subject, kind: "deleted", actor: { type: "system" } }
  );
}

/** Every capture stored, with its key; a row that cannot be read as one is passed over. */
async function readCaptures(
  adapter: DrizzleAdapter,
  dialect: SupportedDialect
): Promise<{ key: string; capture: RetiredDocuments }[]> {
  const { nextlyMeta } = loadedDialect(dialect).tables;
  if (!(await tableStands(adapter, dialect, "nextly_meta"))) return [];
  const rows = await adapter
    .getDrizzle<MetaDatabase>()
    .select({ key: nextlyMeta.key, value: nextlyMeta.value })
    .from(nextlyMeta)
    .where(like(nextlyMeta.key, `${KEY_PREFIX}%`));
  return rows.flatMap(row => {
    const capture = parseCapture(row.value);
    return capture === undefined ? [] : [{ key: String(row.key), capture }];
  });
}

/** A stored capture, read back from its JSON (text on SQLite, parsed on the others). */
function parseCapture(value: unknown): RetiredDocuments | undefined {
  let parsed: unknown = value;
  if (typeof value === "string") {
    try {
      parsed = JSON.parse(value);
    } catch {
      return undefined;
    }
  }
  const capture = parsed as Partial<RetiredDocuments> | null;
  return capture !== null &&
    typeof capture === "object" &&
    typeof capture.file === "string" &&
    (capture.kind === "collection" || capture.kind === "single") &&
    typeof capture.slug === "string" &&
    typeof capture.table === "string" &&
    Array.isArray(capture.ids) &&
    typeof capture.capturedAt === "string"
    ? (capture as RetiredDocuments)
    : undefined;
}

/** Forgets the capture stored under `key`, on `db`. */
async function forget(
  db: unknown,
  dialect: SupportedDialect,
  key: string
): Promise<void> {
  const { nextlyMeta } = loadedDialect(dialect).tables;
  await (db as MetaDatabase).delete(nextlyMeta).where(eq(nextlyMeta.key, key));
}

/** Whether `table` is there. */
async function tableStands(
  adapter: DrizzleAdapter,
  dialect: SupportedDialect,
  table: string
): Promise<boolean> {
  const found = await introspectTableNames(adapter.getDrizzle(), dialect, [
    table,
  ]);
  return found.some(name => name.toLowerCase() === table.toLowerCase());
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
