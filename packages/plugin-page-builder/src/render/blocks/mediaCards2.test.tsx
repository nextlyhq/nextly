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

describe("batch 4a — media & card blocks", () => {
  it("registers all new blocks", () => {
    for (const t of [
      "image-carousel",
      "logo-carousel",
      "slides",
      "content-carousel",
      "hotspot",
      "lottie",
      "cta-card",
      "flip-box",
    ]) {
      expect(defaultBlockRegistry.has(`core/${t}`)).toBe(true);
    }
  });

  it("image carousel scroll-snaps its images", () => {
    const out = html(
      makeNode("core/image-carousel", {
        items: [{ image: { url: "/a.jpg" } }, { image: { url: "/b.jpg" } }],
      })
    );
    expect(out).toContain("scroll-snap-type:x mandatory");
    expect(out).toContain('src="/a.jpg"');
  });

  it("hotspot positions markers over an image", () => {
    const out = html(
      makeNode("core/hotspot", {
        image: { url: "/h.jpg" },
        points: [{ x: 25, y: 75, label: "Here" }],
      })
    );
    expect(out).toContain('src="/h.jpg"');
    expect(out).toContain("left:25%");
    expect(out).toContain('title="Here"');
  });

  it("cta card renders heading + button", () => {
    const out = html(
      makeNode("core/cta-card", {
        heading: "Go",
        buttonText: "Start",
        link: { href: "/s" },
      })
    );
    expect(out).toContain("Go");
    expect(out).toContain('href="/s"');
  });

  it("flip box emits a scoped hover-flip style", () => {
    const out = html(
      makeNode("core/flip-box", { frontTitle: "F", backTitle: "B" })
    );
    expect(out).toContain("rotateY(180deg)");
    expect(out).toContain("F");
    expect(out).toContain("B");
  });

  it("lottie requires an https url", () => {
    expect(html(makeNode("core/lottie", { src: "http://x/a.json" }))).toBe("");
    expect(
      html(makeNode("core/lottie", { src: "https://x/a.json" }))
    ).toContain("lottie-player");
  });
});
