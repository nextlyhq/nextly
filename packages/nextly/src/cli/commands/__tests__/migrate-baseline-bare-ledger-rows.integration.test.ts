/**
 * `nextly migrate:baseline` adopts a database whose ledger holds applied migrations an early
 * release recorded under their bare names, without `.sql`, on every configured dialect.
 *
 * Such a site's schema changed by `db:sync` and development pushes, and its migrations folder
 * holds none of those files any more. The baseline refuses while the ledger records them applied,
 * as it refuses any applied migration the folder lacks. The way on is to record each one rolled
 * back with its file gone (`migrate:resolve --rolled-back <file> --file-missing`), which runs
 * nothing and leaves every table as it stands; the baseline then adopts them. A bare name is the
 * same migration as the name with `.sql`, so either spelling reaches the rows recorded under both,
 * and a row with no checksum, as an early release wrote by hand, is rolled back like any other.
 */
import { mkdirSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createScratchDatabase } from "../../../__tests__/helpers/fresh-database";
import { defineCollection, defineConfig, text } from "../../../config";
import { createAdapter } from "../../../database/factory";
import { clearServices, shutdownServices } from "../../../di/register";
import { SchemaEventsRepository } from "../../../domains/schema/events/schema-events-repository";
import { setNonInteractive } from "../../../domains/schema/migrate/can-prompt";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
} from "../../../plugins/test-nextly";
import { _resetEnvCache } from "../../../shared/lib/env";
import type { CommandContext } from "../../program";
import { createLogger } from "../../utils/logger";
import { runMigrateBaseline } from "../migrate-baseline";
import { runMigrateResolve } from "../migrate-resolve";

/** The configuration the commands load. */
const loaded = vi.hoisted(() => ({ config: undefined as unknown }));
vi.mock("../../utils/config-loader", async importOriginal => ({
  ...(await importOriginal<typeof import("../../utils/config-loader")>()),
  loadConfig: async () => ({ config: loaded.config, dependencies: [] }),
}));

const SILENT = createLogger({ quiet: true });

const POSTS = "bl_posts";
const COLLECTIONS = [
  defineCollection({ slug: POSTS, fields: [text({ name: "title" })] }),
];

/** The three rows an early release left: two spellings of one migration, and one by hand. */
const FIRST = "0000_bl_first";
const BY_HAND = "20260818_054654_541_bl_add_fields";

let dir: string;
let closers: Array<() => Promise<void>> = [];

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "nextly-baseline-bare-"));
  mkdirSync(join(dir, "migrations"));
});

afterEach(async () => {
  await shutdownServices().catch(() => {});
  for (const close of closers.splice(0)) await close();
  vi.unstubAllEnvs();
  _resetEnvCache();
  setNonInteractive(false);
  rmSync(dir, { recursive: true, force: true });
});

async function openDatabase(dialect: TestDialect): Promise<string> {
  let url: string;
  if (dialect === "sqlite") {
    url = `file:${join(dir, "app.db")}`;
  } else {
    const scratch = await createScratchDatabase(dialect, "nextly_bl_bare");
    url = scratch.url;
    closers.push(() => scratch.drop());
  }
  vi.stubEnv("DB_DIALECT", dialect);
  vi.stubEnv("DATABASE_URL", url);
  _resetEnvCache();
  return url;
}

async function connect(
  dialect: TestDialect,
  url: string
): Promise<DrizzleAdapter> {
  const adapter = (await createAdapter({
    type: dialect,
    url,
  } as Parameters<typeof createAdapter>[0])) as unknown as DrizzleAdapter;
  closers.unshift(() => adapter.disconnect().catch(() => {}));
  return adapter;
}

/** Run `fn`, turning `process.exit` into a code, and say what it said. */
async function run(
  fn: (context: CommandContext) => Promise<void>
): Promise<{ exit: number | undefined; said: string }> {
  const said: string[] = [];
  const capture = (message: string) => {
    said.push(message);
  };
  const context = {
    logger: {
      ...SILENT,
      info: capture,
      warn: capture,
      success: capture,
      error: capture,
    },
    options: {},
    cwd: dir,
  } as CommandContext;
  const exit = vi.spyOn(process, "exit").mockImplementation(code => {
    throw new Error(`exit ${String(code)}`);
  });
  const printed = vi
    .spyOn(process.stderr, "write")
    .mockImplementation(chunk => {
      said.push(String(chunk));
      return true;
    });
  const logged = vi.spyOn(console, "error").mockImplementation((...parts) => {
    said.push(parts.map(String).join(" "));
  });
  try {
    await fn(context);
    return { exit: undefined, said: said.join("\n") };
  } catch (error) {
    const match = /^exit (\d+)$/.exec((error as Error).message);
    if (match) return { exit: Number(match[1]), said: said.join("\n") };
    // A refusal thrown with its parts says them as the CLI prints them.
    const { why, next } = error as { why?: string; next?: string };
    return {
      exit: -1,
      said: [...said, String(error), why ?? "", next ?? ""].join("\n"),
    };
  } finally {
    exit.mockRestore();
    printed.mockRestore();
    logged.mockRestore();
  }
}

