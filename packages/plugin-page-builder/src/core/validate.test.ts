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
