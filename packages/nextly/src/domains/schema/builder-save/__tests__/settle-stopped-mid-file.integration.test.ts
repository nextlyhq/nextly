/**
 * A Builder save the process left part-way through a migration file, settled at the next
 * development start from what the database holds.
 *
 * MySQL commits each schema statement as it runs, so a process killed after one statement of a
 * file keeps it. The settle judges each change the save asked for from the live table, as a save
 * that stops while its process lives is judged, and writes the file and snapshot for exactly the
 * changes that applied, recorded applied, with the definition and the registry row brought to that
 * shape. PostgreSQL and SQLite run a file in one transaction, which a kill rolls back, so no file
 * stops inside its statements there.
 *
 * A kill is made as the record's own suite makes one: the step at the kill point runs and then never
 * returns, so no `catch` or `finally` of the save runs. Here the kill point is one of the file
 * runner's own stop points, after a statement. The settle then runs on the same database and folder,
 * as the next start's step would (`settleLeftSaves`).
 */
import {
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { dispatchCollections } from "../../../../dispatcher/handlers/collection-dispatcher";
import { dispatchSingles } from "../../../../dispatcher/handlers/single-dispatcher";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestNextly,
} from "../../../../plugins/test-nextly";
import type { ServiceContainer } from "../../../../services";
import { consoleLogger } from "../../../../shared/types";
import { MetaService } from "../../../meta/services/meta-service";
import { SchemaEventsRepository } from "../../events/schema-events-repository";
import { checksumOf } from "../../migrate/applied-checksums";
import { splitSqlStatements } from "../../migrate/split-sql";
import { parseSqlSections } from "../../migrate/sql-sections";
import { withStopPoints } from "../../migrate/stop-points";
import { WRITER_LOCK_FILE } from "../../migrate-create/writer-hold";
import { introspectLiveSnapshot } from "../../pipeline/diff/introspect-live";
import {
  EARLIER_MIGRATE_LOCK_TABLE,
  MYSQL_MIGRATE_LOCK_NAME,
  SCHEMA_LOCK_TABLE,
} from "../../pipeline/schema-lock";
import { MIGRATION_LOCK_TABLE } from "../../../field-groups/migration/session";
import {
  settleBeforeBuilderSave,
  settleLeftSaves,
  type SettledSave,
} from "../settle-left-save";
import { settleRegistryWriter } from "../settle-registry";

const HISTORY = "./database/history";
const DEFINITION = "./schema/builder.json";
const SLUG = "stopped_hero";
const TABLE = "single_stopped_hero";
const RECORD_KEY = `builder-save-in-progress:single:${SLUG}`;

let current: TestNextly | undefined;
let basePath: string;
let stopped: Promise<unknown> | undefined;
let release: (() => void) | undefined;

beforeEach(() => {
  basePath = mkdtempSync(join(tmpdir(), "nextly-settle-stopped-mid-file-"));
});

afterEach(async () => {
  release?.();
  release = undefined;
  await stopped;
  stopped = undefined;
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  await current?.destroy();
  current = undefined;
  rmSync(basePath, { recursive: true, force: true });
});

type BuilderField = Record<string, unknown>;
const text = (name: string): BuilderField => ({ name, type: "text" });

const HISTORY_DIR = () => join(basePath, HISTORY);
const sqlFiles = () =>
  existsSync(HISTORY_DIR())
    ? readdirSync(HISTORY_DIR())
        .filter(name => name.endsWith(".sql"))
        .sort()
    : [];

/** The Single's field names as the definition file holds them. */
function definedFieldNames(): string[] {
  const manifest = JSON.parse(
    readFileSync(join(basePath, DEFINITION), "utf-8")
  ) as { singles?: Array<{ slug: string; fields: Array<{ name: string }> }> };
  const single = manifest.singles?.find(entity => entity.slug === SLUG);
  return (single?.fields ?? []).map(field => field.name);
}

async function versionOf(t: TestNextly): Promise<number> {
  const [row] = await t.adapter.select<{ schemaVersion: unknown }>(
    "dynamic_singles",
    { where: { and: [{ column: "slug", op: "=", value: SLUG }] } }
  );
  return Number(row?.schemaVersion ?? 1);
}

