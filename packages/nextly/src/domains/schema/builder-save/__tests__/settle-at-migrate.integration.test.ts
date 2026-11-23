/**
 * `nextly migrate` settles a Builder save left part-way before its run, and the commands that
 * cannot settle one refuse while it stands.
 *
 * A save made outside development is left here as its process leaves it when stopped after its
 * last write: its definition written, its migration files and snapshots written from it (as
 * `migrate:create` writes them, and as the save writes them), none applied, and its record (the
 * row and the project's marker) standing.
 *
 * - `nextly migrate` judges a save made outside development by its files: whole files run; a save
 *   stopped before its definition has its own unapplied files withdrawn; a file this database has
 *   applied is never removed, and the run refuses.
 * - It settles a development save as a development start does: one stopped before its file ran has
 *   its files removed and its definition put back, then the run goes on.
 * - What it cannot settle (another machine's applying save) refuses the run before its first file.
 * - A production start that migrates settles nothing: it refuses, leaving the files and the
 *   definition as they are.
 * - `migrate:check` and `migrate:create` refuse on this machine's marker.
 */
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { hostname, tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createScratchDatabase } from "../../../../__tests__/helpers/fresh-database";
import { runMigrate } from "../../../../cli/commands/migrate";
import { runMigrateCheck } from "../../../../cli/commands/migrate-check";
import { runMigrateCreate } from "../../../../cli/commands/migrate-create";
import type { CommandContext } from "../../../../cli/program";
import { createLogger } from "../../../../cli/utils/logger";
import { serializeUiSchema } from "../../../../cli/utils/ui-schema-writer";
import { defineConfig } from "../../../../config";
import { createAdapter } from "../../../../database/factory";
import { dispatchSingles } from "../../../../dispatcher/handlers/single-dispatcher";
import { _resetBootMigrationsGateForTest } from "../../../../init/boot-migrations-gate";
import { runProdMigrationsIfEnabled } from "../../../../init/prod-migrations";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../../../plugins/test-nextly";
import { _resetEnvCache } from "../../../../shared/lib/env";
import { sanitizeConfig } from "../../../../shared/types/config";
import { consoleLogger } from "../../../../shared/types";
import { MetaService } from "../../../meta/services/meta-service";
import { SchemaEventsRepository } from "../../events/schema-events-repository";
import { recordAlreadyApplied } from "../../migrate/drift-reconcile";
import { setNonInteractive } from "../../migrate/can-prompt";
import { newestSnapshotName } from "../../migrate-create/snapshot-io";
import { introspectLiveSnapshot } from "../../pipeline/diff/introspect-live";
import { SCHEMA_LOCK_TABLE, withSchemaLock } from "../../pipeline/schema-lock";

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
const SLUG = "migrate_hero";
const TABLE = "single_migrate_hero";
const RECORD_KEY = `builder-save-in-progress:single:${SLUG}`;
const PROJECT = defineConfig({
  collections: [],
  db: { migrationsDir: MIGRATIONS, uiSchemaFile: DEFINITION },
});

type Field = Record<string, unknown>;
const text = (name: string): Field => ({ name, type: "text" });

let basePath: string;
let current: TestNextly | undefined;
let drops: Array<() => Promise<void>> = [];

beforeEach(() => {
  basePath = mkdtempSync(join(tmpdir(), "nextly-settle-at-migrate-"));
  drops = [];
  loaded.config = PROJECT;
});

