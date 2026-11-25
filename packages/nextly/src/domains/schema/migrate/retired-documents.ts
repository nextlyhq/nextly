/**
 * The deletion events of the documents a migration's drop takes with an entity's table: every
 * document a retired collection or Single held when its table was dropped ends its history with
 * exactly one `deleted` event, however the run stopped after it.
 *
 * Which entities a unit retires is the run's to say (`retired-entities.ts`): a unit it names none
 * for, as a Builder save's is, whose delete records its own, is captured for nothing.
 *
 * Two steps, so a document is named once its table is gone. Immediately before the statement that
 * drops a retired entity's table, so a row the unit's own earlier statements wrote is among them,
 * the ids of the documents it holds are captured into `nextly_meta` (`retirementCheckpoint`): a
 * head row naming the file and the entity, then the ids in rows of at most `CHUNK` each. Where the
 * unit runs in a transaction on PostgreSQL, the table is locked before its first statement as the
 * drop locks it, so a write by another instance either lands before the capture or waits for the
 * drop and fails; SQLite's one writer holds the same. MySQL commits at its first drop, and a unit
 * run outside a transaction commits each statement, so there the capture is best effort: a document
 * another instance writes between the capture and the drop is not named (the documented limit). And
 * there a run may stop between two drops, the rest then made by hand, so every entity the unit
 * retires is captured before its first statement too; each drop's own capture, once whole, stands in
 * for that one, and a capture a run stopped while taking is no capture.
 *
 * A document deleted between the two was ended by that delete. Nothing of a dropped table can be
 * deleted after the drop, so a capture is final once its statement has run: where nothing held the
 * table, the ids whose `deleted` events grew since the capture are taken out then
 * (`finishCapture`), and never later, when the entity may have been made again and a document of
 * the same id deleted in its own right. Once the unit's statements have run, a capture whose table
 * still stands is forgotten: the drop took another table of that name, or one was made again.
 *
 * Then, once the file is recorded applied, every run records one `deleted` event for each captured
 * document and forgets the ids, one transaction per row of ids (`recordRetiredDocumentEvents`). A
 * run stopped part-way leaves the rest, and the next run finishes it, with nothing pending; a
 * document never gets a second event. A capture whose file did not apply is forgotten where the
 * entity's table still stands, nothing of it being retired, unless an attempt at the file is
 * unresolved: an operator may yet finish it by hand.
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
import { migrationStanding } from "../events/migration-state";
import { SchemaEventsRepository } from "../events/schema-events-repository";
import { tablesDroppedIn } from "../ownership/drop-guard";
import { querySqlRows } from "../pipeline/classifier/count-helpers";
import { introspectTableNames } from "../pipeline/diff/introspect-live";
import { assertSchemaLockHeld } from "../pipeline/schema-lock";

import type { MigrationUnit } from "./migration-transaction";
import type { RetiredEntity } from "./retired-entities";
import { endsTheRun, reachStopPoint } from "./stop-points";

/** Every capture's `nextly_meta` keys start with this. */
const KEY_PREFIX = "retired_documents:";

/** The ids one stored row holds, so no row, read or transaction grows with the collection. */
const CHUNK = 500;

/** The place of the capture taken before a unit's first statement, where no drop's own can be. */
const BEFORE_THE_UNIT = -1;

/** The last part of a capture's head row's key. */
const HEAD = "head";

/** What a capture's head row holds: the file whose drop retires the entity, and the entity. */
const headSchema = z.object({
  file: z.string(),
  kind: z.enum(["collection", "single"]),
  slug: z.string(),
  /** The entity's main table, by the name the file drops it under. */
  table: z.string(),
  /** Whether the file's UP drops it, settled once the file is applied, or its DOWN, once rolled back. */
  direction: z.enum(["up", "down"]),
  /** The order the captures were taken in, which is the order their events are recorded in. */
  seq: z.number(),
  /** The statement that drops the table, by its place in the unit. */
  at: z.number(),
  /** Whether the ids are those the drop took (`finishCapture`). */
  final: z.boolean(),
  /** Whether every row of ids is stored: one a run stopped while taking is none. */
  whole: z.boolean(),
});
type CaptureHead = z.infer<typeof headSchema>;

