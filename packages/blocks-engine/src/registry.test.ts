import { beforeEach, describe, expect, expectTypeOf, it } from "vitest";

import type { BlockDefinition, BlockSupports, InferBlockProps } from "./block";
import type { BlockNode } from "./document";
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

describe("the define-then-register workflow keeps its prop types", () => {
  it("registers a definition whose props were inferred from a literal", () => {
    // This is the primary workflow: defineBlock infers { text: string }, and
    // that fully-typed definition must be registrable without erasing types.
    const heading = defineBlock({
      name: "core/typed-heading",
      version: 1,
      description: "A heading.",
      example: { props: { text: "Hi" } },
      defaultProps: { text: "" },
      props: { text: { type: "text" } },
      localized: ["text"],
      render: args => args.props.text,
    });
    expect(() => registerBlocks([heading])).not.toThrow();
    expect(getBlock("core/typed-heading")).toBeDefined();
  });

  it("lets a consumer call render on a definition read back from the registry", () => {
    // The other half of the contract: a renderer holds a stored node and must
    // be able to invoke the registered block with that node's runtime props.
    const greeter = defineBlock({
      name: "core/greeter",
      version: 1,
      description: "Greets.",
      example: { props: { who: "world" } },
      render: args => `hello ${args.props.who}`,
    });
    registerBlocks([greeter]);

    const node: BlockNode = {
      id: "n1",
      type: "core/greeter",
      version: 1,
      props: { who: "reader" },
    };
    const def = getBlock(node.type);
    const output = def?.render({
      props: node.props,
      node,
      className: "nx-pb-x",
      // Both are required by the render contract. This block draws no slots and
      // reads no context, so they stand in rather than doing anything — but a
      // call that omits them is not the call a renderer makes.
      renderSlot: () => undefined,
      ctx: undefined,
      // Required for the same reason: this block declares no parts, so the
      // answer is empty for every name, and a renderer that could omit it would
      // leave every block's parts unmarked with nothing to report.
      partClass: () => "",
    });
    expect(output).toBe("hello reader");
  });

  it("types variation props against the block's own props", () => {
    const withVariation = defineBlock({
      name: "core/varied",
      version: 1,
      description: "Has presets.",
      example: { props: { tone: "calm" } },
      render: args => args.props.tone,
      editor: {
        variations: [{ name: "loud", props: { tone: "LOUD" } }],
      },
    });
    expect(withVariation.editor?.variations?.[0]?.props?.tone).toBe("LOUD");
  });

  it("registers a definition whose props come from a named interface", () => {
    // Interfaces carry no implicit index signature, so the prop constraint has
    // to accept plain object shapes for ordinary author code to compile.
    interface CardProps {
      title: string;
      count: number;
    }
    const card = defineBlock<CardProps>({
      name: "core/typed-card",
      version: 1,
      description: "A card.",
      example: { props: { title: "a", count: 1 } },
      render: args => `${args.props.title}${args.props.count}`,
    });
    expect(() => registerBlocks([card])).not.toThrow();
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

  it("registers a block that says why it needs JavaScript", () => {
    // The must-pass control for the rejections below: a gate refusing every
    // island would pass all of them while making the declaration unusable.
    registerBlocks([
      block({
        name: "core/ticker",
        island: { reason: "counts down to a date the server cannot know." },
      } as never),
    ]);
    expect(hasBlock("core/ticker")).toBe(true);
  });

  it("refuses an island that states no reason", () => {
    // The reason is the whole value of the field. A block that declares
    // interactivity without saying what it is for records the cost on every
    // visitor and hides the justification from the next reviewer.
    for (const island of [{}, { reason: "" }, { reason: "   " }]) {
      expect(() =>
        registerBlocks([block({ name: "core/h1", island } as never)])
      ).toThrow(/NEXTLY_BLOCK_INVALID.*reason/s);
    }
  });

  it("refuses an island that is not a record", () => {
    for (const island of [null, [], true, "yes"]) {
      expect(() =>
        registerBlocks([block({ name: "core/h2", island } as never)])
      ).toThrow(/NEXTLY_BLOCK_INVALID.*island/s);
    }
  });

  it("registers a block declaring well-formed parts", () => {
    // The control every rejection below needs: a gate that refused every parts
    // record would pass all of them while making the feature unusable.
    registerBlocks([
      block({
        name: "core/captioned",
        parts: { caption: { baseStyles: {} } },
      } as never),
    ]);
    expect(hasBlock("core/captioned")).toBe(true);
  });

  it("rejects parts that are not a record, at BOOT rather than at render", () => {
    // Unchecked, a `null` reaches the compile context and `Object.keys` throws
    // during page-style resolution — a long way from the definition that caused
    // it, naming neither the block nor the field.
    expect(() =>
      registerBlocks([block({ name: "core/d1", parts: null } as never)])
    ).toThrow(/NEXTLY_BLOCK_INVALID.*parts/s);
    expect(() =>
      registerBlocks([block({ name: "core/d2", parts: [] } as never)])
    ).toThrow(/NEXTLY_BLOCK_INVALID.*parts/s);
  });

  it("rejects a part name the compiler would refuse to emit", () => {
    // Registration and emission ask the SAME predicate. A name accepted here
    // and refused there registers a block whose part is silently never styled.
    expect(() =>
      registerBlocks([
        block({ name: "core/e1", parts: { "a--b": {} } } as never),
      ])
    ).toThrow(/NEXTLY_BLOCK_INVALID.*a--b/s);
    expect(() =>
      registerBlocks([
        block({ name: "core/e2", parts: { Caption: {} } } as never),
      ])
    ).toThrow(/NEXTLY_BLOCK_INVALID.*Caption/s);
  });

  it("rejects a part name Object.prototype already owns", () => {
    // `constructor` passes the slug grammar, and a record cannot store it and
    // read it back: the lookup answers with the inherited member.
    expect(() =>
      registerBlocks([
        block({ name: "core/f", parts: { constructor: {} } } as never),
      ])
    ).toThrow(/NEXTLY_BLOCK_INVALID.*constructor/s);
  });

  it("rejects a part whose declaration is not a record", () => {
    expect(() =>
      registerBlocks([
        block({ name: "core/g", parts: { caption: null } } as never),
      ])
    ).toThrow(/NEXTLY_BLOCK_INVALID.*caption/s);
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

  it("rejects a version beyond the span migration can chain", () => {
    // Above this, findMigrationGaps cannot report gaps and migration would
    // reject the range at runtime, so registration must not accept it.
    expect(() =>
      registerBlocks([block({ name: "core/huge", version: 5000 })])
    ).toThrow(/NEXTLY_BLOCK_INVALID.*between 1 and/s);
  });

  it("rejects an example whose props are not a plain object", () => {
    // Document validation rejects array props, so such an example could never
    // become a valid node.
    expect(() =>
      registerBlocks([
        block({
          name: "core/arr",
          example: { props: [] as never },
        }),
      ])
    ).toThrow(/NEXTLY_BLOCK_INVALID.*plain object/s);
  });

  it("rejects an unknown sub-flag on a support that enumerates its flags", () => {
    expect(() =>
      registerBlocks([
        block({ name: "core/typo", supports: { spacing: { paddding: true } } }),
      ])
    ).toThrow(/NEXTLY_BLOCK_UNKNOWN_SUPPORT.*paddding/s);
  });

  it("rejects a non-boolean sub-flag value", () => {
    // The authoring types never ran for a definition arriving from plain
    // JavaScript or through the untyped declarations channel, and the style
    // mapping enables a group only on exactly `true`, so this registers
    // cleanly and then styles nothing at all.
    expect(() =>
      registerBlocks([
        block({
          name: "core/flagstring",
          supports: { spacing: { padding: "yes" } } as unknown as BlockSupports,
        }),
      ])
    ).toThrow(/NEXTLY_BLOCK_INVALID.*padding.*a string/s);
  });

  it("rejects a support value that is neither boolean nor a flag object", () => {
    expect(() =>
      registerBlocks([
        block({
          name: "core/supportstring",
          supports: { spacing: "on" } as unknown as BlockSupports,
        }),
      ])
    ).toThrow(/NEXTLY_BLOCK_INVALID.*spacing.*a string/s);
  });

  it("accepts known sub-flags", () => {
    expect(() =>
      registerBlocks([
        block({
          name: "core/ok-flags",
          supports: { spacing: { padding: true } },
        }),
      ])
    ).not.toThrow();
  });

  it("refuses to register a name the engine reserves", () => {
    expect(() =>
      registerBlocks([block({ name: "nextly/component-instance" })])
    ).toThrow(/NEXTLY_BLOCK_RESERVED_NAME/);
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
