/**
 * `nextly migrate:create` and a migration that deletes data: it lists every
 * deletion, and writes the file only with the data-loss consent or a yes at
 * the terminal. A run that cannot ask and has no consent covering every
 * deletion writes nothing, names what it would delete and the consent that
 * covers it, and exits 1.
 *
 * The command is run itself, against a SQLite URL whose file does not exist:
 * the database cannot be read, so the listing names each deletion without a
 * count (the counts are the integration test's, on each database). What
 * separates the correct command from the broken one is the file: written with
 * consent, absent without it.
 */
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { defineCollection, defineConfig, text } from "../../../config";
import { setNonInteractive } from "../../../domains/schema/migrate/can-prompt";
import type { Deletion } from "../../../domains/schema/migrate/data-loss-consent";
import { _resetEnvCache } from "../../../shared/lib/env";
import type { CommandContext } from "../../program";
import { createLogger } from "../../utils/logger";
import { runMigrateCreate } from "../migrate-create";

const state = vi.hoisted(() => ({
  config: undefined as unknown,
  canPrompt: false,
  answer: false,
  asked: [] as string[],
}));

vi.mock("../../program", () => ({
  createContext: () => ({}),
}));

vi.mock("../../utils/config-loader", async importOriginal => ({
  ...(await importOriginal<typeof import("../../utils/config-loader")>()),
  loadConfig: async () => ({ config: state.config, dependencies: [] }),
}));

// The terminal: whether one can be asked, and the answer given to the deletion question.
vi.mock("../../../domains/schema/migrate/can-prompt", async importOriginal => {
  const real =
    await importOriginal<
      typeof import("../../../domains/schema/migrate/can-prompt")
    >();
  return { ...real, canPrompt: () => state.canPrompt };
});
vi.mock("../../utils/data-loss-consent", async importOriginal => ({
  ...(await importOriginal<typeof import("../../utils/data-loss-consent")>()),
  askToDeleteInTerminal: (question: string) => {
    state.asked.push(question);
    return Promise.resolve(state.answer);
  },
}));

let dir: string;
let output: string[];
let clock = 0;
const saved: Record<string, string | undefined> = {};
const ENV = ["DB_DIALECT", "DATABASE_URL", "NEXTLY_ACCEPT_DATA_LOSS"] as const;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "nextly-migrate-create-deletions-"));
  for (const name of ENV) saved[name] = process.env[name];
  process.env.DB_DIALECT = "sqlite";
  // No such file: the listing cannot be counted, and nothing is created.
  process.env.DATABASE_URL = `file:${join(dir, "absent.db")}`;
  delete process.env.NEXTLY_ACCEPT_DATA_LOSS;
  _resetEnvCache();
  state.canPrompt = false;
  state.answer = false;
  state.asked = [];
  output = [];
  const capture = (...args: unknown[]) => {
    output.push(args.map(String).join(" "));
  };
  vi.spyOn(console, "log").mockImplementation(capture);
  vi.spyOn(console, "error").mockImplementation(capture);
  vi.useFakeTimers({ toFake: ["Date"] });
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  for (const name of ENV) {
    if (saved[name] === undefined) delete process.env[name];
    else process.env[name] = saved[name];
  }
  _resetEnvCache();
  rmSync(dir, { recursive: true, force: true });
});

const posts = defineCollection({
  slug: "posts",
  fields: [text({ name: "title" })],
});
const pages = defineCollection({
  slug: "pages",
  fields: [text({ name: "title" }), text({ name: "summary" })],
});
const pagesWithoutSummary = defineCollection({
  slug: "pages",
  fields: [text({ name: "title" })],
});

/** `migrate:create` over `collections`; the code it exits with, if any. */
async function migrateCreate(
  collections: unknown[],
  options: {
    acceptDataLoss?: string | boolean;
    dryRun?: boolean;
    approvedDeletions?: readonly Deletion[];
    plugin?: string;
    /** The positional name; `null` gives none. */
    name?: string | null;
  } = {}
): Promise<number | undefined> {
  state.config = defineConfig({ collections } as Parameters<
    typeof defineConfig
  >[0]);
  clock += 1;
  vi.setSystemTime(new Date(Date.UTC(2026, 10, 12, 12, 0, 0, clock)));
  const exit = vi.spyOn(process, "exit").mockImplementation(code => {
    throw new Error(`exit ${String(code)}`);
  });
  const context = {
    logger: createLogger({}),
    options: {},
    cwd: dir,
  } as CommandContext;
  // A run that cannot ask declines every rename; one that can is asked only about deletions here.
  setNonInteractive(!state.canPrompt);
  try {
    const { name = "change", ...rest } = options;
    await runMigrateCreate(name ?? undefined, { cwd: dir, ...rest }, context);
    return undefined;
  } catch (error) {
    const match = /^exit (\d+)$/.exec((error as Error).message);
    if (match) return Number(match[1]);
    throw error;
  } finally {
    setNonInteractive(false);
    exit.mockRestore();
  }
}

/** Every migration file's content, oldest first. */
function migrations(): string[] {
  // The default `db.migrationsDir`.
  const folder = join(dir, "src", "db", "migrations");
  return readdirSync(folder)
    .filter(f => f.endsWith(".sql"))
    .sort()
    .map(f => readFileSync(join(folder, f), "utf-8"));
}

const printed = () => output.join("\n");

/** A project whose one migration created `posts` and `pages`. */
async function projectWithPostsAndPages(): Promise<void> {
  expect(await migrateCreate([posts, pages])).toBeUndefined();
  expect(migrations()).toHaveLength(1);
  output = [];
}

