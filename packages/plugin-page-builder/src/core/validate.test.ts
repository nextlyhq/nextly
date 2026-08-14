import { describe, it, expect } from "vitest";

import { createBlockRegistry } from "./registry";
import { makeNode } from "./tree";
import { validateDocument } from "./validate";

const reg = createBlockRegistry();
reg.register({
  type: "core/container",
  version: 1,
  label: "C",
  icon: "",
  category: "layout",
  isContainer: true,
  slots: [{ name: "default" }],
  defaultProps: {},
  render: () => null,
});
reg.register({
  type: "core/heading",
  version: 1,
  label: "H",
  icon: "",
  category: "basic",
  defaultProps: {},
  render: () => null,
});

const doc = (root: unknown) => ({ version: 1 as const, root }) as never;

describe("validateDocument", () => {
  it("accepts a valid tree", () => {
    const root = makeNode("core/container", {}, undefined, {
      default: [makeNode("core/heading", { text: "x" })],
    });
    expect(validateDocument(doc(root), reg)).toBe(true);
  });

  it("rejects a non-container leaf that has slots", () => {
    const bad = makeNode("core/heading", {}, undefined, {
      default: [makeNode("core/heading")],
    });
    expect(typeof validateDocument(doc(bad), reg)).toBe("string");
  });

  it("rejects unknown block types unless allowUnknown", () => {
    const bad = { id: "x", type: "acme/unknown", props: {} };
    expect(typeof validateDocument(doc(bad), reg)).toBe("string");
    expect(validateDocument(doc(bad), reg, { allowUnknown: true })).toBe(true);
  });

  it("rejects non-namespaced types", () => {
    const bad = { id: "x", type: "heading", props: {} };
    expect(typeof validateDocument(doc(bad), reg)).toBe("string");
  });

  it("rejects duplicate ids", () => {
    const dup = makeNode("core/heading");
    dup.id = "same";
    const dup2 = makeNode("core/heading");
    dup2.id = "same";
    const root = makeNode("core/container", {}, undefined, {
      default: [dup, dup2],
    });
    expect(typeof validateDocument(doc(root), reg)).toBe("string");
  });

  it("rejects a block placed in a slot that disallows it", () => {
    const restricted = createBlockRegistry();
    restricted.register({
      type: "core/container",
      version: 1,
      label: "C",
      icon: "",
      category: "layout",
      isContainer: true,
      slots: [{ name: "default", allowedBlocks: ["core/heading"] }],
      defaultProps: {},
      render: () => null,
    });
    restricted.register({
      type: "core/image",
      version: 1,
      label: "I",
      icon: "",
      category: "media",
      defaultProps: {},
      render: () => null,
    });
    const root = makeNode("core/container", {}, undefined, {
      default: [makeNode("core/image")],
    });
    expect(typeof validateDocument(doc(root), restricted)).toBe("string");
  });

  it("rejects trees deeper than MAX_DEPTH", () => {
    let node = makeNode("core/container", {}, undefined, { default: [] });
    for (let i = 0; i < 20; i++) {
      node = makeNode("core/container", {}, undefined, { default: [node] });
    }
    expect(typeof validateDocument(doc(node), reg)).toBe("string");
  });

  it("rejects unsupported version / missing root", () => {
    expect(
      typeof validateDocument(
        { version: 2, root: makeNode("core/container") } as never,
        reg
      )
    ).toBe("string");
    expect(typeof validateDocument({ version: 1 } as never, reg)).toBe(
      "string"
    );
  });
});

describe("a root whose type is not a string", () => {
  it("is reported as a malformed type, not as sitting in the wrong place", () => {
    // The value COERCES to a restricted type name, which is what makes this discriminate: a plain
    // number reaches the same lookup, finds nothing, and falls through to the shape check whether
    // or not the guard is present — so a test using one passes either way.
    //
    // The root-parent check runs before the walk that validates node shape, so unguarded it
    // answers first, on a key a property lookup coerced for it: a confident placement verdict
    // about a node whose type is not a type at all.
    const doc = {
      version: 1,
      root: {
        id: "r",
        type: { toString: () => "core/column" },
        props: {},
      },
    };
    const result = validateDocument(doc, createBlockRegistry());
    expect(result).toContain("type");
    expect(result).not.toContain("may only sit inside");
  });
});
