/**
 * `nextly generate:types --dry-run`: every file the real run would write or
 * remove, printed as every dry run prints it, with the folder left as it was.
 *
 * Driven through `runGenerateTypes` itself, with only the config loader
 * replaced. The same project is then generated for real, and the files that
 * run adds are the files the dry run named, so a file the dry run leaves out
 * (or names but the real run never writes) fails here.
 */
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { PAGE_BUILDER_PLUGIN } from "../../../plugins/codegen/block-manifest";
import {
  COMPONENT_IMPORT_MAP_FILENAME,
  COMPONENT_PATHS_FILENAME,
} from "../../../plugins/codegen/component-import-map";
import { definePlugin } from "../../../plugins/plugin-context";
import { folderSnapshot } from "../../__tests__/helpers/folder-snapshot";
import { dryRunLines } from "../../dry-run";

const loadConfig = vi.hoisted(() => vi.fn());
vi.mock("../../utils/config-loader", () => ({ loadConfig }));

const { runGenerateTypes } = await import("../generate-types");
const { createContext } = await import("../../program");

const dirs: string[] = [];

afterEach(async () => {
  loadConfig.mockReset();
  await Promise.all(
    dirs.splice(0).map(dir => rm(dir, { recursive: true, force: true }))
  );
});

const blockPlugins = [
  definePlugin({ name: PAGE_BUILDER_PLUGIN, version: "1.0.0", nextly: "*" }),
  definePlugin({
    name: "@acme/blocks",
    version: "1.0.0",
    nextly: "*",
    contributes: {
      declarations: {
        [PAGE_BUILDER_PLUGIN]: {
          blocks: [
            {
              name: "acme/hero",
              version: 1,
              description: "The hero block.",
              example: { props: {} },
              render: () => null,
            },
          ],
        },
      },
    },
  }),
];

/**
 * A project under src/ with one collection and a block-declaring plugin, so a
 * run writes the types, a Zod schema and index, the block manifest and the
 * component map.
 */
async function project(plugins: unknown[] = blockPlugins): Promise<string> {
  const cwd = await mkdtemp(join(tmpdir(), "nextly-types-dry-run-"));
  dirs.push(cwd);
  await mkdir(join(cwd, "src/app"), { recursive: true });
  config(plugins);
  return cwd;
}

/** Makes the loaded config the project's, with `plugins` as its plugins. */
function config(plugins: unknown[]): void {
  loadConfig.mockResolvedValue({
    configPath: "nextly.config.ts",
    config: {
      collections: [
        { slug: "posts", fields: [{ name: "title", type: "text" }] },
      ],
      singles: [],
      fieldGroups: [],
      users: { fields: [] },
      plugins,
      typescript: { outputFile: "src/types/nextly-types.ts" },
      db: { schemasDir: "src/db/schemas" },
    },
  });
}

/** Runs the command in `cwd` and answers what it printed through `info`. */
async function run(
  cwd: string,
  options: { dryRun?: boolean; zod?: boolean } = {}
): Promise<string[]> {
  const context = createContext({ cwd });
  const info = vi.spyOn(context.logger, "info").mockImplementation(() => {});
  for (const quiet of [
    "success",
    "header",
    "keyValue",
    "newline",
    "divider",
    "warn",
  ] as const) {
    vi.spyOn(context.logger, quiet).mockImplementation(() => {});
  }
  await runGenerateTypes({ cwd, ...options }, context);
  return info.mock.calls.map(call => String(call[0]));
}

/** The lines from the first "Would" line on: the dry run's report. */
const report = (printed: string[]) =>
  printed.slice(printed.findIndex(line => line.startsWith("Would ")));

/**
 * In the order a real run writes them: the manifest, the component map and its
 * path list, the Zod files, then the types.
 */