/** What names one capture among the others. */
type CaptureKey = Pick<
  CaptureHead,
  "file" | "kind" | "slug" | "table" | "direction" | "at"
>;

/** What a row of ids holds: each id, and the `deleted` events of those that had any then. */
const idsSchema = z.object({
  ids: z.array(z.string()),
  deletions: z.record(z.string(), z.number()),
});
type CapturedIds = z.infer<typeof idsSchema>;

/** What a run tells a unit it runs of the entities the unit retires (`MigrationUnit.retirements`). */
export interface RetirementContext {
  /** Each entity whose documents end with the unit, by its main table. */
  entities: readonly RetiredEntity[];
  /** Told of each whose table still stands once the unit's statements have run: nothing is recorded. */
  kept?: (entity: RetiredEntity) => void;
}

/** What a unit that retires entities does at its statements. */
export interface RetirementCheckpoint {
  /** Whether it retires any. */
  readonly retires: boolean;
  /**
   * Where a try starts at the unit's first statement, before it: holds the tables, in a transaction
   * on PostgreSQL, and captures the entities where nothing holds them.
   */
  begin(db: unknown, from: number): Promise<void>;
  /** Before the statement at `index` is sent: captures the documents of each entity it drops. */
  before(db: unknown, index: number): Promise<void>;
  /** Once it has run: what it captured is now final. */
  after(db: unknown, index: number): Promise<void>;
  /** Once the unit's statements have run: forgets the capture of a table that still stands. */
  done(db: unknown): Promise<void>;
}

/** The checkpoint of a unit that retires no entity. */
const RETIRES_NOTHING: RetirementCheckpoint = {
  retires: false,
  begin: () => Promise.resolve(),
  before: () => Promise.resolve(),
  after: () => Promise.resolve(),
  done: () => Promise.resolve(),
};

/**
 * What `unit`, made of `statements`, does for the entities it retires; nothing where it retires
 * none. `held` where its statements run in one transaction that holds the tables until it commits
 * (any dialect's but MySQL's, whose schema statements commit it).
 */
