/**
 * `migrate:check` and `migrate:create` read no database, so they run with no `DATABASE_URL`: the
 * dialect the migrations are for comes from `--dialect`, then the newest migration file's
 * `-- Dialect:` header, then `DB_DIALECT` or the scheme of `DATABASE_URL` read without connecting,
 * then a question at a terminal; where none says and nobody can be asked, both refuse naming
 * `--dialect`.
 *
 * The commands are driven themselves over a project directory, the configuration handed to the
 * loader. What would separate a correct run from a broken one: a command that still refuses for a
 * missing `DATABASE_URL`; a check that passes without comparing (a pending field must still fail
 * it); the environment read before the history, or the flag after either; a question asked where
 * the environment already says, or none asked where nothing does.
 */
import {
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { defineCollection, defineConfig, text } from "../../../config";
import { _resetEnvCache } from "../../../shared/lib/env";

import { pendingProject } from "./helpers/pending-project";

const loaded = vi.hoisted(() => ({ config: undefined as unknown }));
const asked = vi.hoisted(() => ({ select: vi.fn() }));

// `../program` imports every command; the commands under test are handed their context.
vi.mock("../../program", () => ({
  createContext: () => ({ logger: {} }),
}));

vi.mock("../../utils/config-loader", async importOriginal => ({
  ...(await importOriginal<typeof import("../../utils/config-loader")>()),
  loadConfig: async () => ({ config: loaded.config, dependencies: [] }),
}));

// The terminal's question for the dialect, answered by the test.
vi.mock("@clack/prompts", async importOriginal => ({
  ...(await importOriginal<typeof import("@clack/prompts")>()),
  select: asked.select,
}));

let dir: string;
const { create, check } = pendingProject(loaded, () => dir);

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "nextly-no-database-"));
  vi.stubEnv("CI", "");
  vi.stubEnv("DB_DIALECT", "");
  vi.stubEnv("DATABASE_URL", "");
  _resetEnvCache();
  asked.select.mockReset();
});

afterEach(() => {
  vi.unstubAllEnvs();
  _resetEnvCache();
  rmSync(dir, { recursive: true, force: true });
});

/** The project with `posts` holding `fields`. */
const project = (...fields: string[]) =>
  defineConfig({
    collections: [
      defineCollection({
        slug: "posts",
        fields: fields.map(name => text({ name })),
      }),
    ],
    db: { migrationsDir: "./migrations" },
  });

/** Each migration file's `-- Dialect:` header, oldest first. */
function dialectHeaders(): string[] {
  const folder = join(dir, "migrations");
  return readdirSync(folder)
    .filter(file => file.endsWith(".sql"))
    .sort()
    .map(
      file =>
        /^-- Dialect: (\S+)\s*$/m.exec(
          readFileSync(join(folder, file), "utf-8")
        )?.[1] ?? "none"
    );
}

/** A PostgreSQL address nothing listens on: named, never opened. */
const UNOPENED_POSTGRES = "postgres://nobody@127.0.0.1:1/none";

/** The environment a run sees: only the names given are set. */
function environment(env: { DB_DIALECT?: string; DATABASE_URL?: string }) {
  vi.stubEnv("DB_DIALECT", env.DB_DIALECT ?? "");
  vi.stubEnv("DATABASE_URL", env.DATABASE_URL ?? "");
  _resetEnvCache();
}

