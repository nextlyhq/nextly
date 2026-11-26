/**
 * `nextly db:sync` adds each column of a code-first Single and field group once.
 *
 * The sync pushes a new Single's table whole, and then looks for columns the table still misses.
 * Where that look found none of the columns there (MySQL 8's catalogue names them `COLUMN_NAME`), it
 * tried to add every one again and reported each as a duplicate, beside the one a field group's
 * new field really needed.
 *
 * Each case owns its database: a throwaway database on PostgreSQL and MySQL, a temporary file on
 * SQLite.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

/** What the config file says now: what `loadConfig` returns for it. */
const loaded = vi.hoisted(() => ({ config: undefined as unknown }));
vi.mock("../../utils/config-loader", async importOriginal => ({
  ...(await importOriginal<typeof import("../../utils/config-loader")>()),
  loadConfig: async () => ({
    config: loaded.config,
    configPath: "/virtual/nextly.config.ts",
    dependencies: [],
  }),
}));

import { createScratchDatabase } from "../../../__tests__/helpers/fresh-database";
import {
  checkbox,
  defineCollection,
  defineConfig,
  defineFieldGroup,
  defineSingle,
  number,
  relationship,
  select,
  text,
} from "../../../config";
import {
  clearCachedSnapshot,
  clearLiveSnapshots,
} from "../../../init/schema-snapshot-cache";
import { describeEachDialect } from "../../../plugins/__tests__/helpers/dialect-matrix";
import { _resetEnvCache } from "../../../shared/lib/env";
import type { CommandContext } from "../../program";
import { createLogger } from "../../utils/logger";
import { runDbSync } from "../db-sync";
import { openCollectionRegistry } from "../db-sync-registry";

const SINGLE_TABLE = "single_om_banner";
const GROUP_TABLE = "fg_om_seo";

/** The configuration; `edited` gives the Single and the group one more field each. */
function configuration(edited: boolean) {
  return defineConfig({
    collections: [
      defineCollection({ slug: "om_tags", fields: [text({ name: "label" })] }),
    ],
    singles: [
      defineSingle({
        slug: "om_banner",
        fields: [
          text({ name: "heading", localized: false }),
          number({ name: "score" }),
          checkbox({ name: "active" }),
          select({ name: "kind", options: [{ label: "A", value: "a" }] }),
          relationship({ name: "tag", relationTo: "om_tags" }),
          ...(edited ? [number({ name: "rank" })] : []),
        ],
      }),
    ],
    fieldGroups: [
      defineFieldGroup({
        slug: "om_seo",
        fields: [
          number({ name: "weight" }),
          ...(edited ? [number({ name: "priority" })] : []),
        ],
      }),
    ],
  });
}

describeEachDialect(
  "db:sync adds only the columns that are missing",
  dialect => {
    let dir: string;
    let drop: () => Promise<void>;
    let adapter: DrizzleAdapter;
    let close: () => Promise<void>;

    beforeEach(async () => {
      dir = mkdtempSync(join(tmpdir(), "nextly-dbsync-missing-columns-"));
      let url = `file:${join(dir, "test.db")}`;
      drop = async () => {};
      close = async () => {};
      if (dialect !== "sqlite") {
        const scratch = await createScratchDatabase(dialect, "nextly_om");
        url = scratch.url;
        drop = scratch.drop;
      }
      vi.stubEnv("DB_DIALECT", dialect);
      vi.stubEnv("DATABASE_URL", url);
      _resetEnvCache();
      vi.spyOn(process, "cwd").mockReturnValue(dir);
      const opened = await openCollectionRegistry(
        createLogger({ quiet: true })
      );
      if (opened === undefined) throw new Error("the database is not there");
      adapter = opened.adapter;
      close = () => opened.adapter.disconnect();
    }, 60_000);

    afterEach(async () => {
      vi.restoreAllMocks();
      try {
        await close().catch(() => {});
        await drop();
      } finally {
        vi.unstubAllEnvs();
        _resetEnvCache();
        rmSync(dir, { recursive: true, force: true });
      }
    }, 60_000);

    /** `nextly db:sync` of `config`: every warning, error and listed item of it. */
    async function dbSync(config: unknown): Promise<string[]> {
      loaded.config = config;
      // The command runs in a process of its own, so nothing cached about the tables as an
      // earlier run left them may reach it.
      clearCachedSnapshot();
      clearLiveSnapshots();
      const said: string[] = [];
      const note = (message: string) => {
        said.push(message);
      };
      const exit = vi.spyOn(process, "exit").mockImplementation(code => {
        throw new Error(`db:sync exited ${String(code)}: ${said.join("\n")}`);
      });
      try {
        await runDbSync(
          { cwd: dir, autoSync: true } as Parameters<typeof runDbSync>[0],
          {
            logger: {
              ...createLogger({ quiet: true }),
              warn: note,
              error: note,
            },
            options: {},
            cwd: dir,
          } as CommandContext
        );
      } finally {
        exit.mockRestore();
      }
      return said;
    }

    /** The table's columns, sorted. */
    async function columnsOf(table: string): Promise<string[]> {
      const rows = await adapter.executeQuery<{ name: string }>(
        dialect === "sqlite"
          ? `SELECT name FROM pragma_table_info('${table}')`
          : dialect === "postgresql"
            ? `SELECT column_name AS name FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = '${table}'`
            : `SELECT COLUMN_NAME AS name FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = '${table}'`
      );
      return rows.map(row => row.name).sort();
    }

    const q = (name: string) =>
      dialect === "mysql" ? `\`${name}\`` : `"${name}"`;

    it("a new Single and a new field group: reports no column it could not add", async () => {
      expect(await dbSync(configuration(false))).toEqual([]);

      expect(await columnsOf(SINGLE_TABLE)).toEqual(
        expect.arrayContaining(["active", "heading", "kind", "score", "tag"])
      );
      expect(await columnsOf(GROUP_TABLE)).toContain("weight");
    }, 120_000);

    it("a field added to each, with a row in the Single: adds the two columns, keeps the row", async () => {
      await dbSync(configuration(false));
      await adapter.executeQuery(
        `INSERT INTO ${q(SINGLE_TABLE)} (${q("id")}, ${q("title")}, ${q("slug")}, ${q("score")}) VALUES ('r1', 'Banner', 'om_banner', 7)`
      );
      const single = await columnsOf(SINGLE_TABLE);
      const group = await columnsOf(GROUP_TABLE);

      expect(await dbSync(configuration(true))).toEqual([]);

      expect(await columnsOf(SINGLE_TABLE)).toEqual([...single, "rank"].sort());
      expect(await columnsOf(GROUP_TABLE)).toEqual(
        [...group, "priority"].sort()
      );
      expect(
        await adapter.executeQuery(
          `SELECT ${q("id")}, ${q("score")}, ${q("rank")} FROM ${q(SINGLE_TABLE)}`
        )
      ).toEqual([{ id: "r1", score: 7, rank: null }]);
    }, 120_000);
  }
);
