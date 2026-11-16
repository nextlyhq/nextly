/**
 * `nextly generate:manifest --dry-run`: the write or the removal the real run
 * would make to the block manifest, printed as every dry run prints it, with
 * the folder left as it was.
 *
 * Driven through `runGenerateManifest` itself, with only the config loader
 * replaced, so the path and the decision are the command's own. Each case also
 * runs without the flag on the same folder, which shows the fixture reaches
 * the write or the removal the dry run reports.
 */
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { PAGE_BUILDER_PLUGIN } from "../../../plugins/codegen/block-manifest";
import {
  definePlugin,
  type PluginDefinition,
} from "../../../plugins/plugin-context";
import { folderSnapshot } from "../../__tests__/helpers/folder-snapshot";
import { dryRunLines } from "../../dry-run";

const loadConfig = vi.hoisted(() => vi.fn());
vi.mock("../../utils/config-loader", () => ({ loadConfig }));

const { runGenerateManifest } = await import("../generate-manifest");
const { createContext } = await import("../../program");

const TYPES_OUTPUT = "src/generated/nextly-types.ts";
const MANIFEST_REL = "src/generated/blocks.manifest.json";

const dirs: string[] = [];

afterEach(async () => {
  loadConfig.mockReset();
  await Promise.all(
    dirs.splice(0).map(dir => rm(dir, { recursive: true, force: true }))
  );
});

const consumer = (): PluginDefinition =>
  definePlugin({
    name: PAGE_BUILDER_PLUGIN,
    version: "1.0.0",
    nextly: ">=0.0.0",
  });

const declaring = (): PluginDefinition =>
  definePlugin({
    name: "@acme/blocks",
    version: "1.0.0",
    nextly: ">=0.0.0",
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
  });

/** A project whose config declares `plugins`, its types under src/generated. */
async function project(plugins: PluginDefinition[]): Promise<string> {
  const cwd = await mkdtemp(join(tmpdir(), "nextly-manifest-dry-run-"));
  dirs.push(cwd);
  loadConfig.mockResolvedValue({
    configPath: "nextly.config.ts",
    config: { plugins, typescript: { outputFile: TYPES_OUTPUT } },
  });
  return cwd;
}

/** Runs the command in `cwd` and answers what it printed through `info`. */
async function run(cwd: string, dryRun?: boolean): Promise<string[]> {
  const context = createContext({ cwd });
  const info = vi.spyOn(context.logger, "info").mockImplementation(() => {});
  vi.spyOn(context.logger, "success").mockImplementation(() => {});
  vi.spyOn(context.logger, "header").mockImplementation(() => {});
  await runGenerateManifest({ cwd, dryRun }, context);
  return info.mock.calls.map(call => String(call[0]));
}

describe("generate:manifest --dry-run", () => {
  it("names the manifest it would write, and writes nothing", async () => {
    const cwd = await project([consumer(), declaring()]);
    const before = folderSnapshot(cwd);

    const printed = await run(cwd, true);

    expect(printed).toEqual(
      dryRunLines({ changes: [{ action: "write", target: MANIFEST_REL }] })
    );
    expect(folderSnapshot(cwd)).toEqual(before);

    await run(cwd);
    await expect(readFile(join(cwd, MANIFEST_REL), "utf-8")).resolves.toMatch(
      /acme\/hero/
    );
  });

  it("names a stale manifest it would remove, and leaves it", async () => {
    const cwd = await project([consumer()]);
    await mkdir(join(cwd, "src/generated"), { recursive: true });
    await writeFile(join(cwd, MANIFEST_REL), "{}\n", "utf-8");
    const before = folderSnapshot(cwd);

    const printed = await run(cwd, true);

    expect(printed).toEqual(
      dryRunLines({ changes: [{ action: "remove", target: MANIFEST_REL }] })
    );
    expect(folderSnapshot(cwd)).toEqual(before);

    await run(cwd);
    expect(folderSnapshot(cwd)[MANIFEST_REL]).toBeUndefined();
  });

  it("says nothing would change when the manifest is current", async () => {
    const cwd = await project([consumer(), declaring()]);
    await run(cwd);
    const before = folderSnapshot(cwd);

    const printed = await run(cwd, true);

    expect(printed).toEqual(dryRunLines({ changes: [] }));
    expect(folderSnapshot(cwd)).toEqual(before);
  });
});
