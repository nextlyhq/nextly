/**
 * `migrate:create --dry-run` names the files a real run writes and prints the migration's text,
 * and writes nothing. Each case runs the dry run and then the real run on the same clock, so the
 * files the real run writes are the ones the dry run named, with the text it printed: a dry run
 * that guessed at its names or its text would part from the real run here.
 */
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { defineCollection, defineConfig, text } from "../../../config";
import { setNonInteractive } from "../../../domains/schema/migrate/can-prompt";
import { formatTimestamp } from "../../../domains/schema/migrate-create/format-file";
import { _resetEnvCache } from "../../../shared/lib/env";
import { folderSnapshot } from "../../__tests__/helpers/folder-snapshot";
import { dryRunLines, type DryRunChange } from "../../dry-run";
import type { CommandContext } from "../../program";
import type { bundleAndRequire as BundleAndRequire } from "../../utils/config-bundler";
import { createLogger } from "../../utils/logger";
import { runMigrateCreate } from "../migrate-create";

const loaded = vi.hoisted(() => ({
  config: undefined as unknown,
}));
vi.mock("../../utils/config-loader", async importOriginal => ({
  ...(await importOriginal<typeof import("../../utils/config-loader")>()),
  loadConfig: async () => ({ config: loaded.config, dependencies: [] }),
}));

/**
 * The CLI's bundler with the test runner's `import()`, for a plugin entry: esbuild compiles it to
 * an ES module beside it, which is imported from there. The bundler's own import is opaque to the
 * test runner.
 */
const bundleAndRequire = vi.hoisted(
  () =>
    async function bundle(
      options: Parameters<typeof BundleAndRequire>[0]
    ): ReturnType<typeof BundleAndRequire> {
      const { build } = await import("esbuild");
      const outfile = join(
        tmpdir(),
        `nextly-create-dry-run-entry-${Date.now()}-${Math.random().toString(36).slice(2)}.mjs`
      );
      await build({
        entryPoints: [options.filepath],
        bundle: true,
        platform: "node",
        format: "esm",
        packages: "external",
        outfile,
        logLevel: "silent",
      });
      try {
        return {
          mod: (await import(
            /* @vite-ignore */ pathToFileURL(outfile).href
          )) as Record<string, unknown>,
          dependencies: [],
        };
      } finally {
        rmSync(outfile, { force: true });
      }
    }
);
vi.mock("../../utils/config-bundler", () => ({ bundleAndRequire }));

let dir: string;
let previousDialect: string | undefined;
let previousUrl: string | undefined;
let clock = 0;
let now: Date;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "nextly-create-dry-run-"));
  previousDialect = process.env.DB_DIALECT;
  previousUrl = process.env.DATABASE_URL;
  // Only the dialect is read; none of these runs connects.
  process.env.DB_DIALECT = "sqlite";
  process.env.DATABASE_URL = `file:${join(dir, "unused.db")}`;
  _resetEnvCache();
  vi.useFakeTimers({ toFake: ["Date"] });
});

