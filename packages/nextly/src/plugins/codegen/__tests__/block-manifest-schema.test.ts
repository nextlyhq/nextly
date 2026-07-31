/**
 * The manifest's published contract, and the emitter's obligation to it.
 *
 * The file is read by things that never import Nextly, so the shape it promises
 * has to exist as data rather than only as a TypeScript interface. These cases
 * hold the two halves together: the emitter's output satisfies the schema, and
 * the JSON Schema handed to outside readers describes that same shape.
 */
import { describe, expect, it } from "vitest";

import { definePlugin, type PluginDefinition } from "../../plugin-context";
import {
  BLOCK_MANIFEST_VERSION,
  blockManifestJsonSchema,
  blockManifestSchema,
  buildBlockManifest,
  PAGE_BUILDER_PLUGIN,
} from "../block-manifest";

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

function consumer(): PluginDefinition {
  return definePlugin({
    name: PAGE_BUILDER_PLUGIN,
    version: "1.0.0",
    nextly: ">=0.0.0",
  });
}

function declaring(name: string, blocks: unknown[]): PluginDefinition {
  return definePlugin({
    name,
    version: "1.0.0",
    nextly: ">=0.0.0",
    contributes: { declarations: { [PAGE_BUILDER_PLUGIN]: { blocks } } },
  });
}

describe("the manifest schema", () => {
  it("accepts what the emitter produces, with every optional part present", () => {
    const manifest = buildBlockManifest([
      consumer(),
      declaring("@acme/pricing", [
        block("acme/pricing-table", {
          props: { tiers: { type: "array" } },
          supports: { spacing: true },
          slots: { footer: {} },
        }),
      ]),
    ]);

    expect(blockManifestSchema.safeParse(manifest).success).toBe(true);
  });

  it("accepts a manifest with no blocks", () => {
    // The shape an app with the page builder but no block plugins produces.
    expect(
      blockManifestSchema.safeParse({
        manifestVersion: BLOCK_MANIFEST_VERSION,
        blocks: [],
      }).success
    ).toBe(true);
  });

  it("refuses an entry carrying a key the contract does not mention", () => {
    // Strictness is what makes the published schema a promise rather than a
    // description: a key added to the emitter and not to the schema fails here
    // instead of appearing in a file whose own schema rejects it.
    const result = blockManifestSchema.safeParse({
      manifestVersion: BLOCK_MANIFEST_VERSION,
      blocks: [
        {
          name: "acme/hero",
          version: 1,
          description: "A hero.",
          source: "@acme/hero",
          renderer: "./hero.js",
        },
      ],
    });

    expect(result.success).toBe(false);
  });

  it.each([
    ["a nameless block", { name: "", version: 1, description: "d" }],
    ["a block with no description", { name: "n", version: 1, description: "" }],
    ["a non-numeric version", { name: "n", version: "1", description: "d" }],
  ])("refuses %s", (_label, partial) => {
    const result = blockManifestSchema.safeParse({
      manifestVersion: BLOCK_MANIFEST_VERSION,
      blocks: [{ ...partial, source: "@acme/x" }],
    });

    expect(result.success).toBe(false);
  });

  it("refuses a document whose manifestVersion is missing or not a version", () => {
    expect(blockManifestSchema.safeParse({ blocks: [] }).success).toBe(false);
    expect(
      blockManifestSchema.safeParse({ manifestVersion: 0, blocks: [] }).success
    ).toBe(false);
  });
});

describe("the emitter's obligation to the schema", () => {
  /**
   * The first structured issue of a thrown validation error. Asserted on
   * instead of the message, which is deliberately generic — what identifies the
   * failure is the issue's own code and path.
   */
  function issueOf(run: () => unknown): { code?: string; path?: string } {
    try {
      run();
    } catch (error) {
      const issues = (
        error as {
          publicData?: { errors?: { code?: string; path?: string }[] };
        }
      )?.publicData?.errors;
      return issues?.[0] ?? {};
    }
    return {};
  }

  it.each([
    ["NaN", Number.NaN],
    ["Infinity", Number.POSITIVE_INFINITY],
  ])("refuses a version of %s, which JSON cannot carry", (_label, version) => {
    // `typeof NaN === "number"`, so the per-declaration check reads it as a
    // version. It survives to `JSON.stringify`, which writes it as `null` — a
    // manifest that parses as JSON and is wrong. The schema is what catches the
    // gap between "is a number" and "is a number a reader can be handed".
    expect(
      issueOf(() =>
        buildBlockManifest([
          consumer(),
          declaring("@acme/pricing", [block("acme/hero", { version })]),
        ])
      )
      // Not the message: its tail is zod's wording, which a zod upgrade may
      // reword without anything about this refusal having changed.
    ).toMatchObject({
      code: "MANIFEST_SCHEMA_MISMATCH",
      path: "blocks.manifest.json.blocks.0.version",
    });
  });
});

describe("the published JSON Schema", () => {
  it("describes the same document the emitter writes", () => {
    // Pinned rather than merely smoke-tested: this is the contract an outside
    // reader validates against, so a change to it is a change to what Nextly
    // promises, and has to be visible in a diff.
    expect(blockManifestJsonSchema()).toMatchInlineSnapshot(`
      {
        "$schema": "https://json-schema.org/draft/2020-12/schema",
        "additionalProperties": false,
        "properties": {
          "blocks": {
            "items": {
              "additionalProperties": false,
              "properties": {
                "description": {
                  "minLength": 1,
                  "type": "string",
                },
                "example": {},
                "name": {
                  "minLength": 1,
                  "type": "string",
                },
                "props": {
                  "additionalProperties": {},
                  "propertyNames": {
                    "type": "string",
                  },
                  "type": "object",
                },
                "slots": {
                  "additionalProperties": {},
                  "propertyNames": {
                    "type": "string",
                  },
                  "type": "object",
                },
                "source": {
                  "minLength": 1,
                  "type": "string",
                },
                "supports": {
                  "additionalProperties": {},
                  "propertyNames": {
                    "type": "string",
                  },
                  "type": "object",
                },
                "version": {
                  "type": "number",
                },
              },
              "required": [
                "name",
                "version",
                "description",
                "source",
              ],
              "type": "object",
            },
            "type": "array",
          },
          "manifestVersion": {
            "exclusiveMinimum": 0,
            "maximum": 9007199254740991,
            "type": "integer",
          },
        },
        "required": [
          "manifestVersion",
          "blocks",
        ],
        "type": "object",
      }
    `);
  });
});
