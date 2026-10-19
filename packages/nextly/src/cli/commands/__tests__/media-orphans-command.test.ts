/**
 * `nextly media orphans` as the CLI runs it: what it connects, loads and
 * reads before it searches. The search itself is tested in
 * media-orphans.test.ts; here the database and the config loader are
 * stand-ins, so the order and the arguments can be observed.
 */
import {
  mkdir,
  mkdtemp,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const seen = vi.hoisted(() => ({
  calls: [] as string[],
  loadConfig: [] as unknown[],
  /** The process's directory when the config loaded. */
  loadedIn: [] as string[],
  /** The config file the loader reports it loaded, as discovery finds it. */
  loadedFrom: undefined as string | undefined,
  storage: [] as unknown[],
  resolver: null as null | { getTable: (name: string) => unknown },
}));

vi.mock("../../utils/config-loader", () => ({
  loadConfig: async (options: unknown) => {
    seen.loadConfig.push(options);
    seen.loadedIn.push(process.cwd());
    return { config: { storage: seen.storage }, configPath: seen.loadedFrom };
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
    // The per-file ask before a removal: no other item refers to anything.
    getDrizzle: () => ({
      select: () => ({ from: () => ({ where: async () => [] }) }),
    }),
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
const startedIn = process.cwd();
beforeEach(async () => {
  dir = await realpath(await mkdtemp(path.join(tmpdir(), "nextly-cmd-")));
  seen.calls.length = 0;
  seen.loadConfig.length = 0;
  seen.loadedIn.length = 0;
  seen.loadedFrom = undefined;
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
  process.chdir(startedIn);
  vi.restoreAllMocks();
  await rm(dir, { recursive: true, force: true });
});

/** A bucket holding one left-behind thumbnail, stored two hours ago. */
function bucketWithOrphan(folder: string, type = "s3") {
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
      getType: () => type,
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

    // Run from inside the project, as --apply needs.
    process.chdir(dir);
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
    // A prefix for media cannot help while docs shares it: the output names
    // the collection that needs one of its own.
    const said = vi
      .mocked(console.log)
      .mock.calls.map(args => String(args[0]))
      .join("\n");
    expect(said).toMatch(/docs/);
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

    // Run from inside the project, as --apply needs.
    process.chdir(dir);
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

  // Collections with no storage plugin upload through the local-disk
  // fallback, into the default uploads folder an explicit local plugin for
  // media may also use, and nothing shows the two are apart.
  it("removes nothing where media's storage is local disk, which the fallback may share", async () => {
    const media = bucketWithOrphan("media", "local");
    seen.storage = [
      {
        name: "local-media",
        type: "local",
        collections: { media: { prefix: "media" } },
        adapter: media.adapter,
      },
    ];

    // Run from inside the project, as --apply needs.
    process.chdir(dir);
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
    const said = vi
      .mocked(console.log)
      .mock.calls.map(args => String(args[0]))
      .join("\n");
    expect(said).toContain(media.path);
    expect(said).toMatch(/no storage plugin/);
  });

  // A storage factory resolves a relative path when the config loads, so the
  // config loads from the project --cwd names.
  it("loads the config from inside the project --cwd names", async () => {
    await createProgram().parseAsync([
      "node",
      "nextly",
      "--cwd",
      dir,
      "media",
      "orphans",
    ]);

    expect(seen.loadedIn).toEqual([dir]);
  });

  // A relative --cwd names a folder from where the command was run, once.
  it("resolves a relative --cwd once, from where the command was run", async () => {
    process.chdir(path.dirname(dir));

    await createProgram().parseAsync([
      "node",
      "nextly",
      "--cwd",
      path.basename(dir),
      "media",
      "orphans",
    ]);

    expect(seen.loadedIn).toEqual([dir]);
    expect(seen.loadConfig).toEqual([{ configPath: undefined, cwd: dir }]);
  });

  // The CLI reads `.env` from the directory it was run in, before it reads
  // --cwd, so a database named there may be another project's.
  it("removes nothing when run from another project with its own .env", async () => {
    const media = bucketWithOrphan("media");
    seen.storage = [
      {
        name: "s3-media",
        type: "s3",
        collections: { media: { prefix: "media" } },
        adapter: media.adapter,
      },
    ];
    const elsewhere = path.join(dir, "elsewhere");
    await mkdir(elsewhere);
    await writeFile(
      path.join(elsewhere, ".env"),
      "DATABASE_URL=file:other.db\n"
    );
    process.chdir(elsewhere);

    await createProgram().parseAsync([
      "node",
      "nextly",
      "--cwd",
      dir,
      "media",
      "orphans",
      "--apply",
    ]);

    expect(exits).toEqual([1]);
    expect(media.deleted).toEqual([]);
    expect(seen.calls).not.toContain("select media");
  });

  // The database settings may come from the shell or a parent process as
  // well, which nothing ties to the project --cwd names.
  it("removes nothing when run from another directory, with no .env there", async () => {
    const media = bucketWithOrphan("media");
    seen.storage = [
      {
        name: "s3-media",
        type: "s3",
        collections: { media: { prefix: "media" } },
        adapter: media.adapter,
      },
    ];
    const elsewhere = path.join(dir, "no-env-here");
    await mkdir(elsewhere);
    process.chdir(elsewhere);

    await createProgram().parseAsync([
      "node",
      "nextly",
      "--cwd",
      dir,
      "media",
      "orphans",
      "--apply",
    ]);

    expect(exits).toEqual([1]);
    expect(media.deleted).toEqual([]);
    expect(seen.calls).not.toContain("select media");
  });

  // A config outside the project is another project's storage, read
  // against this project's database.
  it("removes nothing with a config from outside the project", async () => {
    const media = bucketWithOrphan("media");
    seen.storage = [
      {
        name: "s3-media",
        type: "s3",
        collections: { media: { prefix: "media" } },
        adapter: media.adapter,
      },
    ];
    process.chdir(dir);

    await createProgram().parseAsync([
      "node",
      "nextly",
      "--cwd",
      dir,
      "--config",
      "../other-project/nextly.config.ts",
      "media",
      "orphans",
      "--apply",
    ]);

    expect(exits).toEqual([1]);
    expect(media.deleted).toEqual([]);
    expect(seen.loadConfig).toEqual([]);
  });

  // A link inside the project to another project's config is that config.
  it("removes nothing with a config linked from outside the project", async () => {
    const media = bucketWithOrphan("media");
    seen.storage = [
      {
        name: "s3-media",
        type: "s3",
        collections: { media: { prefix: "media" } },
        adapter: media.adapter,
      },
    ];
    const other = await mkdtemp(path.join(tmpdir(), "nextly-other-"));
    await writeFile(
      path.join(other, "nextly.config.ts"),
      "export default {};\n"
    );
    await symlink(
      path.join(other, "nextly.config.ts"),
      path.join(dir, "linked.config.ts")
    );
    process.chdir(dir);

    try {
      await createProgram().parseAsync([
        "node",
        "nextly",
        "--cwd",
        dir,
        "--config",
        "linked.config.ts",
        "media",
        "orphans",
        "--apply",
      ]);
    } finally {
      await rm(other, { recursive: true, force: true });
    }

    expect(exits).toEqual([1]);
    expect(media.deleted).toEqual([]);
    expect(seen.loadConfig).toEqual([]);
  });

  // Discovery follows a link too: the project's own config file can be a
  // link to another project's.
  it("removes nothing when the discovered config links outside the project", async () => {
    const media = bucketWithOrphan("media");
    seen.storage = [
      {
        name: "s3-media",
        type: "s3",
        collections: { media: { prefix: "media" } },
        adapter: media.adapter,
      },
    ];
    const other = await mkdtemp(path.join(tmpdir(), "nextly-other-"));
    await writeFile(
      path.join(other, "nextly.config.ts"),
      "export default {};\n"
    );
    await symlink(
      path.join(other, "nextly.config.ts"),
      path.join(dir, "nextly.config.ts")
    );
    seen.loadedFrom = path.join(dir, "nextly.config.ts");
    process.chdir(dir);

    try {
      await createProgram().parseAsync([
        "node",
        "nextly",
        "--cwd",
        dir,
        "media",
        "orphans",
        "--apply",
      ]);
    } finally {
      await rm(other, { recursive: true, force: true });
    }

    expect(exits).toEqual([1]);
    expect(media.deleted).toEqual([]);
    expect(seen.calls).not.toContain("select media");
  });

  it("reads the project's own .env for what is not already set", async () => {
    await writeFile(
      path.join(dir, ".env"),
      "NEXTLY_ORPHANS_TEST_ONLY=from-project\n"
    );
    process.chdir(path.dirname(dir));
    delete process.env.NEXTLY_ORPHANS_TEST_ONLY;

    try {
      await createProgram().parseAsync([
        "node",
        "nextly",
        "--cwd",
        dir,
        "media",
        "orphans",
      ]);

      expect(process.env.NEXTLY_ORPHANS_TEST_ONLY).toBe("from-project");
    } finally {
      delete process.env.NEXTLY_ORPHANS_TEST_ONLY;
    }
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
