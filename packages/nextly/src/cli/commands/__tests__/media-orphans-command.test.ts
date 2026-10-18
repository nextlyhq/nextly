/**
 * `nextly media orphans` as the CLI runs it: what it connects, loads and
 * reads before it searches. The search itself is tested in
 * media-orphans.test.ts; here the database and the config loader are
 * stand-ins, so the order and the arguments can be observed.
 */
import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const seen = vi.hoisted(() => ({
  calls: [] as string[],
  loadConfig: [] as unknown[],
  storage: [] as unknown[],
  resolver: null as null | { getTable: (name: string) => unknown },
}));

vi.mock("../../utils/config-loader", () => ({
  loadConfig: async (options: unknown) => {
    seen.loadConfig.push(options);
    return { config: { storage: seen.storage } };
  },
}));

vi.mock("../../utils/adapter", () => ({
  validateDatabaseEnv: () => ({
    valid: true,
    errors: [],
    dialect: "sqlite",
    databaseUrl: "file:unused.db",
  }),
  createCliAdapter: async () => ({
    getCapabilities: () => ({ dialect: "sqlite" }),
    setTableResolver: (resolver: { getTable: (name: string) => unknown }) => {
      seen.calls.push("setTableResolver");
      seen.resolver = resolver;
    },
    // As the real adapter does: a table with no registered schema is refused.
    select: async (table: string) => {
      seen.calls.push(`select ${table}`);
      if (!seen.resolver?.getTable(table)) {
        throw new Error(`Table "${table}" not found in schema registry`);
      }
      return [];
    },
    disconnect: async () => {},
  }),
}));

import { createProgram } from "../../program";

let dir: string;
let exits: number[];
beforeEach(async () => {
  dir = await realpath(await mkdtemp(path.join(tmpdir(), "nextly-cmd-")));
  seen.calls.length = 0;
  seen.loadConfig.length = 0;
  seen.storage = [];
  seen.resolver = null;
  exits = [];
  vi.spyOn(process, "exit").mockImplementation(
    (code?: number | string | null) => {
      exits.push(Number(code ?? 0));
      return undefined as never;
    }
  );
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(async () => {
  vi.restoreAllMocks();
  await rm(dir, { recursive: true, force: true });
});

/** A bucket holding one left-behind thumbnail, stored two hours ago. */
function bucketWithOrphan(folder: string) {
  const deleted: string[] = [];
  const path = `${folder}/2026/10/0b7f0b0e-6d6f-4b0a-9a39-3f1f6b2a6c11-thumb_x.png`;
  return {
    deleted,
    path,
    adapter: {
      async *list() {
        yield { path, lastModified: new Date(Date.now() - 2 * 3_600_000) };
      },
      async delete(file: string) {
        deleted.push(file);
      },
      async upload(): Promise<never> {
        throw new Error("not used");
      },
      async exists() {
        return true;
      },
      getPublicUrl: (file: string) => file,
      getType: () => "s3",
    },
  };
}

describe("nextly media orphans, as the CLI runs it", () => {
  // Two storage plugins on one bucket are two adapter objects; whether they
  // share a place is read from their prefixes, not from which object is
  // which.
  it("removes nothing where another collection's storage has media's prefix", async () => {
    const media = bucketWithOrphan("media");
    const docs = bucketWithOrphan("media");
    seen.storage = [
      {
        name: "s3-media",
        type: "s3",
        collections: { media: { prefix: "media" } },
        adapter: media.adapter,
      },
      {
        name: "s3-docs",
        type: "s3",
        collections: { docs: { prefix: "media" } },
        adapter: docs.adapter,
      },
    ];

    await createProgram().parseAsync([
      "node",
      "nextly",
      "--cwd",
      dir,
      "media",
      "orphans",
      "--apply",
    ]);

    expect(exits).toEqual([0]);
    expect(media.deleted).toEqual([]);
  });

  it("removes a left-behind thumbnail where media's prefix is its own", async () => {
    const media = bucketWithOrphan("media");
    const docs = bucketWithOrphan("docs");
    seen.storage = [
      {
        name: "s3-media",
        type: "s3",
        collections: { media: { prefix: "media" } },
        adapter: media.adapter,
      },
      {
        name: "s3-docs",
        type: "s3",
        collections: { docs: { prefix: "docs" } },
        adapter: docs.adapter,
      },
    ];

    await createProgram().parseAsync([
      "node",
      "nextly",
      "--cwd",
      dir,
      "media",
      "orphans",
      "--apply",
    ]);

    expect(exits).toEqual([0]);
    expect(media.deleted).toEqual([media.path]);
  });

  it("registers the tables before it reads media, and finds the project from --cwd", async () => {
    await createProgram().parseAsync([
      "node",
      "nextly",
      "--cwd",
      dir,
      "media",
      "orphans",
    ]);

    expect(exits).toEqual([0]);
    expect(seen.calls.indexOf("setTableResolver")).toBeGreaterThanOrEqual(0);
    expect(seen.calls.indexOf("setTableResolver")).toBeLessThan(
      seen.calls.indexOf("select media")
    );
    // The loader discovers the config from the project; a path is passed
    // only when one was given.
    expect(seen.loadConfig).toEqual([{ configPath: undefined, cwd: dir }]);
  });

  it("passes the config path when one is given", async () => {
    await createProgram().parseAsync([
      "node",
      "nextly",
      "--cwd",
      dir,
      "--config",
      "src/nextly.config.ts",
      "media",
      "orphans",
    ]);

    expect(seen.loadConfig).toEqual([
      { configPath: "src/nextly.config.ts", cwd: dir },
    ]);
  });
});
