/**
 * A project of one app whose migrations `nextly migrate:create` writes, for a suite over what
 * `nextly migrate` retires: the two commands driven themselves, in this process, against a project
 * directory and a database of the test's own, with consent for every deletion.
 *
 * The app has two collections, `gt_posts`, which a suite changes and removes, and `gt_pages`, which
 * stays. A suite mocks the commands' config loader (`vi.mock` is hoisted in its own file) and hands
 * the object the mock answers from to `useGeneratedMigrations`.
 *
 * @module cli/commands/__tests__/helpers/generated-migrations
 */
import { createHash, randomUUID } from "node:crypto";
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, expect, vi } from "vitest";

import {
  defineCollection,
  defineConfig,
  relationship,
  text,
} from "../../../../config";
import { createAdapter } from "../../../../database/factory";
import { clearServices } from "../../../../di/register";
import { setNonInteractive } from "../../../../domains/schema/migrate/can-prompt";
import { introspectLiveSnapshot } from "../../../../domains/schema/pipeline/diff/introspect-live";
import {
  createTestNextly,
  type TestDialect,
  type TestNextly,
} from "../../../../plugins/test-nextly";
import { _resetEnvCache } from "../../../../shared/lib/env";
import { toCliError } from "../../../errors/from-thrown";
import { formatCliError } from "../../../errors/render";
import type { CommandContext } from "../../../program";
import { createLogger } from "../../../utils/logger";
import { runMigrate } from "../../migrate";
import { runMigrateCreate } from "../../migrate-create";

export const POSTS = "dc_gt_posts";

/** The app's config: `posts` there or not, its field required or not, and whether `pages` names it. */
export const appConfig = (shape: {
  posts: "required" | "optional" | "removed";
  /** The table `posts` is kept in, where it is not its own. */
  dbName?: string;
  pagesNamePosts: boolean;
}) =>
  defineConfig({
    collections: [
      ...(shape.posts === "removed"
        ? []
        : [
            defineCollection({
              slug: "gt_posts",
              ...(shape.dbName === undefined ? {} : { dbName: shape.dbName }),
              fields: [
                text({
                  name: "headline",
                  required: shape.posts === "required",
                }),
                relationship({
                  name: "related",
                  relationTo: "gt_pages",
                  hasMany: true,
                }),
              ],
            }),
          ]),
      defineCollection({
        slug: "gt_pages",
        fields: [
          text({ name: "heading" }),
          ...(shape.pagesNamePosts
            ? [relationship({ name: "lead", relationTo: "gt_posts" })]
            : []),
        ],
      }),
    ],
    db: { migrationsDir: "./migrations" },
  });

let dir: string;
let instance: TestNextly | undefined;
let previousDialect: string | undefined;
let previousUrl: string | undefined;
let clock = 0;

/** What the suite's mocked config loader answers with. */
let loaded: { config: unknown };

/** The running test's project: its directory, and the instance over its database. */
export const project = {
  get dir(): string {
    return dir;
  },
  get adapter(): TestNextly["adapter"] {
    return instance!.adapter;
  },
};

/** Gives each test of the suite a project of its own, its commands reading `config`'s configuration. */
export function useGeneratedMigrations(config: { config: unknown }): void {
  loaded = config;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "nextly-generated-retire-"));
    mkdirSync(join(dir, "migrations"));
    previousDialect = process.env.DB_DIALECT;
    previousUrl = process.env.DATABASE_URL;
    // Each migration is named by the clock.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(Date.UTC(2026, 10, 13, 12, 0, 0, 0)));
  });

  afterEach(async () => {
    vi.useRealTimers();
    await instance?.destroy();
    // Where its services were cleared, they do not close the connection.
    await instance?.adapter.disconnect().catch(() => {});
    instance = undefined;
    if (previousDialect === undefined) delete process.env.DB_DIALECT;
    else process.env.DB_DIALECT = previousDialect;
    if (previousUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previousUrl;
    _resetEnvCache();
    rmSync(dir, { recursive: true, force: true });
  });
}

/** A booted instance the commands reach through `DATABASE_URL`, declaring no entity of its own. */
export async function boot(dialect: TestDialect): Promise<void> {
  if (dialect !== "sqlite") {
    instance = await createTestNextly({ dialect });
    return;
  }
  const url = `file:${join(dir, "test.db")}`;
  process.env.DB_DIALECT = "sqlite";
  process.env.DATABASE_URL = url;
  _resetEnvCache();
  const adapter = await createAdapter({ type: "sqlite", url } as Parameters<
    typeof createAdapter
  >[0]);
  instance = await createTestNextly({ adapter });
}

