/**
 * Blocks another plugin contributes, registered in the BROWSER's registry
 * when the editor mounts.
 *
 * The registry is the engine's real one, cleared between tests, and this
 * module is loaded afresh for each test, so what one test hands over never
 * reaches the next. Each property is asserted against the registry itself
 * rather than against a call being made, because the editor reads the
 * registry and nothing else.
 */
import {
  clearBlocks,
  getBlock,
  getBlockSource,
  getSupport,
  type AnyBlockDefinition,
} from "@nextlyhq/blocks-engine";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PLUGIN_SOURCE } from "./editor/stored-document";

type Module = typeof import("./contributed-blocks");

let contributed: Module;

beforeEach(async () => {
  clearBlocks();
  vi.resetModules();
  contributed = await import("./contributed-blocks");
});

afterEach(() => {
  clearBlocks();
  vi.restoreAllMocks();
});

/** A complete block the engine accepts, with whatever supports it names. */
function block(
  name: string,
  supports?: Record<string, boolean>
): AnyBlockDefinition {
  return {
    name,
    version: 1,
    description: `The ${name} block.`,
    example: { props: {} },
    props: { label: { type: "text" } },
    ...(supports === undefined ? {} : { supports }),
    render: () => null,
  } as unknown as AnyBlockDefinition;
}

const ENTRY = "acme-blocks/editor#editorBlocks";
const OTHER_ENTRY = "acme-tones/editor#editorBlocks";

describe("registering contributed blocks in the editor", () => {
  it("puts a contributed block beside the core blocks", () => {
    contributed.registerBlockEditorModules({
      entries: { [ENTRY]: { blocks: [block("acme/hero")] } },
    });

    contributed.ensureEditorBlocksRegistered();

    expect(getBlock("acme/hero")).toBeDefined();
    expect(getBlockSource("acme/hero")).toBe(ENTRY);
    expect(getBlock("core/text")).toBeDefined();
  });

  it("is idempotent across remounts", () => {
    const hero = block("acme/hero");
    contributed.registerBlockEditorModules({
      entries: { [ENTRY]: { blocks: [hero] } },
    });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    contributed.ensureEditorBlocksRegistered();
    // The editor mounts again: a second registration of the same names would
    // throw a collision from the engine.
    expect(() => contributed.ensureEditorBlocksRegistered()).not.toThrow();
    contributed.ensureEditorBlocksRegistered();

    expect(getBlock("acme/hero")).toBe(hero);
    expect(warn).not.toHaveBeenCalled();
  });

  it("registers every entry's supports before any entry's blocks", () => {
    // The block comes from the entry handed over FIRST and uses a support only
    // the second entry declares. Registered entry by entry, the block would be
    // refused for naming a support nothing knew yet.
    contributed.registerBlockEditorModules({
      entries: {
        [ENTRY]: { blocks: [block("acme/toned", { tone: true })] },
        [OTHER_ENTRY]: { supports: [{ key: "tone", label: "Tone" }] },
      },
    });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    contributed.ensureEditorBlocksRegistered();

    expect(getSupport("tone")).toBeDefined();
    expect(getBlock("acme/toned")).toBeDefined();
    expect(warn).not.toHaveBeenCalled();
  });

  it("refuses a contributed block taking a core block's name, keeping the core one", () => {
    const impostor = block("core/text");
    contributed.registerBlockEditorModules({
      entries: { [ENTRY]: { blocks: [impostor, block("acme/hero")] } },
    });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    expect(() => contributed.ensureEditorBlocksRegistered()).not.toThrow();

    expect(getBlock("core/text")).not.toBe(impostor);
    expect(getBlockSource("core/text")).toBe(PLUGIN_SOURCE);
    // The rest of the entry still arrives.
    expect(getBlock("acme/hero")).toBeDefined();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]?.[0])).toContain('"core/text"');
  });

  it("skips an entry that does not export blocks, naming it, without throwing", () => {
    contributed.registerBlockEditorModules({
      entries: { [ENTRY]: "not an entry" },
    });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    expect(() => contributed.ensureEditorBlocksRegistered()).not.toThrow();
    contributed.ensureEditorBlocksRegistered();

    expect(getBlock("core/text")).toBeDefined();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]?.[0])).toContain(ENTRY);
  });
});

describe("an entry holding malformed elements", () => {
  // Each a value a plugin's own JavaScript could export in place of a
  // definition: none may stop the editor mounting, and every well-formed
  // element beside them still arrives.
  const MALFORMED: unknown[] = [null, undefined, 7, "acme/hero", []];

  it("skips each malformed block, naming the entry, and registers the rest", () => {
    contributed.registerBlockEditorModules({
      entries: { [ENTRY]: { blocks: [...MALFORMED, block("acme/hero")] } },
    });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    expect(() => contributed.ensureEditorBlocksRegistered()).not.toThrow();

    expect(getBlock("acme/hero")).toBeDefined();
    expect(warn).toHaveBeenCalled();
    expect(warn.mock.calls.every(call => String(call[0]).includes(ENTRY))).toBe(
      true
    );
  });

  it("skips each malformed support, naming the entry, and registers the rest", () => {
    contributed.registerBlockEditorModules({
      entries: {
        [ENTRY]: {
          supports: [...MALFORMED, { key: 42 }, { key: "tone" }],
          blocks: [block("acme/toned", { tone: true })],
        },
      },
    });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    expect(() => contributed.ensureEditorBlocksRegistered()).not.toThrow();

    expect(getSupport("tone")).toBeDefined();
    expect(getBlock("acme/toned")).toBeDefined();
    expect(warn).toHaveBeenCalled();
    expect(warn.mock.calls.every(call => String(call[0]).includes(ENTRY))).toBe(
      true
    );
  });

  it("does not throw in the miniature's lookup, and still finds the good block", () => {
    const hero = block("acme/hero");
    contributed.registerBlockEditorModules({
      entries: { [ENTRY]: { blocks: [...MALFORMED, hero] } },
    });

    expect(() => contributed.contributedBlock("acme/hero")).not.toThrow();
    expect(contributed.contributedBlock("acme/hero")).toBe(hero);
    expect(contributed.contributedBlock("acme/nothing")).toBeUndefined();
  });
});

describe("a contributed block's own inspector", () => {
  it("resolves the component the map handed over, and nothing else", () => {
    const Inspector = () => null;
    contributed.registerBlockEditorModules({
      components: { "acme-blocks/editor#HeroInspector": Inspector },
    });

    expect(
      contributed.contributedInspector("acme-blocks/editor#HeroInspector")
    ).toBe(Inspector);
    expect(
      contributed.contributedInspector("acme-blocks/editor#Missing")
    ).toBeUndefined();
  });

  it("refuses a value that is not a component, naming its path", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    contributed.registerBlockEditorModules({
      components: { "acme-blocks/editor#NotAComponent": { blocks: [] } },
    });

    expect(
      contributed.contributedInspector("acme-blocks/editor#NotAComponent")
    ).toBeUndefined();
    expect(String(warn.mock.calls[0]?.[0])).toContain(
      "acme-blocks/editor#NotAComponent"
    );
  });
});

describe("the entry screen's miniature", () => {
  it("resolves a contributed block before any editor has mounted", async () => {
    const hero = block("acme/hero");
    contributed.registerBlockEditorModules({
      entries: { [ENTRY]: { blocks: [hero] } },
    });
    const { entryBlockResolver } = await import("./entry-block-resolver");

    // The precondition: the registry has not been filled.
    expect(getBlock("acme/hero")).toBeUndefined();
    expect(entryBlockResolver().get("acme/hero")).toBe(hero);
  });
});
