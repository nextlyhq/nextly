/**
 * While a Builder save the process left part-way stands unsettled with a schema step committed and
 * its registry update not run, every write any Nextly process makes that sets the field that step
 * changed is refused, naming the field; writes that set no such field go on; and a read is answered
 * from the tables, one that needs a column they no longer have under the registry's name getting
 * the same message, never a database error. Only the settle lifts it.
 *
 * Only MySQL commits a step of a file on its own, so only there can a step stand committed without
 * its registry update. On PostgreSQL and SQLite a kill finds none or all of the change, and no
 * write is refused.
 *
 * The save is killed in this process: the step at the kill point runs, then the save never returns.
 * The writes come from another process (`helpers/left-save-writer.ts`), through REST as the
 * signed-in editor and through the Direct API.
 */
import { execFile } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { superAdminUser } from "../../../../__tests__/fixtures/permission-holders";
import { createScratchDatabase } from "../../../../__tests__/helpers/fresh-database";
import { childLayoutArgs } from "../../../../__tests__/storage-layout";
import { buildClaims } from "../../../../auth/jwt/claims";
import { signAccessToken } from "../../../../auth/jwt/sign";
import { createAdapter } from "../../../../database/factory";
import { dispatchCollections } from "../../../../dispatcher/handlers/collection-dispatcher";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../../../plugins/test-nextly";
import type { ServiceContainer } from "../../../../services";
import { _resetEnvCache } from "../../../../shared/lib/env";
import { MIGRATION_LOCK_TABLE } from "../../../field-groups/migration/session";
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
import { settleLeftSaves } from "../settle-left-save";
import { settleRegistryWriter } from "../settle-registry";

/** Where the save is stopped, and how to let it go. Shared with the module mock below. */
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

// A save that pushes its change runs the push's statements through the statement executor: one at
// a time here, each followed by a point a process may be killed at, the statement kept, as MySQL
// keeps each schema statement as it runs.
vi.mock("../../services/drizzle-statement-executor", async original => {
  const actual =
    await original<typeof import("../../services/drizzle-statement-executor")>();
  class StoppingExecutor extends actual.DrizzleStatementExecutor {
    override async executeStatements(
      tx: unknown,
      statements: string[]
    ): Promise<void> {
      for (const statement of statements) {
        await super.executeStatements(tx, [statement]);
        await stopHere(`push: ${statement}`);
      }
    }
  }
  return { ...actual, DrizzleStatementExecutor: StoppingExecutor };
});

const run = promisify(execFile);
const WRITER = join(
  __dirname,
  "..",
  "..",
  "..",
  "..",
  "route-handler",
  "__tests__",
  "helpers",
  "left-save-writer.ts"
);
const MIGRATIONS = "./database/history";
const DEFINITION = "./schema/builder.json";
const EDITOR = "left-save-editor";

type Field = Record<string, unknown>;
const text = (name: string): Field => ({ name, type: "text" });

/** What one of the other process's operations came to (`helpers/left-save-writer.ts`). */
type Outcome = {
  kind: "write" | "read";
  via: "rest" | "api";
  data?: Record<string, unknown>;
  ok: boolean;
  status?: number;
  code?: string;
  message?: string;
  items?: Array<Record<string, unknown>>;
};

let basePath: string;
let current: TestNextly | undefined;
let stopped: Promise<unknown> | undefined;
let drops: Array<() => Promise<void>> = [];

beforeEach(() => {
  basePath = mkdtempSync(join(tmpdir(), "nextly-left-save-holds-"));
  drops = [];
});

afterEach(async () => {
  kill.at = undefined;
  kill.reached = undefined;
  kill.release?.();
  kill.release = undefined;
  await stopped;
  stopped = undefined;
  vi.restoreAllMocks();
  await current?.destroy();
  current = undefined;
  vi.unstubAllEnvs();
  _resetEnvCache();
  for (const drop of drops) await drop().catch(() => undefined);
  rmSync(basePath, { recursive: true, force: true });
}, 60_000);

/**
 * The two layouts a database keeps translatable values in: on the main tables, as databases made
 * before per-language storage do, and per language in translations tables, as every installation
 * keeps them now. The other process runs on the same one (`childLayoutArgs`).
 */
const LAYOUTS = [
  { layout: "translatable values on the main table", perLanguage: false },
  { layout: "translatable values per language", perLanguage: true },
] as const;

