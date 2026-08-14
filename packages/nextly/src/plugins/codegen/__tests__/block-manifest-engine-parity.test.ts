/**
 * Generation and registration agree about what they refuse.
 *
 * The rules have to be stated where generation runs, and core states them
 * rather than importing them: reading them from the engine would make every
 * app that installs core carry the block engine so codegen can read a bound,
 * match a name and walk a map, and it points the dependency the wrong way,
 * since the plugin layer builds on core and not the reverse.
 *
 * Restating a rule is only safe if it cannot quietly diverge. This file is what
 * makes that true. Rather than checking each restated rule against its
 * counterpart, it asks the engine itself — `registerBlocks` runs the whole
 * registration validator — and requires the two to reach the same verdict on
 * the same declaration. A rule tightened or loosened on either side, including
 * one nobody thought to mirror, shows up here.
 *
 * `supports` is the one thing deliberately absent from the table: the engine
 * checks those keys against capabilities registered at runtime, which
 * generation cannot know without booting, so parity there is not achievable
 * rather than merely unimplemented.
 *
 * The engine is a development dependency for this file alone; nothing imports
 * it at runtime.
 */
import {
  clearBlocks,
  COMPONENT_INSTANCE_TYPE,
  registerBlocks,
  MAX_BLOCK_VERSION,
} from "@nextlyhq/blocks-engine";
import { afterEach, describe, expect, it } from "vitest";

import { definePlugin, type PluginDefinition } from "../../plugin-context";
import {
  buildBlockManifest,
  MAX_DECLARED_BLOCK_VERSION,
  PAGE_BUILDER_PLUGIN,
} from "../block-manifest";

afterEach(() => {
  clearBlocks();
});

describe("the manifest's block-version bound", () => {
  it("is the bound the engine enforces at registration", () => {
    expect(MAX_DECLARED_BLOCK_VERSION).toBe(MAX_BLOCK_VERSION);
  });
});

describe("the parent names each side accepts", () => {
  const withParent = (parent: unknown) => ({
    name: "acme/thing",
    version: 1,
    description: "A block.",
    example: { props: {} },
    parent,
    render: () => null,
  });

  it("both accept a namespaced name", () => {
    // The positive control on BOTH sides. Without it, a pair that rejected everything would agree
    // perfectly and satisfy the disagreement checks below.
    expect(() =>
      registerBlocks([withParent(["core/columns"])] as never, {
        source: "acme",
      })
    ).not.toThrow();
    clearBlocks();
    const manifest = buildBlockManifest([
      consumer(),
      declaring([withParent(["core/columns"])]),
    ]);
    expect(manifest.blocks[0]?.parent).toEqual(["core/columns"]);
  });

  it("neither accepts a bare name the engine would refuse at boot", () => {
    // Generation running ahead of the engine is the failure that matters: `nextly generate` and
    // `--check` would succeed for a configuration that cannot boot, which is the opposite of what
    // an artifact describing a plugin's declaration is for.
    expect(() =>
      registerBlocks([withParent(["shell"])] as never, { source: "acme" })
    ).toThrow();
    clearBlocks();
    expect(() =>
      buildBlockManifest([consumer(), declaring([withParent(["shell"])])])
    ).toThrow();
  });

  it("neither accepts an EMPTY list, which permits no placement", () => {
    expect(() =>
      registerBlocks([withParent([])] as never, { source: "acme" })
    ).toThrow();
    clearBlocks();
    expect(() =>
      buildBlockManifest([consumer(), declaring([withParent([])])])
    ).toThrow();
  });

  it("neither accepts a bare string in place of the array", () => {
    expect(() =>
      registerBlocks([withParent("core/columns")] as never, { source: "acme" })
    ).toThrow();
    clearBlocks();
    expect(() =>
      buildBlockManifest([consumer(), declaring([withParent("core/columns")])])
    ).toThrow();
  });
});

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

const step = () => ({});