export function retirementCheckpoint(
  statements: readonly string[],
  dialect: SupportedDialect,
  unit: MigrationUnit,
  inTransaction: boolean
): RetirementCheckpoint {
  const entities = unit.retirements?.entities ?? [];
  if (entities.length === 0) return RETIRES_NOTHING;
  const held = inTransaction && dialect !== "mysql";
  const droppedAt = statements.map(statement => {
    const names = new Set(tablesDroppedIn(statement, dialect));
    return entities.filter(({ table }) => names.has(table.toLowerCase()));
  });
  /** The captures of `retired` at the statement at `at`, as their heads name them. */
  const headsOf = (retired: readonly RetiredEntity[], at: number) =>
    retired.map(({ kind, slug, table }) => ({
      file: unit.source,
      kind,
      slug,
      table,
      direction: unit.direction ?? ("up" as const),
      at,
    }));
  const headsAt = (at: number) => headsOf(droppedAt[at] ?? [], at);
  /** Takes each of `heads` whose table stands; answers those it took. */
  const take = async (
    db: unknown,
    heads: ReturnType<typeof headsOf>,
    first: (head: CaptureKey) => boolean
  ) => {
    // Only a table still there is read: a statement naming a missing table aborts the
    // transaction on PostgreSQL, and a capture an earlier try stored is kept.
    const standing = await standingTables(
      db,
      dialect,
      heads.map(head => head.table)
    );
    let seq = await lastSeq(db, dialect);
    for (const head of heads) {
      if (!standing.has(tableKey(head.table, dialect))) continue;
      seq += 1;
      await captureOne(db, dialect, {
        ...head,
        seq,
        final: held,
        whole: false,
      });
      // Whatever an earlier attempt of the unit captured goes, now this one is whole: the table
      // stands, so that attempt dropped nothing.
      if (first(head)) await forgetOthers(db, dialect, head);
    }
  };
  // A database whose `nextly_meta` is not there yet (one `migrate:down` rolls back from before it)
  // has nowhere to keep a capture: its documents are retired with no event, as before.
  return {
    retires: true,
    begin: async (db, from) => {
      if (from > 0 || !(await metaStands(db, dialect))) return;
      if (!held) {
        await take(db, headsOf(entities, BEFORE_THE_UNIT), () => true);
        // Its reads fixed what MySQL's transaction sees, which each drop's own capture must not be
        // held to; reopened, as after the implicit commits of the unit's own statements.
        if (inTransaction) {
          await runStatement(db, dialect, sql`COMMIT`);
          await runStatement(db, dialect, sql`START TRANSACTION`);
        }
        return;
      }
      if (dialect !== "postgresql") return;
      const standing = await standingTables(
        db,
        dialect,
        entities.map(({ table }) => table)
      );
      for (const { table } of entities) {
        if (!standing.has(tableKey(table, dialect))) continue;
        // The mode the drop takes, taken first: a write waits for the unit's transaction, which
        // drops the table, so none lands unnamed, and no lock is upgraded behind a waiting writer.
        await runStatement(
          db,
          dialect,
          sql`LOCK TABLE ${sql.identifier(table)} IN ACCESS EXCLUSIVE MODE`
        );
      }
    },
    before: async (db, index) => {
      const heads = headsAt(index);
      if (heads.length === 0 || !(await metaStands(db, dialect))) return;
      // At the unit's first drop of it, an entity's other captures are an earlier attempt's, and
      // the one taken before the unit.
      const isFirst = ({ table }: CaptureKey) =>
        droppedAt.findIndex(dropped =>
          dropped.some(entity => entity.table === table)
        ) === index;
      await take(db, heads, isFirst);
      for (const head of heads) {
        await reachStopPoint(`${head.kind} ${head.slug}: captured`);
      }
    },
    after: async (db, index) => {
      const heads = held ? [] : headsAt(index);
      if (heads.length === 0 || !(await metaStands(db, dialect))) return;
      for (const head of heads) {
        const stored = await readHead(db, dialect, capturePrefix(head));
        if (stored !== undefined) await finishCapture(db, dialect, stored);
      }
    },
    done: async db => {
      if (!(await metaStands(db, dialect))) return;
      const standing = await standingTables(
        db,
        dialect,
        entities.map(({ table }) => table)
      );
      for (const entity of entities) {
        if (!standing.has(tableKey(entity.table, dialect))) continue;
        await forgetPrefix(
          db,
          dialect,
          entityPrefix({
            file: unit.source,
            kind: entity.kind,
            slug: entity.slug,
            direction: unit.direction ?? "up",
          })
        );
        unit.retirements?.kept?.(entity);
      }
    },
  };
}

/** Whether any capture waits for its events, for a run that asks before it takes the lock. */
export async function capturesWait(
  db: unknown,
  dialect: SupportedDialect
): Promise<boolean> {
  if (!(await metaStands(db, dialect))) return false;
  return (await readHeads(db, dialect, KEY_PREFIX)).length > 0;
}

/** The highest `seq` of the captures stored, 0 when there is none. */
async function lastSeq(
  db: unknown,
  dialect: SupportedDialect
): Promise<number> {
  const heads = await readHeads(db, dialect, KEY_PREFIX);
  return Math.max(0, ...heads.map(({ head }) => head.seq));
}

/**
 * Captures one entity's documents at one drop, each id with the `deleted` events it has then; a try
 * of the same drop before this one is replaced.
 */
async function captureOne(
  db: unknown,
  dialect: SupportedDialect,
  head: CaptureHead
): Promise<void> {
  const prefix = capturePrefix(head);
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
    if (page.length === 0) break;
    const ids = page.map(row => String(row.id));
    const deletions = head.final
      ? {}
      : Object.fromEntries(await deletionCounts(db, dialect, head, ids));
    await store(db, dialect, `${prefix}${String(n)}`, { ids, deletions });
    if (page.length < CHUNK) break;
    after = page[page.length - 1].id;
  }
  await replace(db, dialect, `${prefix}${HEAD}`, { ...head, whole: true });
}