describe.each(
  getConfiguredTestDialects().flatMap(dialect =>
    LAYOUTS.map(layout => ({ dialect, ...layout }))
  )
)(
  "writes and reads while a Builder save is left part-way ($dialect, $layout)",
  ({
    dialect,
    perLanguage,
  }: {
    dialect: TestDialect;
    perLanguage: boolean;
  }) => {
    const slug = `held_notes_${dialect.slice(0, 2)}`;
    const table = `dc_${slug}`;
    let url: string;
    let cookie: string;

    /** A new database of this dialect, the instance on it, an editor, and the collection. */
    async function boot(): Promise<TestNextly> {
      if (dialect === "sqlite") {
        url = `file:${join(basePath, "site.db")}`;
      } else {
        const scratch = await createScratchDatabase(dialect, "nextly_held");
        drops.push(scratch.drop);
        url = scratch.url;
      }
      vi.stubEnv("DB_DIALECT", dialect);
      vi.stubEnv("DATABASE_URL", url);
      vi.stubEnv("NODE_ENV", "development");
      _resetEnvCache();
      current = await createTestNextly({
        adapter: (await createAdapter({ type: dialect, url } as Parameters<
          typeof createAdapter
        >[0])) as never,
        basePath,
        db: { migrationsDir: MIGRATIONS, uiSchemaFile: DEFINITION },
        perLanguageStorage: perLanguage,
      });
      await superAdminUser(current, EDITOR);
      cookie = `nextly_session=${await signAccessToken(
        buildClaims({
          userId: EDITOR,
          email: `${EDITOR}@example.test`,
          name: EDITOR,
          image: null,
          roleIds: [],
          sessionEpoch: 0,
        }),
        process.env.NEXTLY_SECRET ?? ""
      )}`;
      await dispatchCollections(
        {} as ServiceContainer,
        "createCollection",
        {},
        { name: slug, label: slug, fields: [text("heading"), text("note")] }
      );
      await current.nextly.create({
        collection: slug,
        data: { title: "First", slug: "first", heading: "h", note: "n" },
      } as never);
      return current;
    }

    /**
     * The columns of the collection's tables: its main table and its translations table, where
     * a translatable field's column is kept.
     */
    async function liveColumns(t: TestNextly): Promise<string[]> {
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

    async function versionOf(t: TestNextly): Promise<number> {
      const row = await t.adapter.selectOne<{ schema_version?: unknown }>(
        "dynamic_collections",
        { where: { and: [{ column: "slug", op: "=", value: slug }] } }
      );
      return Number(row?.schema_version ?? 1);
    }

    /** Start the save renaming `heading` to `headline` and kill it where `at` says. */
    async function killRename(
      t: TestNextly,
      at: (point: string) => Promise<boolean> | boolean
    ): Promise<void> {
      const reached = new Promise<void>(resolve => {
        kill.reached = resolve;
      });
      let armed = true;
      kill.at = point =>
        (point.startsWith("unit:") || point.startsWith("push:")) &&
        armed &&
        at(point) === true;
      const schemaVersion = await versionOf(t);
      stopped = withStopPoints(
        async point => {
          if (!armed || !(await at(point))) return;
          armed = false;
          kill.at = () => true;
          await stopHere(point);
        },
        () =>
          dispatchCollections(
            {} as ServiceContainer,
            "applySchemaChanges",
            { collectionName: slug },
            {
              fields: [text("headline"), text("note")],
              confirmed: true,
              schemaVersion,
              renameResolutions: [
                {
                  // A translatable field's column is in the translations table where values
                  // are kept per language.
                  tableName: perLanguage ? `${table}_locales` : table,
                  fromColumn: "heading",
                  toColumn: "headline",
                  choice: "rename",
                },
              ],
            }
          )
      ).catch((error: unknown) => error);
      const outcome = await Promise.race([
        reached.then(() => "reached"),
        stopped.then(answer => `the save ended first: ${String(answer)}`),
      ]);
      expect(outcome, "the save never reached the kill point").toBe("reached");
      await clearStoppedHolds(t);
    }

    /** What the killed process held, cleared as its lapse would clear it. */
    async function clearStoppedHolds(t: TestNextly): Promise<void> {
      await t.adapter.executeQuery(`DELETE FROM ${SCHEMA_LOCK_TABLE}`);
      for (const earlier of [MIGRATION_LOCK_TABLE, EARLIER_MIGRATE_LOCK_TABLE]) {
        if (await t.adapter.tableExists(earlier)) {
          await t.adapter.executeQuery(`DELETE FROM ${earlier}`);
        }
      }
      rmSync(join(basePath, MIGRATIONS, WRITER_LOCK_FILE), { force: true });
      if (dialect !== "mysql") return;
      const db = t.adapter.getDrizzle<{
        execute: (q: unknown) => Promise<unknown>;
      }>();
      const result = await db.execute(
        sql`SELECT IS_USED_LOCK(${MYSQL_MIGRATE_LOCK_NAME}) AS holder`
      );
      const rows = (
        Array.isArray(result) && Array.isArray(result[0]) ? result[0] : result
      ) as Array<{ holder: number | null }>;
      const holder = rows[0]?.holder;
      if (holder !== null && holder !== undefined) {
        await t.adapter.executeQuery(`KILL ${Number(holder)}`);
      }
    }

    /** `operations` sent from another process of the site, through REST and the Direct API. */
    async function fromAnotherProcess(
      operations: Array<Omit<Outcome, "ok">>
    ): Promise<Outcome[]> {
      const { stdout } = await run(
        process.execPath,
        [
          "--import",
          "tsx",
          ...childLayoutArgs(),
          WRITER,
          dialect,
          url,
          basePath,
          slug,
          JSON.stringify(operations),
        ],
        {
          cwd: join(__dirname, "..", "..", "..", "..", ".."),
          env: {
            ...process.env,
            NODE_ENV: "development",
            DB_DIALECT: dialect,
            DATABASE_URL: url,
            NEXTLY_TEST_COOKIE: cookie,
          },
          timeout: 150_000,
          maxBuffer: 64 * 1024 * 1024,
        }
      );
      const last = stdout.trim().split("\n").at(-1) ?? "[]";
      return JSON.parse(last) as Outcome[];
    }

    /** Writes setting the field under each name, one setting another field, and reads, both ways. */
    const operations = (field: string, n: number) => [
      {
        kind: "write" as const,
        via: "rest" as const,
        data: { title: `R${n}`, slug: `r${n}`, [field]: "x" },
      },
      {
        kind: "write" as const,
        via: "api" as const,
        data: { title: `A${n}`, slug: `a${n}`, [field]: "y" },
      },
      {
        kind: "write" as const,
        via: "rest" as const,
        data: { title: `RN${n}`, slug: `rn${n}`, note: "only the note" },
      },
      {
        kind: "write" as const,
        via: "api" as const,
        data: { title: `AN${n}`, slug: `an${n}`, note: "only the note" },
      },
      { kind: "read" as const, via: "rest" as const },
      { kind: "read" as const, via: "api" as const },
    ];

    /** A migration file's statements in run order, for the runner's `unit` name, from disk. */
    function statementsOf(unit: string): string[] {
      const folder = join(basePath, MIGRATIONS);
      const file = readdirSync(folder).find(
        name => name === unit || name === `${unit}.sql`
      );
      if (file === undefined) return [];
      const content = readFileSync(join(folder, file), "utf-8");
      return splitSqlStatements(parseSqlSections(content).upSql, "mysql");
    }

    /** Whether an outcome is a database error rather than an answer of Nextly's own. */
    const databaseError = (o: Outcome) =>
      /unknown column|no such column|does not exist|ER_BAD_FIELD/i.test(
        o.message ?? ""
      ) ||
      o.status === 500 ||
      o.code === "INTERNAL_ERROR";

    it.runIf(dialect === "mysql")(
      "refuses a write setting a field a committed rename changed, naming it, from another process; lets the rest through; and answers reads without a database error",
      async () => {
        const t = await boot();
        // Killed once the rename has committed, before its registry update: after the statement
        // that renames, read from the file the save runs or the push it makes, as no query may run
        // beside the save. A collection that keeps values per language pushes its change.
        await killRename(t, point => {
          if (point.startsWith("push: ")) {
            return /RENAME\s+COLUMN\s+`?heading`?/i.test(point);
          }
          const after = /^(.*_update[^:]*): after statement (\d+)$/.exec(point);
          if (after === null) return false;
          const statement = statementsOf(after[1]!)[Number(after[2]) - 1];
          return statement !== undefined && /^\s*EXECUTE\b/i.test(statement);
        });
        const columns = await liveColumns(t);
        expect(columns).toContain("headline");
        expect(columns).not.toContain("heading");

        const held = await fromAnotherProcess(operations("heading", 1));

        const [restSets, apiSets, restOther, apiOther, restRead, apiRead] =
          held;
        for (const refused of [restSets!, apiSets!]) {
          expect(refused.ok, JSON.stringify(refused)).toBe(false);
          expect(databaseError(refused), JSON.stringify(refused)).toBe(false);
          expect(refused.message, JSON.stringify(refused)).toMatch(/heading/);
        }
        expect(restSets!.status).toBe(409);
        for (const through of [restOther!, apiOther!]) {
          expect(through.ok, JSON.stringify(through)).toBe(true);
        }
        for (const read of [restRead!, apiRead!]) {
          expect(databaseError(read), JSON.stringify(read)).toBe(false);
        }

        // The next development start settles the save: both writes go through again.
        await settleLeftSaves({
          adapter: t.adapter,
          projectRoot: basePath,
          migrationsDir: join(basePath, MIGRATIONS),
          logger: { info: () => undefined, warn: () => undefined },
          writeRegistry: settleRegistryWriter(t.adapter),
        });
        const settled = await fromAnotherProcess(operations("headline", 2));
        for (const outcome of settled) {
          expect(outcome.ok, JSON.stringify(outcome)).toBe(true);
        }
      },
      600_000
    );

    // Killed before its file starts: a save that runs its file has a point there. One that pushes
    // (values kept per language) has none before its first statement; the comparison the hold
    // makes is the same on both, nothing changed and nothing held.
    it.runIf(!perLanguage)("refuses no write where the save was killed before its file ran", async () => {
      const t = await boot();
      // Before the save's first file runs, whichever file that is.
      await killRename(t, point => point.startsWith("unit:"));
      expect(await liveColumns(t)).toContain("heading");

      const outcomes = await fromAnotherProcess(operations("heading", 1));

      for (const outcome of outcomes) {
        expect(outcome.ok, JSON.stringify(outcome)).toBe(true);
      }
    }, 600_000);
  }
);
