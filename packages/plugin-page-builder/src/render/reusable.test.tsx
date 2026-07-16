import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { makeNode } from "../core/tree";
import type { BlockNode } from "../core/types";

import "./blocks";
import { PageRenderer } from "./PageRenderer";

function page(root: BlockNode, refs?: Record<string, BlockNode>) {
  return renderToStaticMarkup(
    <PageRenderer document={{ version: 1, root }} refs={refs} />
  );
}

describe("reusable blocks (core/ref)", () => {
  it("resolves a ref to its stored subtree", () => {
    const stored = makeNode("core/heading", { text: "Shared header" });
    const root = makeNode("core/container", {}, undefined, {
      default: [makeNode("core/ref", { refId: "hdr" })],
    });
    const out = page(root, { hdr: stored });
    expect(out).toContain("Shared header");
  });

  it("renders a placeholder for a missing ref", () => {
    const root = makeNode("core/container", {}, undefined, {
      default: [makeNode("core/ref", { refId: "nope" })],
    });
    expect(page(root, {})).toContain("data-nx-ref-missing");
  });

  it("guards against a reference cycle", () => {
    // ref 'a' resolves to a subtree that itself references 'a'.
    const cyclic = makeNode("core/container", {}, undefined, {
      default: [makeNode("core/ref", { refId: "a" })],
    });
    const root = makeNode("core/container", {}, undefined, {
      default: [makeNode("core/ref", { refId: "a" })],
    });
    const out = page(root, { a: cyclic });
    // Inner self-reference is stopped with a missing/cycle placeholder — no infinite loop.
    expect(out).toContain("data-nx-ref-missing");
  });
});