/** Forgets the other captures of `head`'s entity by its file. */
async function forgetOthers(
  db: unknown,
  dialect: SupportedDialect,
  head: CaptureKey
): Promise<void> {
  for (const other of await readHeads(db, dialect, entityPrefix(head))) {
    if (other.head.at === head.at) continue;
    await forgetPrefix(db, dialect, capturePrefix(other.head));
  }
}

/**
 * Makes a capture final: the ids whose `deleted` events grew since it are taken out, each ended by
 * the delete that recorded it, and the head says so. Counted, not timed, so no two hosts' clocks are
 * compared, and asked as soon as the drop has run, or by the first run after one that stopped there,
 * before it records any event. Nothing for a capture already final.
 */
async function finishCapture(
  db: unknown,
  dialect: SupportedDialect,
  head: CaptureHead
): Promise<void> {
  if (head.final) return;
  const prefix = capturePrefix(head);
  for (const key of await idKeys(db, dialect, prefix)) {
    const captured = await readIds(db, dialect, key);
    if (captured === undefined) continue;
    const now = await deletionCounts(db, dialect, head, captured.ids);
    const ids = captured.ids.filter(
      id => (now.get(id) ?? 0) <= (captured.deletions[id] ?? 0)
    );
    if (ids.length === captured.ids.length) continue;
    // The counts stay, so a pass stopped part-way asks the same again.
    await replace(db, dialect, key, { ...captured, ids });
  }
  // Last, so a run stopped before it finds the capture not final.
  await replace(db, dialect, `${prefix}${HEAD}`, { ...head, final: true });
}

/**
 * The run whose captures are settled: the handle it was given, which every read goes through, and
 * the adapter that opens each transaction events are recorded in, asked for only where there is
 * something to record.
 */
export interface RetirementRun {
  adapter: DrizzleAdapter;
  db: unknown;
  dialect: SupportedDialect;
}

/** What a run did with the captures it found. */
export interface RetiredDocumentEvents {
  /** Each entity whose documents' deletion events were recorded, as `<kind> <slug>`. */
  recorded: string[];
  /**
   * Each capture left for a later run, as `<kind> <slug>`: its file is not recorded as its drop
   * leaves it (applied, or rolled back for a DOWN), and its table is gone, or an attempt at the file
   * is unresolved.
   */
  left: string[];
  /** Each capture forgotten because its file is applied and its table still stands. */
  kept: string[];
  /**
   * Each capture whose events could not be recorded, kept for a later run, with which way its
   * file's drop ran and why it failed.
   */
  failed: { name: string; direction: "up" | "down"; reason: string }[];
}

/**
 * Records the deletion events every capture still owes, in the order they were captured, one
 * transaction per row of ids, under the caller's schema lock, which each transaction asks for
 * before its writes and before its commit. A capture is settled once its file is recorded as the
 * drop leaves it: applied for an UP, rolled back for a DOWN. Answers which entities' events went
 * and which captures wait.
 *
 * Every capture a stopped run left unfinished is made final first, before any event is recorded.
 * A capture that fails is kept for the next run, and the captures of other entities still settle;
 * a later capture of the same entity waits behind it, so each life's event follows the last one's.
 * A lost lock, or a test's stop, ends the pass at once. The failures are answered with the rest,
 * for the caller to judge.
 */
export async function recordRetiredDocumentEvents(
  run: RetirementRun
): Promise<RetiredDocumentEvents> {
  const { db, dialect } = run;
  const result: RetiredDocumentEvents = {
    recorded: [],
    left: [],
    kept: [],
    failed: [],
  };
  if (!(await metaStands(db, dialect))) return result;
  const heads = (await wholeCaptures(run)).sort(
    (a, b) => a.head.seq - b.head.seq
  );
  const waiting = new Set<string>();
  const unfinished = await finishCaptures(run, heads);
  for (const { head } of heads) {
    const name = `${head.kind} ${head.slug}`;
    if (waiting.has(name)) continue;
    const settled =
      unfinished.get(capturePrefix(head)) ?? (await trySettling(run, head));
    if (typeof settled === "object") {
      waiting.add(name);
      result.failed.push({
        name,
        direction: head.direction,
        reason: reasonOf(settled.error),
      });
    } else if (settled !== "forgotten") {
      result[settled].push(name);
    }
  }
  return result;
}

