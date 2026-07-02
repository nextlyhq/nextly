import { describe, it, expect } from "vitest";

import { getPath, resolveBindings } from "./bindings";
import { makeNode } from "./tree";
import type { BlockNode } from "./types";

describe("getPath", () => {
  it("reads dot paths", () => {
    expect(getPath({ a: { b: 2 } }, "a.b")).toBe(2);
    expect(getPath({ a: {} }, "a.z")).toBeUndefined();
    expect(getPath(null, "a")).toBeUndefined();
  });
});

describe("resolveBindings", () => {
  it("fills bound props from the item, leaves literal props", () => {
    const node: BlockNode = {
      ...makeNode("core/heading", { text: "literal", level: "h2" }),
      bindings: { text: { source: "field", path: "title" } },
    };
    const out = resolveBindings(node, { title: "Hello" });
    expect(out.text).toBe("Hello");
    expect(out.level).toBe("h2");
  });

  it("resolves nested field paths", () => {
    const node: BlockNode = {
      ...makeNode("core/paragraph"),
      bindings: { text: { source: "field", path: "author.name" } },
    };
    expect(resolveBindings(node, { author: { name: "Ada" } }).text).toBe("Ada");
  });

  it("resolves a missing bound field to undefined", () => {
    const node: BlockNode = {
      ...makeNode("core/heading"),
      bindings: { text: { source: "field", path: "nope" } },
    };
    expect(resolveBindings(node, { title: "x" }).text).toBeUndefined();
  });

  it("applies a transform", () => {
    const node: BlockNode = {
      ...makeNode("core/heading"),
      bindings: {
        text: { source: "field", path: "title", transform: "uppercase" },
      },
    };
    expect(resolveBindings(node, { title: "hello" }).text).toBe("HELLO");
  });

  it("returns literal props unchanged when there are no bindings", () => {
    const node = makeNode("core/heading", { text: "x" });
    expect(resolveBindings(node, {}).text).toBe("x");
  });
});
