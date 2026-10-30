// `nextly migrate` judges a field its files newly translate against the registry as it was before
// any file applied, driving `migrate:create` and `migrate` themselves on each configured dialect.
//
// A translations column already there is taken as a field's own. For a field the run newly
// translates, that column may be another field's leftover, and one that cannot hold the field is
// refused, failing the command. Whether the field is new is read from the registry as it was at
// the start. The refusal comes once the files have applied and before the registry records them,
// so the registry keeps its definitions and the next run is refused the same way: judged after
// the registry recorded the new field, the retry would take the field as translated before and
// only warn. The files that ran stay applied and in the ledger, and none runs twice.

import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { defineCollection, defineConfig } from "../../../config";
import { createAdapter } from "../../../database/factory";
import { introspectLiveSnapshot } from "../../../domains/schema/pipeline/diff/introspect-live";
import type { ColumnSpec } from "../../../domains/schema/pipeline/diff/types";
import { describeEachDialect } from "../../../plugins/__tests__/helpers/dialect-matrix";
import {
  createTestNextly,
  type TestDialect,
  type TestNextly,
} from "../../../plugins/test-nextly";
import { _resetEnvCache } from "../../../shared/lib/env";
import type { CommandContext } from "../../program";
import type { CLIDatabaseAdapter } from "../../utils/adapter";
import { createLogger } from "../../utils/logger";
import { findPendingFiles, runMigrate } from "../migrate";
import { runMigrateCreate } from "../migrate-create";

import { throwawayDatabase } from "./helpers/sync-target";

const loaded = vi.hoisted(() => ({
  config: undefined as unknown,
}));
vi.mock("../../utils/config-loader", async importOriginal => ({
  ...(await importOriginal<typeof import("../../utils/config-loader")>()),
  loadConfig: async () => ({ config: loaded.config, dependencies: [] }),
}));

const SLUG = "mgbefore";
const COMPANION = `dc_${SLUG}_locales`;

/** The collection, its `code` field absent, translated text, or translated number. */
const configWith = (code: "absent" | "text" | "number") =>
  defineConfig({
    localization: { locales: ["en", "es"], defaultLocale: "en" },
    db: { migrationsDir: "./migrations" },
    collections: [
      defineCollection({
        slug: SLUG,
        localized: true,
        fields: [
          { name: "title", type: "text", localized: true },
          ...(code === "absent"
            ? []
            : [{ name: "code", type: code, localized: true }]),
        ] as never,
      }),
    ],
  });