/** Whether `file` is recorded applied, and whether an attempt at it, or at its DOWN, is unresolved. */
async function standingOfFile(
  { db, dialect }: RetirementRun,
  file: string
): Promise<{ applied: boolean; unresolved: boolean }> {
  const repo = new SchemaEventsRepository(db, dialect);
  const rollbacks = await repo.listFailedRollbacks();
  const standing = migrationStanding([
    ...(await repo.findFileApplies(file)),
    ...rollbacks.filter(row => row.filename === file),
  ]);
  return {
    applied: standing.state === "applied",
    unresolved: standing.unresolvedAttempt !== undefined,
  };
}

/** How one capture settled, or why it could not; what ends the run still ends it. */
async function trySettling(
  run: RetirementRun,
  head: CaptureHead
): Promise<Awaited<ReturnType<typeof settleCapture>> | { error: unknown }> {
  try {
    return await settleCapture(run, head);
  } catch (error) {
    if (endsTheRun(error)) throw error;
    return { error };
  }
}

/** What a failure is said as. */
function reasonOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * The captures stored, less those that are none: one a run stopped while taking, which is forgotten,
 * and the one taken before a unit where a drop's own, whole, stands in for it.
 */
async function wholeCaptures({
  db,
  dialect,
}: RetirementRun): Promise<{ head: CaptureHead }[]> {
  const stored = await readHeads(db, dialect, KEY_PREFIX);
  const whole = stored.filter(({ head }) => head.whole);
  const replaced = new Set(
    whole
      .filter(({ head }) => head.at !== BEFORE_THE_UNIT)
      .map(({ head }) => entityPrefix(head))
  );
  const kept = whole.filter(
    ({ head }) =>
      head.at !== BEFORE_THE_UNIT || !replaced.has(entityPrefix(head))
  );
  for (const each of stored) {
    if (kept.includes(each)) continue;
    await forgetPrefix(db, dialect, capturePrefix(each.head));
  }
  return kept;
}

/**
 * Makes final each capture of `heads` a stopped run left unfinished, where its table is gone: one
 * whose table stands was not dropped, and is forgotten or captured again. Answers those that fail.
 */
async function finishCaptures(
  { db, dialect }: RetirementRun,
  heads: readonly { head: CaptureHead }[]
): Promise<Map<string, { error: unknown }>> {
  const failed = new Map<string, { error: unknown }>();
  for (const { head } of heads) {
    if (head.final) continue;
    try {
      const standing = await standingTables(db, dialect, [head.table]);
      if (standing.has(tableKey(head.table, dialect))) continue;
      await finishCapture(db, dialect, head);
    } catch (error) {
      if (endsTheRun(error)) throw error;
      failed.set(capturePrefix(head), { error });
    }
  }
  return failed;
}

/**
 * Settles one capture: forgotten where its file is not where its drop leaves it and the table
 * stands, left where the table is gone, kept where the file applied and the table still stands, and
 * otherwise its events recorded, row by row.
 */
