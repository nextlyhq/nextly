/**
 * The development server's report of the changes not yet in a migration (`init/drift-block.ts`):
 * one block naming each entity and what changed in it, read from the comparison `migrate:check`
 * reports from; nothing while nothing is pending, never the same block twice; "fully captured"
 * once a migration captures the last change, and nothing where a change is undone; and nothing
 * at all in a production start, which reads no migration file to work it out.
 *
 * Driven over a project directory the commands write migrations into, as a development server's
 * project is. What would separate a correct report from a broken one: a block that names other
 * changes than `migrate:check`; a block said on every reload; "fully captured" said for an undone
 * edit, or more than once; a production start that reads the migrations folder.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { pendingProject } from "../../cli/commands/__tests__/helpers/pending-project";
import {
  defineCollection,
  defineConfig,
  defineSingle,
  text,
} from "../../config";
import { container } from "../../di/container";
import { processGlobal } from "../../shared/process-global";
import { consoleLogger } from "../../shared/types";
import { _resetEnvCache } from "../../shared/lib/env";
import {
  DRIFT_HEADER,
  type DriftInputs,
  FULLY_CAPTURED,
  reportPendingChanges,
} from "../drift-block";

const loaded = vi.hoisted(() => ({ config: undefined as unknown }));
const project = vi.hoisted(() => ({ root: "" }));
/** Every path the file system was asked to read, in this test. */
const reads = vi.hoisted(() => ({ paths: [] as string[] }));

// `../program` imports every command; the commands under test are handed their context.
vi.mock("../../cli/program", () => ({ createContext: () => ({ logger: {} }) }));

vi.mock("../../cli/utils/config-loader", async importOriginal => ({
  ...(await importOriginal<typeof import("../../cli/utils/config-loader")>()),
  loadConfig: async () => ({ config: loaded.config, dependencies: [] }),
}));

// The development server's project: where its migrations folder and definition file are.
vi.mock("../boot-apply", async importOriginal => ({
  ...(await importOriginal<typeof import("../boot-apply")>()),
  startProject: async () => ({
    root: project.root,
    migrationsDir: join(project.root, "migrations"),
    database: undefined,
  }),
}));

/** `fn`, noting the path it is asked for. */
function noted<A extends unknown[], R>(
  fn: (...args: A) => R
): (...args: A) => R {
  return (...args: A) => {
    reads.paths.push(String(args[0]));
    return fn(...args);
  };
}
vi.mock("node:fs/promises", async importOriginal => {
  const real = await importOriginal<typeof import("node:fs/promises")>();
  const spied = {
    readFile: noted(real.readFile),
    readdir: noted(real.readdir),
  };
  return { ...real, ...spied, default: { ...real, ...spied } };
});
vi.mock("node:fs", async importOriginal => {
  const real = await importOriginal<typeof import("node:fs")>();
  const spied = {
    readFileSync: noted(real.readFileSync),
    readdirSync: noted(real.readdirSync),
    watch: noted(real.watch),
  };
  return { ...real, ...spied, default: { ...real, ...spied } };
});

const { create, check } = pendingProject(loaded, () => project.root);

let said: { warn: string[]; info: string[] };

beforeEach(() => {
  project.root = mkdtempSync(join(tmpdir(), "nextly-drift-block-"));
  reads.paths = [];
  vi.stubEnv("CI", "");
  vi.stubEnv("NODE_ENV", "development");
  vi.stubEnv("DB_DIALECT", "sqlite");
  vi.stubEnv("DATABASE_URL", `file:${join(project.root, "unused.db")}`);
  _resetEnvCache();
  // A development server's database is registered; the report reads only its dialect.
  vi.spyOn(container, "has").mockImplementation(name => name === "adapter");
  vi.spyOn(container, "get").mockImplementation(() => ({ dialect: "sqlite" }));
  said = { warn: [], info: [] };
  vi.spyOn(consoleLogger, "warn").mockImplementation(line => {
    said.warn.push(String(line));
  });
  vi.spyOn(consoleLogger, "info").mockImplementation(line => {
    said.info.push(String(line));
  });
  // Each test starts as a fresh development server: nothing said yet.
  const report = processGlobal<{ last?: unknown }>("driftReport", () => ({}));
  delete report.last;
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  _resetEnvCache();
  rmSync(project.root, { recursive: true, force: true });
});

