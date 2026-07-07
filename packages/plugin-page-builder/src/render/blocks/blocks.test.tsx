import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { defaultBlockRegistry } from "../../core/registry";
import { makeNode } from "../../core/tree";
import type { BlockNode } from "../../core/types";
import { RenderNode } from "../RenderNode";
import "./index"; // side-effect: registers the 7 core blocks

const html = (node: BlockNode) =>
  renderToStaticMarkup(
    <RenderNode node={node} registry={defaultBlockRegistry} />
  );

describe("core block renderers", () => {
  it("registers all 8 core blocks", () => {
    for (const t of [
      "paragraph",
      "heading",
      "image",
      "button",
      "video",
      "container",
      "grid",
      "query-loop",
    ]) {
      expect(defaultBlockRegistry.has(`core/${t}`)).toBe(true);
    }
  });

  it("heading renders the chosen semantic level", () => {
    expect(
      html(makeNode("core/heading", { text: "Hi", level: "h3" }))
    ).toContain("<h3");
  });

  it("paragraph escapes text", () => {
    expect(html(makeNode("core/paragraph", { text: "<b>x</b>" }))).toContain(
      "&lt;b&gt;"
    );
  });

  it("image renders src + alt and rejects javascript: urls", () => {
    const ok = html(makeNode("core/image", { url: "/a.jpg", alt: "A" }));
    expect(ok).toContain('src="/a.jpg"');
    expect(ok).toContain('alt="A"');
    expect(
      html(makeNode("core/image", { url: "javascript:alert(1)" }))
    ).not.toContain("javascript:");
  });

  it("button renders a safe anchor, or a <button> when no href", () => {
    expect(
      html(makeNode("core/button", { text: "Go", link: { href: "/x" } }))
    ).toContain('href="/x"');
    const noHref = html(makeNode("core/button", { text: "No link", link: {} }));
    expect(noHref).toContain("<button");
    expect(noHref).not.toContain('href="#"');
  });

  it("video renders a youtube iframe with a safe embed url", () => {
    const out = html(
      makeNode("core/video", { provider: "youtube", videoId: "abc" })
    );
    expect(out).toContain("youtube.com/embed/abc");
    expect(out).toContain("<iframe");
  });

  it("container + grid render their slot children", () => {
    const grid = makeNode("core/grid", { columns: 2 }, undefined, {
      default: [makeNode("core/paragraph", { text: "cell" })],
    });
    expect(html(grid)).toContain("cell");
    const container = makeNode("core/container", {}, undefined, {
      default: [makeNode("core/heading", { text: "inside" })],
    });
    expect(html(container)).toContain("inside");
  });

  it("container renders its chosen semantic tag, defaulting to <section>", () => {
    const def = makeNode("core/container", {}, undefined, { default: [] });
    expect(html(def)).toContain("<section");
    const asArticle = makeNode("core/container", { as: "article" }, undefined, {
      default: [],
    });
    expect(html(asArticle)).toContain("<article");
  });

  it("grid applies an inline column template from the columns prop", () => {
    const out = html(
      makeNode("core/grid", { columns: 3 }, undefined, { default: [] })
    );
    expect(out).toContain("repeat(3, minmax(0, 1fr))");
  });

  it("image renders the editor media object (url + alt) when present", () => {
    const out = html(
      makeNode("core/image", { media: { url: "/x.jpg", alt: "X" } })
    );
    expect(out).toContain('src="/x.jpg"');
    expect(out).toContain('alt="X"');
  });

  it("image renders a bound media value that is a plain URL string", () => {
    // Simulates a Query Loop binding resolving `media` to a string URL.
    const out = html(makeNode("core/image", { media: "/bound.jpg" }));
    expect(out).toContain('src="/bound.jpg"');
  });

  it("every block exposes inspector metadata (content and/or style controls)", () => {
    for (const def of defaultBlockRegistry.all()) {
      const hasContent = (def.contentFields?.length ?? 0) > 0;
      const hasStyle = (def.styleControls?.length ?? 0) > 0;
      expect(hasContent || hasStyle).toBe(true);
    }
  });
});
