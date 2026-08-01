/**
 * Settling the block manifest on disk, and reporting when it is stale.
 *
 * The pair under test is what both `generate:types` and `generate:manifest`
 * call, so these cases are the whole of the contract for where the file lives,
 * when it is written, and when it is removed.
 *
 * `--check` exists because a committed manifest that no longer matches the
 * config breaks nothing at runtime — the app reads its registry, not the file —
 * so the only thing that can notice is a build step that compares them.
 */
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { PAGE_BUILDER_PLUGIN } from "../../../plugins/codegen/block-manifest";
import {
  definePlugin,
  type PluginDefinition,
} from "../../../plugins/plugin-context";
import {
  applyBlockManifestState,
  describeManifestDrift,
  readBlockManifestState,
} from "../generate-manifest";

const TYPES_OUTPUT = "src/generated/nextly-types.ts";
const MANIFEST_REL = "src/generated/blocks.manifest.json";

const dirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    dirs.splice(0).map(dir => rm(dir, { recursive: true, force: true }))
  );
});

async function workspace(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "nextly-manifest-"));
  dirs.push(dir);
  return dir;
}

function consumer(): PluginDefinition {
  return definePlugin({
    name: PAGE_BUILDER_PLUGIN,
    version: "1.0.0",
    nextly: ">=0.0.0",
  });
}

function declaring(blocks: unknown[]): PluginDefinition {
  return definePlugin({
    name: "@acme/blocks",
    version: "1.0.0",
    nextly: ">=0.0.0",
    contributes: { declarations: { [PAGE_BUILDER_PLUGIN]: { blocks } } },
  });
}

function block(name: string) {
  return {
    name,
    version: 1,
    description: `The ${name} block.`,
    example: { props: {} },
    render: () => null,
  };
}

const WITH_BLOCKS = [consumer(), declaring([block("acme/hero")])];

describe("settling the manifest on disk", () => {
  it("writes it beside the generated types", async () => {
    const cwd = await workspace();

    const state = await readBlockManifestState(WITH_BLOCKS, TYPES_OUTPUT, cwd);
    expect(await applyBlockManifestState(state)).toBe(true);

    const written = JSON.parse(
      await readFile(join(cwd, MANIFEST_REL), "utf-8")
    );
    expect(written.blocks.map((b: { name: string }) => b.name)).toEqual([
      "acme/hero",
    ]);
  });

  it("reports no change on a second run", async () => {
    // Not cosmetic: a generator that rewrites an identical file touches its
    // mtime on every run, which is enough to invalidate a build cache.
    const cwd = await workspace();
    await applyBlockManifestState(
      await readBlockManifestState(WITH_BLOCKS, TYPES_OUTPUT, cwd)
    );

    const second = await readBlockManifestState(WITH_BLOCKS, TYPES_OUTPUT, cwd);
    expect(await applyBlockManifestState(second)).toBe(false);
  });

  it("removes a manifest left behind when the last block plugin goes", async () => {
    // The state that matters most: the file still reads as current, and
    // advertises blocks nothing can render.
    const cwd = await workspace();
    await applyBlockManifestState(
      await readBlockManifestState(WITH_BLOCKS, TYPES_OUTPUT, cwd)
    );

    const after = await readBlockManifestState([consumer()], TYPES_OUTPUT, cwd);
    expect(await applyBlockManifestState(after)).toBe(true);
    await expect(readFile(join(cwd, MANIFEST_REL), "utf-8")).rejects.toThrow();
  });

  it("does nothing when there is neither a manifest nor a file", async () => {
    const cwd = await workspace();

    const state = await readBlockManifestState([consumer()], TYPES_OUTPUT, cwd);
    expect(state.expected).toBeNull();
    expect(state.actual).toBeNull();
    expect(await applyBlockManifestState(state)).toBe(false);
  });

  it("refuses a types output that would collide with the manifest", async () => {
    // The cleanup branch deletes by name, so this is the difference between
    // removing a stale artifact and deleting the file the user asked for.
    const cwd = await workspace();

    await expect(
      readBlockManifestState(WITH_BLOCKS, "src/blocks.manifest.json", cwd)
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("surfaces a manifest path that exists but cannot be read", async () => {
    // Reading unreadable as absent is what makes it dangerous: with no blocks
    // expected, "nothing there" compares equal to "there should be nothing",
    // so the removal is skipped and a check reports the tree clean.
    const cwd = await workspace();
    await mkdir(join(cwd, MANIFEST_REL), { recursive: true });

    await expect(
      readBlockManifestState([consumer()], TYPES_OUTPUT, cwd)
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
  });
});

describe("reporting drift", () => {
  it("names a manifest that is missing", async () => {
    const cwd = await workspace();

    const state = await readBlockManifestState(WITH_BLOCKS, TYPES_OUTPUT, cwd);
    expect(describeManifestDrift(state)).toMatch(/is missing/);
  });

  it("names a manifest that should not exist at all", async () => {
    const cwd = await workspace();
    await mkdir(join(cwd, "src/generated"), { recursive: true });
    await writeFile(join(cwd, MANIFEST_REL), "{}\n", "utf-8");

    const state = await readBlockManifestState([consumer()], TYPES_OUTPUT, cwd);
    expect(describeManifestDrift(state)).toMatch(/declares no blocks/);
  });

  it("names a manifest whose contents have drifted", async () => {
    const cwd = await workspace();
    await applyBlockManifestState(
      await readBlockManifestState(WITH_BLOCKS, TYPES_OUTPUT, cwd)
    );

    const state = await readBlockManifestState(
      [consumer(), declaring([block("acme/pricing")])],
      TYPES_OUTPUT,
      cwd
    );
    expect(state.expected).not.toBeNull();
    expect(state.actual).not.toBeNull();
    expect(describeManifestDrift(state)).toMatch(/does not match this config/);
  });
});