/** The project with `posts` (described as `description`, holding `fields`) and `extra` entities. */
const site = (
  description: string,
  fields: string[],
  extra: { single?: string } = {}
) =>
  defineConfig({
    collections: [
      defineCollection({
        slug: "posts",
        description,
        fields: fields.map(name => text({ name })),
      }),
    ],
    singles:
      extra.single === undefined
        ? []
        : [
            defineSingle({
              slug: extra.single,
              fields: [text({ name: "note" })],
            }),
          ],
    db: { migrationsDir: "./migrations" },
  });

/** A report over `config`, as a reload that read it hands one over. */
const report = (config: unknown) => {
  loaded.config = config;
  return reportPendingChanges({ config } as DriftInputs);
};

const blocks = () => said.warn.filter(line => line.startsWith(DRIFT_HEADER));

describe("the block", () => {
  it("names each entity with what changed in it, and the command that captures them", async () => {
    expect((await create(site("Blog posts", ["title"]))).code).toBeUndefined();

    const edited = site("Articles", ["title", "summary"], { single: "about" });
    await report(edited);

    expect(blocks()).toHaveLength(1);
    expect(blocks()[0]).toMatchInlineSnapshot();
    // The same changes migrate:check reports for the same project, entity by entity.
    const checked = await check(edited);
    expect(checked.code).toBe(1);
    const listed = checked.said.join("\n");
    expect(listed).toContain("posts: description, fields.summary (added)");
    expect(listed).toContain("about (single): added");
    expect(blocks()[0]).toContain(
      "posts: setting description changed, field summary added"
    );
    expect(blocks()[0]).toContain("about (single): added");
  });

  it("is silent when in step", async () => {
    expect((await create(site("Blog posts", ["title"]))).code).toBeUndefined();

    await report(site("Blog posts", ["title"]));

    expect(said.warn).toEqual([]);
    expect(said.info).toEqual([]);
  });

  it("is not said again after a reload with no change", async () => {
    expect((await create(site("Blog posts", ["title"]))).code).toBeUndefined();

    await report(site("Blog posts", ["title", "summary"]));
    await report(site("Blog posts", ["title", "summary"]));

    expect(blocks()).toHaveLength(1);
  });

  it("is said again when what is pending changes", async () => {
    expect((await create(site("Blog posts", ["title"]))).code).toBeUndefined();

    await report(site("Blog posts", ["title", "summary"]));
    await report(site("Blog posts", ["title", "summary", "body"]));

    expect(blocks()).toHaveLength(2);
    expect(blocks()[1]).toContain("field body added");
  });
});

describe("once the list empties", () => {
  it("says the schema is fully captured once, after migrate:create wrote the migration", async () => {
    expect((await create(site("Blog posts", ["title"]))).code).toBeUndefined();
    await report(site("Blog posts", ["title", "summary"]));

    expect(
      (await create(site("Blog posts", ["title", "summary"]))).code
    ).toBeUndefined();
    await report(site("Blog posts", ["title", "summary"]));
    await report(site("Blog posts", ["title", "summary"]));

    expect(said.info.filter(line => line === FULLY_CAPTURED)).toHaveLength(1);
  });

  it("says nothing where the change was undone, since no migration captured it", async () => {
    expect((await create(site("Blog posts", ["title"]))).code).toBeUndefined();
    await report(site("Blog posts", ["title", "summary"]));

    await report(site("Blog posts", ["title"]));

    expect(said.info).toEqual([]);
    expect(blocks()).toHaveLength(1);
  });
});

describe("in production", () => {
  it("a production start with pending changes prints no block and reads no migration file", async () => {
    expect((await create(site("Blog posts", ["title"]))).code).toBeUndefined();
    vi.stubEnv("NODE_ENV", "production");
    reads.paths = [];

    // What a start runs that could report: its development steps and its reload, which a
    // production start refuses, and the report itself.
    const { runBootTimeApplyIfDev } = await import("../boot-apply");
    await runBootTimeApplyIfDev({ caller: "init" });
    await report(site("Articles", ["title", "summary"]));

    expect(blocks()).toEqual([]);
    expect(
      reads.paths.filter(path =>
        path.startsWith(join(project.root, "migrations"))
      )
    ).toEqual([]);
  });
});
