import { beforeEach, describe, expect, expectTypeOf, it } from "vitest";

import type { BlockDefinition, InferBlockProps } from "./block";
import { defineBlock } from "./block";
import { migrateDocument } from "./migration";
import {
  allBlocks,
  allSupports,
  clearBlocks,
  getBlock,
  getBlockSource,
  getSupport,
  hasBlock,
  registerBlocks,
  registerSupport,
  registryLookup,
  registryMigrationSource,
} from "./registry";
import { validate } from "./validation";
import { FIXTURE_BREAKPOINTS } from "./validation.fixtures";

/** A minimal valid definition; overrides let each test vary one rule. */
function block(
  overrides: Partial<BlockDefinition> & { name: string }
): BlockDefinition {
  return {
    version: 1,
    description: "A test block.",
    example: { props: {} },
    render: () => null,
    ...overrides,
  };
}

beforeEach(() => {
  clearBlocks();
});

describe("defineBlock typing", () => {
  it("binds one prop type across props, example, defaults, and render", () => {
    const heading = defineBlock({
      name: "core/heading",
      version: 1,
      description: "A heading.",
      example: { props: { text: "Hello", level: 2 } },
      props: { text: { type: "text" }, level: { type: "number" } },
      defaultProps: { text: "", level: 2 },
      render: args => args.props.text.toUpperCase(),
    });
    expectTypeOf<InferBlockProps<typeof heading>>().toEqualTypeOf<{
      text: string;
      level: number;
    }>();
    // The definition is returned unchanged.
    expect(heading.name).toBe("core/heading");
  });
});

describe("registration rules", () => {
  it("registers and reads back a block with its source", () => {
    registerBlocks([block({ name: "core/text" })], { source: "core" });
    expect(hasBlock("core/text")).toBe(true);
    expect(getBlock("core/text")?.description).toBe("A test block.");
    expect(getBlockSource("core/text")).toBe("core");
    expect(allBlocks()).toHaveLength(1);
  });

  it("rejects a non-namespaced name", () => {
    expect(() => registerBlocks([block({ name: "heading" })])).toThrow(
      /NEXTLY_BLOCK_INVALID/
    );
  });

  it("rejects a missing description or example", () => {
    expect(() =>
      registerBlocks([block({ name: "core/a", description: "  " })])
    ).toThrow(/NEXTLY_BLOCK_INVALID.*description/s);
    expect(() =>
      registerBlocks([
        block({ name: "core/b", example: undefined as unknown as never }),
      ])
    ).toThrow(/NEXTLY_BLOCK_INVALID.*example/s);
  });

  it("rejects a non-integer or zero version", () => {
    expect(() =>
      registerBlocks([block({ name: "core/c", version: 0 })])
    ).toThrow(/NEXTLY_BLOCK_INVALID/);
    expect(() =>
      registerBlocks([block({ name: "core/d", version: 1.5 })])
    ).toThrow(/NEXTLY_BLOCK_INVALID/);
  });

  it("refuses a version bump that has no covering migration", () => {
    expect(() =>
      registerBlocks([block({ name: "core/e", version: 3 })])
    ).toThrow(/NEXTLY_BLOCK_MIGRATION_GAP.*versions 1, 2/s);
  });

  it("accepts a version bump whose migration chain is complete", () => {
    registerBlocks([
      block({
        name: "core/f",
        version: 3,
        migrate: { 1: p => p, 2: p => p },
      }),
    ]);
    expect(getBlock("core/f")?.version).toBe(3);
  });

  it("names both sources when two register the same block", () => {
    registerBlocks([block({ name: "core/dup" })], { source: "core" });
    expect(() =>
      registerBlocks([block({ name: "core/dup" })], { source: "plugin-x" })
    ).toThrow(/NEXTLY_BLOCK_COLLISION.*"core".*"plugin-x"/s);
  });

  it("rejects a duplicate name inside one batch", () => {
    expect(() =>
      registerBlocks([block({ name: "core/g" }), block({ name: "core/g" })])
    ).toThrow(/NEXTLY_BLOCK_COLLISION/);
  });

  it("does not partially register a batch containing an invalid block", () => {
    expect(() =>
      registerBlocks([block({ name: "core/ok" }), block({ name: "bad-name" })])
    ).toThrow(/NEXTLY_BLOCK_INVALID/);
    // The valid sibling must not have been stored.
    expect(hasBlock("core/ok")).toBe(false);
  });
});