/** A command's context, with everything it says captured. */
export function command(said: string[] = []): {
  context: CommandContext;
  said: string[];
} {
  const capture = (message: string) => {
    said.push(message);
  };
  return {
    context: {
      logger: {
        ...createLogger({ quiet: true }),
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

/** Runs `nextly migrate:create --name=<name>` over `config`; answers the SQL it wrote, or its refusal. */
export async function migrateCreate(
  config: unknown,
  name: string
): Promise<{ sql: string; refused?: string }> {
  loaded.config = config;
  clock += 1;
  vi.setSystemTime(new Date(Date.UTC(2026, 10, 13, 12, 0, 0, clock)));
  const { context, said } = command();
  const printed = vi.spyOn(console, "error").mockImplementation(message => {
    said.push(String(message));
  });
  const exit = vi.spyOn(process, "exit").mockImplementation(code => {
    throw new Error(`exit ${String(code)}`);
  });
  setNonInteractive(true);
  try {
    await runMigrateCreate(name, { cwd: dir, acceptDataLoss: true }, context);
  } catch (error) {
    return { sql: "", refused: `${said.join("\n")}\n${String(error)}` };
  } finally {
    setNonInteractive(false);
    printed.mockRestore();
    exit.mockRestore();
  }
  const file = readdirSync(join(dir, "migrations")).find(f =>
    f.endsWith(`_${name}.sql`)
  );
  expect(file, `no migration named ${name}\n${said.join("\n")}`).toBeDefined();
  return { sql: readFileSync(join(dir, "migrations", file!), "utf8") };
}

/** Runs `nextly migrate` over `config`, with consent for every deletion; answers its failure, if any. */
export async function migrate(
  config: unknown,
  said: string[] = []
): Promise<string | undefined> {
  loaded.config = config;
  const { context } = command(said);
  setNonInteractive(true);
  try {
    await runMigrate(
      { cwd: dir, throwOnFailure: true, acceptDataLoss: true },
      context
    );
    return undefined;
  } catch (error) {
    return [...said, formatCliError(toCliError(error))].join("\n");
  } finally {
    setNonInteractive(false);
  }
}

/** The statement storing `ids` in `posts`, its other required columns filled by their types. */
export async function insertingPosts(
  dialect: TestDialect,
  ids: readonly string[],
  table = POSTS
): Promise<string> {
  const q = (name: string) =>
    dialect === "mysql" ? `\`${name}\`` : `"${name}"`;
  const { tables } = await introspectLiveSnapshot(
    instance!.adapter.getDrizzle(),
    dialect,
    [table]
  );
  const columns = tables[0].columns.filter(
    column => !column.nullable && column.default === undefined
  );
  const literal = (id: string, type: string) =>
    /time|date/i.test(type)
      ? "CURRENT_TIMESTAMP"
      : /int|num|dec|real|double|float|bool/i.test(type)
        ? "1"
        : `'${id}'`;
  const row = (id: string) =>
    `(${columns
      .map(c => (c.name === "id" ? `'${id}'` : literal(id, c.type)))
      .join(", ")})`;
  return `INSERT INTO ${q(table)} (${columns.map(c => q(c.name)).join(", ")}) VALUES ${ids.map(row).join(", ")}`;
}

/** One row in `posts`. */
export async function insertPost(
  dialect: TestDialect,
  id: string
): Promise<void> {
  await instance!.adapter.executeQuery(await insertingPosts(dialect, [id]));
}

/** How many `deleted` events each document of `gt_posts` has. */
export async function deletions(): Promise<Record<string, number>> {
  const rows = await instance!.adapter.select<{ subjectId: string }>(
    "nextly_content_events",
    {
      where: {
        and: [
          { column: "subjectSlug", op: "=", value: "gt_posts" },
          { column: "kind", op: "=", value: "deleted" },
        ],
      },
    }
  );
  const counts: Record<string, number> = {};
  for (const row of rows) {
    counts[row.subjectId] = (counts[row.subjectId] ?? 0) + 1;
  }
  return counts;
}

/** Whether each of `gt_posts`' permissions is orphaned; it has some. */
export async function orphanedPermissions(): Promise<boolean[]> {
  const rows = await instance!.adapter.select<{
    resource: string;
    orphanedAt: unknown;
  }>("permissions", {});
  const own = rows.filter(row => row.resource === "gt_posts");
  expect(own.length, "permissions of gt_posts").toBeGreaterThan(0);
  return own.map(row => row.orphanedAt !== null);
}

/** A `deleted` event of `posts`' document `id`, as an ordinary delete records one. */
export async function postDeleted(id: string): Promise<void> {
  await instance!.adapter.insert("nextly_content_events", {
    id: randomUUID(),
    subjectKind: "collection",
    subjectSlug: "gt_posts",
    subjectId: id,
    kind: "deleted",
    actorKind: "system",
    occurredAt: new Date(),
  });
}

/**
 * Stores a capture of `ids` waiting on `file`, as a run leaves one, whose event cannot be written:
 * its slug is longer than an event holds. Taken before any other of the test's.
 */
export async function storeUnrecordableCapture(
  file: string,
  direction: "up" | "down",
  ids: readonly string[]
): Promise<void> {
  const hash = (said: string) =>
    createHash("sha256").update(said).digest("hex").slice(0, 32);
  const slug = "x".repeat(600);
  const prefix = `retired_documents:${hash(file)}:${hash(`collection:${slug}:${direction}`)}:0:`;
  for (const [key, value] of [
    [
      `${prefix}head`,
      {
        file,
        kind: "collection",
        slug,
        table: "gt_not_there",
        direction,
        seq: 0,
        at: 0,
        final: true,
      },
    ],
    [`${prefix}0`, { ids, deletions: {} }],
  ] as const) {
    await instance!.adapter.insert("nextly_meta", {
      key,
      value: JSON.stringify(value),
      updatedAt: new Date(),
    });
  }
}

/** Forgets what `storeUnrecordableCapture` stored. */
export async function forgetUnrecordableCapture(): Promise<void> {
  const rows = await instance!.adapter.select<{ key: string; value: unknown }>(
    "nextly_meta",
    {}
  );
  const heads = rows.filter(row =>
    JSON.stringify(row.value).includes("gt_not_there")
  );
  for (const head of heads) {
    for (const key of [head.key, head.key.replace(/head$/, "0")]) {
      await instance!.adapter.delete("nextly_meta", {
        and: [{ column: "key", op: "=", value: key }],
      });
    }
  }
}

/** How many rows of captured documents wait in `nextly_meta`. */
export async function captures(): Promise<number> {
  const rows = await instance!.adapter.select<{ key: string }>(
    "nextly_meta",
    {}
  );
  return rows.filter(row => row.key.startsWith("retired_documents:")).length;
}

/**
 * Runs another command over `config` as the CLI does, its exit turned into an answer: what it said
 * where it failed, undefined where it finished.
 */
export async function runs(
  config: unknown,
  command_: (context: CommandContext) => Promise<void>
): Promise<string | undefined> {
  loaded.config = config;
  // A command of its own process finds no services: the booted instance's would write on its own
  // connection, which on SQLite waits behind the command's transaction.
  clearServices();
  const { context, said } = command();
  const printed = vi.spyOn(console, "error").mockImplementation(message => {
    said.push(String(message));
  });
  const exit = vi.spyOn(process, "exit").mockImplementation(code => {
    throw new Error(`exit ${String(code)}`);
  });
  setNonInteractive(true);
  try {
    await command_(context);
    return undefined;
  } catch (error) {
    return [...said, String(error)].join("\n");
  } finally {
    setNonInteractive(false);
    printed.mockRestore();
    exit.mockRestore();
  }
}

export const WITH_POSTS = { posts: "required", pagesNamePosts: true } as const;

/** The first migration written and applied, with two posts. */
export async function started(dialect: TestDialect): Promise<void> {
  await boot(dialect);
  const config = appConfig(WITH_POSTS);
  expect((await migrateCreate(config, "start")).refused).toBeUndefined();
  expect(await migrate(config)).toBeUndefined();
  await insertPost(dialect, "p1");
  await insertPost(dialect, "p2");
}

/** The path of the migration named `name`, or of its snapshot. */
export function pathOf(name: string, kind: "sql" | "snapshot" = "sql"): string {
  const file = readdirSync(join(dir, "migrations")).find(f =>
    f.endsWith(`_${name}.sql`)
  );
  expect(file, `no migration named ${name}`).toBeDefined();
  return kind === "sql"
    ? join(dir, "migrations", file!)
    : join(dir, "migrations", "meta", file!.replace(".sql", ".snapshot.json"));
}

/** Rewrites the migration named `name` as `edit` gives its text, which has to change it. */
export function edited(name: string, edit: (sql: string) => string): void {
  const path = pathOf(name);
  const sql = readFileSync(path, "utf8");
  expect(edit(sql), sql).not.toBe(sql);
  writeFileSync(path, edit(sql));
}

/** The snapshot of `name` without the declarations it records, as an earlier release wrote it. */
export function withoutEntities(name: string): void {
  const path = pathOf(name, "snapshot");
  const snapshot = JSON.parse(readFileSync(path, "utf8")) as Record<
    string,
    unknown
  >;
  expect(snapshot.entities).toBeDefined();
  delete snapshot.entities;
  writeFileSync(path, JSON.stringify(snapshot, null, 2));
}

/** The statement that drops `posts`' main table, as `migrate:create` writes it. */
export const DROP = /DROP TABLE [`"]dc_gt_posts[`"]( CASCADE)?;/;

/** A statement renaming `posts`' main table, as each dialect writes one. */
export const renameTo = (dialect: TestDialect, to: string) =>
  dialect === "mysql"
    ? `ALTER TABLE \`${POSTS}\` RENAME TO \`${to}\`;`
    : `ALTER TABLE "${POSTS}" RENAME TO "${to}";`;

/** Whether a table named `name` is there. */
export const stands = async (name: string) =>
  (await instance!.adapter.listTables()).includes(name);

/** A removal of `posts` written, not yet applied, after two posts were stored. */
export async function removalWritten(dialect: TestDialect): Promise<unknown> {
  await started(dialect);
  const gone = appConfig({ posts: "removed", pagesNamePosts: false });
  const { sql, refused } = await migrateCreate(gone, "remove");
  expect(refused).toBeUndefined();
  // The premise of every edit below: the file drops the table in this form.
  expect(sql).toMatch(DROP);
  return gone;
}

/** The warnings `said` holds about a drop that ends no document. */
export const unrecorded = (said: readonly string[]) =>
  said.filter(line => /no `deleted` event/.test(line));