const baseline = () =>
  run(context => runMigrateBaseline({ cwd: dir }, context));

/** `nextly migrate:resolve --rolled-back <file> --file-missing`. */
const rollBack = (file: string) =>
  run(context =>
    runMigrateResolve(
      { cwd: dir, rolledBack: file, fileMissing: true } as Parameters<
        typeof runMigrateResolve
      >[0],
      context
    )
  );

const quote = (dialect: TestDialect, name: string) =>
  dialect === "mysql" ? `\`${name}\`` : `"${name}"`;

describe.each(getConfiguredTestDialects())(
  "migrate:baseline over applied rows an early release recorded under bare names (%s)",
  dialect => {
    /**
     * A site set up without migrations, with one post, whose ledger records three applied
     * migrations its folder lacks: one under its bare name and again with `.sql`, and one under
     * its bare name with no checksum. Beside them, development pushes that never finished.
     */
    async function earlySite(): Promise<DrizzleAdapter> {
      const url = await openDatabase(dialect);
      loaded.config = defineConfig({
        collections: COLLECTIONS,
        db: { migrationsDir: "./migrations" },
      });
      await shutdownServices().catch(() => {});
      clearServices();
      const app = await createTestNextly({
        adapter: (await connect(dialect, url)) as never,
        collections: COLLECTIONS,
      });
      await app.nextly.create({
        collection: POSTS as never,
        data: { title: "Kept" } as never,
      });
      await shutdownServices().catch(() => {});
      const adapter = await connect(dialect, url);
      const repo = new SchemaEventsRepository(
        adapter.getDrizzle(),
        adapter.getCapabilities().dialect
      );
      const applied = (filename: string, sha256: string, at: string) =>
        repo.insertEvent({
          eventType: "file_apply",
          status: "applied",
          source: "cli-migrate",
          filename,
          sha256,
          startedAt: new Date(at),
        });
      await applied(FIRST, "a".repeat(64), "2026-08-18T05:45:40Z");
      // The checksum an early release wrote for a row recorded by hand.
      await applied(BY_HAND, "manual".padEnd(64), "2026-08-18T05:50:44Z");
      await applied(`${FIRST}.sql`, "b".repeat(64), "2026-11-13T09:19:35Z");
      await repo.insertEvent({
        eventType: "dev_push",
        status: "in_progress",
        source: "dev-server",
        scopeKind: "global",
        startedAt: new Date("2026-09-03T04:52:04Z"),
      });
      return adapter;
    }

    it("refuses the baseline while the ledger records them applied, naming each", async () => {
      await earlySite();

      const refused = await baseline();

      expect(refused.exit, refused.said).not.toBeUndefined();
      expect(refused.said).toContain(FIRST);
      expect(refused.said).toContain(BY_HAND);
      expect(refused.said).toMatch(
        /nextly migrate:resolve --rolled-back <file> --file-missing/
      );
      expect(readdirSync(join(dir, "migrations"))).toEqual([]);
    }, 120_000);

    it("adopts the database once each is recorded rolled back, under the name the refusal gave, keeping every row", async () => {
      const adapter = await earlySite();

      for (const file of [FIRST, `${FIRST}.sql`, BY_HAND]) {
        const resolved = await rollBack(file);
        expect(resolved.exit, `${file}\n${resolved.said}`).toBeUndefined();
      }
      const adopted = await baseline();

      expect(adopted.exit, adopted.said).toBeUndefined();
      expect(
        readdirSync(join(dir, "migrations")).filter(f => f.endsWith(".sql"))
      ).toHaveLength(1);
      const rows = (await adapter.executeQuery(
        `SELECT ${quote(dialect, "title")} AS title FROM ${quote(dialect, `dc_${POSTS}`)}`
      )) as Array<{ title: string }>;
      expect(rows.map(row => row.title)).toEqual(["Kept"]);
    }, 120_000);

    it("reaches both spellings of one migration from either name", async () => {
      const adapter = await earlySite();

      expect((await rollBack(`${BY_HAND}.sql`)).exit).toBeUndefined();
      expect((await rollBack(FIRST)).exit).toBeUndefined();
      // Both spellings stand rolled back: the second is already done.
      const again = await rollBack(`${FIRST}.sql`);
      expect(again.exit, again.said).toBeUndefined();
      expect(again.said).toMatch(/already rolled back/);

      const applied = (await adapter.executeQuery(
        `SELECT ${quote(dialect, "filename")} AS filename FROM ${quote(dialect, "nextly_schema_events")} WHERE ${quote(dialect, "event_type")} = 'file_apply' AND ${quote(dialect, "status")} = 'applied'`
      )) as Array<{ filename: string }>;
      expect(applied).toEqual([]);
      expect((await baseline()).exit).toBeUndefined();
    }, 120_000);
  }
);