async function settleCapture(
  run: RetirementRun,
  head: CaptureHead
): Promise<"recorded" | "left" | "kept" | "forgotten"> {
  const { adapter, db, dialect } = run;
  const name = `${head.kind} ${head.slug}`;
  const prefix = capturePrefix(head);
  const { applied, unresolved } = await standingOfFile(run, head.file);
  if (applied !== (head.direction === "up")) {
    // The file is not where its drop leaves it. An attempt at it that stopped part-way may yet be
    // finished by hand, so its captures wait; otherwise, where the entity's table stands, nothing of
    // it was retired, and a run that drops it again captures again.
    if (unresolved) return "left";
    const standing = await standingTables(db, dialect, [head.table]);
    if (!standing.has(tableKey(head.table, dialect))) return "left";
    await forgetPrefix(db, dialect, prefix);
    return "forgotten";
  }
  // A capture not final here has its table still there (`finishCaptures`): the run that took it
  // stopped before the drop, and the file was recorded applied without it.
  if (!head.final) {
    const standing = await standingTables(db, dialect, [head.table]);
    if (standing.has(tableKey(head.table, dialect))) {
      await forgetPrefix(db, dialect, prefix);
      return "kept";
    }
  }
  for (const key of await idKeys(db, dialect, prefix)) {
    await adapter.transaction(async tx => {
      await assertSchemaLockHeld();
      const captured = await readIds(tx.getDrizzle(), dialect, key);
      if (captured !== undefined) {
        await recordDeletions(tx, adapter, head, captured);
      }
      await reachStopPoint(`${name}: recorded deletion events`);
      await forgetKey(tx.getDrizzle(), dialect, key);
      // The commit is what lands the events: refused, and undone, by a run that lost the lock.
      await assertSchemaLockHeld();
    });
  }
  await forgetKey(db, dialect, `${prefix}${HEAD}`);
  return "recorded";
}