describe("with no DATABASE_URL", () => {
  it("runs on a project with migrations, the dialect read from them", async () => {
    environment({ DB_DIALECT: "sqlite" });
    expect((await create(project("title"))).code).toBeUndefined();
    environment({});

    // Nothing pending passes; a pending field fails, so the check compared.
    expect((await check(project("title"))).code).toBeUndefined();
    const pending = await check(project("title", "summary"));
    expect(pending.code).toBe(1);
    expect(pending.said.join("\n")).toContain("column dc_posts.summary");

    expect((await create(project("title", "summary"))).code).toBeUndefined();
    expect(dialectHeaders()).toEqual(["SQLite", "SQLite"]);
    expect((await check(project("title", "summary"))).code).toBeUndefined();
  });

  it("takes the dialect from DB_DIALECT or DATABASE_URL's scheme on a project without migrations", async () => {
    environment({ DB_DIALECT: "postgresql" });
    expect((await create(project("title"))).code).toBeUndefined();
    expect(dialectHeaders()).toEqual(["PostgreSQL"]);
    rmSync(join(dir, "migrations"), { recursive: true });

    // Read without connecting: nothing listens on this address.
    environment({ DATABASE_URL: "mysql://nobody@127.0.0.1:1/none" });
    expect((await create(project("title"))).code).toBeUndefined();
    expect(dialectHeaders()).toEqual(["MySQL"]);
  });

  it("refuses naming --dialect where nothing says and no terminal can be asked", async () => {
    for (const ran of [
      await create(project("title")),
      await check(project("title")),
    ]) {
      expect(ran.code).toBe(1);
      expect(ran.said.join("\n")).toContain("(DIALECT_NOT_STATED)");
      expect(ran.said.join("\n")).toContain("--dialect");
    }
    expect(asked.select).not.toHaveBeenCalled();
  });
});

describe("the order the dialect is read in", () => {
  it("takes the newest migration's dialect over DB_DIALECT and DATABASE_URL", async () => {
    environment({ DB_DIALECT: "postgresql", DATABASE_URL: UNOPENED_POSTGRES });
    expect((await create(project("title"))).code).toBeUndefined();

    environment({
      DB_DIALECT: "sqlite",
      DATABASE_URL: `file:${join(dir, "unused.db")}`,
    });
    expect((await create(project("title", "summary"))).code).toBeUndefined();

    expect(dialectHeaders()).toEqual(["PostgreSQL", "PostgreSQL"]);
  });

  it("takes --dialect over the history and the environment", async () => {
    environment({ DB_DIALECT: "postgresql", DATABASE_URL: UNOPENED_POSTGRES });
    expect((await create(project("title"))).code).toBeUndefined();

    // Over a PostgreSQL history the project has nothing pending; compared as MySQL, every text
    // column takes MySQL's type, so the flag is what the comparison used.
    expect((await check(project("title"))).code).toBeUndefined();
    const asMysql = await check(project("title"), { dialect: "mysql" });
    expect(asMysql.code).toBe(1);
    expect(asMysql.said.join("\n")).toContain("varchar(255)");

    rmSync(join(dir, "migrations"), { recursive: true });
    expect(
      (await create(project("title"), { dialect: "mysql" })).code
    ).toBeUndefined();
    expect(dialectHeaders()).toEqual(["MySQL"]);
  });
});

describe("the environment, read without connecting", () => {
  it("refuses a DB_DIALECT Nextly does not run on, and a DATABASE_URL whose scheme names none, as a command that connects does", async () => {
    environment({ DB_DIALECT: "oracle" });
    const invalid = await check(project("title"));
    expect(invalid.code).toBe(1);
    expect(invalid.said.join("\n")).toContain("(DATABASE_DIALECT_INVALID)");

    environment({ DATABASE_URL: "redis://127.0.0.1:1/0" });
    const unknown = await check(project("title"));
    expect(unknown.code).toBe(1);
    expect(unknown.said.join("\n")).toContain("(DATABASE_DIALECT_UNKNOWN)");
  });
});

describe("the history's dialect", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("is read from a migration written as one dialect's file alone, by its name", async () => {
    environment({ DB_DIALECT: "sqlite" });
    expect((await create(project("title"))).code).toBeUndefined();
    const folder = join(dir, "migrations");
    const [first] = readdirSync(folder).filter(file => file.endsWith(".sql"));
    renameSync(
      join(folder, first),
      join(folder, first.replace(/\.sql$/, ".sqlite.sql"))
    );

    environment({});
    const next = await create(project("title", "summary"));
    expect(next.code, next.said.join("\n")).toBeUndefined();
    expect(dialectHeaders()).toEqual(["SQLite", "SQLite"]);
  });

  it("is read from a file's header, never from a comment among its statements", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-01-01T12:00:00.000Z"));
    environment({ DB_DIALECT: "postgresql", DATABASE_URL: UNOPENED_POSTGRES });
    expect((await create(project("title"))).code).toBeUndefined();
    // Written by hand after it: its header names no dialect, and a statement's comment does.
    writeFileSync(
      join(dir, "migrations", "20260101_120001_000_by_hand.sql"),
      "-- UP\n-- Dialect: MySQL\nSELECT 1;\n\n-- DOWN\n"
    );

    vi.setSystemTime(new Date("2026-01-01T12:00:02.000Z"));
    environment({});
    const next = await create(project("title", "summary"));
    expect(next.code, next.said.join("\n")).toBeUndefined();
    const generated = readdirSync(join(dir, "migrations"))
      .filter(file => file.endsWith(".sql") && !file.includes("by_hand"))
      .sort()
      .map(
        file =>
          /^-- Dialect: (\S+)\s*$/m.exec(
            readFileSync(join(dir, "migrations", file), "utf-8")
          )?.[1]
      );
    expect(generated).toEqual(["PostgreSQL", "PostgreSQL"]);
  });
});

