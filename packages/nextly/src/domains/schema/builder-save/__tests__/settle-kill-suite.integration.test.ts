/**
 * The commands around a Builder save the process left part-way: before it is settled,
 * `migrate:check` and `migrate:create` refuse it, naming it, and change nothing; once the next
 * development start has settled it, `nextly migrate` plans nothing, `migrate:create` writes nothing
 * and `migrate:check` passes over the folder.
 *
 * Each kill is made as the record's own suite makes one: the step at the kill point runs and then
 * never returns, so no `catch` or `finally` of the save runs. The kill points:
 *
 * - before the save's file ran (every dialect): the settle finds none of it;
 * - after everything applied, before the record cleared (every dialect): the settle finds all of it;
 * - after the first statement of the file (MySQL, which commits each statement as it runs): the
 *   settle writes the file for exactly what applied. `nextly migrate`, which settles a development
 *   save before its run, refuses this one until then.
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

import { createScratchDatabase } from "../../../../__tests__/helpers/fresh-database";
import { runMigrate } from "../../../../cli/commands/migrate";
import { runMigrateCheck } from "../../../../cli/commands/migrate-check";
import { runMigrateCreate } from "../../../../cli/commands/migrate-create";
import type { CommandContext } from "../../../../cli/program";
import { createLogger } from "../../../../cli/utils/logger";
import { defineConfig } from "../../../../config";
import { createAdapter } from "../../../../database/factory";
import { dispatchSingles } from "../../../../dispatcher/handlers/single-dispatcher";
import { runBootTimeApplyIfDev } from "../../../../init/boot-apply";
import { _resetBootMigrationsGateForTest } from "../../../../init/boot-migrations-gate";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../../../plugins/test-nextly";
import { _resetEnvCache } from "../../../../shared/lib/env";
import { consoleLogger } from "../../../../shared/types";
import { MetaService } from "../../../meta/services/meta-service";
import {
  SchemaEventsRepository,
  type SchemaEventRow,
} from "../../events/schema-events-repository";
import { setNonInteractive } from "../../migrate/can-prompt";
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
import { settleLeftSaves, type SettledOutcome } from "../settle-left-save";
import { settleRegistryWriter } from "../settle-registry";
import { letRenamesGo, stoppedAtRename } from "./helpers/stop-at-rename";

// A settle may be stopped at one of its renames, as a process killed there.
vi.mock("node:fs/promises", async original =>
  (await import("./helpers/stop-at-rename")).stoppingRenames(
    await original<typeof import("node:fs/promises")>()
  )
);

/** Where the save is stopped, and how to let it go. Shared with the module mocks below. */
const kill = vi.hoisted(() => ({
  at: undefined as undefined | ((point: string) => boolean),
  reached: undefined as undefined | (() => void),
  release: undefined as undefined | (() => void),
}));

/** Stop for good where `point` is the kill point; the case releases it once it has looked. */
const stopHere = vi.hoisted(() => async (point: string): Promise<void> => {
  if (kill.at === undefined || !kill.at(point)) return;
  kill.at = undefined;
  await new Promise<void>((_, reject) => {
    kill.release = () =>
      reject(new Error(`the process was killed at ${point}`));
    kill.reached?.();
  });
});

// Each file runs as a unit: stop before one starts, as a process killed between two files would.
vi.mock("../../busy-table/run-unit", async original => {
  const actual = await original<typeof import("../../busy-table/run-unit")>();
  return {
    ...actual,
    runUnitInTries: async (
      ...args: Parameters<typeof actual.runUnitInTries>
    ) => {
      await stopHere(`unit:${args[2].source}`);
      return actual.runUnitInTries(...args);
    },
  };
});

