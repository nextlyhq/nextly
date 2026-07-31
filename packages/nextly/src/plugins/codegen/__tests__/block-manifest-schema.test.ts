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
    // The rest are what the block engine refuses at registration. Generation
    // accepting them would report success, and delete the previous manifest,
    // for an app that cannot start.
    [
      "a fractional version, which has no migration step",
      { name: "n", version: 1.5, description: "d" },
    ],
    [
      "a version below 1, with nothing to migrate from",
      { name: "n", version: 0, description: "d" },
    ],
    [
      "a description of nothing but whitespace",
      { name: "n", version: 1, description: "   " },
    ],
    [
      "an example whose props are an array, which no node can hold",
      { name: "n", version: 1, description: "d", example: { props: [] } },
    ],
    [
      "an example with no props at all",
      { name: "n", version: 1, description: "d", example: {} },
    ],
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
    ["a fraction", 1.5],
    ["zero", 0],
    ["a negative", -1],
  ])(
    "refuses a version of %s, which the per-declaration check reads as a number",
    (_label, version) => {
      // `typeof NaN === "number"`, and so is 1.5 and -1, so the declaration
      // check lets all of them through. NaN even survives to `JSON.stringify`,
      // which writes it as `null` — a manifest that parses as JSON and is
      // wrong. The schema is the gap between "is a number" and "is a version".
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
    }
  );

  it("refuses a description of nothing but whitespace", () => {
    // The per-declaration check measures length, so spaces pass it; the engine
    // trims before checking, and a blank description renders as an empty
    // palette entry — the thing requiring one exists to prevent.
    expect(
      issueOf(() =>
        buildBlockManifest([
          consumer(),
          declaring("@acme/pricing", [
            block("acme/hero", { description: "   " }),
          ]),
        ])
      )
    ).toMatchObject({
      code: "MANIFEST_SCHEMA_MISMATCH",
      path: "blocks.manifest.json.blocks.0.description",
    });
  });

  it("refuses an example whose props are not a key/value map", () => {
    // The per-declaration check requires the example to be an object and says
    // nothing about its props. A stored node's props are a map, so an
    // array-shaped example describes a node that could never be valid.
    expect(
      issueOf(() =>
        buildBlockManifest([
          consumer(),
          declaring("@acme/pricing", [
            block("acme/hero", { example: { props: [] } }),
          ]),
        ])
      )
    ).toMatchObject({
      code: "MANIFEST_SCHEMA_MISMATCH",
      path: "blocks.manifest.json.blocks.0.example.props",
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
                  "pattern": "\\S",
                  "type": "string",
                },
                "example": {
                  "additionalProperties": {},
                  "properties": {
                    "props": {
                      "additionalProperties": {},
                      "propertyNames": {
                        "type": "string",
                      },
                      "type": "object",
                    },
                  },
                  "required": [
                    "props",
                  ],
                  "type": "object",
                },
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
                  "exclusiveMinimum": 0,
                  "maximum": 9007199254740991,
                  "type": "integer",
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
