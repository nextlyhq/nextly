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

describe("block-specific options (batch 3)", () => {
  it("button applies width + outline variant + link rel", () => {
    const out = html(
      makeNode("core/button", {
        text: "Go",
        link: { href: "/x" },
        variant: "outline",
        width: "50%",
        rel: "nofollow",
      })
    );
    expect(out).toContain("width:50%");
    expect(out).toContain("transparent");
    expect(out).toContain('rel="nofollow"');
  });

  it("grid auto mode uses auto-fill minmax", () => {
    const out = html(
      makeNode("core/grid", { mode: "auto", minColWidth: "200px" }, undefined, {
        default: [makeNode("core/heading", { text: "c" })],
      })
    );
    expect(out).toContain("repeat(auto-fill, minmax(200px, 1fr))");
  });

  it("image applies an aspect-ratio preset + rounded", () => {
    const out = html(
      makeNode("core/image", {
        media: { url: "/x.jpg" },
        aspectPreset: "16/9",
        rounded: true,
      })
    );
    expect(out).toContain("aspect-ratio:16/9");
    expect(out).toContain("border-radius:12px");
  });

  it("row/stack renders a flex container with orientation", () => {
    expect(defaultBlockRegistry.has("core/row")).toBe(true);
    const out = html(
      makeNode("core/row", { orientation: "vertical" }, undefined, {
        default: [makeNode("core/heading", { text: "r" })],
      })
    );
    expect(out).toContain("flex-direction:column");
    expect(out).toContain("r");
  });
});