const WRITES = [
  "src/types/blocks.manifest.json",
  `src/types/${COMPONENT_IMPORT_MAP_FILENAME}`,
  `src/types/${COMPONENT_PATHS_FILENAME}`,
  "src/db/schemas/zod/posts.zod.ts",
  "src/db/schemas/zod/index.ts",
  "src/types/nextly-types.ts",
];

describe("generate:types --dry-run", () => {
  it("names every file it would write, and writes nothing", async () => {
    const cwd = await project();
    const before = folderSnapshot(cwd);

    const printed = await run(cwd, { dryRun: true });

    expect(report(printed)).toEqual(
      dryRunLines({
        changes: WRITES.map(target => ({ action: "write", target })),
      })
    );
    expect(folderSnapshot(cwd)).toEqual(before);
  });

  it("names the files the real run then writes", async () => {
    const cwd = await project();
    const before = folderSnapshot(cwd);

    await run(cwd, { dryRun: true });
    await run(cwd);

    const added = Object.entries(folderSnapshot(cwd))
      .filter(([path, hash]) => hash !== "dir" && before[path] === undefined)
      .map(([path]) => path)
      .sort();
    expect(added).toEqual([...WRITES].sort());
  });

  it("leaves the Zod files out under --no-zod", async () => {
    const cwd = await project();

    const printed = await run(cwd, { dryRun: true, zod: false });

    expect(report(printed)).toEqual(
      dryRunLines({
        // Every planned file but the Zod ones, in the same order.
        changes: WRITES.filter(target => !target.includes("/zod/")).map(
          target => ({ action: "write", target })
        ),
      })
    );
  });

  it("names a manifest it would remove once no plugin declares blocks", async () => {
    const cwd = await project();
    await run(cwd);
    config([]);
    const before = folderSnapshot(cwd);

    const printed = await run(cwd, { dryRun: true });

    expect(report(printed)[0]).toBe(
      "Would remove src/types/blocks.manifest.json"
    );
    expect(folderSnapshot(cwd)).toEqual(before);

    // No file the real run then changes goes unnamed. The types and Zod files
    // are written on every run, so they are named even when their content is
    // the same; the component map is written only where it differs, so its
    // files are named exactly when the real run changes them.
    const named = report(printed)
      .filter(line => line.startsWith("Would write "))
      .map(line => line.slice("Would write ".length))
      .sort();
    await run(cwd);
    const after = folderSnapshot(cwd);
    const changed = Object.keys(after)
      .filter(path => after[path] !== "dir" && after[path] !== before[path])
      .sort();
    expect(changed.filter(path => !named.includes(path))).toEqual([]);
    const isMap = (path: string) =>
      path.endsWith(COMPONENT_IMPORT_MAP_FILENAME) ||
      path.endsWith(COMPONENT_PATHS_FILENAME);
    expect(named.filter(isMap)).toEqual(changed.filter(isMap));
  });

  it("names a workflow the real run would refuse, and exits 0", async () => {
    const cwd = await project();
    loadConfig.mockResolvedValue({
      configPath: "nextly.config.ts",
      config: {
        collections: [
          {
            slug: "posts",
            fields: [{ name: "title", type: "text" }],
            // Not from defineWorkflow, which the attachment check refuses.
            workflow: { kind: "something-else" },
          },
        ],
        singles: [],
        fieldGroups: [],
        users: { fields: [] },
        plugins: [],
        typescript: { outputFile: "src/types/nextly-types.ts" },
        db: { schemasDir: "src/db/schemas" },
      },
    });
    const exit = vi.spyOn(process, "exit").mockImplementation(code => {
      throw new Error(`exit ${String(code)}`);
    });
    const before = folderSnapshot(cwd);

    const printed = await run(cwd, { dryRun: true });

    expect(exit).not.toHaveBeenCalled();
    expect(
      printed.some(line => line.startsWith("A real run would refuse: "))
    ).toBe(true);
    expect(printed.at(-1)).toBe("Dry run: nothing was changed.");
    expect(folderSnapshot(cwd)).toEqual(before);
    exit.mockRestore();
  });
});
