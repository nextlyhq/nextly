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

describe("media & card blocks", () => {
  it("registers cover, icon-box, image-box, gallery", () => {
    for (const t of ["cover", "icon-box", "image-box", "gallery"]) {
      expect(defaultBlockRegistry.has(`core/${t}`)).toBe(true);
    }
  });

  it("cover renders background image + overlay + slot content", () => {
    const node = makeNode(
      "core/cover",
      {
        image: { url: "/bg.jpg" },
        overlayColor: "#123456",
        overlayOpacity: 0.5,
      },
      undefined,
      { default: [makeNode("core/heading", { text: "Hero" })] }
    );
    const out = html(node);
    expect(out).toContain("url(&quot;/bg.jpg&quot;)");
    expect(out).toContain("Hero");
  });

  it("icon-box renders icon, title, description", () => {
    const out = html(
      makeNode("core/icon-box", {
        icon: "Rocket",
        title: "Fast",
        description: "Blazing",
      })
    );
    expect(out).toContain("<svg");
    expect(out).toContain("Fast");
    expect(out).toContain("Blazing");
  });

  it("image-box renders image + title", () => {
    const out = html(
      makeNode("core/image-box", {
        image: { url: "/p.jpg" },
        title: "Card",
      })
    );
    expect(out).toContain('src="/p.jpg"');
    expect(out).toContain("Card");
  });

  it("gallery renders a grid of images", () => {
    const out = html(
      makeNode("core/gallery", {
        columns: 2,
        items: [{ image: { url: "/a.jpg" } }, { image: { url: "/b.jpg" } }],
      })
    );
    expect(out).toContain('src="/a.jpg"');
    expect(out).toContain('src="/b.jpg"');
    expect(out).toContain("repeat(2, minmax(0, 1fr))");
  });

  it("image renders a caption in a figure and a link wrapper", () => {
    const withCaption = html(
      makeNode("core/image", { media: { url: "/x.jpg" }, caption: "A photo" })
    );
    expect(withCaption).toContain("<figure");
    expect(withCaption).toContain("A photo");
    const withLink = html(
      makeNode("core/image", {
        media: { url: "/x.jpg" },
        link: { href: "/go" },
      })
    );
    expect(withLink).toContain('href="/go"');
  });

  it("video self-hosted renders a <video> with controls", () => {
    const out = html(
      makeNode("core/video", {
        provider: "self",
        src: "/clip.mp4",
        controls: true,
      })
    );
    expect(out).toContain("<video");
    expect(out).toContain('src="/clip.mp4"');
  });

  it("video youtube uses the privacy-friendly nocookie host with options", () => {
    const out = html(
      makeNode("core/video", {
        provider: "youtube",
        videoId: "abc",
        autoplay: true,
      })
    );
    expect(out).toContain("youtube-nocookie.com/embed/abc");
    expect(out).toContain("autoplay=1");
  });
});