describeEachDialect(
  "nextly migrate over a leftover translations column",
  dialect => {
    let dir: string;
    let instance: TestNextly | undefined;
    let drop: () => Promise<void> = async () => {};
    let previousDialect: string | undefined;
    let previousUrl: string | undefined;
    let clock = 0;
    const q = (name: string) =>
      dialect === "mysql" ? `\`${name}\`` : `"${name}"`;

    beforeEach(async () => {
      dir = mkdtempSync(join(tmpdir(), "nextly-migrate-before-"));
      mkdirSync(join(dir, "migrations"));
      previousDialect = process.env.DB_DIALECT;
      previousUrl = process.env.DATABASE_URL;
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(new Date(Date.UTC(2026, 9, 29, 12, 0, 0, 0)));
      // A database of the case's own: the commands reconcile the whole database against the config.
      const own =
        dialect === "sqlite"
          ? { url: `file:${join(dir, "test.db")}`, drop: async () => {} }
          : await throwawayDatabase(dialect);
      drop = own.drop;
      process.env.DB_DIALECT = dialect;
      process.env.DATABASE_URL = own.url;
      _resetEnvCache();
      const adapter = await createAdapter({
        type: dialect,
        url: own.url,
      } as Parameters<typeof createAdapter>[0]);
      instance = await createTestNextly({ adapter });
    });

    afterEach(async () => {
      vi.useRealTimers();
      await instance?.destroy();
      instance = undefined;
      await drop();
      if (previousDialect === undefined) delete process.env.DB_DIALECT;
      else process.env.DB_DIALECT = previousDialect;
      if (previousUrl === undefined) delete process.env.DATABASE_URL;
      else process.env.DATABASE_URL = previousUrl;
      _resetEnvCache();
      rmSync(dir, { recursive: true, force: true });
    });

    function command(): { context: CommandContext; said: string[] } {
      const said: string[] = [];
      const base = createLogger({ quiet: true });
      const capture = (message: string) => {
        said.push(message);
      };
      return {
        context: {
          logger: {
            ...base,
            info: capture,
            warn: capture,
            success: capture,
            error: capture,
          },
          options: {},
          cwd: dir,
        } as CommandContext,
        said,
      };
    }

    async function exiting(
      fn: () => Promise<void>
    ): Promise<number | undefined> {
      const exit = vi.spyOn(process, "exit").mockImplementation(code => {
        throw new Error(`exit ${String(code)}`);
      });
      try {
        await fn();
        return undefined;
      } catch (error) {
        const match = /^exit (\d+)$/.exec((error as Error).message);
        if (match) return Number(match[1]);
        throw error;
      } finally {
        exit.mockRestore();
      }
    }

    async function migrateCreate(config: unknown, name: string): Promise<void> {
      loaded.config = config;
      clock += 1;
      vi.setSystemTime(new Date(Date.UTC(2026, 9, 29, 12, 0, 0, clock)));
      const { context, said } = command();
      const code = await exiting(() =>
        runMigrateCreate(name, { cwd: dir, nonInteractive: true }, context)
      );
      expect(code, said.join("\n")).toBeUndefined();
    }

    async function migrate(config: unknown) {
      loaded.config = config;
      const { context, said } = command();
      const code = await exiting(() => runMigrate({ cwd: dir }, context));
      return { code, said: said.join("\n") };
    }

    function adapter(): DrizzleAdapter {
      if (!instance) throw new Error("no instance");
      return instance.adapter as unknown as DrizzleAdapter;
    }

    async function codeColumn(): Promise<ColumnSpec | undefined> {
      const snapshot = await introspectLiveSnapshot(
        adapter().getDrizzle(),
        dialect as TestDialect,
        [COMPANION]
      );
      return snapshot.tables
        .find(table => table.name === COMPANION)
        ?.columns.find(column => column.name === "code");
    }

    /** The fields the registry records for the collection, as stored; undefined with no row. */
    async function recorded(): Promise<unknown> {
      const [row] = (await adapter().executeQuery(
        `SELECT ${q("fields")} AS fields FROM ${q("dynamic_collections")} WHERE ${q("slug")} = '${SLUG}'`
      )) as { fields: unknown }[];
      return typeof row?.fields === "string"
        ? JSON.parse(row.fields)
        : row?.fields;
    }

    /** The migration files the ledger does not hold yet. */
    async function pendingFiles() {
      return findPendingFiles(
        adapter() as unknown as CLIDatabaseAdapter,
        adapter().getDrizzle(),
        dialect,
        join(dir, "migrations"),
        createLogger({ quiet: true })
      );
    }

    const refusal =
      /column \\?"code\\?" \(.+\) that cannot hold every value code allows/;

    it("refuses a field its files newly translate, keeps the registry, and refuses the retry the same way", async () => {
      await migrateCreate(configWith("absent"), "posts");
      const first = await migrate(configWith("absent"));
      expect(first.code, first.said).toBeUndefined();
      await adapter().executeQuery(
        `ALTER TABLE ${q(COMPANION)} ADD COLUMN ${q("code")} INTEGER`
      );
      const leftover = await codeColumn();

      const registryBefore = await recorded();
      await migrateCreate(configWith("text"), "code");
      const refused = await migrate(configWith("text"));

      expect(refused.code).toBe(1);
      expect(refused.said).toMatch(refusal);
      expect(await codeColumn()).toEqual(leftover);
      // The registry keeps what it held; the files that ran are in the ledger.
      expect(await recorded()).toEqual(registryBefore);
      expect(await pendingFiles()).toEqual([]);

      // Judged against the same registry, the retry is refused the same way, running no file again.
      const retried = await migrate(configWith("text"));
      expect(retried.code).toBe(1);
      expect(retried.said).toMatch(refusal);
      expect(await recorded()).toEqual(registryBefore);
      expect(await codeColumn()).toEqual(leftover);
    });

    it("completes once the config gives the field the leftover column's type", async () => {
      await migrateCreate(configWith("absent"), "posts");
      expect((await migrate(configWith("absent"))).code).toBeUndefined();
      await adapter().executeQuery(
        `ALTER TABLE ${q(COMPANION)} ADD COLUMN ${q("code")} INTEGER`
      );
      const leftover = await codeColumn();
      await migrateCreate(configWith("text"), "code");
      expect((await migrate(configWith("text"))).code).toBe(1);

      // A number is an integer column, which the leftover is.
      await migrateCreate(configWith("number"), "code-as-number");
      const fixed = await migrate(configWith("number"));

      expect(fixed.code, fixed.said).toBeUndefined();
      expect(fixed.said).not.toMatch(/cannot hold every value/);
      // Taken as the field's column, as it was.
      expect(await codeColumn()).toEqual(leftover);
    });
  }
);