async function registryFieldNames(t: TestNextly): Promise<string[]> {
  const [row] = await t.adapter.select<{ fields: unknown }>("dynamic_singles", {
    where: { and: [{ column: "slug", op: "=", value: SLUG }] },
  });
  const fields =
    typeof row?.fields === "string" ? JSON.parse(row.fields) : row?.fields;
  return (fields as Array<{ name: string }>).map(field => field.name);
}

/**
 * The columns of `table` and of its translations table, where an entity that keeps its
 * translatable values per language has their columns.
 */
async function liveColumns(t: TestNextly, table = TABLE): Promise<string[]> {
  const tables = [table, `${table}_locales`];
  const live = await introspectLiveSnapshot(
    t.adapter.getDrizzle(),
    t.adapter.dialect,
    tables
  );
  return live.tables
    .filter(each => tables.includes(each.name))
    .flatMap(each => each.columns.map(column => column.name));
}

/**
 * Where a save is killed: after the statement of its update file this answers yes for, given the
 * file's statements in run order and the statement's index. Read from the file on disk, as the
 * runner splits it, never from the database: a query from the stop point would run beside the
 * save's own open transaction.
 */
type KillPoint = (statements: readonly string[], index: number) => boolean;

/** The update file's statements, in run order, for the runner's `unit` name. */
function statementsOf(unit: string): string[] {
  const file = sqlFiles().find(name => name === unit || name === `${unit}.sql`);
  if (file === undefined) return [];
  const content = readFileSync(join(HISTORY_DIR(), file), "utf-8");
  return splitSqlStatements(parseSqlSections(content).upSql, "mysql");
}

/**
 * What a save that ended before its kill point answered, with its update files' statements, so a
 * kill point that matched none of them says what they were.
 */
function endedFirst(answer: unknown): string {
  const data =
    typeof answer === "object" && answer !== null && "publicData" in answer
      ? ` ${JSON.stringify((answer as { publicData?: unknown }).publicData)}`
      : "";
  const files = sqlFiles().map(
    name => `${name}:\n${statementsOf(name).join("\n---\n")}`
  );
  return `${String(answer)}${data}\n${files.join("\n")}`;
}

/** Whether `statement` is a schema statement naming the column `column`. */
const altersColumn = (statement: string | undefined, column: string) =>
  statement !== undefined &&
  /^\s*ALTER\s+TABLE/i.test(statement) &&
  statement.includes(`\`${column}\``);

/**
 * Whether `statement` runs a schema change: an `ALTER TABLE`, or the `EXECUTE` of one the file
 * prepares (a rename, a column made required).
 */
const schemaStatement = (statement: string | undefined) =>
  statement !== undefined &&
  /^\s*(ALTER\s+TABLE|EXECUTE)\b/i.test(statement);

/** After the statement that adds `column`. */
const afterAdding =
  (column: string): KillPoint =>
  (all, index) =>
    altersColumn(all[index], column);

