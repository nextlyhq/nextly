/**
 * A field moved into or out of a group in a code-first config keeps every entry's value through
 * `nextly migrate:create` and `nextly migrate`, and `nextly migrate:down` puts it back, on every
 * configured dialect.
 *
 * Moved into a group, the field's column goes and its values belong in the group's JSON; moved out,
 * a column arrives and its values are in the JSON. Compared column by column, the first is a drop
 * and the second an add: the values are deleted, or left behind under a key nothing reads. What
 * separates a generator that carries the move from one that does not is the value read back at
 * the field's new path.
 *
 * Run non-interactively, as CI runs it: the move is carried only with `--accept-moves`, and the
 * column it drops still asks the data-loss consent, as every drop does. Without `--accept-moves`
 * the run says which move it left undone and how to make it.
 *
 * Each run owns its database, reached by the commands through `DATABASE_URL` as an app's would: a
 * file on SQLite, a scratch database on the servers.
 */
import { mkdirSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createScratchDatabase } from "../../../__tests__/helpers/fresh-database";
import { defineCollection, defineConfig, group, text } from "../../../config";
import { createAdapter } from "../../../database/factory";
import { clearServices, shutdownServices } from "../../../di/register";
import { setNonInteractive } from "../../../domains/schema/migrate/can-prompt";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../../plugins/test-nextly";
import { _resetEnvCache } from "../../../shared/lib/env";
import type { CommandContext } from "../../program";
import { createLogger } from "../../utils/logger";
import { runMigrate } from "../migrate";
import { runMigrateCreate } from "../migrate-create";
import { runMigrateDown } from "../migrate-down";

/** The configuration the commands load, set by each step before it runs them. */
const loaded = vi.hoisted(() => ({ config: undefined as unknown }));
vi.mock("../../utils/config-loader", async importOriginal => ({
  ...(await importOriginal<typeof import("../../utils/config-loader")>()),
  loadConfig: async () => ({ config: loaded.config, dependencies: [] }),
}));

/** The posts with `subtitle` on the row (`row`) or inside the `meta` group (`grouped`). */
function posts(where: "row" | "grouped") {
  const subtitle = text({ name: "subtitle" });
  return [
    defineCollection({
      slug: "mf_posts",
      fields: [
        text({ name: "title" }),
        ...(where === "row" ? [subtitle] : []),
        group({
          name: "meta",
          fields: [
            text({ name: "note" }),
            ...(where === "grouped" ? [subtitle] : []),
          ],
        }),
      ],
    }),
  ];
}

const configOf = (where: "row" | "grouped") =>
  defineConfig({
    collections: posts(where),
    db: { migrationsDir: "./migrations" },
  });

let dir: string;
let closers: Array<() => Promise<void>> = [];

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "nextly-moved-field-"));
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

/** A database of this test's own, which the commands reach through `DATABASE_URL`. */
async function openDatabase(dialect: TestDialect): Promise<string> {
  let url: string;
  if (dialect === "sqlite") {
    url = `file:${join(dir, "app.db")}`;
  } else {
    const scratch = await createScratchDatabase(dialect, "nextly_mf_moves");
    url = scratch.url;
    closers.push(() => scratch.drop());
  }
  vi.stubEnv("DB_DIALECT", dialect);
  vi.stubEnv("DATABASE_URL", url);
  _resetEnvCache();
  return url;
}

/** Start the app over the database at `url`, declaring the posts as `where` places `subtitle`. */
async function start(
  dialect: TestDialect,
  url: string,
  where?: "row" | "grouped"
): Promise<TestNextly> {
  await shutdownServices().catch(() => {});
  clearServices();
  const adapter = (await createAdapter({
    type: dialect,
    url,
  } as Parameters<typeof createAdapter>[0])) as unknown as DrizzleAdapter;
  closers.unshift(() => adapter.disconnect().catch(() => {}));
  return createTestNextly({
    adapter: adapter as never,
    ...(where === undefined ? {} : { collections: posts(where) }),
  });
}

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