describe("migrate:create --record-snapshot", () => {
  it("refuses a DATABASE_URL that names another dialect than the migrations are for, before reading it", async () => {
    environment({ DB_DIALECT: "postgresql", DATABASE_URL: UNOPENED_POSTGRES });
    expect((await create(project("title"))).code).toBeUndefined();

    // The history is PostgreSQL's; the URL names a SQLite file.
    environment({ DATABASE_URL: `file:${join(dir, "site.db")}` });
    const recorded = await create(project("title"), { recordSnapshot: true });
    expect(recorded.code).toBe(1);
    expect(recorded.said.join("\n")).toContain("(DATABASE_DIALECT_DIFFERS)");
    expect(dialectHeaders()).toEqual(["PostgreSQL"]);
    expect(existsSync(join(dir, "site.db"))).toBe(false);
  });

  it("reports that refusal and exits 0 in a dry run, as a dry run reports what the real run would refuse", async () => {
    environment({ DB_DIALECT: "postgresql", DATABASE_URL: UNOPENED_POSTGRES });
    expect((await create(project("title"))).code).toBeUndefined();

    environment({ DATABASE_URL: `file:${join(dir, "site.db")}` });
    const dry = await create(project("title"), {
      recordSnapshot: true,
      dryRun: true,
    });
    expect(dry.code, dry.said.join("\n")).toBe(0);
    expect(dry.said.join("\n")).toContain("(DATABASE_DIALECT_DIFFERS)");
    expect(dialectHeaders()).toEqual(["PostgreSQL"]);
    expect(existsSync(join(dir, "site.db"))).toBe(false);
  });
});

describe("at a terminal", () => {
  /** stdin and stdout as a terminal's, for `run`. */
  async function atTerminal<T>(run: () => Promise<T>): Promise<T> {
    const stdin = Object.getOwnPropertyDescriptor(process.stdin, "isTTY");
    const stdout = Object.getOwnPropertyDescriptor(process.stdout, "isTTY");
    Object.defineProperty(process.stdin, "isTTY", {
      value: true,
      configurable: true,
    });
    Object.defineProperty(process.stdout, "isTTY", {
      value: true,
      configurable: true,
    });
    try {
      return await run();
    } finally {
      if (stdin) Object.defineProperty(process.stdin, "isTTY", stdin);
      else delete (process.stdin as { isTTY?: boolean }).isTTY;
      if (stdout) Object.defineProperty(process.stdout, "isTTY", stdout);
      else delete (process.stdout as { isTTY?: boolean }).isTTY;
    }
  }

  it("asks for the dialect only where nothing else says", async () => {
    asked.select.mockResolvedValue("sqlite");

    environment({ DB_DIALECT: "sqlite" });
    const said = await atTerminal(() => check(project("title")));
    expect(asked.select).not.toHaveBeenCalled();
    // Compared in the dialect the environment names: the new table is pending.
    expect(said.code).toBe(1);
    expect(said.said.join("\n")).toContain("(SCHEMA_DRIFT)");

    environment({});
    const answered = await atTerminal(() => check(project("title")));
    expect(asked.select).toHaveBeenCalledTimes(1);
    expect(answered.code).toBe(1);
    expect(answered.said.join("\n")).toContain("(SCHEMA_DRIFT)");
  });
});
