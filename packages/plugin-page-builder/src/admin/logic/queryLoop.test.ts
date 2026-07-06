import { describe, it, expect } from "vitest";

import { makeNode } from "../../core/tree";

import {
  buildSort,
  deriveFieldNames,
  findEnclosingLoop,
  parseSort,
} from "./queryLoop";

describe("findEnclosingLoop", () => {
  it("returns the nearest ancestor query-loop of a node", () => {
    const child = makeNode("core/heading", { text: "x" });
    const loop = makeNode(
      "core/query-loop",
      { collection: "posts" },
      undefined,
      {
        default: [child],
      }
    );
    const root = makeNode("core/container", {}, undefined, { default: [loop] });
    expect(findEnclosingLoop(root, child.id)?.id).toBe(loop.id);
  });

  it("returns undefined when the node is not inside a loop", () => {
    const child = makeNode("core/heading", { text: "x" });
    const root = makeNode("core/container", {}, undefined, {
      default: [child],
    });
    expect(findEnclosingLoop(root, child.id)).toBeUndefined();
  });
});

describe("deriveFieldNames", () => {
  it("unions keys across sample rows, excluding internal id timestamps? no — keeps id", () => {
    const rows = [
      { id: "1", title: "a", body: "x" },
      { id: "2", title: "b", author: "z" },
    ];
    expect(deriveFieldNames(rows).sort()).toEqual([
      "author",
      "body",
      "id",
      "title",
    ]);
  });

  it("returns [] for no rows", () => {
    expect(deriveFieldNames([])).toEqual([]);
  });
});

describe("buildSort / parseSort", () => {
  it("builds a leading-minus string for desc", () => {
    expect(buildSort("createdAt", "desc")).toBe("-createdAt");
    expect(buildSort("title", "asc")).toBe("title");
    expect(buildSort("", "asc")).toBe("");
  });

  it("parses a sort string back to field + direction", () => {
    expect(parseSort("-createdAt")).toEqual({
      field: "createdAt",
      dir: "desc",
    });
    expect(parseSort("title")).toEqual({ field: "title", dir: "asc" });
    expect(parseSort("")).toEqual({ field: "", dir: "asc" });
  });
});
