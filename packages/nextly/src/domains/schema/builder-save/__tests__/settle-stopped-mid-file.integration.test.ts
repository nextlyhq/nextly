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

import { folderSnapshot } from "../../../../cli/__tests__/helpers/folder-snapshot";
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
import { setAside } from "../collection-save";
import { databaseIdentity } from "../saved-database";
import { settleBeforeMigrate } from "../settle-at-migrate";
import {
  settleBeforeBuilderSave,
  settleLeftSaves,
  type SettledSave,
} from "../settle-left-save";
import { settleRegistryWriter } from "../settle-registry";
import {
  letRenamesGo,
  renames,
  stoppedAtRename,
} from "./helpers/stop-at-rename";

// A settle may be stopped at one of its renames, as a process killed there.
vi.mock("node:fs/promises", async original =>
  (await import("./helpers/stop-at-rename")).stoppingRenames(
    await original<typeof import("node:fs/promises")>()
  )
);

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
  letRenamesGo();
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
  statement !== undefined && /^\s*(ALTER\s+TABLE|EXECUTE)\b/i.test(statement);

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

/** The settle `nextly migrate` runs before its files, over the same database and folder. */
async function settleAtMigrate(t: TestNextly): Promise<void> {
  await settleBeforeMigrate({
    adapter: t.adapter,
    projectRoot: basePath,
    migrationsDir: HISTORY_DIR(),
    database: databaseIdentity(),
    logger: { info: () => undefined, warn: () => undefined },
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

// Only MySQL keeps each schema statement of a file as it runs, so only there does a save stop inside
// one. Reported skipped, not failed, where MySQL is not configured.
describe.skipIf(!getConfiguredTestDialects().includes("mysql"))(
  "on MySQL",
  () => {
    describe.each(
      LAYOUTS.map(layout => ({ dialect: "mysql" as const, ...layout }))
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
          const content = readFileSync(
            join(HISTORY_DIR(), written[0]!),
            "utf-8"
          );
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
          await save(t, [
            field("heading"),
            field("subtitle"),
            field("summary"),
          ]);
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
          expect(settled.flatMap(s => s.notes).join(" ")).toMatch(
            /definition/i
          );
          expect(await recordRow(t), "the record clears").toBeUndefined();
          expect(sqlFiles().filter(f => !before.includes(f))).toHaveLength(1);
          expect(await registryFieldNames(t)).toEqual(["heading", "subtitle"]);
        }, 300_000);

        // A settle that stopped once it had set the stopped file aside, before its replacement was
        // written, left the record naming a file no listing reads: the next settle puts it back
        // and judges the stop from it, at either road.
        for (const road of [
          { name: "the development start", run: settle },
          { name: "nextly migrate", run: settleAtMigrate },
        ]) {
          it(`settles a stop whose file an earlier settle set aside before it stopped, at ${road.name}`, async () => {
            const t = await boot();
            const before = sqlFiles();
            await killedAfterFirstAdd(t);
            const [stoppedFile] = sqlFiles().filter(f => !before.includes(f));
            expect(stoppedFile, "the stopped file").toBeDefined();
            // As the settle sets it aside, with its snapshot, before it writes the replacement.
            await setAside({ migrationsDir: HISTORY_DIR() }, stoppedFile!);
            expect(sqlFiles()).not.toContain(stoppedFile);

            await road.run(t);

            expect(await recordRow(t), "the record clears").toBeUndefined();
            const written = sqlFiles().filter(f => !before.includes(f));
            expect(written).toHaveLength(1);
            expect(
              readFileSync(join(HISTORY_DIR(), written[0]!), "utf-8")
            ).not.toContain("summary");
            expect(await registryFieldNames(t)).toEqual([
              "heading",
              "subtitle",
            ]);
          }, 300_000);
        }

        // Put back for the checks to read, and set aside again where they refuse: the folder is as
        // the settle found it, with nothing for `nextly migrate` to run.
        it("leaves a file an earlier settle set aside as it is where the history refuses", async () => {
          const t = await boot();
          const before = sqlFiles();
          await killedAfterFirstAdd(t);
          const [stoppedFile] = sqlFiles().filter(f => !before.includes(f));
          await setAside({ migrationsDir: HISTORY_DIR() }, stoppedFile!);
          const applied = join(HISTORY_DIR(), before[0]!);
          writeFileSync(
            applied,
            `${readFileSync(applied, "utf-8")}\n-- edited\n`
          );
          const folder = folderSnapshot(HISTORY_DIR());

          await expect(settle(t)).rejects.toThrow(
            expect.objectContaining({
              code: "NEXTLY_MIGRATION_HISTORY_REFUSED",
            })
          );

          expect(folderSnapshot(HISTORY_DIR())).toEqual(folder);
          expect(await recordRow(t), "the record stays").toBeDefined();
        }, 300_000);

        /** The names under the folder, its snapshots' included, that stand set aside. */
        const asideNames = () =>
          readdirSync(HISTORY_DIR(), { recursive: true })
            .map(String)
            .filter(name => name.endsWith(".stopped"));

        // A kill between the two renames of one move, the file's and its snapshot's, in either
        // direction: the next settle finishes the move and settles the stop, nothing left aside.
        for (const kill of [
          {
            name: "as it was set aside",
            before: () => Promise.resolve(),
            at: (file: string) => (_: string, to: string) =>
              to.endsWith(`${file}.stopped`),
          },
          {
            name: "as it was put back",
            before: (file: string) =>
              setAside({ migrationsDir: HISTORY_DIR() }, file),
            at: (file: string) => (_: string, to: string) => to.endsWith(file),
          },
        ]) {
          it(`settles a stop whose file and snapshot a kill parted ${kill.name}`, async () => {
            const t = await boot();
            const before = sqlFiles();
            await killedAfterFirstAdd(t);
            const [stoppedFile] = sqlFiles().filter(f => !before.includes(f));
            await kill.before(stoppedFile!);
            expect(
              await stoppedAtRename(kill.at(stoppedFile!), () => settle(t)),
              "the settle stopped at the rename"
            ).toBe("reached");
            // One of the two is aside and the other in place.
            expect(asideNames(), "parted").toHaveLength(1);

            const settled = await settle(t);

            expect(settled.map(s => s.outcome)).toEqual(["partial"]);
            expect(await recordRow(t), "the record clears").toBeUndefined();
            expect(asideNames(), "nothing left aside").toEqual([]);
            expect(sqlFiles().filter(f => !before.includes(f))).toHaveLength(1);
            expect(await registryFieldNames(t)).toEqual([
              "heading",
              "subtitle",
            ]);
          }, 300_000);
        }

        // Setting it aside again may fail too: the refusal the settle made is still the one said.
        it("says the history's refusal where the put-back file could not be set aside again", async () => {
          const t = await boot();
          const before = sqlFiles();
          await killedAfterFirstAdd(t);
          const [stoppedFile] = sqlFiles().filter(f => !before.includes(f));
          await setAside({ migrationsDir: HISTORY_DIR() }, stoppedFile!);
          const applied = join(HISTORY_DIR(), before[0]!);
          writeFileSync(
            applied,
            `${readFileSync(applied, "utf-8")}\n-- edited\n`
          );
          renames.fail = (_, to) => to.endsWith(`${stoppedFile!}.stopped`);

          await expect(settle(t)).rejects.toThrow(
            expect.objectContaining({
              code: "NEXTLY_MIGRATION_HISTORY_REFUSED",
            })
          );

          expect(await recordRow(t), "the record stays").toBeDefined();
        }, 300_000);

        // The control: the same file gone and not set aside is a history the settle cannot vouch
        // for, refused with nothing written.
        it("refuses a stop whose file was removed, none of it set aside", async () => {
          const t = await boot();
          const before = sqlFiles();
          await killedAfterFirstAdd(t);
          const [stoppedFile] = sqlFiles().filter(f => !before.includes(f));
          rmSync(join(HISTORY_DIR(), stoppedFile!));

          await expect(settle(t)).rejects.toThrow(
            expect.objectContaining({
              code: "NEXTLY_MIGRATION_HISTORY_REFUSED",
            })
          );

          expect(await recordRow(t), "the record stays").toBeDefined();
          expect(sqlFiles(), "nothing written").toEqual(before);
        }, 300_000);

        // Read again as the definition is written: an edit made while the replacement was written is
        // kept as it stands, never written over.
        it("keeps a definition edited while the replacement was written, settling the rest", async () => {
          const t = await boot();
          const before = sqlFiles();
          await killedAfterFirstAdd(t);
          const [stoppedFile] = sqlFiles().filter(f => !before.includes(f));
          const path = join(basePath, DEFINITION);
          const manifest = JSON.parse(readFileSync(path, "utf-8")) as {
            singles: Array<{ slug: string; label?: unknown }>;
          };
          const single = manifest.singles.find(entity => entity.slug === SLUG);
          if (single !== undefined) single.label = "Edited as it settled";
          const edited = `${JSON.stringify(manifest, null, 2)}\n`;
          // The edit lands as the settle names the replacement's files in the record, which it does
          // once they are written and before it writes the definition.
          const realAmend = MetaService.prototype.compareAndSet;
          let editedYet = false;
          vi.spyOn(MetaService.prototype, "compareAndSet").mockImplementation(
            async function (
              this: MetaService,
              ...args: Parameters<MetaService["compareAndSet"]>
            ) {
              const answer = await realAmend.apply(this, args);
              const files = (args[2] as { files?: unknown }).files;
              const names = Array.isArray(files) ? (files as string[]) : [];
              if (
                !editedYet &&
                names.some(f => !before.includes(f) && f !== stoppedFile)
              ) {
                editedYet = true;
                writeFileSync(path, edited);
              }
              return answer;
            }
          );

          const settled = await settle(t);

          expect(editedYet, "the edit landed during the settle").toBe(true);
          expect(settled.map(s => s.outcome)).toEqual(["partial"]);
          expect(readFileSync(path, "utf-8"), "the edit kept").toBe(edited);
          expect(await recordRow(t), "the record clears").toBeUndefined();
          expect(await registryFieldNames(t)).toEqual(["heading", "subtitle"]);
        }, 300_000);

        /** `heading` renamed to `headline` alone: the file sets, prepares, runs, then deallocates. */
        const renamedAlone = [field("headline")];
        const renameAloneAnswers = {
          renameResolutions: [
            {
              tableName: TABLE,
              fromColumn: "heading",
              toColumn: "headline",
              choice: "rename",
            },
          ],
        };
        /** After the statement that sets the rename up, before it ran: nothing of the save applied. */
        const beforeRenameRan: KillPoint = (all, index) =>
          /^\s*SET\b/i.test(all[index] ?? "") &&
          all
            .slice(index + 1)
            .some(statement => /^\s*EXECUTE\b/i.test(statement));

        // Stopped inside its file with nothing of it applied, the save is settled as one that never
        // ran: its file removed at the development start, and set aside at `nextly migrate`, which
        // removes no migration file.
        for (const road of [
          { name: "the development start", run: settle, aside: false },
          { name: "nextly migrate", run: settleAtMigrate, aside: true },
        ]) {
          it(`settles a stop inside its file that applied nothing at ${road.name}, its file ${road.aside ? "set aside" : "removed"}`, async () => {
            const t = await boot();
            const before = sqlFiles();
            await killSave(
              t,
              renamedAlone,
              beforeRenameRan,
              renameAloneAnswers
            );
            const [stoppedFile] = sqlFiles().filter(f => !before.includes(f));
            expect(stoppedFile, "the stopped file").toBeDefined();
            expect(await liveColumns(t)).toContain("heading");
            await clearStoppedHolds(t);

            await road.run(t);

            expect(await recordRow(t), "the record clears").toBeUndefined();
            expect(sqlFiles(), "no file of the save listed").toEqual(before);
            expect(
              existsSync(join(HISTORY_DIR(), `${stoppedFile!}.stopped`)),
              "the stopped file set aside"
            ).toBe(road.aside);
            expect(definedFieldNames()).toEqual(["heading"]);
          }, 300_000);
        }

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
          all
            .slice(index + 1)
            .some(statement => /^\s*EXECUTE\b/i.test(statement));

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
          const version = await t.adapter.selectOne<{
            schema_version?: unknown;
          }>("dynamic_collections", {
            where: { and: [{ column: "slug", op: "=", value: slug }] },
          });
          let armed = true;
          let reached: () => void = () => undefined;
          const there = new Promise<void>(resolve => {
            reached = resolve;
          });
          stopped = withStopPoints(
            async point => {
              const after = /^(.*_update[^:]*): after statement (\d+)$/.exec(
                point
              );
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
            stopped.then(
              answer => `the save ended first: ${endedFirst(answer)}`
            ),
          ]);
          expect(outcome, "the save never reached the kill point").toBe(
            "reached"
          );
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
              [
                field("heading"),
                text("subtitle"),
                text("summary"),
                text("caption"),
              ],
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
  }
);
