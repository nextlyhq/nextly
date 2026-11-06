/**
 * A code-first relationship switched from one related entry to many while the server was stopped,
 * converted by the development start that follows.
 *
 * The start syncs the registry from the configuration before its apply runs, so by then the row
 * already records the field as many. On PostgreSQL and MySQL the column's type tells the apply what
 * to convert; on SQLite the column is text either way, and only the row from before the sync tells
 * it. A development start therefore reads the rows first and hands them to its apply. A production
 * start applies nothing, and must not read them either.
 *
 * SQLite, where the start is the only road that carries the switch.
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/** What the config file says now: what `loadConfig` returns for it. */
const loaded = vi.hoisted(() => ({ config: undefined as unknown }));
vi.mock("../../cli/utils/config-loader", async importOriginal => ({
  ...(await importOriginal<typeof import("../../cli/utils/config-loader")>()),
  loadConfig: async () => ({
    config: loaded.config,
    configPath: "/virtual/nextly.config.ts",
    dependencies: [],
  }),
}));

import {
  defineCollection,
  defineConfig,
  relationship,
  text,
} from "../../config";
import { createAdapter } from "../../database/factory";
import { clearServices } from "../../di/register";
import { takeRecordedAtStart } from "../../domains/schema/pipeline/recorded-fields";
import { createTestNextly } from "../../plugins/test-nextly";
import { _resetEnvCache } from "../../shared/lib/env";
import { runBootTimeApplyIfDev } from "../boot-apply";
import { reloadNextlyConfig } from "../reload-config";
import { clearCachedSnapshot } from "../schema-snapshot-cache";

const A = "3fb954e4-f04c-4de6-b970-d16bf548688a";
const B = "16d6dfdf-bcd5-4408-a97b-df9e2547b30f";

const authors = defineCollection({
  slug: "authors",
  fields: [text({ name: "name" })],
});
const posts = (hasMany: boolean) =>
  defineCollection({
    slug: "posts",
    fields: [
      text({ name: "headline" }),
      relationship({ name: "author", relationTo: "authors", hasMany }),
    ],
  });

describe("a relationship switched to many while the server was stopped — sqlite", () => {
  let dir: string;
  let adapter: DrizzleAdapter;
  let projectRoot: string;

  /** A start of the server with `collections` as its configuration. */
  async function start(
    collections: ReturnType<typeof defineCollection>[]
  ): Promise<void> {
    clearServices();
    clearCachedSnapshot();
    loaded.config = defineConfig({ collections });
    await createTestNextly({ adapter: adapter as never, collections });
  }

  /** What the post's `author` column holds. */
  async function authorOf(): Promise<unknown> {
    const [row] = await adapter.executeQuery<{ author: unknown }>(
      `SELECT "author" FROM "dc_posts"`
    );
    return row?.author;
  }

  beforeEach(async () => {
    projectRoot = await mkdtemp(join(tmpdir(), "nextly-hm-restart-app-"));
    vi.spyOn(process, "cwd").mockReturnValue(projectRoot);
    dir = await mkdtemp(join(tmpdir(), "nextly-hm-restart-"));
    vi.stubEnv("DB_DIALECT", "sqlite");
    _resetEnvCache();
    adapter = (await createAdapter({
      type: "sqlite",
      url: `file:${join(dir, "test.db")}`,
    } as Parameters<typeof createAdapter>[0])) as unknown as DrizzleAdapter;
    // Nothing an earlier start in this process held reaches this one.
    takeRecordedAtStart();
  });

  afterEach(async () => {
    clearServices();
    await adapter.disconnect().catch(() => {});
    await rm(dir, { recursive: true, force: true });
    vi.restoreAllMocks();
    await rm(projectRoot, { recursive: true, force: true });
    vi.unstubAllEnvs();
    _resetEnvCache();
  });

  it("keeps the id the row held as a one-item list after a development start", async () => {
    vi.stubEnv("NODE_ENV", "development");
    await start([authors, posts(false)]);
    await adapter.executeQuery(
      `INSERT INTO "dc_posts" ("id", "slug", "title", "headline", "author") VALUES ('p1', 'p1', 'P1', 'P1', '${A}')`
    );

    // The configuration is edited while the server is stopped, then it starts again.
    await start([authors, posts(true)]);
    await runBootTimeApplyIfDev({ caller: "test" });

    const [row] = await adapter.executeQuery<{ author: unknown }>(
      `SELECT "author" FROM "dc_posts"`
    );
    expect(row?.author).toBe(JSON.stringify([A]));
  });

  it("still converts on the retry after a start that was refused, once the row is fixed", async () => {
    vi.stubEnv("NODE_ENV", "development");
    await start([authors, posts(true)]);
    await adapter.executeQuery(
      `INSERT INTO "dc_posts" ("id", "slug", "title", "headline", "author") VALUES ('p1', 'p1', 'P1', 'P1', '${JSON.stringify([A, B])}')`
    );

    // Switched back to one while a row holds two: the start's apply is refused, and the table is
    // left as it was.
    await start([authors, posts(false)]);
    await runBootTimeApplyIfDev({ caller: "test" });
    expect(await authorOf()).toBe(JSON.stringify([A, B]));

    // The extra entry is removed, and the configuration is saved again under `next dev`.
    await adapter.executeQuery(
      `UPDATE "dc_posts" SET "author" = '${JSON.stringify([A])}'`
    );
    await reloadNextlyConfig();

    expect(await authorOf()).toBe(A);
  });

  it("reads no registry rows ahead of the sync on a production start", async () => {
    vi.stubEnv("NODE_ENV", "development");
    await start([authors, posts(false)]);
    takeRecordedAtStart();

    vi.stubEnv("NODE_ENV", "production");
    await start([authors, posts(false)]);

    expect(takeRecordedAtStart()).toBeUndefined();
  });
});
