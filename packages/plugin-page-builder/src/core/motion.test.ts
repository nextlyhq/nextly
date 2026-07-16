import { describe, expect, it } from "vitest";

import { compileMotionCss } from "./motion";
import { compileDocumentMotionCss } from "./style-compiler";
import { makeNode } from "./tree";
import type { BlockNode } from "./types";

describe("compileMotionCss", () => {
  it("emits a reduced-motion-guarded animation rule", () => {
    const n: BlockNode = {
      id: "m1",
      type: "core/heading",
      props: {},
      motion: { entrance: "slide-up", duration: "500ms", delay: "100ms" },
    };
    const css = compileMotionCss(n, "nx-pb-x");
    expect(css).toContain("prefers-reduced-motion: no-preference");
    expect(css).toContain("animation: nx-slide-up 500ms ease 100ms both");
  });

  it("returns '' for none / unknown / invalid time", () => {
    expect(
      compileMotionCss(
        { id: "a", type: "t", props: {}, motion: { entrance: "none" } },
        "c"
      )
    ).toBe("");
    expect(
      compileMotionCss(
        { id: "b", type: "t", props: {}, motion: { entrance: "evil()" } },
        "c"
      )
    ).toBe("");
    const bad = compileMotionCss(
      {
        id: "c",
        type: "t",
        props: {},
        motion: { entrance: "fade-in", duration: "5s;color:red" },
      },
      "c"
    );
    expect(bad).toContain("600ms"); // invalid duration falls back
    expect(bad).not.toContain("color:red");
  });
});

describe("compileDocumentMotionCss", () => {
  it("emits keyframes only when a node animates", () => {
    const withMotion = makeNode("core/heading", {});
    withMotion.motion = { entrance: "fade-in" };
    expect(
      compileDocumentMotionCss({ version: 1, root: withMotion })
    ).toContain("@keyframes nx-fade-in");
    expect(
      compileDocumentMotionCss({
        version: 1,
        root: makeNode("core/heading", {}),
      })
    ).toBe("");
  });
});