afterEach(() => {
  vi.useRealTimers();
  if (previousDialect === undefined) delete process.env.DB_DIALECT;
  else process.env.DB_DIALECT = previousDialect;
  if (previousUrl === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = previousUrl;
  _resetEnvCache();
  rmSync(dir, { recursive: true, force: true });
});

/** Moves the clock to a time no earlier run used. */
function nextTick(): void {
  clock += 1;
  now = new Date(Date.UTC(2026, 10, 3, 12, 0, 0, clock));
}

/**
 * `migrate:create` over `config` with `options`, on the clock as it stands; the lines it logged
 * and the code it exited with, if any.
 */
async function migrateCreate(
  config: unknown,
  options: {
    name?: string;
    dryRun?: boolean;
    blank?: boolean;
    recordSnapshot?: boolean;
  }
): Promise<{ lines: string[]; exit: number | undefined }> {
  loaded.config = config;
  vi.setSystemTime(now);
  const lines: string[] = [];
  const exit = vi.spyOn(process, "exit").mockImplementation(code => {
    throw new Error(`exit ${String(code)}`);
  });
  const context = {
    logger: {
      ...createLogger({ quiet: true }),
      info: (message: string) => lines.push(message),
    },
    options: {},
    cwd: dir,
  } as CommandContext;
  // As `--non-interactive` does: no rename is asked about.
  setNonInteractive(true);
  try {
    await runMigrateCreate(options.name, { cwd: dir, ...options }, context);
    return { lines, exit: undefined };
  } catch (error) {
    const match = /^exit (\d+)$/.exec((error as Error).message);
    if (match) return { lines, exit: Number(match[1]) };
    throw error;
  } finally {
    setNonInteractive(false);
    exit.mockRestore();
  }
}

const project = (fields: ReturnType<typeof text>[]) =>
  defineConfig({
    collections: [defineCollection({ slug: "posts", fields })],
    db: { migrationsDir: "./migrations" },
  } as never);

/** The two files a generated migration is, named for `name` on the clock as it stands. */
function pairOf(name: string): DryRunChange[] {
  const base = `${formatTimestamp(now)}_${name}`;
  return [
    { action: "write", target: `migrations/${base}.sql` },
    { action: "write", target: `migrations/meta/${base}.snapshot.json` },
  ];
}

/** The project folder's files and their hashes, `unused.db` included should it appear. */
const folder = () => folderSnapshot(dir);

describe("migrate:create --dry-run", () => {
  it("names the migration and its snapshot, prints the migration, and writes nothing", async () => {
    nextTick();
    const before = folder();
    const config = project([text({ name: "title" })]);
    const dry = await migrateCreate(config, { name: "init", dryRun: true });

    expect(dry.exit).toBeUndefined();
    expect(folder()).toEqual(before);
    const changes = pairOf("init");
    expect(dry.lines.slice(-dryRunLines({ changes }).length)).toEqual(
      dryRunLines({ changes })
    );

    // The real run on the same clock writes exactly those files, and the migration holds the text
    // the dry run printed.
    const real = await migrateCreate(config, { name: "init" });
    expect(real.exit).toBeUndefined();
    expect(
      Object.keys(folder())
        .filter(path => !(path in before))
        .sort()
    ).toEqual(
      ["migrations", "migrations/meta", ...changes.map(c => c.target)].sort()
    );
    const written = readFileSync(join(dir, changes[0].target), "utf-8");
    expect(dry.lines.some(line => line.includes(written.trimEnd()))).toBe(true);
  });

  it("names a blank migration and writes nothing", async () => {
    nextTick();
    const before = folder();
    const config = project([text({ name: "title" })]);
    const dry = await migrateCreate(config, {
      name: "seed",
      blank: true,
      dryRun: true,
    });

    expect(dry.exit).toBeUndefined();
    expect(folder()).toEqual(before);
    const changes: DryRunChange[] = [
      {
        action: "write",
        target: `migrations/${formatTimestamp(now)}_seed.sql`,
      },
    ];
    expect(dry.lines.slice(-2)).toEqual(dryRunLines({ changes }));

    const real = await migrateCreate(config, { name: "seed", blank: true });
    expect(real.exit).toBeUndefined();
    const written = readFileSync(join(dir, changes[0].target), "utf-8");
    expect(dry.lines.some(line => line.includes(written.trimEnd()))).toBe(true);
  });

  it("keeps the message of a run with nothing to generate, and exits 0", async () => {
    nextTick();
    const config = project([text({ name: "title" })]);
    await migrateCreate(config, { name: "init" });
    nextTick();
    const before = folder();
    const dry = await migrateCreate(config, { name: "again", dryRun: true });
    expect(dry.exit).toBe(0);
    expect(dry.lines).toContain(
      "No changes detected. Your config matches the latest snapshot."
    );
    // And ends as every dry run ends.
    expect(dry.lines.slice(-2)).toEqual(dryRunLines({ changes: [] }));
    expect(folder()).toEqual(before);
  });

  it("ends a run with no schema at all as every dry run ends", async () => {
    const before = folder();
    const dry = await migrateCreate(
      defineConfig({ db: { migrationsDir: "./migrations" } } as never),
      { name: "init", dryRun: true }
    );
    expect(dry.lines.slice(-2)).toEqual(dryRunLines({ changes: [] }));
    expect(folder()).toEqual(before);
  });

  describe("with --record-snapshot", () => {
    /**
     * A project migrated once, whose latest snapshot is made to predate the record of which
     * fields are translated, as a snapshot written before that record existed does.
     */
    async function predatingProject(): Promise<void> {
      nextTick();
      await migrateCreate(project([text({ name: "title" })]), {
        name: "init",
      });
      const snapshot = join(
        dir,
        `migrations/meta/${formatTimestamp(now)}_init.snapshot.json`
      );
      const data = JSON.parse(readFileSync(snapshot, "utf-8")) as Record<
        string,
        unknown
      >;
      delete data.translatedFieldsRecorded;
      writeFileSync(snapshot, `${JSON.stringify(data, null, 2)}\n`);
    }

    it("names the record migration and its snapshot, and writes nothing", async () => {
      await predatingProject();
      nextTick();
      const before = folder();
      const config = project([text({ name: "title" })]);
      const dry = await migrateCreate(config, {
        recordSnapshot: true,
        dryRun: true,
      });

      expect(dry.exit).toBeUndefined();
      expect(folder()).toEqual(before);
      const changes = pairOf("record_translated_fields");
      expect(dry.lines.slice(-3)).toEqual(dryRunLines({ changes }));

      const real = await migrateCreate(config, { recordSnapshot: true });
      expect(real.exit).toBeUndefined();
      expect(
        Object.keys(folder())
          .filter(path => !(path in before))
          .sort()
      ).toEqual(changes.map(c => c.target).sort());
    });

    it("reports the refusal of a config with changes to migrate, and exits 0", async () => {
      await predatingProject();
      nextTick();
      const before = folder();
      const changed = project([
        text({ name: "title" }),
        text({ name: "summary" }),
      ]);
      const dry = await migrateCreate(changed, {
        recordSnapshot: true,
        dryRun: true,
      });

      expect(dry.exit).toBe(0);
      expect(folder()).toEqual(before);
      const last = dry.lines.slice(-2);
      expect(last[0]).toMatch(
        /^A real run would refuse: --record-snapshot records the config as it was at the last migration, and the config has changes to "dc_posts" to migrate\./
      );
      expect(last[1]).toBe("Dry run: nothing was changed.");

      // The real run refuses the same config.
      const real = await migrateCreate(changed, { recordSnapshot: true });
      expect(real.exit).toBe(1);
    });
  });

  it("with --plugin, names the module and the barrel and writes nothing", async () => {
    nextTick();
    // A plugin with nothing to import, so its entry bundles on its own.
    mkdirSync(join(dir, "src"));
    writeFileSync(
      join(dir, "src/index.ts"),
      'export default { name: "@test/dry", version: "1.0.0", nextly: "*", schemaVersion: 1 };\n'
    );
    const before = folder();
    const options = { name: "backfill", blank: true, plugin: "src/index.ts" };
    const dry = await migrateCreate(undefined, { ...options, dryRun: true });
    expect(dry.exit).toBeUndefined();
    expect(folder()).toEqual(before);

    // The real run on the same clock writes the files the dry run named, the module holding the
    // text it printed.
    const real = await migrateCreate(undefined, options);
    expect(real.exit).toBeUndefined();
    const added = Object.keys(folder()).filter(
      path => !(path in before) && path !== "src/migrations"
    );
    const module = added.find(path => path !== "src/migrations/index.ts")!;
    const changes: DryRunChange[] = [
      { action: "write", target: module },
      { action: "write", target: "src/migrations/index.ts" },
    ];
    expect(added.sort()).toEqual(changes.map(c => c.target).sort());
    expect(dry.lines.slice(-3)).toEqual(dryRunLines({ changes }));
    const written = readFileSync(join(dir, module), "utf-8");
    expect(dry.lines.some(line => line.includes(written.trimEnd()))).toBe(true);
  });

  it("leaves a real run as it was", async () => {
    nextTick();
    const run = await migrateCreate(project([text({ name: "title" })]), {
      name: "init",
    });
    expect(run.exit).toBeUndefined();
    expect(run.lines).not.toContain("Dry run: nothing was changed.");
    expect(Object.keys(folder())).toEqual(
      expect.arrayContaining(pairOf("init").map(c => c.target))
    );
  });
});