/** Records, on `tx`, the deletion event of each of `captured`'s documents. */
async function recordDeletions(
  tx: Parameters<typeof recordWriteEvent>[0],
  adapter: DrizzleAdapter,
  head: CaptureHead,
  captured: CapturedIds
): Promise<void> {
  for (const id of captured.ids) {
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

/** The key every row of one capture starts with: its entity's, then the drop's place in the unit. */
function capturePrefix(
  head: Pick<CaptureHead, "file" | "kind" | "slug" | "direction" | "at">
): string {
  return `${entityPrefix(head)}${String(head.at)}:`;
}

/** The key every capture of an entity by a file starts with: the file's hash, then the entity's and the direction's. */
function entityPrefix(
  head: Pick<CaptureHead, "file" | "kind" | "slug" | "direction">
): string {
  return `${KEY_PREFIX}${hashOf(head.file)}:${hashOf(`${head.kind}:${head.slug}:${head.direction}`)}:`;
}

/** A short hash of `text`, so a key stays within what `nextly_meta` holds on MySQL. */
function hashOf(text: string): string {
  return createHash("sha256").update(text).digest("hex").slice(0, 32);
}

/**
 * The `nextly_meta` rows `condition` selects, each key with its value. Read, as every write below
 * is made, through a statement: the handle a unit hands the capture may be a session's, which runs
 * statements and nothing else.
 */
function metaRows(
  db: unknown,
  dialect: SupportedDialect,
  condition: SQL | undefined
): Promise<{ key: unknown; value: unknown }[]> {
  const { nextlyMeta } = loadedDialect(dialect).tables;
  return querySqlRows<{ key: unknown; value: unknown }>(
    db,
    dialect,
    sql`SELECT ${nextlyMeta.key} AS ${sql.identifier("key")}, ${nextlyMeta.value} AS ${sql.identifier("value")} FROM ${nextlyMeta} WHERE ${condition}`
  );
}

/** Every capture's head under `prefix`, with its key; a row that cannot be read as one is passed over. */
async function readHeads(
  db: unknown,
  dialect: SupportedDialect,
  prefix: string
): Promise<{ key: string; head: CaptureHead }[]> {
  const { nextlyMeta } = loadedDialect(dialect).tables;
  const rows = await metaRows(
    db,
    dialect,
    like(nextlyMeta.key, `${prefix}%:${HEAD}`)
  );
  return rows.flatMap(row => {
    const head = parsed(headSchema, row.value);
    return head === undefined ? [] : [{ key: String(row.key), head }];
  });
}

/** The head of the capture whose keys start with `prefix`, or undefined when it has none. */
async function readHead(
  db: unknown,
  dialect: SupportedDialect,
  prefix: string
): Promise<CaptureHead | undefined> {
  const { nextlyMeta } = loadedDialect(dialect).tables;
  const [row] = await metaRows(
    db,
    dialect,
    eq(nextlyMeta.key, `${prefix}${HEAD}`)
  );
  return row === undefined ? undefined : parsed(headSchema, row.value);
}

/** The keys of the rows of ids under `prefix`. */
async function idKeys(
  db: unknown,
  dialect: SupportedDialect,
  prefix: string
): Promise<string[]> {
  const { nextlyMeta } = loadedDialect(dialect).tables;
  // The keys alone: each row's ids are read when its turn comes, a row at a time.
  const rows = await querySqlRows<{ key: unknown }>(
    db,
    dialect,
    sql`SELECT ${nextlyMeta.key} AS ${sql.identifier("key")} FROM ${nextlyMeta} WHERE ${like(nextlyMeta.key, `${prefix}%`)}`
  );
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
  const [row] = await metaRows(db, dialect, eq(nextlyMeta.key, key));
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
  // Each value encoded by its column, as an insert through the table encodes it.
  await runStatement(
    db,
    dialect,
    sql`INSERT INTO ${nextlyMeta} (${sql.identifier(nextlyMeta.key.name)}, ${sql.identifier(nextlyMeta.value.name)}, ${sql.identifier(nextlyMeta.updatedAt.name)}) VALUES (${sql.param(key, nextlyMeta.key)}, ${sql.param(JSON.stringify(value), nextlyMeta.value)}, ${sql.param(new Date(), nextlyMeta.updatedAt)})`
  );
}

/** Stores `value` under `key` in place of what is there, in one statement, on `db`. */
async function replace(
  db: unknown,
  dialect: SupportedDialect,
  key: string,
  value: unknown
): Promise<void> {
  const { nextlyMeta } = loadedDialect(dialect).tables;
  await runStatement(
    db,
    dialect,
    sql`UPDATE ${nextlyMeta} SET ${sql.identifier(nextlyMeta.value.name)} = ${sql.param(JSON.stringify(value), nextlyMeta.value)}, ${sql.identifier(nextlyMeta.updatedAt.name)} = ${sql.param(new Date(), nextlyMeta.updatedAt)} WHERE ${eq(nextlyMeta.key, key)}`
  );
}

/** Forgets the row under `key`, on `db`. */
async function forgetKey(
  db: unknown,
  dialect: SupportedDialect,
  key: string
): Promise<void> {
  const { nextlyMeta } = loadedDialect(dialect).tables;
  await runStatement(
    db,
    dialect,
    sql`DELETE FROM ${nextlyMeta} WHERE ${eq(nextlyMeta.key, key)}`
  );
}

/** Forgets every row under `prefix`, on `db`. */
async function forgetPrefix(
  db: unknown,
  dialect: SupportedDialect,
  prefix: string
): Promise<void> {
  const { nextlyMeta } = loadedDialect(dialect).tables;
  await runStatement(
    db,
    dialect,
    sql`DELETE FROM ${nextlyMeta} WHERE ${like(nextlyMeta.key, `${prefix}%`)}`
  );
}

/**
 * How a table's name is compared on `dialect`: as the catalog spells it on PostgreSQL, which keeps
 * a quoted name's case (`"Topics"` and `topics` are two tables), lower-cased elsewhere.
 */
function tableKey(name: string, dialect: SupportedDialect): string {
  return dialect === "postgresql" ? name : name.toLowerCase();
}

/** Which of `tables` are there, each as `tableKey` gives it. */
async function standingTables(
  db: unknown,
  dialect: SupportedDialect,
  tables: readonly string[]
): Promise<Set<string>> {
  const found = await introspectTableNames(db, dialect, [...tables]);
  return new Set(found.map(name => tableKey(name, dialect)));
}

/** Whether `nextly_meta`, where captures are kept, is there. */
async function metaStands(
  db: unknown,
  dialect: SupportedDialect
): Promise<boolean> {
  return (await standingTables(db, dialect, ["nextly_meta"])).has(
    "nextly_meta"
  );
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
