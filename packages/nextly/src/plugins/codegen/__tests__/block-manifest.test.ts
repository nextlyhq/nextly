import { describe, expect, it } from "vitest";

import {
  assertManifestPathIsFree,
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

/** The page builder itself, which must be present for anything to register. */
function consumer(enabled?: boolean): PluginDefinition {
  return definePlugin({
    name: PAGE_BUILDER_PLUGIN,
    version: "1.0.0",
    nextly: ">=0.0.0",
    enabled,
  });
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
      consumer(),
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
      consumer(),
      declaring("@acme/a", [block("acme/one")]),
    ]);

    expect(manifest.blocks[0]).not.toHaveProperty("render");
    expect(() => JSON.stringify(manifest)).not.toThrow();
  });

  it("carries props, supports and slots when the block declares them", () => {
    const manifest = buildBlockManifest([
      consumer(),
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

  it("carries the island declaration, so a reader can tell an interactive block", () => {
    // This artifact is what an editor build, the docs and an agent read to tell
    // an interactive block from an inert one WITHOUT importing it. Dropped, all
    // three believe no block on the page needs JavaScript — which is the one
    // thing the field exists to say.
    const manifest = buildBlockManifest([
      consumer(),
      declaring("@acme/a", [
        block("acme/ticker", {
          island: { reason: "counts down to a date the server cannot know." },
        }),
      ]),
    ]);

    expect(manifest.blocks[0]).toMatchObject({
      island: { reason: "counts down to a date the server cannot know." },
    });
  });

  it("omits it entirely for a block that needs no JavaScript", () => {
    // The control the assertion above needs: an emitter that stamped a field on
    // every block would satisfy it while saying nothing about any of them.
    const manifest = buildBlockManifest([
      consumer(),
      declaring("@acme/a", [block("acme/still")]),
    ]);

    expect(manifest.blocks[0]).not.toHaveProperty("island");
  });

  it("refuses an unknown key inside island, as the JSON Schema does", () => {
    // Zod strips an unknown key by default while `blockManifestJsonSchema()`
    // declares `additionalProperties: false` and refuses it. Left loose, the
    // two published validators answer differently about one manifest — and the
    // object one accepts is not the object the other describes.
    expect(() =>
      buildBlockManifest([
        consumer(),
        declaring("@acme/a", [
          block("acme/x", { island: { reason: "r", extra: true } }),
        ]),
      ])
    ).toThrow();
  });

  it("refuses a blank reason here, as registration does at boot", () => {
    // The two gates answering differently is how a manifest generates cleanly
    // for a block the engine then refuses to register — generation succeeding
    // for a configuration that cannot run.
    for (const island of [{ reason: "" }, { reason: "   " }, {}]) {
      expect(() =>
        buildBlockManifest([
          consumer(),
          declaring("@acme/a", [block("acme/bad", { island })]),
        ])
      ).toThrow();
    }
  });

  it("sorts blocks by name so the artifact is stable", () => {
    // Reordering plugins must not rewrite the file, or every unrelated config
    // edit shows a diff and a drift test cannot tell a change from a shuffle.
    const forward = buildBlockManifest([
      consumer(),
      declaring("@acme/a", [block("acme/zebra")]),
      declaring("@acme/b", [block("acme/alpha")]),
    ]);
    const reversed = buildBlockManifest([
      consumer(),
      declaring("@acme/b", [block("acme/alpha")]),
      declaring("@acme/a", [block("acme/zebra")]),
    ]);

    expect(forward.blocks.map(b => b.name)).toEqual([
      "acme/alpha",
      "acme/zebra",
    ]);
    expect(reversed).toEqual(forward);
  });

  it("lists nothing when the page builder is disabled", () => {
    // A disabled plugin runs no init and contributes no services, so the
    // registry these declarations would fill never exists. Listing them would
    // tell tooling the app has blocks it cannot render.
    const manifest = buildBlockManifest([
      consumer(false),
      declaring("@acme/a", [block("acme/one")]),
    ]);

    expect(manifest.blocks).toEqual([]);
  });

  it("lists nothing when the page builder is not installed", () => {
    const manifest = buildBlockManifest([
      declaring("@acme/a", [block("acme/one")]),
    ]);

    expect(manifest.blocks).toEqual([]);
  });

  it("ignores a declaration carrying no blocks key", () => {
    // Another version of the page builder may read keys this one does not, so
    // an unread declaration is not a defect.
    const manifest = buildBlockManifest([
      consumer(),
      declaring("@acme/other", undefined as unknown as unknown[]),
    ]);

    expect(manifest.blocks).toEqual([]);
  });

  it("refuses a blocks value that is present but not an array", () => {
    // The runtime refuses the same input, so reading it as "no blocks" here
    // would emit -- or delete -- a manifest describing a config that cannot
    // boot, and the first sign of trouble would be a failing start.
    let thrown: unknown;
    try {
      buildBlockManifest([
        consumer(),
        declaring("@acme/bad", { nope: true } as unknown as unknown[]),
      ]);
    } catch (error) {
      thrown = error;
    }

    // Asserted on the structured issue rather than the message: the public
    // message is deliberately generic, and the plugin to go and fix is named
    // in the issue.
    const issues = (
      thrown as { publicData?: { errors?: { message: string }[] } }
    )?.publicData?.errors;
    expect(issues?.[0]?.message, String(thrown)).toContain("@acme/bad");
  });
});

describe("buildBlockManifest rejects what boot would reject", () => {
  /** The message of the first issue on a thrown validation error. */
  function issueOf(run: () => unknown): string {
    try {
      run();
    } catch (error) {
      const issues = (
        error as { publicData?: { errors?: { message: string }[] } }
      )?.publicData?.errors;
      return issues?.[0]?.message ?? String(error);
    }
    return "";
  }

  it("refuses a non-object entry inside a valid array", () => {
    // Filtering it would drop a block the author meant to ship and leave the
    // manifest quietly short, while the engine rejects the same element at
    // registration.
    const message = issueOf(() =>
      buildBlockManifest([consumer(), declaring("@acme/a", ["not-a-block"])])
    );

    expect(message).toContain("@acme/a");
    expect(message).toContain("index 0");
  });

  it("refuses a version whose migration chain has a hole", () => {
    // A version above 1 says stored nodes exist at older versions. Without the
    // step between, registration refuses the block and those nodes could never
    // be upgraded, so a manifest describing it would describe an app that does
    // not start.
    const message = issueOf(() =>
      buildBlockManifest([
        consumer(),
        declaring("@acme/a", [{ ...block("acme/one"), version: 2 }]),
      ])
    );

    expect(message).toContain("acme/one");
    expect(message).toContain("no migration from version 1");
  });

  it("refuses a block with no name", () => {
    const message = issueOf(() =>
      buildBlockManifest([consumer(), declaring("@acme/a", [{ version: 1 }])])
    );

    expect(message).toContain("no name");
  });

  it("refuses a block with no description", () => {
    // Required by the block API and by the manifest's own contract: it is what
    // the palette, the docs and an agent read.
    const message = issueOf(() =>
      buildBlockManifest([
        consumer(),
        declaring("@acme/a", [{ name: "acme/x", version: 1 }]),
      ])
    );

    expect(message).toContain("no description");
  });

  it("refuses a block with no example", () => {
    // The block API requires a worked instance, so a declaration without one
    // describes a block that could not have been built with defineBlock. It is
    // also what a preview renders and what a generator few-shots from.
    const message = issueOf(() =>
      buildBlockManifest([
        consumer(),
        declaring("@acme/a", [
          { name: "acme/x", version: 1, description: "No example." },
        ]),
      ])
    );

    expect(message).toContain("no example");
  });

  it("refuses the same block name from two plugins, naming both", () => {
    // The engine throws NEXTLY_BLOCK_COLLISION for the second registration, so
    // emitting both would hand tooling an ambiguous manifest for a config that
    // cannot boot.
    const message = issueOf(() =>
      buildBlockManifest([
        consumer(),
        declaring("@acme/a", [block("acme/dup")]),
        declaring("@acme/b", [block("acme/dup")]),
      ])
    );

    expect(message).toContain("@acme/a");
    expect(message).toContain("@acme/b");
  });
});

describe("assertManifestPathIsFree", () => {
  it("refuses a types output named like the manifest", () => {
    // Same directory, same filename: with blocks the types overwrite the
    // manifest, and with none the cleanup deletes the types output.
    expect(() =>
      assertManifestPathIsFree(`/app/src/${BLOCK_MANIFEST_FILENAME}`)
    ).toThrow();
  });

  it("refuses one that differs only in case", () => {
    // The default filesystem on macOS and Windows is case-insensitive, so this
    // IS the manifest there — and the cleanup branch would delete it. Matching
    // case-sensitively would have guarded Linux alone while the delete landed
    // on the two platforms most users are on.
    expect(() =>
      assertManifestPathIsFree(
        `/app/src/${BLOCK_MANIFEST_FILENAME.toUpperCase()}`
      )
    ).toThrow();
  });

  it("accepts an ordinary types output", () => {
    expect(() =>
      assertManifestPathIsFree("/app/src/nextly-types.ts")
    ).not.toThrow();
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
      [consumer(), declaring("@acme/a", [block("acme/one")])],
      "/app/src/nextly-types.ts"
    );

    expect(artifact?.path).toBe(`/app/src/${BLOCK_MANIFEST_FILENAME}`);
    expect(artifact?.code.endsWith("\n")).toBe(true);
    expect(JSON.parse(String(artifact?.code)).blocks).toHaveLength(1);
  });
});
