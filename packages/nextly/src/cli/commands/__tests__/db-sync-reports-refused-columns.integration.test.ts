/**
 * `nextly db:sync` ends with an error naming every entity whose column or table the database
 * refused, once it has done everything else.
 *
 * Such an entity is recorded `failed`, the others are synced, and the next run tries it again. The
 * watch reports it and goes on. The steps over data an earlier release stored wait for a run that
 * synced every entity.
 *
 * The refusal is the one statement made to fail, on the command's own connection; everything else
 * reaches the database. Each case owns its database: a throwaway database on PostgreSQL and MySQL,
 * a temporary file on SQLite.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/** What the config file says now, and what a saved edit reaches the watch through. */
const loaded = vi.hoisted(() => ({
  config: undefined as unknown,
  onWatch: undefined as (() => void) | undefined,
}));
vi.mock("../../utils/config-loader", async importOriginal => ({
  ...(await importOriginal<typeof import("../../utils/config-loader")>()),
  loadConfig: async () => ({
    config: loaded.config,
    configPath: "/virtual/nextly.config.ts",
    dependencies: [],
  }),
  watchConfig: () => {
    loaded.onWatch?.();
    return () => {};
  },
}));

/** How often the steps over stored data ran, beside the real ones. */
const dataSteps = vi.hoisted(() => ({ taken: 0 }));
vi.mock("../stored-data-of-run", async importOriginal => {
  const actual = await importOriginal<typeof import("../stored-data-of-run")>();
  return {
    ...actual,
    storedDataOfRun: (
      args: Parameters<typeof actual.storedDataOfRun>[0]
    ): ReturnType<typeof actual.storedDataOfRun> => {
      const real = actual.storedDataOfRun(args);
      return {
        ...real,
        takeAfterSchemaChanges: async changes => {
          dataSteps.taken += 1;
          await real.takeAfterSchemaChanges(changes);
        },
      };
    },
  };
});

import { createScratchDatabase } from "../../../__tests__/helpers/fresh-database";
import {
  defineCollection,
  defineConfig,
  defineFieldGroup,
  group,
  number,
  password,
  text,
} from "../../../config";
import {
  clearCachedSnapshot,
  clearLiveSnapshots,
} from "../../../init/schema-snapshot-cache";
import { describeEachDialect } from "../../../plugins/__tests__/helpers/dialect-matrix";
import { _resetEnvCache } from "../../../shared/lib/env";
import type { CommandContext } from "../../program";
import type { CLIDatabaseAdapter } from "../../utils/adapter";
import type { LoadConfigResult } from "../../utils/config-loader";
import { createLogger } from "../../utils/logger";
import { runDbSync } from "../db-sync";
import { openCollectionRegistry } from "../db-sync-registry";
import { createDebouncedSync } from "../dev-watcher";

const SEO = { slug: "rc_seo", table: "fg_rc_seo" };
const TWO = { slug: "rc_two", table: "fg_rc_two" };

/** Two field groups; `edited` gives each one more shared field. */
function configuration(edited: boolean, groups: readonly string[] = ["seo"]) {
  return defineConfig({
    collections: [
      defineCollection({
        slug: "rc_tags",
        fields: [
          text({ name: "label" }),
          group({ name: "box", fields: [password({ name: "pin" })] }),
        ],
      }),
    ],
    fieldGroups: [
      ...(groups.includes("seo")
        ? [
            defineFieldGroup({
              slug: SEO.slug,
              fields: [
                number({ name: "weight" }),
                ...(edited ? [number({ name: "priority" })] : []),
              ],
            }),
          ]
        : []),
      defineFieldGroup({
        slug: TWO.slug,
        fields: [
          number({ name: "one" }),
          ...(edited ? [number({ name: "two" })] : []),
        ],
      }),
    ],
  });
}

interface Run {
  /** The error the command ends with; undefined where it succeeds. */
  error:
    | { code?: unknown; what?: string; why?: string; next?: string }
    | undefined;
  said: string[];
}

