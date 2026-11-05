/**
 * `nextly build --dry-run` plans the files a real build writes, the Zod
 * schemas, their index and the types file, and writes none of them. Where the
 * real build would fail, the dry run names the failure and still exits 0.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { NextlyError } from "../../../errors/nextly-error";
import { folderSnapshot } from "../../__tests__/helpers/folder-snapshot";
import type { CommandContext } from "../../program";
import type { LoadConfigResult } from "../../utils/config-loader";
import type { Logger } from "../../utils/logger";
import { runBuild } from "../build";

const loadConfig = vi.hoisted(() => vi.fn());
vi.mock("../../utils/config-loader", () => ({ loadConfig }));

/** Records every line the build prints, the ending error included. */
function captureLogger(): { logger: Logger; lines: string[] } {
  const lines: string[] = [];
  const record = (message: string): void => {
    lines.push(message);
  };
  vi.spyOn(console, "error").mockImplementation((message: unknown) => {
    lines.push(String(message));
  });
  const logger: Logger = {
    debug: () => undefined,
    info: record,
    warn: record,
    error: record,
    success: record,
    newline: () => undefined,
    divider: () => undefined,
    header: record,
    item: record,
    keyValue: () => undefined,
    table: () => undefined,
    spinner: () => ({ stop: () => undefined }),
    setOptions: () => undefined,
    getOptions: () => ({}),
  };
  return { logger, lines };
}

const dirs: string[] = [];
afterEach(() => {
  vi.restoreAllMocks();
  loadConfig.mockReset();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true });
});

/** A project folder whose config `loadConfig` answers with `collections`. */
function project(collections: unknown[]): string {
  const dir = mkdtempSync(join(tmpdir(), "nextly-build-dry-run-"));
  dirs.push(dir);
  loadConfig.mockResolvedValue({
    config: {
      collections,
      singles: [],
      fieldGroups: [],
      plugins: [],
      typescript: { outputFile: "./src/types/nextly-types.ts" },
      // What the config loader fills in when a project names no folder.
      db: { schemasDir: "./src/db/schemas" },
    },
    configPath: join(dir, "nextly.config.ts"),
    dependencies: [],
  } as unknown as LoadConfigResult);
  return dir;
}

const posts = { slug: "posts", fields: [{ name: "title", type: "text" }] };

/** The process exit, thrown so the test keeps running past it. */
function stubExit() {
  return vi.spyOn(process, "exit").mockImplementation(code => {
    throw NextlyError.internal({ logContext: { exitCode: code } });
  });
}

describe("nextly build --dry-run", () => {
  it("names every file the build writes and writes none of them", async () => {
    const dir = project([posts]);
    const before = folderSnapshot(dir);
    const { logger, lines } = captureLogger();
    const exit = stubExit();
    const context: CommandContext = { logger, options: {}, cwd: dir };

    await runBuild(
      { cwd: dir, skipMigrationsCheck: true, dryRun: true },
      context
    );

    expect(folderSnapshot(dir)).toEqual(before);
    expect(exit).not.toHaveBeenCalled();
    expect(lines).toContain("Would write src/types/nextly-types.ts");
    expect(lines.some(line => /^Would write .*zod.*posts/.test(line))).toBe(
      true
    );
    expect(lines.some(line => /^Would write .*zod.*index/.test(line))).toBe(
      true
    );
    expect(lines.at(-1)).toBe("Dry run: nothing was changed.");
    expect(lines.some(line => line.startsWith("Generated"))).toBe(false);
  });

  it("is the same build as a real one, which does write those files", async () => {
    const dir = project([posts]);
    const { logger } = captureLogger();
    stubExit();
    const context: CommandContext = { logger, options: {}, cwd: dir };

    await runBuild({ cwd: dir, skipMigrationsCheck: true }, context);

    const written = Object.keys(folderSnapshot(dir));
    expect(written).toContain("src/types/nextly-types.ts");
    expect(written.some(path => /zod.*posts/.test(path))).toBe(true);
  });

  it("leaves out what --no-types and --no-zod leave out", async () => {
    const dir = project([posts]);
    const { logger, lines } = captureLogger();
    stubExit();
    const context: CommandContext = { logger, options: {}, cwd: dir };

    await runBuild(
      { cwd: dir, skipMigrationsCheck: true, dryRun: true, zod: false },
      context
    );

    expect(lines).toContain("Would write src/types/nextly-types.ts");
    expect(lines.some(line => /zod/.test(line))).toBe(false);

    // And the other way round: no types file, the Zod files still named.
    lines.length = 0;
    await runBuild(
      { cwd: dir, skipMigrationsCheck: true, dryRun: true, types: false },
      context
    );
    expect(lines.some(line => line.includes("nextly-types.ts"))).toBe(false);
    expect(lines.some(line => /^Would write .*zod.*posts/.test(line))).toBe(
      true
    );
  });

  it("ends a project with no schema as every dry run ends", async () => {
    const dir = project([]);
    const { logger, lines } = captureLogger();
    const exit = stubExit();
    const context: CommandContext = { logger, options: {}, cwd: dir };

    await runBuild(
      { cwd: dir, skipMigrationsCheck: true, dryRun: true },
      context
    );

    expect(exit).not.toHaveBeenCalled();
    expect(lines.slice(-2)).toEqual([
      "Nothing would change.",
      "Dry run: nothing was changed.",
    ]);
  });

  it.each([
    {
      name: "a field type no plugin offers",
      collection: {
        slug: "posts",
        fields: [{ name: "body", type: "no-such-type" }],
      },
    },
    {
      name: "a workflow that did not come from defineWorkflow",
      collection: {
        ...posts,
        workflow: { kind: "something-else" },
      },
    },
  ])(
    "names the refusal of $name before planning, and exits 0",
    async ({ collection }) => {
      const dir = project([collection]);
      const before = folderSnapshot(dir);
      const { logger, lines } = captureLogger();
      const exit = stubExit();
      const context: CommandContext = { logger, options: {}, cwd: dir };

      await runBuild(
        { cwd: dir, skipMigrationsCheck: true, dryRun: true },
        context
      );

      expect(exit).not.toHaveBeenCalled();
      expect(
        lines.some(line => line.startsWith("A real run would refuse: "))
      ).toBe(true);
      expect(lines.at(-1)).toBe("Dry run: nothing was changed.");
      expect(folderSnapshot(dir)).toEqual(before);
    }
  );

  it("names the failure a real build would end with, and exits 0", async () => {
    // Two collections with one slug: the build's own validation refuses it.
    const dir = project([posts, posts]);
    const before = folderSnapshot(dir);
    const { logger, lines } = captureLogger();
    const exit = stubExit();
    const context: CommandContext = { logger, options: {}, cwd: dir };

    await runBuild(
      { cwd: dir, skipMigrationsCheck: true, dryRun: true },
      context
    );

    expect(exit).not.toHaveBeenCalled();
    expect(folderSnapshot(dir)).toEqual(before);
    expect(
      lines.some(line => line.startsWith("A real run would refuse: "))
    ).toBe(true);
    expect(lines.at(-1)).toBe("Dry run: nothing was changed.");
  });
});
