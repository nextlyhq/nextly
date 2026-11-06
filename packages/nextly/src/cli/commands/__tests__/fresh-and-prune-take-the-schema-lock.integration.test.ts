/**
 * `nextly migrate:fresh` and `nextly prune` hold the schema lock for the work that changes the
 * schema, and change nothing while another process holds it.
 *
 * The commands are driven themselves (`runMigrateFresh`, `runPruneCommand`) against a database of
 * the test's own, reached through `DATABASE_URL` as the CLI reaches it. Only the config file is not
 * read from disk: the loader is handed the config below. A second process holds the lock
 * (`schema-lock-holder.ts`) where a case needs one.
 *
 * - `migrate:fresh` is refused while the lock is held, before it drops anything. Run with nothing
 *   holding it, it keeps the lock tables through the drop: at the moment the drop has ended and the
 *   re-apply begins, every lock table is still there and the lock row names `migrate:fresh` as its
 *   holder. A drop that took the lock tables with it would have ended its own hold there. A
 *   re-apply that fails ends the command with the lock already released: at the moment the process
 *   would exit, the lock row is free.
 * - `prune` is refused while the lock is held, dropping nothing. Given consent at a terminal, it
 *   re-reads what it would drop once it holds the lock, and refuses with nothing dropped when that
 *   changed after the consent; with nothing changed it drops as agreed.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import type { Command } from "commander";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { defineCollection, defineConfig, text } from "../../../config";
import {
  LOCK_DIALECTS,
  lockWorld,
  startHolder,
  type Holder,
  type LockWorld,
} from "../../../domains/schema/pipeline/__tests__/helpers/schema-lock-world";
import { withMigrateLock } from "../../../domains/schema/pipeline/locks";
import { NextlyError } from "../../../errors/nextly-error";
import { definePlugin } from "../../../plugins/plugin-context";
import { createTestNextly } from "../../../plugins/test-nextly";
import { _resetEnvCache } from "../../../shared/lib/env";
import { toCliError } from "../../errors";
import type { CommandContext } from "../../program";
import { createLogger } from "../../utils/logger";
import { migrateFreshAction, runMigrateFresh } from "../migrate-fresh";
import { runPruneCommand } from "../prune";

/** What the commands load, and the seams a case drives between their steps. */
const seams = vi.hoisted(() => ({
  config: undefined as unknown,
  /** Runs when `migrate:fresh` hands over to `nextly migrate`: its drop has ended. */
  beforeReapply: undefined as undefined | (() => Promise<void>),
  interactive: false,
  /** The answer a person at the terminal gives. */
  ask: async (_question: string): Promise<boolean> => false,
}));

vi.mock("../../utils/config-loader", async importOriginal => ({
  ...(await importOriginal<typeof import("../../utils/config-loader")>()),
  loadConfig: async () => ({ config: seams.config, dependencies: [] }),
}));
vi.mock("../migrate", async importOriginal => {
  const actual = await importOriginal<typeof import("../migrate")>();
  return {
    ...actual,
    runMigrate: async (...args: Parameters<typeof actual.runMigrate>) => {
      await seams.beforeReapply?.();
      return actual.runMigrate(...args);
    },
  };
});
// Whether a person can be asked: the one question the CLI's prompts consult.
vi.mock("../../../domains/schema/migrate/can-prompt", async importOriginal => ({
  ...(await importOriginal<
    typeof import("../../../domains/schema/migrate/can-prompt")
  >()),
  canPrompt: () => seams.interactive,
}));
vi.mock("../../utils/data-loss-consent", async importOriginal => ({
  ...(await importOriginal<typeof import("../../utils/data-loss-consent")>()),
  askToDeleteInTerminal: (question: string) => seams.ask(question),
}));

const ORPHAN = "ffl_orphan";
/** A table only a test makes, so its presence says whether a drop ran. */
const ITEMS = "ffl_items";
/** A companion whose main table does not exist, which prune finds and drops. */
const STRAY_COMPANION = "dc_ffl_stray_locales";

/** Every table a lock keeps its row in, as the lock names them. */
const LOCK_TABLES = [
  "nextly_schema_lock",
  "nextly_migrate_lock",
  "nextly_field_group_lock",
];