/** Run `fn`, turning `process.exit` into a thrown `exit <code>`. */
async function exiting(fn: () => Promise<void>): Promise<number | undefined> {
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

/**
 * `migrate:create` with `name` over the config `where` places `subtitle` in, non-interactively,
 * then `migrate`, each consenting to the drops it makes; what `migrate:create` said.
 */
async function createAndApply(
  name: string,
  where: "row" | "grouped",
  options: { acceptMoves?: boolean } = {}
): Promise<string> {
  loaded.config = configOf(where);
  setNonInteractive(true);
  const created = command();
  expect(
    await exiting(() =>
      runMigrateCreate(
        name,
        { cwd: dir, acceptDataLoss: true, ...options },
        created.context
      )
    ),
    created.said.join("\n")
  ).toBeUndefined();
  const applied = command();
  expect(
    await exiting(() =>
      runMigrate({ cwd: dir, acceptDataLoss: true }, applied.context)
    ),
    applied.said.join("\n")
  ).toBeUndefined();
  return created.said.join("\n");
}

/** The SQL file `migrate:create` wrote for `name`. */
async function migrationFile(name: string): Promise<string> {
  const file = readdirSync(join(dir, "migrations")).find(f =>
    f.endsWith(`_${name}.sql`)
  );
  if (file === undefined) throw new Error(`no migration named ${name}`);
  return readFile(join(dir, "migrations", file), "utf-8");
}

/** The post's `subtitle` on the row and inside `meta`, as the app reads it back. */
async function subtitles(t: TestNextly, id: string) {
  const post = (await t.nextly.findByID({
    collection: "mf_posts" as never,
    id: id as never,
  })) as Record<string, unknown>;
  return {
    row: post.subtitle,
    grouped: (post.meta as { subtitle?: unknown } | null)?.subtitle,
  };
}

/** A post created with `data` under the config `where` places `subtitle` in; its id. */
async function created(
  dialect: TestDialect,
  url: string,
  where: "row" | "grouped",
  data: Record<string, unknown>
): Promise<string> {
  const app = await start(dialect, url, where);
  const post = await app.nextly.create({
    collection: "mf_posts" as never,
    data: data as never,
  });
  return String((post.item as { id: unknown }).id);
}

describe.each(getConfiguredTestDialects())(
  "a field moved in code keeps its values through migrate:create (%s)",
  dialect => {
    it("copies a field moved into a group before its column goes, and migrate:down puts it back", async () => {
      const url = await openDatabase(dialect);
      await start(dialect, url);
      await createAndApply("create_posts", "row");
      const id = await created(dialect, url, "row", {
        title: "P",
        subtitle: "Kept subtitle",
        meta: { note: "N" },
      });

      await createAndApply("move_subtitle_in", "grouped", {
        acceptMoves: true,
      });
      // The regex the run without --accept-moves is held to, matching the copy here.
      expect(await migrationFile("move_subtitle_in")).toMatch(
        /UPDATE[^;]*"?meta"?/i
      );
      expect(await subtitles(await start(dialect, url, "grouped"), id)).toEqual(
        { row: undefined, grouped: "Kept subtitle" }
      );

      setNonInteractive(true);
      const down = command();
      expect(
        await exiting(() =>
          runMigrateDown({ cwd: dir, acceptDataLoss: true }, down.context)
        ),
        down.said.join("\n")
      ).toBeUndefined();
      expect(await subtitles(await start(dialect, url, "row"), id)).toEqual({
        row: "Kept subtitle",
        grouped: undefined,
      });
    });

    it("copies a field moved out of a group onto the row it arrives on", async () => {
      const url = await openDatabase(dialect);
      await start(dialect, url);
      await createAndApply("create_posts", "grouped");
      const id = await created(dialect, url, "grouped", {
        title: "P",
        meta: { note: "N", subtitle: "Kept subtitle" },
      });

      await createAndApply("move_subtitle_out", "row", { acceptMoves: true });
      expect(await subtitles(await start(dialect, url, "row"), id)).toEqual({
        row: "Kept subtitle",
        grouped: undefined,
      });
    });

    it("without --accept-moves and no terminal, makes no move and says which and how", async () => {
      const url = await openDatabase(dialect);
      await start(dialect, url);
      await createAndApply("create_posts", "row");

      const said = await createAndApply("move_subtitle_in", "grouped");
      // The drop and the add, as before; no copy into the group.
      expect(await migrationFile("move_subtitle_in")).not.toMatch(
        /UPDATE[^;]*"?meta"?/i
      );
      expect(said).toContain("subtitle");
      expect(said).toContain("--accept-moves");
    });
  }
);