/** After the last statement before the registry row is written: every schema statement ran. */
const beforeRegistryRow: KillPoint = (all, index) =>
  /^\s*INSERT\s+INTO\s+`?dynamic_/i.test(all[index + 1] ?? "");

async function recordRow(t: TestNextly): Promise<unknown> {
  const entry = await new MetaService(t.adapter, consoleLogger).getEntry(
    RECORD_KEY
  );
  return entry.present ? entry.value : undefined;
}

function save(
  t: TestNextly,
  fields: BuilderField[],
  answers: Record<string, unknown> = {}
): Promise<unknown> {
  return versionOf(t).then(schemaVersion =>
    dispatchSingles(
      "applySingleSchemaChanges",
      { slug: SLUG },
      { fields, confirmed: true, schemaVersion, ...answers }
    )
  );
}

/**
 * Start a save of `fields` and kill it at the file runner's stop point `at`, in whichever of its
 * files `at` names: the step there runs, then the save never returns. Resolves once it has
 * stopped there.
 */
async function killSave(
  t: TestNextly,
  fields: BuilderField[],
  at: KillPoint,
  answers: Record<string, unknown> = {}
): Promise<void> {
  let reached: () => void = () => undefined;
  const there = new Promise<void>(resolve => {
    reached = resolve;
  });
  // The killed run never returns, so its hook stays installed: it stops one point only.
  let armed = true;
  stopped = withStopPoints(
    async point => {
      const after = /^(.*): after statement (\d+)$/.exec(point);
      if (!armed || after === null) return;
      if (!at(statementsOf(after[1]!), Number(after[2]) - 1)) return;
      armed = false;
      reached();
      await new Promise<void>((_, reject) => {
        release = () => reject(new Error(`the process was killed at ${point}`));
      });
    },
    () => save(t, fields, answers)
  ).catch((error: unknown) => error);
  const outcome = await Promise.race([
    there.then(() => "reached"),
    stopped.then(answer => `the save ended first: ${endedFirst(answer)}`),
  ]);
  expect(outcome, "the save never reached the kill point").toBe("reached");
}

/**
 * What the killed process held, cleared as its lapse would clear it: the schema lock's row, the
 * earlier locks' rows it holds beside it, the project's writer hold, and the named lock its MySQL
 * connection holds, which only that connection's end releases.
 */
async function clearStoppedHolds(t: TestNextly): Promise<void> {
  await t.adapter.executeQuery(`DELETE FROM ${SCHEMA_LOCK_TABLE}`);
  for (const earlier of [MIGRATION_LOCK_TABLE, EARLIER_MIGRATE_LOCK_TABLE]) {
    if (await t.adapter.tableExists(earlier)) {
      await t.adapter.executeQuery(`DELETE FROM ${earlier}`);
    }
  }
  rmSync(join(HISTORY_DIR(), WRITER_LOCK_FILE), { force: true });
  const db = t.adapter.getDrizzle<{
    execute: (q: unknown) => Promise<unknown>;
  }>();
  const result = await db.execute(
    sql`SELECT IS_USED_LOCK(${MYSQL_MIGRATE_LOCK_NAME}) AS holder`
  );
  // mysql2 answers [rows, fields].
  const rows = (
    Array.isArray(result) && Array.isArray(result[0]) ? result[0] : result
  ) as Array<{ holder: number | null }>;
  const holder = rows[0]?.holder;
  if (holder !== null && holder !== undefined) {
    await t.adapter.executeQuery(`KILL ${Number(holder)}`);
  }
}

/** The settle, as the next development start runs it, over the same database and folder. */
function settle(t: TestNextly): Promise<SettledSave[]> {
  return settleLeftSaves({
    adapter: t.adapter,
    projectRoot: basePath,
    migrationsDir: HISTORY_DIR(),
    logger: { info: () => undefined, warn: () => undefined },
    writeRegistry: settleRegistryWriter(t.adapter),
  });
}

/**
 * The two layouts a database keeps translatable values in: on the main tables, as databases made
 * before per-language storage do, and per language in translations tables, as every installation
 * keeps them now. A stop is judged on both.
 */
const LAYOUTS = [
  { layout: "translatable values on the main table", perLanguage: false },
  { layout: "translatable values per language", perLanguage: true },
] as const;

describe.each(
  getConfiguredTestDialects()
    .filter(d => d === "mysql")
    .flatMap(dialect => LAYOUTS.map(layout => ({ dialect, ...layout })))
)(
  "a Builder save killed inside its migration file, settled ($dialect, $layout)",
  ({ dialect, perLanguage }) => {
    /**
     * A text field kept on the main table in either layout: with values kept per language it is
     * shared (`localized: false`), so the save changes the main table alone, in one file, which is
     * what a stop inside a file is judged for there.
     */
    const field = (name: string): BuilderField =>
      perLanguage ? { ...text(name), localized: false } : text(name);

    async function boot(): Promise<TestNextly> {
      vi.stubEnv("NODE_ENV", "development");
      current = await createTestNextly({
        dialect,
        basePath,
        db: { migrationsDir: HISTORY, uiSchemaFile: DEFINITION },
        perLanguageStorage: perLanguage,
      });
      await dispatchSingles(
        "createSingle",
        {},
        { slug: SLUG, label: SLUG, fields: [field("heading")] }
      );
      return current;
    }

    it("writes the file for exactly the change that applied, recorded, with the definition and registry at that shape", async () => {
      const t = await boot();
      const before = sqlFiles();

      await killSave(
        t,
        [field("heading"), field("subtitle"), field("summary")],
        afterAdding("subtitle")
      );
      // The kill left the table half-changed: the first column added, the second not.
      const killedAt = await liveColumns(t);
      expect(killedAt).toContain("subtitle");
      expect(killedAt).not.toContain("summary");
      await clearStoppedHolds(t);

      const settled = await settle(t);

      expect(settled.map(s => s.outcome)).not.toContain("left");
      expect(await recordRow(t), "the record clears").toBeUndefined();
      // One file in place of the stopped one, for the column that applied alone.
      const written = sqlFiles().filter(f => !before.includes(f));
      expect(written).toHaveLength(1);
      const content = readFileSync(join(HISTORY_DIR(), written[0]!), "utf-8");
      expect(content).toContain("subtitle");
      expect(content).not.toContain("summary");
      // Recorded applied, with the checksum `nextly migrate` checks it by.
      const repo = new SchemaEventsRepository(
        t.adapter.getDrizzle(),
        t.adapter.dialect
      );
      const row = (await repo.listFileApplies()).find(
        r => r.filename === written[0] && r.status === "applied"
      );
      expect(row?.sha256).toBe(checksumOf(content));
      expect(definedFieldNames()).toEqual(["heading", "subtitle"]);
      expect(await registryFieldNames(t)).toEqual(["heading", "subtitle"]);

      // The rest saved again: a second file, the table and registry complete.
      await save(t, [field("heading"), field("subtitle"), field("summary")]);
      expect(sqlFiles().filter(f => !before.includes(f))).toHaveLength(2);
      expect(await liveColumns(t)).toContain("summary");
      expect(await registryFieldNames(t)).toEqual([
        "heading",
        "subtitle",
        "summary",
      ]);
    }, 300_000);

    /** Killed after the first of two added columns: the table holds `subtitle` and not `summary`. */
    async function killedAfterFirstAdd(t: TestNextly): Promise<void> {
      await killSave(
        t,
        [field("heading"), field("subtitle"), field("summary")],
        afterAdding("subtitle")
      );
      const killedAt = await liveColumns(t);
      expect(killedAt).toContain("subtitle");
      expect(killedAt).not.toContain("summary");
      await clearStoppedHolds(t);
    }

    it("settles the same stop before the next Builder save of the entity, as the next start would", async () => {
      const t = await boot();
      const before = sqlFiles();
      await killedAfterFirstAdd(t);

      await settleBeforeBuilderSave(t.adapter, HISTORY_DIR(), {
        info: () => undefined,
        warn: () => undefined,
      });

      expect(await recordRow(t), "the record clears").toBeUndefined();
      const written = sqlFiles().filter(f => !before.includes(f));
      expect(written).toHaveLength(1);
      expect(
        readFileSync(join(HISTORY_DIR(), written[0]!), "utf-8")
      ).not.toContain("summary");
      expect(await registryFieldNames(t)).toEqual(["heading", "subtitle"]);
    }, 300_000);

    it("leaves a definition edited while the save was left as it is, settling the rest and naming the difference", async () => {
      const t = await boot();
      const before = sqlFiles();
      await killedAfterFirstAdd(t);
      // The Single's label changed in the definition while the save was left: a real edit.
      const path = join(basePath, DEFINITION);
      const manifest = JSON.parse(readFileSync(path, "utf-8")) as {
        singles: Array<{ slug: string; label?: unknown }>;
      };
      const single = manifest.singles.find(entity => entity.slug === SLUG);
      if (single !== undefined) single.label = "Edited while left";
      const edited = `${JSON.stringify(manifest, null, 2)}\n`;
      writeFileSync(path, edited);

      const settled = await settle(t);

      expect(settled.map(s => s.outcome)).not.toContain("left");
      expect(readFileSync(path, "utf-8"), "the edit kept").toBe(edited);
      expect(settled.flatMap(s => s.notes).join(" ")).toMatch(/definition/i);
      expect(await recordRow(t), "the record clears").toBeUndefined();
      expect(sqlFiles().filter(f => !before.includes(f))).toHaveLength(1);
      expect(await registryFieldNames(t)).toEqual(["heading", "subtitle"]);
    }, 300_000);

    /**
     * `heading` renamed to `headline` and `count` added. MySQL's file adds `count` first, then
     * renames by a prepared statement (set, prepare, execute, deallocate), then writes the registry
     * row: killed after the addition, the rename has not run; before the registry row, both have.
     */
    const renamed = [field("headline"), { name: "count", type: "number" }];
    const renameAnswers = {
      renameResolutions: [
        {
          tableName: TABLE,
          fromColumn: "heading",
          toColumn: "headline",
          choice: "rename",
        },
        {
          tableName: TABLE,
          fromColumn: "heading",
          toColumn: "count",
          choice: "drop_and_add",
        },
      ],
    };
    /** After `count` is added, with the rename still to run. */
    const addedBeforeRename: KillPoint = (all, index) =>
      afterAdding("count")(all, index) &&
      all.slice(index + 1).some(statement => /^\s*EXECUTE\b/i.test(statement));

    it("settles a rename that had not run beside an addition that had, keeping the field under its old name", async () => {
      const t = await boot();
      const before = sqlFiles();
      await killSave(t, renamed, addedBeforeRename, renameAnswers);
      const killedAt = await liveColumns(t);
      expect(killedAt).toContain("count");
      expect(killedAt).toContain("heading");
      expect(killedAt).not.toContain("headline");
      await clearStoppedHolds(t);

      const settled = await settle(t);

      expect(settled.map(s => s.outcome)).not.toContain("left");
      expect(await recordRow(t), "the record clears").toBeUndefined();
      const written = sqlFiles().filter(f => !before.includes(f));
      expect(written).toHaveLength(1);
      expect(
        readFileSync(join(HISTORY_DIR(), written[0]!), "utf-8").split(
          "-- DOWN"
        )[0]
      ).not.toMatch(/headline/);
      expect(definedFieldNames()).toEqual(["heading", "count"]);
      expect(await registryFieldNames(t)).toEqual(["heading", "count"]);
    }, 300_000);

    it("settles a rename and an addition that both ran before the registry row was written, as all of the save", async () => {
      const t = await boot();
      const before = sqlFiles();
      await killSave(t, renamed, beforeRegistryRow, renameAnswers);
      const killedAt = await liveColumns(t);
      expect(killedAt).toContain("count");
      expect(killedAt).toContain("headline");
      expect(killedAt).not.toContain("heading");
      await clearStoppedHolds(t);

      const settled = await settle(t);

      expect(settled.map(s => s.outcome)).not.toContain("left");
      expect(await recordRow(t), "the record clears").toBeUndefined();
      const written = sqlFiles().filter(f => !before.includes(f));
      expect(written).toHaveLength(1);
      const repo = new SchemaEventsRepository(
        t.adapter.getDrizzle(),
        t.adapter.dialect
      );
      expect(await repo.isFileApplied(written[0]!)).toBe(true);
      expect(definedFieldNames()).toEqual(["headline", "count"]);
      expect(await registryFieldNames(t)).toEqual(["headline", "count"]);
    }, 300_000);

    it("leaves a save whose file changes rows of its own, stopped after its schema statement, as it stands", async () => {
      const t = await boot();
      // A collection whose save deletes the entry with no value for the field it makes required:
      // the delete is the save's own row change, which the tables' shape says nothing of. The
      // field stays on the main table in either layout (`localized: false`), where the delete
      // reads it.
      const slug = "stopped_posts";
      const table = `dc_${slug}`;
      const note = { name: "note", type: "text", localized: false };
      await dispatchCollections(
        {} as ServiceContainer,
        "createCollection",
        {},
        { name: slug, label: slug, fields: [text("heading"), note] }
      );
      await t.nextly.create({
        collection: slug,
        data: { title: "Kept", slug: "kept", heading: "h", note: "n" },
      } as never);
      await t.nextly.create({
        collection: slug,
        data: { title: "Gone", slug: "gone", heading: "h" },
      } as never);
      const before = sqlFiles();
      const version = await t.adapter.selectOne<{ schema_version?: unknown }>(
        "dynamic_collections",
        { where: { and: [{ column: "slug", op: "=", value: slug }] } }
      );
      let armed = true;
      let reached: () => void = () => undefined;
      const there = new Promise<void>(resolve => {
        reached = resolve;
      });
      stopped = withStopPoints(
        async point => {
          const after = /^(.*_update[^:]*): after statement (\d+)$/.exec(point);
          if (!armed || after === null) return;
          // Past the delete and the schema statement after it: both are lasting on MySQL.
          const all = statementsOf(after[1]!);
          const index = Number(after[2]) - 1;
          const deleted = all
            .slice(0, index)
            .some(statement => /^\s*DELETE\b/i.test(statement));
          if (!deleted || !schemaStatement(all[index])) return;
          armed = false;
          reached();
          await new Promise<void>((_, reject) => {
            release = () =>
              reject(new Error(`the process was killed at ${point}`));
          });
        },
        () =>
          dispatchCollections(
            {} as ServiceContainer,
            "applySchemaChanges",
            { collectionName: slug },
            {
              fields: [text("heading"), { ...note, required: true }],
              confirmed: true,
              schemaVersion: Number(version?.schema_version ?? 1),
              eventResolutions: [
                {
                  kind: "delete_nonconforming",
                  eventId: `add_not_null_with_nulls:${table}.note`,
                },
              ],
            }
          )
      ).catch((error: unknown) => error);
      const outcome = await Promise.race([
        there.then(() => "reached"),
        stopped.then(answer => `the save ended first: ${endedFirst(answer)}`),
      ]);
      expect(outcome, "the save never reached the kill point").toBe("reached");
      await clearStoppedHolds(t);
      const written = sqlFiles().filter(f => !before.includes(f));
      expect(written.length, "the save's file").toBeGreaterThan(0);

      const settled = await settle(t);

      const own = settled.find(s => s.slug === slug);
      expect(own?.outcome).toBe("left");
      expect(sqlFiles(), "its file stays").toEqual(
        [...before, ...written].sort()
      );
    }, 300_000);

    // With values kept per language, a Single's translatable fields change in a file of their own,
    // after the one that writes its registry row: a stop there is not one file's, and is not
    // judged yet. It stays as it stopped, refusing, rather than settled wrongly; the registry row
    // already names the field the translations table does not hold.
    it.runIf(perLanguage)(
      "leaves a save of translatable fields stopped in its translations file as it stands",
      async () => {
        const t = await boot();
        // The translations table made first, by a save that lands whole.
        await save(t, [field("heading"), text("subtitle")]);
        const before = sqlFiles();
        await killSave(
          t,
          [field("heading"), text("subtitle"), text("summary"), text("caption")],
          afterAdding("summary")
        );
        const killedAt = await liveColumns(t);
        expect(killedAt).toContain("summary");
        expect(killedAt).not.toContain("caption");
        expect(await registryFieldNames(t)).toContain("caption");
        await clearStoppedHolds(t);

        const settled = await settle(t);

        expect(settled.map(s => s.outcome)).toEqual(["left"]);
        expect(await recordRow(t), "the record stays").toBeDefined();
        expect(sqlFiles().filter(f => !before.includes(f))).toHaveLength(2);
      },
      300_000
    );

    it("leaves a save stopped inside its file whose record does not say what its files carry, as it stands", async () => {
      const t = await boot();
      const before = sqlFiles();
      await killedAfterFirstAdd(t);
      // A record from before it said whether the save's files carry statements of their own.
      const meta = new MetaService(t.adapter, consoleLogger);
      const record = (await recordRow(t)) as Record<string, unknown>;
      const { ownStatements: _said, ...older } = record;
      await meta.set(RECORD_KEY, older);

      const settled = await settle(t);

      expect(settled.map(s => s.outcome)).toEqual(["left"]);
      expect(await recordRow(t), "the record stays").toBeDefined();
      expect(sqlFiles().filter(f => !before.includes(f))).toHaveLength(1);
      expect(await registryFieldNames(t)).toEqual(["heading"]);
    }, 300_000);
  }
);
