/**
 * `nextly migrate` settles a Builder save left part-way before its run, and the commands that
 * cannot settle one refuse while it stands.
 *
 * A save is left part-way here as a stopped process leaves it: the save runs, and its record (the
 * row and the project's marker) is kept where its end would clear it. A save made outside
 * development (`NODE_ENV=test`) writes its files and its definition and applies none of them.
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
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

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
import { introspectLiveSnapshot } from "../../pipeline/diff/introspect-live";

/** Whether a save's record is kept where its end would clear it, as a stopped process leaves it. */
const keep = vi.hoisted(() => ({ records: false }));

// The record's marker is removed through `rm`: kept while a case leaves the save part-way.
vi.mock("node:fs/promises", async importOriginal => {
  const real = await importOriginal<typeof import("node:fs/promises")>();
  const rm: typeof real.rm = async (path, options) => {
    if (keep.records && String(path).includes("save-in-progress")) return;
    return real.rm(path, options);
  };
  return { ...real, rm, default: { ...real, rm } };
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
  keep.records = false;
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
     * A save adding `alpha`, left part-way: its record kept as a stopped process leaves it. Made
     * outside development where `applies` is false, so it writes its files and its definition and
     * applies none of them.
     */
    async function leftSave(
      t: TestNextly,
      applies: boolean
    ): Promise<{ written: string[]; before: string | null; after: string }> {
      const before = definitionText();
      const filesBefore = sqlFiles();
      if (!applies) vi.stubEnv("NODE_ENV", "test");
      keep.records = true;
      const realDelete = MetaService.prototype.delete;
      vi.spyOn(MetaService.prototype, "delete").mockImplementation(
        async function (this: MetaService, key: string) {
          if (keep.records && key.startsWith("builder-save-in-progress:")) {
            return;
          }
          return realDelete.call(this, key);
        }
      );
      await dispatchSingles(
        "applySingleSchemaChanges",
        { slug: SLUG },
        {
          fields: [text("heading"), text("alpha")],
          confirmed: true,
          schemaVersion: await versionOf(t),
        }
      ).catch((error: unknown) => error);
      keep.records = false;
      vi.mocked(MetaService.prototype.delete).mockRestore();
      vi.stubEnv("NODE_ENV", "development");
      const written = sqlFiles().filter(name => !filesBefore.includes(name));
      expect(written.length, "the save wrote its files").toBeGreaterThan(0);
      expect(await recordRow(t), "the save's record").toBeDefined();
      return { written, before, after: definitionText() ?? "" };
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

    const migrate = () =>
      command(context =>
        runMigrate(
          { cwd: basePath, throwOnFailure: true } as Parameters<
            typeof runMigrate
          >[0],
          context
        )
      );

    it("runs the whole files of a save made outside development, and clears its record", async () => {
      const t = await boot();
      const { written } = await leftSave(t, false);
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
      const { written, before } = await leftSave(t, false);
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
      const { written, before } = await leftSave(t, false);
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
      const { written, before } = await leftSave(t, false);
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
      const { written } = await leftSave(t, false);
      await setRecord(t, { applies: true, host: "another-machine" });

      const run = await migrate();

      expect(run.code, run.said).not.toBeUndefined();
      expect(run.said).toContain("another-machine");
      for (const file of written) {
        expect(await isApplied(t, file), file).toBe(false);
      }
      expect(await liveColumns(t)).not.toContain("alpha");
    }, 300_000);

    it("refuses a production start that migrates, leaving the files and the definition as they are", async () => {
      const t = await boot();
      const { written, after } = await leftSave(t, false);
      const files = sqlFiles();
      vi.stubEnv("NODE_ENV", "production");
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
      await leftSave(t, false);
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