describeEachDialect("db:sync and what the database refuses", dialect => {
  let dir: string;
  let drop: () => Promise<void>;
  let adapter: DrizzleAdapter;
  let close: () => Promise<void>;
  /** The statement the database refuses. */
  let refuse: RegExp | undefined;
  /** Every connection the case's runs sent a statement on: a watch never closes its own. */
  const used = new Set<DrizzleAdapter>();

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), "nextly-dbsync-refused-"));
    let url = `file:${join(dir, "test.db")}`;
    drop = async () => {};
    close = async () => {};
    refuse = undefined;
    loaded.onWatch = undefined;
    dataSteps.taken = 0;
    if (dialect !== "sqlite") {
      const scratch = await createScratchDatabase(
        dialect,
        "nextly_syncrefused"
      );
      url = scratch.url;
      drop = scratch.drop;
    }
    vi.stubEnv("DB_DIALECT", dialect);
    vi.stubEnv("DATABASE_URL", url);
    _resetEnvCache();
    vi.spyOn(process, "cwd").mockReturnValue(dir);
    const opened = await openCollectionRegistry(createLogger({ quiet: true }));
    if (opened === undefined) throw new Error("the database is not there");
    adapter = opened.adapter;
    close = () => opened.adapter.disconnect();
    // Every connection of the run is this class's: the statement is refused on whichever sends it.
    const connection = Object.getPrototypeOf(adapter) as DrizzleAdapter;
    const send = connection.executeQuery;
    vi.spyOn(connection, "executeQuery").mockImplementation(async function (
      this: DrizzleAdapter,
      sql: string,
      params?: never[]
    ) {
      used.add(this);
      if (refuse?.test(sql)) throw new Error("refused by the database");
      return send.call(this, sql, params) as never;
    });
  }, 60_000);

  afterEach(async () => {
    vi.restoreAllMocks();
    try {
      for (const connection of used) {
        await connection.disconnect().catch(() => {});
      }
      used.clear();
      await close().catch(() => {});
      await drop();
    } finally {
      vi.unstubAllEnvs();
      _resetEnvCache();
      rmSync(dir, { recursive: true, force: true });
    }
  }, 60_000);

  function context(said: string[]): CommandContext {
    const note = (message: string) => {
      said.push(message);
    };
    return {
      logger: {
        ...createLogger({ quiet: true }),
        warn: note,
        error: note,
        item: note,
        success: note,
      },
      options: {},
      cwd: dir,
    } as CommandContext;
  }

  /** `nextly db:sync` of `config`, as a process of its own. */
  async function dbSync(
    config: unknown,
    options: Record<string, unknown> = {}
  ): Promise<Run> {
    loaded.config = config;
    clearCachedSnapshot();
    clearLiveSnapshots();
    const said: string[] = [];
    let error: Run["error"];
    try {
      await runDbSync(
        { cwd: dir, autoSync: true, ...options } as Parameters<
          typeof runDbSync
        >[0],
        context(said)
      );
    } catch (thrown) {
      error = thrown as Run["error"];
    }
    return { error, said };
  }

  async function columnsOf(table: string): Promise<string[]> {
    const rows = await adapter.executeQuery<{ name: string }>(
      dialect === "sqlite"
        ? `SELECT name FROM pragma_table_info('${table}')`
        : dialect === "postgresql"
          ? `SELECT column_name AS name FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = '${table}'`
          : `SELECT COLUMN_NAME AS name FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = '${table}'`
    );
    return rows.map(row => row.name);
  }

  async function statusOf(slug: string): Promise<string> {
    const [row] = await adapter.executeQuery<{ st: string }>(
      `SELECT migration_status AS st FROM dynamic_field_groups WHERE slug = '${slug}'`
    );
    return row.st;
  }

  const q = (name: string) =>
    dialect === "mysql" ? `\`${name}\`` : `"${name}"`;

  /** A password inside a container as an earlier release left it: as it was written. */
  async function storePasswordAsWritten(): Promise<void> {
    await adapter.executeQuery(
      `INSERT INTO ${q("dc_rc_tags")} (${q("id")}, ${q("title")}, ${q("slug")}, ${q("box")}) VALUES ('t1', 'Tag', 'tag', '{"pin":"written-plain"}')`
    );
  }

  /** What that entry's container holds now, as text. */
  async function storedPassword(): Promise<string> {
    const [row] = await adapter.executeQuery<{ box: unknown }>(
      `SELECT ${q("box")} FROM ${q("dc_rc_tags")} WHERE ${q("id")} = 't1'`
    );
    return JSON.stringify(row.box);
  }

  /** What the run announced as synced. */
  const syncedIn = (said: string[]) =>
    said.filter(message => /^Synced \d+ component table/.test(message));

  describe("a column a field group's new field needs is refused", () => {
    it("names the group, the column and the reason, after syncing the rest", async () => {
      await dbSync(configuration(false));
      refuse = /ADD COLUMN .priority/;
      const run = await dbSync(configuration(true));

      expect(run.error?.code).toBe("ENTITIES_NOT_SYNCED");
      const text = `${run.error?.what} ${run.error?.why}`;
      expect(text).toContain(SEO.slug);
      expect(text).toContain("priority");
      expect(text).toContain("refused by the database");
      expect(text).not.toContain(TWO.slug);
      expect(run.error?.next).toContain("nextly db:sync");

      expect(await columnsOf(SEO.table)).not.toContain("priority");
      expect(await statusOf(SEO.slug)).toBe("failed");
      expect(syncedIn(run.said)).toEqual([
        `Synced 1 component table(s): ${TWO.slug}`,
      ]);

      // The rest went on: the other group, and the permissions after it.
      expect(await columnsOf(TWO.table)).toContain("two");
      expect(await statusOf(TWO.slug)).toBe("applied");
      expect(run.said.some(m => m.startsWith("Permissions:"))).toBe(true);
    }, 120_000);

    it("tries it again in the next run, which records it applied", async () => {
      await dbSync(configuration(false));
      refuse = /ADD COLUMN .priority/;
      await dbSync(configuration(true));

      refuse = undefined;
      const run = await dbSync(configuration(true));

      expect(run.error).toBeUndefined();
      expect(await columnsOf(SEO.table)).toContain("priority");
      expect(await statusOf(SEO.slug)).toBe("applied");
    }, 120_000);

    it("adds the column an earlier release left missing on an entity it recorded applied", async () => {
      await dbSync(configuration(false));
      refuse = /ADD COLUMN .priority/;
      await dbSync(configuration(true));
      // As an earlier release left it: the column refused, the group recorded applied.
      await adapter.executeQuery(
        `UPDATE ${q("dynamic_field_groups")} SET ${q("migration_status")} = 'applied' WHERE ${q("slug")} = '${SEO.slug}'`
      );
      expect(await columnsOf(SEO.table)).not.toContain("priority");

      refuse = undefined;
      const run = await dbSync(configuration(true));

      expect(run.error).toBeUndefined();
      expect(await columnsOf(SEO.table)).toContain("priority");
      expect(await statusOf(SEO.slug)).toBe("applied");
    }, 120_000);

    it("says nothing new where nothing was refused", async () => {
      await dbSync(configuration(false));
      const run = await dbSync(configuration(true));

      expect(run.error).toBeUndefined();
      expect(syncedIn(run.said)).toEqual([
        `Synced 2 component table(s): ${SEO.slug}, ${TWO.slug}`,
      ]);
      expect(await statusOf(SEO.slug)).toBe("applied");
    }, 120_000);
  });

  it("a table a new field group needs is refused: names the group, and syncs the rest", async () => {
    await dbSync(configuration(false, []));
    refuse = /CREATE TABLE .*fg_rc_seo\b/;
    const run = await dbSync(configuration(true));

    expect(run.error?.code).toBe("ENTITIES_NOT_SYNCED");
    expect(`${run.error?.what} ${run.error?.why}`).toContain(SEO.slug);
    expect(await statusOf(SEO.slug)).toBe("failed");
    expect(await columnsOf(TWO.table)).toContain("two");
  }, 120_000);

  it("leaves the stored-data steps to a run that synced every entity, and says so", async () => {
    await dbSync(configuration(false));
    expect(dataSteps.taken).toBe(1);

    refuse = /ADD COLUMN .priority/;
    const failed = await dbSync(configuration(true));
    expect(dataSteps.taken).toBe(1);
    expect(failed.said.join("\n")).toMatch(/data an earlier release stored/i);

    refuse = undefined;
    const clean = await dbSync(configuration(true));
    expect(clean.error).toBeUndefined();
    expect(dataSteps.taken).toBe(2);
  }, 120_000);

  it("says which stored passwords wait for a clean run, which then hashes them", async () => {
    await dbSync(configuration(false));
    await storePasswordAsWritten();

    refuse = /ADD COLUMN .priority/;
    const failed = await dbSync(configuration(true), {
      backupConfirmed: true,
    });
    expect(failed.error?.code).toBe("ENTITIES_NOT_SYNCED");
    expect(failed.said).toContain(
      "1 password(s) stored before this release are not yet hashed. `nextly db:sync` hashes them once it has synced every entity."
    );
    expect(await storedPassword()).toContain("written-plain");

    refuse = undefined;
    const clean = await dbSync(configuration(true), { backupConfirmed: true });
    expect(clean.error).toBeUndefined();
    expect(await storedPassword()).not.toContain("written-plain");
  }, 180_000);

  describe("the watch", () => {
    it("reports a refusal of its first sync, and goes on watching", async () => {
      await dbSync(configuration(false));
      refuse = /ADD COLUMN .priority/;

      const said: string[] = [];
      let watching!: () => void;
      const reached = new Promise<void>(resolve => {
        watching = resolve;
      });
      loaded.onWatch = watching;
      loaded.config = configuration(true);
      clearCachedSnapshot();
      clearLiveSnapshots();
      // The watch never returns: what it reaches is what is waited for.
      const ended = runDbSync(
        { cwd: dir, autoSync: true, watch: true } as Parameters<
          typeof runDbSync
        >[0],
        context(said)
      ).then(
        () => "ended",
        (error: unknown) => error
      );
      const outcome = await Promise.race([
        reached.then(() => "watching"),
        ended,
      ]);

      expect(outcome).toBe("watching");
      expect(said.join("\n")).toContain(SEO.slug);
      expect(said.join("\n")).toContain("refused by the database");
      expect(dataSteps.taken).toBe(1);
      expect(await statusOf(SEO.slug)).toBe("failed");
    }, 120_000);

    // A re-sync never takes the data steps, refused or not, so it names no password left either.
    it("reports a refusal of a re-sync, says nothing of stored passwords, and syncs the next one", async () => {
      await dbSync(configuration(false));
      await storePasswordAsWritten();
      const warned: string[] = [];
      refuse = /ADD COLUMN .priority/;
      const errors: string[] = [];
      let settled!: () => void;
      const base = context([]);
      const resync = createDebouncedSync(
        adapter as unknown as CLIDatabaseAdapter,
        { cwd: dir, autoSync: true } as Parameters<
          typeof createDebouncedSync
        >[1],
        {
          ...base,
          logger: {
            ...base.logger,
            warn: (message: string) => {
              warned.push(message);
            },
            error: (message: string) => {
              errors.push(message);
              settled();
            },
            success: (message: string) => {
              if (message.startsWith("Permissions:")) settled();
            },
          },
        }
      );
      const once = async () => {
        clearCachedSnapshot();
        clearLiveSnapshots();
        const done = new Promise<void>(resolve => {
          settled = resolve;
        });
        resync({
          config: configuration(true),
          dependencies: [],
        } as unknown as LoadConfigResult);
        await done;
        // The re-sync reports last, and lets its schema lock go just after.
        await new Promise(resolve => setTimeout(resolve, 1_000));
      };

      await once();
      expect(errors.join("\n")).toContain(SEO.slug);
      expect(errors.join("\n")).toContain("refused by the database");
      expect(await statusOf(SEO.slug)).toBe("failed");

      refuse = undefined;
      errors.length = 0;
      await once();
      expect(errors).toEqual([]);
      expect(await columnsOf(SEO.table)).toContain("priority");
      expect(await statusOf(SEO.slug)).toBe("applied");

      expect(warned.filter(line => line.includes("password"))).toEqual([]);
      expect(await storedPassword()).toContain("written-plain");
    }, 180_000);
  });
});