describe.each(LOCK_DIALECTS)(
  "migrate:fresh and prune under the schema lock on %s",
  dialect => {
    let world: LockWorld;
    let adapter: DrizzleAdapter;
    let dir: string;
    let holder: Holder | undefined;
    const previous = {
      dialect: process.env.DB_DIALECT,
      url: process.env.DATABASE_URL,
    };

    beforeEach(async () => {
      world = await lockWorld(dialect, { fresh: true });
      adapter = await world.connect();
      dir = mkdtempSync(join(tmpdir(), "nextly-fresh-prune-lock-"));
      mkdirSync(join(dir, "migrations"));
      process.env.DB_DIALECT = dialect;
      process.env.DATABASE_URL =
        dialect === "sqlite" ? `file:${world.url}` : world.url;
      _resetEnvCache();
      seams.config = defineConfig({
        collections: [],
        db: { migrationsDir: "./migrations" },
      });
      seams.beforeReapply = undefined;
      seams.interactive = false;
      seams.ask = async () => false;
    }, 60_000);

    afterEach(async () => {
      if (holder !== undefined) {
        holder.kill("SIGKILL");
        await holder.exited;
        holder = undefined;
      }
      await adapter.disconnect();
      if (previous.dialect === undefined) delete process.env.DB_DIALECT;
      else process.env.DB_DIALECT = previous.dialect;
      if (previous.url === undefined) delete process.env.DATABASE_URL;
      else process.env.DATABASE_URL = previous.url;
      _resetEnvCache();
      rmSync(dir, { recursive: true, force: true });
      await world.dispose();
    }, 60_000);

    /** A command's context, quiet. */
    function context(): CommandContext {
      return {
        logger: createLogger({ quiet: true }),
        options: {},
        cwd: dir,
      } as CommandContext;
    }

    /** Run `fn`, turning `process.exit` into a thrown `exit <code>`. */
    async function exitsAsThrow<T>(fn: () => Promise<T>): Promise<T> {
      const exit = vi.spyOn(process, "exit").mockImplementation(code => {
        throw new Error(`exit ${String(code)}`);
      });
      try {
        return await fn();
      } finally {
        exit.mockRestore();
      }
    }

    function fresh(lockWaitMs: number): Promise<void> {
      return exitsAsThrow(() =>
        runMigrateFresh(
          { acceptDataLoss: true, cwd: dir, quiet: true, lockWaitMs },
          context()
        )
      );
    }

    function prune(
      options: { acceptDataLoss?: boolean; lockWaitMs: number } = {
        lockWaitMs: 1_000,
      }
    ): Promise<void> {
      return exitsAsThrow(() =>
        runPruneCommand({ ...options, cwd: dir }, context())
      );
    }

    /** The registry's collection slugs. */
    async function registered(): Promise<string[]> {
      const rows = (await adapter.executeQuery(
        "SELECT slug FROM dynamic_collections"
      )) as Array<{ slug: string }>;
      return rows.map(row => row.slug).sort();
    }

    /** What a refused command must leave alone: every table, and the registry. */
    async function databaseState(): Promise<{
      tables: string[];
      registered: string[];
    }> {
      const tables = (await adapter.listTables())
        .filter(name => name !== "nextly_schema_lock")
        .sort();
      return {
        tables,
        registered: tables.includes("dynamic_collections")
          ? await registered()
          : [],
      };
    }

    /** The lock row: who holds it, and for what. */
    async function lockRow(): Promise<{
      owner: string | null;
      command: string | null;
    }> {
      const rows = (await adapter.executeQuery(
        "SELECT owner, command FROM nextly_schema_lock WHERE id = 1"
      )) as Array<{ owner: string | null; command: string | null }>;
      return rows[0] ?? { owner: null, command: null };
    }

    async function holdTheLock(): Promise<void> {
      holder = startHolder(world, {
        command: "nextly db:sync",
        leaseSeconds: 30,
        prefix: "ffl_holder",
      });
      await holder.printed("held");
    }

    /** Runs `path` under a held lock, and asserts it was refused and changed nothing. */
    async function refusedWhileHeld(path: () => Promise<unknown>) {
      await holdTheLock();
      // The holder's own first table is part of the state from here on.
      const before = await databaseState();
      const error = await path().then(
        () => undefined,
        (e: unknown) => e
      );
      expect(NextlyError.is(error) ? error.code : error).toBe(
        "NEXTLY_MIGRATE_LOCK_BUSY"
      );
      expect(await databaseState()).toEqual(before);
    }

    /**
     * A database with a collection the config no longer declares: booted with a plugin that
     * contributes it, as the site was before the plugin was removed.
     */
    async function withOrphan(): Promise<string> {
      const plugin = definePlugin({
        name: "@t/fresh-prune-lock",
        version: "1.0.0",
        nextly: ">=0.0.0",
        contributes: {
          collections: [
            defineCollection({ slug: ORPHAN, fields: [text({ name: "v" })] }),
          ],
        },
      });
      const booted = await createTestNextly({
        adapter: (await world.connect()) as never,
        plugins: [plugin],
      });
      await booted.destroy();
      const table = (await adapter.listTables()).find(name =>
        name.endsWith(ORPHAN)
      );
      // The control: the orphan is there to be dropped, in the registry and as a table.
      expect(await registered()).toContain(ORPHAN);
      expect(table).toBeDefined();
      return table as string;
    }

    it("refuses migrate:fresh while another process holds the lock, dropping nothing", async () => {
      await adapter.executeQuery(`CREATE TABLE ${ITEMS} (id integer)`);
      await refusedWhileHeld(() => fresh(1_000));
      expect(await adapter.listTables()).toContain(ITEMS);
    }, 120_000);

    it("keeps the lock tables through migrate:fresh's drop, holding the lock until the re-apply", async () => {
      // The lock tables as any earlier run leaves them, created by the lock itself.
      await withMigrateLock(adapter, dialect, async () => undefined, {
        command: "nextly migrate",
      });
      await adapter.executeQuery(`CREATE TABLE ${ITEMS} (id integer)`);
      const lockTables = (await adapter.listTables()).filter(name =>
        LOCK_TABLES.includes(name)
      );
      expect(lockTables).toContain("nextly_schema_lock");

      let afterDrop:
        | {
            tables: string[];
            row: { owner: string | null; command: string | null };
          }
        | undefined;
      seams.beforeReapply = async () => {
        const tables = await adapter.listTables();
        afterDrop = {
          tables,
          row: tables.includes("nextly_schema_lock")
            ? await lockRow()
            : { owner: null, command: null },
        };
      };

      await fresh(1_000);

      // The drop ran: the test's own table went with it.
      expect(afterDrop?.tables).not.toContain(ITEMS);
      // Every lock table outlived it, and the lock was held through it, by this run.
      expect(afterDrop?.tables).toEqual(expect.arrayContaining(lockTables));
      expect(afterDrop?.row.command).toBe("nextly migrate:fresh");
      expect(afterDrop?.row.owner).not.toBeNull();
      // Released once the run ended.
      expect((await lockRow()).owner).toBeNull();
    }, 120_000);

    it("releases the lock before migrate:fresh exits on a re-apply that fails", async () => {
      // A migration that cannot apply, so the re-apply inside the lock fails.
      const broken = "20261103_000001_ffl_broken";
      writeFileSync(
        join(dir, "migrations", `${broken}.sql`),
        `-- Migration: ${broken}\n\n-- UP\nCREATE TABLE ffl_broken (id integer;\n\n-- DOWN\nDROP TABLE ffl_broken;\n`,
        "utf8"
      );
      // A real exit ends the process where it is called, so the lock row as it stands at that
      // call is what the next run finds. The read is issued there, before anything unwinds.
      const exits: Array<{ code: unknown; owner: Promise<string | null> }> = [];
      const exit = vi.spyOn(process, "exit").mockImplementation(code => {
        exits.push({ code, owner: lockRow().then(row => row.owner) });
        throw new Error(`exit ${String(code)}`);
      });
      const printed = vi.spyOn(console, "error").mockImplementation(() => {});
      let output = "";
      try {
        await migrateFreshAction({ acceptDataLoss: true }, {
          optsWithGlobals: () => ({ cwd: dir, quiet: true }),
        } as unknown as Command).catch(() => undefined);
      } finally {
        // Read before the restore, which clears what the spy recorded.
        output = printed.mock.calls.flat().join("\n");
        exit.mockRestore();
        printed.mockRestore();
      }

      // Nothing held the lock at any exit, and the command ended once, non-zero.
      expect(await Promise.all(exits.map(e => e.owner))).toEqual([null]);
      expect(exits.map(e => e.code)).toEqual([1]);
      expect((await lockRow()).owner).toBeNull();
      // The control: it was the re-apply that failed, named in what the command printed.
      expect(output, `printed: ${output}`).toContain(broken);
    }, 120_000);

    it("refuses prune while another process holds the lock, dropping nothing", async () => {
      const table = await withOrphan();
      await refusedWhileHeld(() =>
        prune({ acceptDataLoss: true, lockWaitMs: 1_000 })
      );
      expect(await adapter.listTables()).toContain(table);
      expect(await registered()).toContain(ORPHAN);
    }, 120_000);

    it("refuses prune when what it would drop changed after the consent, dropping nothing", async () => {
      const table = await withOrphan();
      seams.interactive = true;
      seams.ask = async () => {
        // While the person reads the list, another table appears for prune to drop.
        await adapter.executeQuery(
          `CREATE TABLE ${STRAY_COMPANION} (id integer)`
        );
        return true;
      };

      const error = await prune().then(
        () => undefined,
        (e: unknown) => e
      );

      // The command ends as the CLI code for it, naming the table that appeared.
      const ended = toCliError(error);
      expect(ended.code).toBe("PLAN_CHANGED_AFTER_CONSENT");
      expect(ended.next).toBe(
        "Run `nextly prune` again to see what it would do now."
      );
      expect(ended.why).toContain(STRAY_COMPANION);
      expect(NextlyError.is(error) ? error.publicMessage : error).toContain(
        "Run `nextly prune` again"
      );
      const tables = await adapter.listTables();
      expect(tables).toContain(table);
      expect(tables).toContain(STRAY_COMPANION);
      expect(await registered()).toContain(ORPHAN);
    }, 120_000);

    it("drops what prune was agreed to drop when nothing changed, releasing the lock", async () => {
      const table = await withOrphan();
      seams.interactive = true;
      seams.ask = async () => true;

      await prune();

      expect(await adapter.listTables()).not.toContain(table);
      expect(await registered()).not.toContain(ORPHAN);
      expect((await lockRow()).owner).toBeNull();
    }, 120_000);
  }
);