afterEach(async () => {
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
const definitionText = (): string | null => {
  const file = join(basePath, DEFINITION);
  return existsSync(file) ? readFileSync(file, "utf-8") : null;
};
const markers = (): string[] => {
  const dir = join(basePath, ".nextly", "save-in-progress");
  return existsSync(dir) ? readdirSync(dir) : [];
};

describe.each(getConfiguredTestDialects())(
  "a Builder save left part-way, at nextly migrate (%s)",
  (dialect: TestDialect) => {
    /** A new database of this dialect, the instance on it, and the commands pointed at it. */
    async function boot(): Promise<TestNextly> {
      let url: string;
      if (dialect === "sqlite") {
        url = `file:${join(basePath, "test.db")}`;
      } else {
        const scratch = await createScratchDatabase(dialect, "nextly_sam");
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
      // A Single, created and applied in development.
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

    /**
     * A save adding `alpha` made outside development, stopped after its last write: its
     * definition and its files written, none applied, its record and marker standing.
     */
    async function leftSave(
      t: TestNextly
    ): Promise<{ written: string[]; before: string; after: string }> {
      const before = definitionText() ?? "";
      const filesBefore = sqlFiles();
      const startedFrom =
        (await newestSnapshotName(join(historyDir(), "meta"))) ?? null;
      const manifest = JSON.parse(before) as {
        singles: Array<{ slug: string; fields: Field[] }>;
      };
      const single = manifest.singles.find(each => each.slug === SLUG);
      single?.fields.push(text("alpha"));
      const after = serializeUiSchema(manifest as never);
      writeFileSync(join(basePath, DEFINITION), after);
      setNonInteractive(true);
      const created = await command(context =>
        runMigrateCreate("hero_alpha", { cwd: basePath }, context)
      ).finally(() => setNonInteractive(false));
      expect(created.code, created.said).toBeUndefined();
      const written = sqlFiles().filter(name => !filesBefore.includes(name));
      expect(written.length, "the save's files").toBeGreaterThan(0);
      const record = {
        id: "a-save-made-outside-development",
        kind: "single",
        slug: SLUG,
        startedAt: new Date().toISOString(),
        host: hostname(),
        database: "unknown",
        definitionFile: DEFINITION.replace(/^\.\//, ""),
        definitionBefore: before,
        definitionAfter: after,
        startedFrom,
        files: written,
        applies: false,
      };
      await new MetaService(t.adapter, consoleLogger).set(RECORD_KEY, record);
      const folder = join(basePath, ".nextly", "save-in-progress");
      mkdirSync(folder, { recursive: true });
      writeFileSync(
        join(folder, `single-${SLUG}-${record.id}.json`),
        JSON.stringify(record)
      );
      return { written, before, after };
    }

    async function recordRow(t: TestNextly): Promise<unknown> {
      const entry = await new MetaService(t.adapter, consoleLogger).getEntry(
        RECORD_KEY
      );
      return entry.present ? entry.value : undefined;
    }

    async function setRecord(
      t: TestNextly,
      change: Record<string, unknown>
    ): Promise<void> {
      const meta = new MetaService(t.adapter, consoleLogger);
      await meta.set(RECORD_KEY, {
        ...((await recordRow(t)) as Record<string, unknown>),
        ...change,
      });
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

    async function isApplied(t: TestNextly, file: string): Promise<boolean> {
      return new SchemaEventsRepository(
        t.adapter.getDrizzle(),
        t.adapter.dialect
      ).isFileApplied(file);
    }

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

    const migrate = (options: Record<string, unknown> = {}) =>
      command(context =>
        runMigrate(
          { cwd: basePath, throwOnFailure: true, ...options } as Parameters<
            typeof runMigrate
          >[0],
          context
        )
      );

    it("runs the whole files of a save made outside development, and clears its record", async () => {
      const t = await boot();
      const { written } = await leftSave(t);
      expect(await liveColumns(t)).not.toContain("alpha");

      const run = await migrate();

      expect(run.code, run.said).toBeUndefined();
      expect(await recordRow(t), "the record clears").toBeUndefined();
      expect(markers(), "its marker goes with it").toEqual([]);
      for (const file of written) {
        expect(await isApplied(t, file), file).toBe(true);
      }
      expect(await liveColumns(t)).toContain("alpha");
    }, 300_000);

    it("withdraws the files of a save made outside development stopped before its definition", async () => {
      const t = await boot();
      const { written, before } = await leftSave(t);
      // As a save stopped before its definition leaves it: the definition it found.
      writeFileSync(join(basePath, DEFINITION), before ?? "");

      const run = await migrate();

      expect(run.code, run.said).toBeUndefined();
      expect(await recordRow(t), "the record clears").toBeUndefined();
      expect(sqlFiles().filter(file => written.includes(file))).toEqual([]);
      expect(definitionText()).toBe(before);
      expect(await liveColumns(t)).not.toContain("alpha");
    }, 300_000);

    it("never removes a file this database has applied, and refuses the run", async () => {
      const t = await boot();
      const { written, before } = await leftSave(t);
      writeFileSync(join(basePath, DEFINITION), before ?? "");
      // One of its files recorded applied here, as a run before this one could have left it.
      await recordAlreadyApplied(
        { filename: written[0] ?? "" },
        new SchemaEventsRepository(t.adapter.getDrizzle(), t.adapter.dialect)
      );

      const run = await migrate();

      expect(run.code, run.said).not.toBeUndefined();
      expect(run.said).toContain("left part-way");
      expect(sqlFiles(), "the save's files stay").toEqual(
        expect.arrayContaining(written)
      );
      expect(await recordRow(t), "the record stays").toBeDefined();
    }, 300_000);

    it("settles a development save stopped before its file ran, then runs", async () => {
      const t = await boot();
      const { written, before } = await leftSave(t);
      // As a development save stopped after writing its files, before they ran.
      await setRecord(t, { applies: true });

      const run = await migrate();

      expect(run.code, run.said).toBeUndefined();
      expect(await recordRow(t), "the record clears").toBeUndefined();
      expect(sqlFiles().filter(file => written.includes(file))).toEqual([]);
      expect(definitionText()).toBe(before);
      expect(await liveColumns(t)).not.toContain("alpha");
    }, 300_000);

    it("refuses before its first file while another machine's applying save is left", async () => {
      const t = await boot();
      const { written } = await leftSave(t);
      await setRecord(t, { applies: true, host: "another-machine" });

      const run = await migrate();

      expect(run.code, run.said).not.toBeUndefined();
      expect(run.said).toContain("another-machine");
      for (const file of written) {
        expect(await isApplied(t, file), file).toBe(false);
      }
      expect(await liveColumns(t)).not.toContain("alpha");
    }, 300_000);

    // Another machine's save made outside development changed no table here, but where it shares
    // this project's migration folder the files it left are here, part of a save it never finished:
    // run, they would apply a part of a change. The run refuses, naming the save.
    it("refuses before its first file over another machine's save made outside development whose files are in this folder", async () => {
      const t = await boot();
      const { written } = await leftSave(t);
      await setRecord(t, { host: "another-machine" });

      const run = await migrate();

      expect(run.code, run.said).not.toBeUndefined();
      expect(run.said).toContain("another-machine");
      for (const file of written) {
        expect(await isApplied(t, file), file).toBe(false);
      }
      expect(await liveColumns(t)).not.toContain("alpha");
      expect(await recordRow(t), "the record stays").toBeDefined();
    }, 300_000);

    it("goes on, with a notice, over another machine's save made outside development whose files are not in this folder", async () => {
      const t = await boot();
      const { written, before } = await leftSave(t);
      await setRecord(t, { host: "another-machine" });
      // The save's files and its definition are on its own machine, not in this project.
      writeFileSync(join(basePath, DEFINITION), before);
      for (const file of written) {
        rmSync(join(historyDir(), file), { force: true });
        rmSync(
          join(historyDir(), "meta", file.replace(/\.sql$/, ".snapshot.json")),
          { force: true }
        );
      }

      const run = await migrate();

      expect(run.code, run.said).toBeUndefined();
      expect(run.said).toContain("made outside development");
      expect(
        await recordRow(t),
        "the record stays, its machine's"
      ).toBeDefined();
    }, 300_000);

    it("refuses a production start over another machine's save made outside development whose files are in this folder", async () => {
      const t = await boot();
      const { written } = await leftSave(t);
      await setRecord(t, { host: "another-machine" });
      vi.stubEnv("NODE_ENV", "production");
      // A production start reads the project from its own folder.
      vi.spyOn(process, "cwd").mockReturnValue(basePath);
      const logger = {
        info: () => undefined,
        warn: () => undefined,
        error: () => undefined,
        debug: () => undefined,
      };

      const started = await runProdMigrationsIfEnabled({
        adapter: t.adapter as never,
        config: {
          db: {
            runMigrationsOnBoot: true,
            migrationsDir: historyDir(),
            uiSchemaFile: DEFINITION,
          },
          collections: [],
          singles: [],
        },
        served: sanitizeConfig(PROJECT) as never,
        logger,
        afterMigrations: async () => undefined,
      }).then(
        ran => `ran: ${String(ran)}`,
        (error: unknown) =>
          (error as { publicMessage?: string }).publicMessage ?? String(error)
      );

      expect(started).toContain("another-machine");
      for (const file of written) {
        expect(await isApplied(t, file), file).toBe(false);
      }
    }, 300_000);

    // A marker of a save against another database, with no row here (that database holds it), is
    // that database's to settle: a run against this one leaves it, so the commands with no
    // database still refuse there.
    it("keeps the marker of a save against another database", async () => {
      await boot();
      const folder = join(basePath, ".nextly", "save-in-progress");
      mkdirSync(folder, { recursive: true });
      const marker = join(folder, `single-${SLUG}-another-database.json`);
      writeFileSync(
        marker,
        JSON.stringify({
          id: "another-database",
          kind: "single",
          slug: SLUG,
          startedAt: new Date().toISOString(),
          host: hostname(),
          database: "0".repeat(32),
          definitionFile: DEFINITION.replace(/^\.\//, ""),
          definitionBefore: null,
          applies: true,
        })
      );

      const run = await migrate();

      expect(run.code, run.said).toBeUndefined();
      expect(existsSync(marker), "the other database's marker").toBe(true);
    }, 300_000);

    // A file the save wrote that is gone from the folder can be neither run nor withdrawn: the
    // save is not settled around it, and the run refuses with the record standing.
    it("refuses a save made outside development whose file is gone from the folder", async () => {
      const t = await boot();
      const { written } = await leftSave(t);
      for (const file of written) rmSync(join(historyDir(), file));

      const run = await migrate();

      expect(run.code, run.said).not.toBeUndefined();
      expect(run.said).toContain("left part-way");
      expect(await recordRow(t), "the record stays").toBeDefined();
    }, 300_000);

    // A consent the command refuses ends the run before its settle changes anything.
    it("settles nothing when the run's consent is refused", async () => {
      const t = await boot();
      const { written, after } = await leftSave(t);

      const run = await migrate({ acceptDataLoss: "a.b.c" });

      expect(run.code, run.said).not.toBeUndefined();
      expect(run.said).toContain("not a list of tables");
      expect(await recordRow(t), "the record stays").toBeDefined();
      expect(sqlFiles()).toEqual(expect.arrayContaining(written));
      expect(definitionText()).toBe(after);
    }, 300_000);

    // `--force-unlock` clears a lock a stopped run left before the settle takes it.
    it("clears a stale lock with --force-unlock before the settle takes it", async () => {
      const t = await boot();
      // The lock's row as a run that stopped leaves it: its claim and lease, taken by a real run of
      // the lock and written back once that run has let go. Nothing holds it any more (on MySQL,
      // no connection holds its named lock), yet the row says it is held.
      type LockRow = Record<string, unknown>;
      const where = { and: [{ column: "id", op: "=" as const, value: 1 }] };
      let claimed: LockRow | undefined;
      await withSchemaLock(
        {
          adapter: t.adapter as never,
          command: "test: a run that stopped",
          whenHeld: "wait",
        },
        async () => {
          [claimed] = await t.adapter.select<LockRow>(SCHEMA_LOCK_TABLE, {
            columns: ["owner", "command", "acquired_at", "expires_at"],
            where,
          });
        }
      );
      expect(claimed?.owner, "the stopped run's claim").toEqual(
        expect.any(String)
      );
      await t.adapter.update(SCHEMA_LOCK_TABLE, claimed ?? {}, where);

      const run = await migrate({ forceUnlock: true });

      expect(run.code, run.said).toBeUndefined();
    }, 300_000);

    // A create that applied whole and stopped before its registry row was written: the settle
    // makes no row, but the run's metadata pass adds it from the newest applied snapshot, and the
    // settle after the run brings it up and clears the record.
    it("finishes a create stopped before its registry row", async () => {
      const t = await boot();
      await new MetaService(t.adapter, consoleLogger).set(RECORD_KEY, {
        id: "a-create-stopped-before-its-row",
        kind: "single",
        slug: SLUG,
        startedAt: new Date().toISOString(),
        host: hostname(),
        database: "unknown",
        definitionFile: DEFINITION.replace(/^\.\//, ""),
        definitionBefore: null,
        definitionAfter: definitionText(),
        startedFrom: null,
        files: sqlFiles(),
        applies: true,
      });
      await t.adapter.delete("dynamic_singles", {
        and: [{ column: "slug", op: "=", value: SLUG }],
      });

      const run = await migrate();

      expect(run.code, run.said).toBeUndefined();
      expect(await recordRow(t), "the record clears").toBeUndefined();
      const [row] = await t.adapter.select<{ slug: string }>(
        "dynamic_singles",
        { where: { and: [{ column: "slug", op: "=", value: SLUG }] } }
      );
      expect(row?.slug, "the registry row").toBe(SLUG);
    }, 300_000);

    // A development create stopped before its file ran is withdrawn by the settle: its files go and
    // its definition is put back, and the run plans from the project as the settle left it, not
    // from the declarations read before it.
    it("runs from the project as the settle left it after withdrawing a create", async () => {
      const t = await boot();
      const fresh = "settle_fresh";
      const before = definitionText() ?? "";
      const filesBefore = sqlFiles();
      const startedFrom =
        (await newestSnapshotName(join(historyDir(), "meta"))) ?? null;
      const manifest = JSON.parse(before) as {
        singles: Array<Record<string, unknown>>;
      };
      const hero = manifest.singles.find(each => each.slug === SLUG) ?? {};
      manifest.singles.push({
        ...hero,
        slug: fresh,
        label: fresh,
        fields: [text("title")],
      });
      const after = serializeUiSchema(manifest as never);
      writeFileSync(join(basePath, DEFINITION), after);
      setNonInteractive(true);
      const created = await command(context =>
        runMigrateCreate("fresh", { cwd: basePath }, context)
      ).finally(() => setNonInteractive(false));
      expect(created.code, created.said).toBeUndefined();
      const written = sqlFiles().filter(name => !filesBefore.includes(name));
      await new MetaService(t.adapter, consoleLogger).set(
        `builder-save-in-progress:single:${fresh}`,
        {
          id: "a-create-stopped-before-its-file",
          kind: "single",
          slug: fresh,
          startedAt: new Date().toISOString(),
          host: hostname(),
          database: "unknown",
          definitionFile: DEFINITION.replace(/^\.\//, ""),
          definitionBefore: before,
          definitionAfter: after,
          startedFrom,
          files: written,
          applies: true,
        }
      );

      const run = await migrate();

      expect(run.code, run.said).toBeUndefined();
      expect(sqlFiles().filter(file => written.includes(file))).toEqual([]);
      expect(definitionText()).toBe(before);
      // Read from the declarations before the settle, the run would report the withdrawn create
      // as declared with no registry row.
      expect(
        run.said,
        "the run reads the withdrawn create as still declared"
      ).not.toContain(`"${fresh}" is declared in the configuration`);
    }, 300_000);

    it("refuses a production start that migrates, leaving the files and the definition as they are", async () => {
      const t = await boot();
      const { written, after } = await leftSave(t);
      const files = sqlFiles();
      vi.stubEnv("NODE_ENV", "production");
      // A production start reads the project from its own folder.
      vi.spyOn(process, "cwd").mockReturnValue(basePath);
      const logged: string[] = [];
      const logger = {
        info: () => undefined,
        warn: (m: string) => logged.push(m),
        error: (m: string) => logged.push(m),
        debug: () => undefined,
      };

      const started = await runProdMigrationsIfEnabled({
        adapter: t.adapter as never,
        config: {
          db: {
            runMigrationsOnBoot: true,
            migrationsDir: historyDir(),
            uiSchemaFile: DEFINITION,
          },
          collections: [],
          singles: [],
        },
        served: sanitizeConfig(PROJECT) as never,
        logger,
        afterMigrations: async () => undefined,
      }).then(
        ran => `ran: ${String(ran)}`,
        (error: unknown) =>
          (error as { publicMessage?: string }).publicMessage ?? String(error)
      );

      expect(started, logged.join("\n")).toContain("left part-way");
      expect(sqlFiles(), "the files stay").toEqual(files);
      expect(definitionText(), "the definition stays").toBe(after);
      for (const file of written) {
        expect(await isApplied(t, file), file).toBe(false);
      }
      expect(await recordRow(t), "the record stays").toBeDefined();
    }, 300_000);

    it("refuses migrate:check and migrate:create on this machine's marker", async () => {
      const t = await boot();
      await leftSave(t);
      expect(markers().length, "the record's marker").toBeGreaterThan(0);

      const checked = await command(context =>
        runMigrateCheck({ cwd: basePath }, context)
      );
      setNonInteractive(true);
      const created = await command(context =>
        runMigrateCreate("after", { cwd: basePath }, context)
      ).finally(() => setNonInteractive(false));

      expect(checked.code, checked.said).not.toBeUndefined();
      expect(checked.said).toContain("left part-way");
      expect(created.code, created.said).not.toBeUndefined();
      expect(created.said).toContain("left part-way");
    }, 300_000);
  }
);