/** The configuration the commands load: the project the instance runs. */
const loaded = vi.hoisted(() => ({ config: undefined as unknown }));
vi.mock("../../../../cli/program", () => ({
  createContext: () => ({ logger: createLogger({ quiet: true }) }),
}));
vi.mock("../../../../cli/utils/config-loader", async importOriginal => ({
  ...(await importOriginal<
    typeof import("../../../../cli/utils/config-loader")
  >()),
  loadConfig: async () => ({ config: loaded.config, dependencies: [] }),
}));

const MIGRATIONS = "./database/history";
const DEFINITION = "./schema/builder.json";
const SLUG = "suite_hero";
const TABLE = "single_suite_hero";
const RECORD_KEY = `builder-save-in-progress:single:${SLUG}`;
const PROJECT = defineConfig({
  collections: [],
  db: { migrationsDir: MIGRATIONS, uiSchemaFile: DEFINITION },
});

type Field = Record<string, unknown>;
const text = (name: string): Field => ({ name, type: "text" });

let basePath: string;
let current: TestNextly | undefined;
let stopped: Promise<unknown> | undefined;
let drops: Array<() => Promise<void>> = [];

beforeEach(() => {
  basePath = mkdtempSync(join(tmpdir(), "nextly-settle-kill-suite-"));
  drops = [];
  loaded.config = PROJECT;
});

afterEach(async () => {
  letRenamesGo();
  kill.at = undefined;
  kill.reached = undefined;
  kill.release?.();
  kill.release = undefined;
  await stopped;
  stopped = undefined;
  vi.restoreAllMocks();
  await current?.destroy();
  current = undefined;
  _resetBootMigrationsGateForTest();
  vi.unstubAllEnvs();
  _resetEnvCache();
  for (const drop of drops) await drop().catch(() => undefined);
  rmSync(basePath, { recursive: true, force: true });
}, 60_000);

const historyDir = () => join(basePath, "database", "history");
const sqlFiles = (): string[] =>
  existsSync(historyDir())
    ? readdirSync(historyDir())
        .filter(name => name.endsWith(".sql"))
        .sort()
    : [];

/**
 * The killed save's three kill points, each with the dialects it can stop on, the fields it added
 * that stand live while it is parked there, and how the next development start settles it.
 */
const KILLS: Array<{
  name: string;
  on: (dialect: TestDialect) => boolean;
  at: (point: string) => boolean;
  parked: string[];
  settles: SettledOutcome;
}> = [
  {
    name: "before its file ran",
    on: () => true,
    at: point => point.startsWith("unit:") && point.includes("_update"),
    parked: [],
    settles: "none",
  },
  {
    name: "after everything applied, before its record cleared",
    on: () => true,
    at: point => point === "clear",
    parked: ["subtitle", "summary"],
    settles: "all",
  },
  {
    name: "after the first statement of its file",
    on: dialect => dialect === "mysql",
    at: point =>
      point.includes("_update") && point.endsWith(": after statement 1"),
    parked: ["subtitle"],
    settles: "partial",
  },
];

/** The two fields the killed save adds, of which a kill point leaves some live. */
const ADDED = ["subtitle", "summary"];

