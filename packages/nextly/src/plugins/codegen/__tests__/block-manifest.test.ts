import { describe, expect, it } from "vitest";

import {
  BLOCK_MANIFEST_FILENAME,
  buildBlockManifest,
  buildBlockManifestArtifact,
  PAGE_BUILDER_PLUGIN,
} from "../block-manifest";
import { definePlugin, type PluginDefinition } from "../../plugin-context";

/** A block definition as a plugin declares one. */
function block(name: string, extra: Record<string, unknown> = {}) {
  return {
    name,
    version: 1,
    description: `The ${name} block.`,
    example: { props: {} },
    render: () => null,
    ...extra,
  };
}

/** A plugin declaring blocks for the page builder. */
function declaring(name: string, blocks: unknown[]): PluginDefinition {
  return definePlugin({
    name,
    version: "1.0.0",
    nextly: ">=0.0.0",
    contributes: { declarations: { [PAGE_BUILDER_PLUGIN]: { blocks } } },
  });
}

describe("buildBlockManifest", () => {
  it("states each declared block and who declared it", () => {
    const manifest = buildBlockManifest([
      declaring("@acme/pricing", [block("acme/pricing-table")]),
    ]);

    expect(manifest.blocks).toEqual([
      {
        name: "acme/pricing-table",
        version: 1,
        description: "The acme/pricing-table block.",
        source: "@acme/pricing",
        example: { props: {} },
      },
    ]);
  });

  it("drops the render function", () => {
    // A function cannot be serialized, and the manifest describes what a block
    // accepts rather than how it draws.
    const manifest = buildBlockManifest([
      declaring("@acme/a", [block("acme/one")]),
    ]);

    expect(manifest.blocks[0]).not.toHaveProperty("render");
    expect(() => JSON.stringify(manifest)).not.toThrow();
  });

  it("carries props, supports and slots when the block declares them", () => {
    const manifest = buildBlockManifest([
      declaring("@acme/a", [
        block("acme/section", {
          props: { width: { type: "text" } },
          supports: { spacing: true },
          slots: { default: { allow: ["core/*"] } },
        }),
      ]),
    ]);

    expect(manifest.blocks[0]).toMatchObject({
      props: { width: { type: "text" } },
      supports: { spacing: true },
      slots: { default: { allow: ["core/*"] } },
    });
  });

  it("sorts blocks by name so the artifact is stable", () => {
    // Reordering plugins must not rewrite the file, or every unrelated config
    // edit shows a diff and a drift test cannot tell a change from a shuffle.
    const forward = buildBlockManifest([
      declaring("@acme/a", [block("acme/zebra")]),
      declaring("@acme/b", [block("acme/alpha")]),
    ]);
    const reversed = buildBlockManifest([
      declaring("@acme/b", [block("acme/alpha")]),
      declaring("@acme/a", [block("acme/zebra")]),
    ]);

    expect(forward.blocks.map(b => b.name)).toEqual([
      "acme/alpha",
      "acme/zebra",
    ]);
    expect(reversed).toEqual(forward);
  });

  it("ignores a declaration whose blocks are not an array", () => {
    const manifest = buildBlockManifest([
      declaring("@acme/bad", undefined as unknown as unknown[]),
    ]);

    expect(manifest.blocks).toEqual([]);
  });
});

describe("buildBlockManifestArtifact", () => {
  it("emits nothing when no plugin declared a block", () => {
    // An empty manifest and an absent one mean the same thing, and only one of
    // them leaves a stale file behind when the last block plugin is removed.
    expect(
      buildBlockManifestArtifact([], "/app/src/nextly-types.ts")
    ).toBeNull();
  });

  it("writes beside the generated types, as parseable JSON", () => {
    const artifact = buildBlockManifestArtifact(
      [declaring("@acme/a", [block("acme/one")])],
      "/app/src/nextly-types.ts"
    );

    expect(artifact?.path).toBe(`/app/src/${BLOCK_MANIFEST_FILENAME}`);
    expect(artifact?.code.endsWith("\n")).toBe(true);
    expect(JSON.parse(String(artifact?.code)).blocks).toHaveLength(1);
  });
});