describe("migrate:create with a deletion and nobody to ask", () => {
  it("writes nothing without consent, naming the deletion and the consent that covers it", async () => {
    await projectWithPostsAndPages();
    expect(await migrateCreate([pages])).toBe(1);
    expect(migrations()).toHaveLength(1);
    expect(printed()).toContain(
      "table dc_posts: collection posts is no longer in the config"
    );
    expect(printed()).toContain("--accept-data-loss=dc_posts");
  });

  it("writes the marked file with consent naming the table", async () => {
    await projectWithPostsAndPages();
    expect(
      await migrateCreate([pages], { acceptDataLoss: "dc_posts" })
    ).toBeUndefined();
    const files = migrations();
    expect(files).toHaveLength(2);
    expect(files[1]).toContain(
      "-- Deletes: table dc_posts: collection posts is no longer in the config"
    );
    expect(printed()).toContain(
      "table dc_posts: collection posts is no longer in the config"
    );
  });

  it("writes it with the consent in the environment", async () => {
    await projectWithPostsAndPages();
    process.env.NEXTLY_ACCEPT_DATA_LOSS = "1";
    expect(await migrateCreate([pages])).toBeUndefined();
    expect(migrations()).toHaveLength(2);
  });

  it("refuses a consent that leaves a deletion out, naming it", async () => {
    await projectWithPostsAndPages();
    expect(
      await migrateCreate([pagesWithoutSummary], {
        acceptDataLoss: "dc_pages.title",
      })
    ).toBe(1);
    expect(migrations()).toHaveLength(1);
    expect(printed()).toContain("column dc_pages.summary");
    expect(printed()).toContain("dc_posts");
  });

  it("writes what a caller already agreed to without asking again", async () => {
    await projectWithPostsAndPages();
    expect(
      await migrateCreate([pages], {
        approvedDeletions: [{ kind: "table", table: "dc_posts" }],
      })
    ).toBeUndefined();
    expect(migrations()).toHaveLength(2);
  });

  it("writes nothing on a dry run and names the consent a real run needs", async () => {
    await projectWithPostsAndPages();
    expect(await migrateCreate([pages], { dryRun: true })).toBeUndefined();
    expect(migrations()).toHaveLength(1);
    // The dry run's own lines, not the header of the file it prints.
    expect(printed()).toMatch(
      / - table dc_posts: collection posts is no longer in the config$/m
    );
    expect(printed()).toContain(
      "A real run that cannot ask needs: --accept-data-loss=dc_posts"
    );
  });

  it("asks nothing for a migration that deletes nothing", async () => {
    expect(await migrateCreate([posts])).toBeUndefined();
    expect(migrations()).toHaveLength(1);
    expect(migrations()[0]).not.toMatch(/^-- (Destructive|Deletes):/m);
  });

  it("says when the counts could not be read", async () => {
    await projectWithPostsAndPages();
    await migrateCreate([pages], { acceptDataLoss: true });
    expect(printed()).toContain(
      "Counts not shown: the database could not be read"
    );
  });
});

describe("migrate:create with a deletion at a terminal", () => {
  it("lists every deletion and asks; a no writes nothing and says how to keep the data", async () => {
    await projectWithPostsAndPages();
    state.canPrompt = true;
    state.answer = false;
    expect(await migrateCreate([pagesWithoutSummary])).toBe(1);
    expect(state.asked).toHaveLength(1);
    expect(migrations()).toHaveLength(1);
    expect(printed()).toContain(
      "table dc_posts: collection posts is no longer in the config"
    );
    expect(printed()).toContain("column dc_pages.summary");
    expect(printed()).toContain("No migration was written");
    expect(printed()).toContain("put the removed fields or entities back");
  });

  it("writes the file on a yes", async () => {
    await projectWithPostsAndPages();
    state.canPrompt = true;
    state.answer = true;
    expect(await migrateCreate([pages])).toBeUndefined();
    expect(state.asked).toHaveLength(1);
    expect(migrations()).toHaveLength(2);
  });
});

describe("migrate:create's consent, read as it was meant", () => {
  it("lists each deletion once when the consent covers it", async () => {
    await projectWithPostsAndPages();
    expect(
      await migrateCreate([pages], { acceptDataLoss: "dc_posts" })
    ).toBeUndefined();
    const listed = printed()
      .split("\n")
      .filter(line =>
        line.includes(
          "table dc_posts: collection posts is no longer in the config"
        )
      );
    expect(listed).toHaveLength(1);
  });

  it("refuses a name the consent took as its list, saying how to write both", async () => {
    await projectWithPostsAndPages();
    // `--accept-data-loss remove_posts`: the option's value is the name.
    expect(
      await migrateCreate([pages], {
        name: null,
        acceptDataLoss: "remove_posts",
      })
    ).toBe(1);
    expect(migrations()).toHaveLength(1);
    expect(printed()).toContain("--accept-data-loss=");
    expect(printed()).toContain("remove_posts");
  });

  it("says a dry run's real run refuses where a named consent leaves one out", async () => {
    await projectWithPostsAndPages();
    expect(
      await migrateCreate([pagesWithoutSummary], {
        dryRun: true,
        acceptDataLoss: "dc_posts",
      })
    ).toBeUndefined();
    expect(printed()).toContain(
      "A real run refuses: the consent given does not cover column dc_pages.summary"
    );
    expect(printed()).not.toContain("A real run asks");
  });

  it("says --accept-data-loss does nothing for a plugin's module", async () => {
    // The entry does not exist, so the run then fails loading it; the warning comes first.
    await migrateCreate([posts], {
      plugin: join(dir, "missing-plugin.ts"),
      acceptDataLoss: true,
    }).catch(() => undefined);
    expect(printed()).toContain(
      "--accept-data-loss has no effect with --plugin"
    );
  });
});
