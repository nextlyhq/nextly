/**
 * `migrate:check` reports the changes `migrate:create` would write, from what the project commits.
 *
 * - A Schema Builder definition file git ignores is not committed, so a check over it would pass
 *   on the machine that holds it and fail in CI: `migrate:check` refuses it, naming the file, and
 *   `migrate:create` writes from it and warns, naming it. A committed file, or one outside any git
 *   repository, is read as before.
 * - Over a snapshot written before snapshots recorded settings and permissions, both commands say
 *   so: the check passes, and `migrate:create` records them, after which neither says it.
 *
 * The commands are driven themselves over a project directory, the configuration handed to the
 * loader. What would separate a correct run from a broken one: an ignored file read in silence, a
 * committed one refused, a file outside git refused because git cannot be asked; the notice
 * missing from either command, the check failing on it, or the notice given again once recorded.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { defineCollection, defineConfig, text } from "../../../config";
import { _resetEnvCache } from "../../../shared/lib/env";

import { pendingProject } from "./helpers/pending-project";

const loaded = vi.hoisted(() => ({ config: undefined as unknown }));

// `../program` imports every command; the commands under test are handed their context.
vi.mock("../../program", () => ({
  createContext: () => ({ logger: {} }),
}));

vi.mock("../../utils/config-loader", async importOriginal => ({
  ...(await importOriginal<typeof import("../../utils/config-loader")>()),
  loadConfig: async () => ({ config: loaded.config, dependencies: [] }),
}));

let dir: string;
const { create, check } = pendingProject(loaded, () => dir);

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "nextly-pending-"));
  vi.stubEnv("CI", "");
  // Neither command connects; each needs only the dialect.
  vi.stubEnv("DB_DIALECT", "sqlite");
  vi.stubEnv("DATABASE_URL", "");
  // git looks no further up than the test's own directory, so a temporary folder inside some
  // other repository is still outside one.
  vi.stubEnv("GIT_CEILING_DIRECTORIES", dirname(dir));
  _resetEnvCache();
});

afterEach(() => {
  vi.unstubAllEnvs();
  _resetEnvCache();
  rmSync(dir, { recursive: true, force: true });
});

/** Every line a run said, as one text. */
const saidBy = (ran: { said: string[] }) => ran.said.join("\n");

/** The migration files in the folder. */
const sqlFiles = () =>
  readdirSync(join(dir, "migrations")).filter(file => file.endsWith(".sql"));

describe("a Schema Builder definition file", () => {
  const builderProject = defineConfig({
    collections: [],
    db: { migrationsDir: "./migrations" },
  });

  /** The definition file holding the Builder collections `slugs`. */
  const define = (...slugs: string[]) =>
    writeFile(
      join(dir, "ui-schema.json"),
      JSON.stringify({
        collections: slugs.map(slug => ({
          slug,
          fields: [{ name: "summary", type: "text" }],
        })),
      })
    );

  const git = (...args: string[]) =>
    execFileSync("git", args, { cwd: dir, stdio: "ignore" });

  it("that git ignores is refused by migrate:check and warned about by migrate:create, naming it", async () => {
    git("init", "-q");
    await writeFile(join(dir, ".gitignore"), "ui-schema.json\n");
    await define("cases");

    const created = await create(builderProject);
    expect(created.code).toBeUndefined();
    expect(saidBy(created)).toMatch(
      /ui-schema\.json, is ignored by git[\s\S]*Commit \S*ui-schema\.json/
    );
    // Written from the file all the same.
    expect(sqlFiles()).toHaveLength(1);

    const checked = await check(builderProject);
    expect(checked.code).toBe(1);
    expect(saidBy(checked)).toContain("(BUILDER_DEFINITION_IGNORED)");
    expect(saidBy(checked)).toMatch(/`\S*ui-schema\.json`, is ignored by git/);
  });

  it("that git does not ignore is read as before", async () => {
    git("init", "-q");
    await define("cases");

    const created = await create(builderProject);
    expect(created.code).toBeUndefined();
    expect(saidBy(created)).not.toContain("ignored by git");
    expect((await check(builderProject)).code).toBeUndefined();

    // Read: an entity added to it is pending.
    await define("cases", "notes");
    const pending = await check(builderProject);
    expect(pending.code).toBe(1);
    expect(saidBy(pending)).toContain("dc_notes");
  });

  it("outside any git repository is read as before", async () => {
    await define("cases");

    const created = await create(builderProject);
    expect(created.code).toBeUndefined();
    expect(saidBy(created)).not.toContain("ignored by git");
    expect((await check(builderProject)).code).toBeUndefined();
  });
});

describe("a snapshot written before snapshots recorded settings", () => {
  const NOTICE = "Settings not yet recorded in a migration";

  const project = defineConfig({
    collections: [
      defineCollection({
        slug: "posts",
        description: "Blog posts",
        fields: [text({ name: "headline" })],
      }),
    ],
    db: { migrationsDir: "./migrations" },
  });

  it("is named by both commands, passes the check, and is recorded by migrate:create", async () => {
    expect((await create(project)).code).toBeUndefined();
    // The same snapshot as an earlier release wrote it: no record of settings or permissions.
    const meta = join(dir, "migrations", "meta");
    const [name] = readdirSync(meta);
    const file = JSON.parse(await readFile(join(meta, name), "utf-8"));
    delete file.entities;
    delete file.permissions;
    await rm(join(meta, name));
    await writeFile(join(meta, name), JSON.stringify(file));

    const checked = await check(project);
    expect(checked.code).toBeUndefined();
    expect(saidBy(checked)).toContain(NOTICE);

    const created = await create(project);
    expect(created.code).toBeUndefined();
    expect(saidBy(created)).toContain(NOTICE);
    expect(sqlFiles()).toHaveLength(2);

    const after = await check(project);
    expect(after.code).toBeUndefined();
    expect(saidBy(after)).not.toContain(NOTICE);
  });
});
