/**
 * Where the connection test sits in a run without questions: once, with the
 * string given, before the first file is written, and then the run goes on to
 * write the project. A database that already holds tables is named as a
 * warning. The test itself is replaced here by a recorder; what it does
 * against a server is in connection-test.test.ts and its integration tests.
 */
import { access, mkdir, readFile } from "node:fs/promises";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ConnectionResult } from "../connection-test";

import { ui } from "./clack-recorder";
import {
  HERMETIC,
  USER_AGENTS,
  captureConsole,
  installFakeManagers,
  makeWorkdir,
  printed,
  removeWorkdir,
  runCli,
} from "./scaffold-harness";

const seen = vi.hoisted(() => ({
  calls: [] as { dialect: string; url: string; folderExisted: boolean }[],
  folder: "",
  answer: undefined as unknown,
}));

vi.mock("@clack/prompts", async () =>
  (await import("./clack-recorder")).clack()
);
vi.mock("@nextlyhq/telemetry", async () =>
  (await import("./clack-recorder")).telemetry()
);
vi.mock("../connection-test", async importOriginal => {
  const { existsSync } = await import("node:fs");
  return {
    ...(await importOriginal<typeof import("../connection-test")>()),
    testConnection: async (dialect: string, url: string) => {
      seen.calls.push({ dialect, url, folderExisted: existsSync(seen.folder) });
      return seen.answer;
    },
  };
});

const URL = "postgresql://site_user:Or-S3cret@localhost:5440/site";

let dir: string;
let work: string;

beforeEach(async () => {
  ui.reset();
  captureConsole();
  dir = await makeWorkdir("nextly-conn-order-");
  work = path.join(dir, "work");
  await mkdir(work);
  await installFakeManagers(dir);
  vi.stubEnv("npm_config_user_agent", USER_AGENTS.pnpm);
  vi.stubEnv("DATABASE_URL", "");
  seen.calls = [];
  seen.folder = path.join(work, "my-app");
  seen.answer = {
    ok: true,
    server: "PostgreSQL 17.2",
    database: "site",
  } satisfies ConnectionResult;
});
afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  await removeWorkdir(dir);
});

const allOutput = () => [...ui.out, ...printed].join("\n");
const FLAGS = ["my-app", "-t", "blank", "-d", "postgresql", ...HERMETIC];

describe("the connection test's place in a run", () => {
  it("tests the given string once, before the project folder exists, then writes the project", async () => {
    const code = await runCli([...FLAGS, "--database-url", URL], { cwd: work });
    expect(code).toBe(0);
    expect(seen.calls).toEqual([
      { dialect: "postgresql", url: URL, folderExisted: false },
    ]);
    expect(allOutput()).toContain(
      'Connected to PostgreSQL 17.2, database "site" (tested)'
    );
    await access(path.join(work, "my-app", ".env"));
    expect(await readFile(path.join(work, "my-app", ".env"), "utf8")).toContain(
      `DATABASE_URL=${URL}`
    );
  });

  it("names a database that already holds tables, and says whether they look like a Nextly site", async () => {
    seen.answer = {
      ok: true,
      server: "PostgreSQL 17.2",
      database: "site",
      existingTables: "other",
    } satisfies ConnectionResult;
    const code = await runCli([...FLAGS, "--database-url", URL], { cwd: work });
    expect(code).toBe(0);
    expect(allOutput()).toContain(
      "This database already holds tables that don't look like a Nextly site."
    );
  });

  it("tests nothing for SQLite, nor for --yes with no string at all (the placeholder)", async () => {
    expect(
      await runCli(["my-app", "-t", "blank", "-d", "sqlite", ...HERMETIC], {
        cwd: work,
      })
    ).toBe(0);
    expect(
      await runCli(
        ["other-app", "-t", "blank", "-d", "postgresql", "--yes", ...HERMETIC],
        { cwd: work, tty: true }
      )
    ).toBe(0);
    expect(seen.calls).toEqual([]);
  });
});