describe("supports", () => {
  it("ships the built-in capabilities and accepts blocks using them", () => {
    expect(getSupport("spacing")?.flags).toContain("padding");
    expect(allSupports().length).toBeGreaterThan(5);
    registerBlocks([
      block({
        name: "core/h",
        supports: { spacing: true, color: { text: true } },
      }),
    ]);
    expect(getBlock("core/h")?.supports?.spacing).toBe(true);
  });

  it("rejects a block declaring an unregistered support", () => {
    expect(() =>
      registerBlocks([block({ name: "core/i", supports: { telepathy: true } })])
    ).toThrow(/NEXTLY_BLOCK_UNKNOWN_SUPPORT.*telepathy/s);
  });

  it("accepts that same support once it is registered", () => {
    registerSupport({ key: "telepathy", label: "Telepathy" });
    registerBlocks([block({ name: "core/j", supports: { telepathy: true } })]);
    expect(getBlock("core/j")).toBeDefined();
  });

  it("rejects a duplicate or malformed support key", () => {
    expect(() => registerSupport({ key: "spacing" })).toThrow(
      /NEXTLY_SUPPORT_COLLISION/
    );
    expect(() => registerSupport({ key: "not a key" })).toThrow(
      /NEXTLY_SUPPORT_INVALID/
    );
  });
});

describe("clear-and-rebuild (boot / HMR)", () => {
  it("lets the same blocks re-register after a clear", () => {
    registerBlocks([block({ name: "core/k" })], { source: "core" });
    clearBlocks();
    expect(hasBlock("core/k")).toBe(false);
    // Re-registering the same name after a boot reset must not collide.
    expect(() =>
      registerBlocks([block({ name: "core/k" })], { source: "core" })
    ).not.toThrow();
  });

  it("restores the built-in supports after a clear", () => {
    registerSupport({ key: "custom", label: "Custom" });
    clearBlocks();
    expect(getSupport("custom")).toBeUndefined();
    expect(getSupport("spacing")).toBeDefined();
  });
});

describe("registry adapters", () => {
  it("drives validation's unknown-type check", () => {
    registerBlocks([block({ name: "core/known" })]);
    const doc = {
      formatVersion: 1 as const,
      kind: "page" as const,
      nodes: [
        { id: "a", type: "core/known", version: 1, props: {} },
        { id: "b", type: "core/missing", version: 1, props: {} },
      ],
    };
    const issues = validate(doc, {
      breakpoints: FIXTURE_BREAKPOINTS,
      mode: "strict",
      registry: registryLookup(),
    });
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({
      code: "unknown-node-type",
      path: "/nodes/1/type",
    });
  });

  it("drives migration from each block's declared version and steps", () => {
    registerBlocks([
      block({
        name: "core/m",
        version: 2,
        migrate: { 1: p => ({ ...p, added: true }) },
      }),
    ]);
    const { doc, failures } = migrateDocument(
      {
        formatVersion: 1,
        kind: "page",
        nodes: [{ id: "n", type: "core/m", version: 1, props: {} }],
      },
      registryMigrationSource()
    );
    expect(failures).toEqual([]);
    expect(doc.nodes[0]).toMatchObject({ version: 2, props: { added: true } });
  });

  it("reads through to the live registry rather than a snapshot", () => {
    const lookup = registryLookup();
    expect(lookup.has("core/late")).toBe(false);
    registerBlocks([block({ name: "core/late" })]);
    expect(lookup.has("core/late")).toBe(true);
  });
});