/** A declaration the engine accepts, for a case to vary one thing from. */
function valid(overrides: Record<string, unknown> = {}) {
  return {
    name: "acme/hero",
    version: 1,
    description: "A hero.",
    example: { props: {} },
    render: () => null,
    ...overrides,
  };
}

const CASES: { label: string; definition: Record<string, unknown> }[] = [
  { label: "an ordinary block", definition: valid() },
  {
    label: "a hyphenated namespace and name",
    definition: valid({ name: "my-co/call-to-action" }),
  },
  { label: "a name with no namespace", definition: valid({ name: "Hero" }) },
  {
    label: "a name in the wrong case",
    definition: valid({ name: "Acme/Hero" }),
  },
  { label: "a name with two slashes", definition: valid({ name: "a/b/c" }) },
  {
    label: "a name with a trailing hyphen",
    definition: valid({ name: "acme/hero-" }),
  },
  { label: "an empty namespace", definition: valid({ name: "/hero" }) },
  {
    label: "the reserved component-instance name",
    definition: valid({ name: COMPONENT_INSTANCE_TYPE }),
  },
  { label: "a fractional version", definition: valid({ version: 1.5 }) },
  { label: "a version of zero", definition: valid({ version: 0 }) },
  {
    label: "a version past the bound",
    definition: valid({ version: MAX_BLOCK_VERSION + 1 }),
  },
  {
    label: "a version at the bound, fully migrated",
    definition: valid({ version: 2, migrate: { 1: step } }),
  },
  {
    label: "version 2 with no migration map",
    definition: valid({ version: 2 }),
  },
  {
    label: "version 3 missing its first step",
    definition: valid({ version: 3, migrate: { 2: step } }),
  },
  {
    label: "version 3 fully covered",
    definition: valid({ version: 3, migrate: { 1: step, 2: step } }),
  },
  {
    label: "a step that is not a function",
    definition: valid({ version: 2, migrate: { 1: "nope" } }),
  },
  { label: "a blank description", definition: valid({ description: "   " }) },
  {
    label: "no description at all",
    definition: valid({ description: undefined }),
  },
  {
    label: "an example whose props are an array",
    definition: valid({ example: { props: [] } }),
  },
  { label: "an example with no props", definition: valid({ example: {} }) },
  // The two the engine requires that never reach the manifest. A table whose
  // every row carries a render function cannot notice a missing render check,
  // which is how these went unmirrored in the first place.
  { label: "no render function", definition: valid({ render: undefined }) },
  {
    label: "a render that is not a function",
    definition: valid({ render: "./hero.js" }),
  },
  {
    label: "defaultProps that are a plain record",
    definition: valid({ defaultProps: { heading: "Hi" } }),
  },
  {
    label: "defaultProps that are an array",
    definition: valid({ defaultProps: [] }),
  },
  {
    label: "defaultProps that are a primitive",
    definition: valid({ defaultProps: "none" }),
  },
];

/**
 * Whether the engine refuses this definition at registration.
 *
 * The table is mostly definitions the engine SHOULD refuse, so it cannot
 * satisfy the definition type — that is the point. Handing the registrar what
 * a plugin might actually declare, rather than only what type-checks, is the
 * whole of what makes this an oracle.
 */
function engineRefuses(definition: Record<string, unknown>): boolean {
  try {
    registerBlocks([definition] as unknown as Parameters<
      typeof registerBlocks
    >[0]);
    return false;
  } catch {
    return true;
  } finally {
    clearBlocks();
  }
}

/** Whether generation refuses the same definition as a declaration. */
function generationRefuses(definition: Record<string, unknown>): boolean {
  try {
    buildBlockManifest([consumer(), declaring([definition])]);
    return false;
  } catch {
    return true;
  }
}

describe("what generation refuses", () => {
  it.each(CASES)("matches the engine for $label", ({ definition }) => {
    expect(generationRefuses(definition)).toBe(engineRefuses(definition));
  });
});