describe.each(getConfiguredTestDialects())(
  "the commands around a Builder save left part-way (%s)",
  (dialect: TestDialect) => {
    /** A new database of this dialect, the instance on it, and the commands pointed at it. */
    async function boot(): Promise<TestNextly> {
      let url: string;
      if (dialect === "sqlite") {
        url = `file:${join(basePath, "test.db")}`;
      } else {
        const scratch = await createScratchDatabase(dialect, "nextly_sks");
        drops.push(scratch.drop);
        url = scratch.url;
      }
      vi.stubEnv("DB_DIALECT", dialect);
      vi.stubEnv("DATABASE_URL", url);
      vi.stubEnv("NODE_ENV", "development");
      _resetEnvCache();
      const adapter = await createAdapter({ type: dialect, url } as Parameters<
        typeof createAdapter
      >[0]);
      current = await createTestNextly({
        adapter,
        basePath,
        db: { migrationsDir: MIGRATIONS, uiSchemaFile: DEFINITION },
      });
      await dispatchSingles(
        "createSingle",
        {},
        { slug: SLUG, label: SLUG, fields: [text("heading")] }
      );
      return current;
    }

    async function versionOf(t: TestNextly): Promise<number> {
      const [row] = await t.adapter.select<{ schemaVersion: unknown }>(
        "dynamic_singles",
        { where: { and: [{ column: "slug", op: "=", value: SLUG }] } }
      );
      return Number(row?.schemaVersion ?? 1);
    }

    async function recordRow(t: TestNextly): Promise<unknown> {
      const entry = await new MetaService(t.adapter, consoleLogger).getEntry(
        RECORD_KEY
      );
      return entry.present ? entry.value : undefined;
    }

    async function liveColumns(t: TestNextly): Promise<string[]> {
      const live = await introspectLiveSnapshot(
        t.adapter.getDrizzle(),
        t.adapter.dialect,
        [TABLE]
      );
      return (live.tables.find(each => each.name === TABLE)?.columns ?? []).map(
        column => column.name
      );
    }

    /** The files this database's ledger records applied, sorted. */
    async function appliedFiles(t: TestNextly): Promise<string[]> {
      const rows = await new SchemaEventsRepository(
        t.adapter.getDrizzle(),
        t.adapter.dialect
      ).listFileApplies();
      return rows
        .filter(row => row.status === "applied")
        .map(row => String(row.filename))
        .sort();
    }

    /**
     * Every file-apply event this database's ledger holds, by id: a refused command that appended
     * one, applied or not, changes it, where `appliedFiles` sees only the applied ones.
     */
    async function fileApplyRows(t: TestNextly): Promise<SchemaEventRow[]> {
      const rows = await new SchemaEventsRepository(
        t.adapter.getDrizzle(),
        t.adapter.dialect
      ).listFileApplies();
      return [...rows].sort((a, b) => a.id.localeCompare(b.id));
    }

    /** Start a save adding two fields and kill it at `at`; resolves once it has stopped there. */
    async function killSave(
      t: TestNextly,
      at: (point: string) => boolean
    ): Promise<void> {
      const realDelete = MetaService.prototype.delete;
      vi.spyOn(MetaService.prototype, "delete").mockImplementation(
        async function (this: MetaService, key: string) {
          if (key === RECORD_KEY) await stopHere("clear");
          return realDelete.call(this, key);
        }
      );
      const reached = new Promise<void>(resolve => {
        kill.reached = resolve;
      });
      kill.at = at;
      const schemaVersion = await versionOf(t);
      stopped = withStopPoints(
        point => stopHere(point),
        () =>
          dispatchSingles(
            "applySingleSchemaChanges",
            { slug: SLUG },
            {
              fields: [text("heading"), text("subtitle"), text("summary")],
              confirmed: true,
              schemaVersion,
            }
          )
      ).catch((error: unknown) => error);
      const outcome = await Promise.race([
        reached.then(() => "reached"),
        stopped.then(answer => `the save ended first: ${String(answer)}`),
      ]);
      expect(outcome, "the save never reached the kill point").toBe("reached");
      vi.mocked(MetaService.prototype.delete).mockRestore();
      expect(await recordRow(t), "the record the kill left").toBeDefined();
      await clearStoppedHolds(t);
    }

    /**
     * What the killed process held, cleared as its lapse would clear it: the schema lock's row, the
     * earlier locks' rows it holds beside it (the field-group lock, and PostgreSQL's migrate lock),
     * the project's writer hold, and on MySQL the named lock its connection holds, which only that
     * connection's end releases.
     */
    async function clearStoppedHolds(t: TestNextly): Promise<void> {
      await t.adapter.executeQuery(`DELETE FROM ${SCHEMA_LOCK_TABLE}`);
      for (const earlier of [
        MIGRATION_LOCK_TABLE,
        EARLIER_MIGRATE_LOCK_TABLE,
      ]) {
        if (await t.adapter.tableExists(earlier)) {
          await t.adapter.executeQuery(`DELETE FROM ${earlier}`);
        }
      }
      rmSync(join(historyDir(), WRITER_LOCK_FILE), { force: true });
      if (dialect !== "mysql") return;
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

    /** Whether a command ended well: it returned, or exited with 0 (`migrate:create` with nothing to write). */
    const ok = (code: number | undefined): boolean =>
      code === undefined || code === 0;

    /** A command over the project, as its CLI would run it: its exit code and what it said. */
    async function command(
      run: (context: CommandContext) => Promise<void>
    ): Promise<{ code: number | undefined; said: string }> {
      const said: string[] = [];
      const capture = (message: string) => {
        said.push(message);
      };
      const context = {
        logger: {
          ...createLogger({ quiet: true }),
          error: capture,
          info: capture,
          success: capture,
          warn: capture,
        },
        options: {},
        cwd: basePath,
      } as CommandContext;
      const printed = vi
        .spyOn(console, "error")
        .mockImplementation((...parts: unknown[]) => {
          said.push(parts.map(String).join(" "));
        });
      const exit = vi.spyOn(process, "exit").mockImplementation(code => {
        throw new Error(`exit ${String(code)}`);
      });
      try {
        await run(context);
        return { code: undefined, said: said.join("\n") };
      } catch (error) {
        const match = /^exit (\d+)$/.exec((error as Error).message);
        if (match) return { code: Number(match[1]), said: said.join("\n") };
        const e = error as { publicMessage?: string; message?: string };
        said.push(String(e.publicMessage ?? e.message));
        return { code: 1, said: said.join("\n") };
      } finally {
        exit.mockRestore();
        printed.mockRestore();
      }
    }

    /** The killed save's fields a migration file's UP adds to the Single's table, in order. */
    function addsOf(text: string): string[] {
      const up = text.split("-- DOWN")[0] ?? "";
      return ADDED.filter(name =>
        new RegExp(
          `ALTER\\s+TABLE\\s+[\`"]?${TABLE}[\`"]?\\s+ADD\\s+(COLUMN\\s+)?[\`"]?${name}[\`"]?`,
          "i"
        ).test(up)
      );
    }

    const migrate = () =>
      command(context =>
        runMigrate(
          { cwd: basePath, throwOnFailure: true } as Parameters<
            typeof runMigrate
          >[0],
          context
        )
      );
    const check = () =>
      command(context => runMigrateCheck({ cwd: basePath }, context));
    const create = () => {
      setNonInteractive(true);
      return command(context =>
        runMigrateCreate("after", { cwd: basePath }, context)
      ).finally(() => setNonInteractive(false));
    };

    for (const killed of KILLS) {
      it.runIf(killed.on(dialect))(
        `refuses migrate:check and migrate:create before the settle, then plans and writes nothing once it ran, a save killed ${killed.name}`,
        async () => {
          const t = await boot();
          await killSave(t, killed.at);
          // How far the save got, read off the live table while it is parked.
          const parked = await liveColumns(t);
          expect(
            ADDED.filter(name => parked.includes(name)),
            "the fields live while parked"
          ).toEqual(killed.parked);
          const files = sqlFiles();
          const ledger = await fileApplyRows(t);

          const checked = await check();
          const created = await create();

          expect(ok(checked.code), checked.said).toBe(false);
          expect(checked.said).toContain("left part-way");
          expect(ok(created.code), created.said).toBe(false);
          expect(created.said).toContain("left part-way");
          expect(sqlFiles(), "the folder unchanged").toEqual(files);
          expect(await fileApplyRows(t), "the ledger unchanged").toEqual(
            ledger
          );

          // The next development start settles it, as far as the save got.
          const settled = await settleLeftSaves({
            adapter: t.adapter,
            projectRoot: basePath,
            migrationsDir: historyDir(),
            logger: { info: () => undefined, warn: () => undefined },
            writeRegistry: settleRegistryWriter(t.adapter),
          });
          expect(settled.map(each => each.outcome)).toEqual([killed.settles]);
          expect(await recordRow(t), "the record clears").toBeUndefined();
          const settledFiles = sqlFiles();
          const settledApplied = await appliedFiles(t);
          const columns = await liveColumns(t);

          const migrated = await migrate();
          expect(ok(migrated.code), migrated.said).toBe(true);
          expect(await appliedFiles(t), "migrate plans nothing").toEqual(
            settledApplied
          );
          expect(await liveColumns(t)).toEqual(columns);
          const createdAfter = await create();
          expect(ok(createdAfter.code), createdAfter.said).toBe(true);
          expect(sqlFiles(), "migrate:create writes nothing").toEqual(
            settledFiles
          );
          const checkedAfter = await check();
          expect(ok(checkedAfter.code), checkedAfter.said).toBe(true);
        },
        300_000
      );
    }

    it.runIf(dialect === "mysql")(
      "settles a save killed inside its file at nextly migrate in development, its stopped file kept aside, then runs",
      async () => {
        const t = await boot();
        const before = sqlFiles();
        await killSave(t, KILLS[2]!.at);
        const stoppedFile = sqlFiles().find(f => !before.includes(f));
        expect(stoppedFile, "the stopped file").toBeDefined();

        const migrated = await migrate();

        expect(ok(migrated.code), migrated.said).toBe(true);
        expect(await recordRow(t), "the record clears").toBeUndefined();
        // One file for what applied in the stopped one's place, and the stopped one kept aside.
        const written = sqlFiles().filter(f => !before.includes(f));
        expect(written).toHaveLength(1);
        expect(written[0]).not.toBe(stoppedFile);
        const aside = join(historyDir(), `${stoppedFile!}.stopped`);
        expect(existsSync(aside), "the stopped file kept aside").toBe(true);
        // The replacement adds what applied, and only that. The stopped file, the control, adds
        // both fields, so an UP that read either file's text whole would be told apart.
        expect(addsOf(readFileSync(aside, "utf-8"))).toEqual(ADDED);
        expect(
          addsOf(readFileSync(join(historyDir(), written[0]!), "utf-8"))
        ).toEqual(["subtitle"]);
        expect(await liveColumns(t)).toContain("subtitle");
        // The folder the settle left passes the checks the next commands make.
        const checked = await check();
        expect(ok(checked.code), checked.said).toBe(true);
        const migratedAgain = await migrate();
        expect(ok(migratedAgain.code), migratedAgain.said).toBe(true);
      },
      300_000
    );

    /**
     * A settle set the stopped file aside and stopped; the next one put it back and was killed
     * there, before it judged anything: the file stands in the folder as the stop left it.
     */
    async function killedOncePutBack(t: TestNextly): Promise<string> {
      const before = sqlFiles();
      await killSave(t, KILLS[2]!.at);
      const [stoppedFile] = sqlFiles().filter(f => !before.includes(f));
      await setAside({ migrationsDir: historyDir() }, stoppedFile!);
      expect(
        await stoppedAtRename(
          from => from.endsWith(".stopped") && from.includes("meta"),
          () =>
            settleLeftSaves({
              adapter: t.adapter,
              projectRoot: basePath,
              migrationsDir: historyDir(),
              logger: { info: () => undefined, warn: () => undefined },
              writeRegistry: settleRegistryWriter(t.adapter),
            })
        ),
        "the settle stopped once its file was back"
      ).toBe("reached");
      expect(sqlFiles(), "the file is back in the folder").toContain(
        stoppedFile
      );
      return stoppedFile!;
    }

    /** A development start over the project, and everything it logged. */
    async function startSays(): Promise<string> {
      const lines: string[] = [];
      const spies = (["info", "warn", "error"] as const).map(level =>
        vi
          .spyOn(consoleLogger, level)
          .mockImplementation(message => void lines.push(String(message)))
      );
      try {
        await runBootTimeApplyIfDev({ caller: "kill suite" });
      } finally {
        for (const spy of spies) spy.mockRestore();
      }
      return lines.join("\n");
    }

    // The control: with neither the record nor the attempt standing, the same start over the same
    // folder reads the file as pending and runs it.
    it.runIf(dialect === "mysql")(
      "runs the same file at a development start once neither its record nor its attempt stands",
      async () => {
        const t = await boot();
        const stoppedFile = await killedOncePutBack(t);
        const ledger = await fileApplyRows(t);
        await new MetaService(t.adapter, consoleLogger).delete(RECORD_KEY);
        await t.adapter.executeQuery(
          `DELETE FROM nextly_schema_events WHERE filename = '${stoppedFile}'`
        );

        const said = await startSays();

        const ran = (await fileApplyRows(t)).filter(
          row =>
            row.filename === stoppedFile &&
            !ledger.some(earlier => earlier.id === row.id)
        );
        expect(ran.length, said).toBeGreaterThan(0);
      },
      300_000
    );

    // Back in the folder, the file is no migration to run: the settle comes first, and where it
    // refuses or leaves the save, neither command nor start runs anything.
    for (const unsettled of [
      {
        name: "the history refuses the settle",
        make: (_t: TestNextly, stoppedFile: string) => {
          const applied = sqlFiles().find(f => f !== stoppedFile);
          const path = join(historyDir(), applied!);
          writeFileSync(path, `${readFileSync(path, "utf-8")}\n-- edited\n`);
          return Promise.resolve();
        },
      },
      {
        name: "the settle leaves the save as it stands",
        // A record that does not say what its files carry is never judged from the tables.
        make: async (t: TestNextly) => {
          const record = (await recordRow(t)) as Record<string, unknown>;
          const { ownStatements: _, ...older } = record;
          await new MetaService(t.adapter, consoleLogger).set(
            RECORD_KEY,
            older
          );
        },
      },
    ]) {
      it.runIf(dialect === "mysql")(
        `runs nothing of a file put back by a killed settle, at nextly migrate or a development start, where ${unsettled.name}`,
        async () => {
          const t = await boot();
          const stoppedFile = await killedOncePutBack(t);
          await unsettled.make(t, stoppedFile);
          const ledger = await fileApplyRows(t);
          const columns = await liveColumns(t);

          const migrated = await migrate();
          expect(ok(migrated.code), migrated.said).toBe(false);
          expect(await fileApplyRows(t), "migrate ran nothing").toEqual(ledger);
          expect(await liveColumns(t)).toEqual(columns);

          const said = await startSays();
          expect(said).toContain("Pending migrations were not applied");
          expect(await fileApplyRows(t), "the start ran nothing").toEqual(
            ledger
          );
          expect(await liveColumns(t)).toEqual(columns);
          expect(await recordRow(t), "the record stays").toBeDefined();
        },
        300_000
      );
    }

    it.runIf(dialect === "mysql")(
      "refuses nextly migrate in production on a save killed inside its file, writing nothing",
      async () => {
        const t = await boot();
        await killSave(t, KILLS[2]!.at);
        const files = sqlFiles();
        const ledger = await fileApplyRows(t);
        vi.stubEnv("NODE_ENV", "production");
        _resetEnvCache();

        const migrated = await migrate();

        vi.stubEnv("NODE_ENV", "development");
        _resetEnvCache();
        expect(ok(migrated.code), migrated.said).toBe(false);
        expect(migrated.said).toContain("left part-way");
        expect(sqlFiles()).toEqual(files);
        expect(await fileApplyRows(t), "the ledger unchanged").toEqual(ledger);
        expect(await recordRow(t), "the record stays").toBeDefined();
      },
      300_000
    );
  }
);
