import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { defaultBlockRegistry } from "../../core/registry";
import { makeNode } from "../../core/tree";
import type { BlockNode } from "../../core/types";
import { RenderNode } from "../RenderNode";

import "./index";

const html = (node: BlockNode) =>
  renderToStaticMarkup(
    <RenderNode node={node} registry={defaultBlockRegistry} />
  );

describe("structure & basic blocks", () => {
  it("registers the new blocks", () => {
    for (const t of ["spacer", "divider", "anchor", "badge", "icon"]) {
      expect(defaultBlockRegistry.has(`core/${t}`)).toBe(true);
    }
  });

  it("spacer renders a sized div", () => {
    const out = html(makeNode("core/spacer", { height: "80px" }));
    expect(out).toContain("height:80px");
  });

  it("divider renders an hr with border style", () => {
    const out = html(
      makeNode("core/divider", { weight: "2px", lineStyle: "dashed" })
    );
    expect(out).toContain("<hr");
    expect(out).toContain("border-top:2px dashed");
  });

  it("anchor renders a span with the given id", () => {
    const out = html(makeNode("core/anchor", { anchorId: "features" }));
    expect(out).toContain('id="features"');
  });

  it("badge renders its text", () => {
    expect(html(makeNode("core/badge", { text: "New" }))).toContain("New");
  });

  it("icon renders an svg of the requested size", () => {
    const out = html(makeNode("core/icon", { icon: "Star", size: "40" }));
    expect(out).toContain("<svg");
    expect(out).toContain('width="40"');
  });

  it("icon falls back to a default icon for an unknown name", () => {
    const out = html(makeNode("core/icon", { icon: "definitely-not-real" }));
    expect(out).toContain("<svg");
  });
});
