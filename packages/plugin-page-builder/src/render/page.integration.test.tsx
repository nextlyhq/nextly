import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { defaultBlockRegistry } from "../core/registry";
import { makeNode } from "../core/tree";
import { validateDocument } from "../core/validate";
import type { BlockDocument } from "../core/types";
import { PageRenderer } from "./PageRenderer";
import "./blocks"; // register the 7 core blocks

/**
 * "Seeded page" proof (M3.3, deterministic): a realistic tree that nests every MVP
 * block validates and renders end-to-end through the real PageRenderer + real blocks,
 * with scoped CSS and correct semantics. This is the render half of the spike; the
 * live DB round-trip is exercised in the Playground.
 */
function seededPage(): BlockDocument {
  return {
    version: 1,
    root: makeNode(
      "core/container",
      {},
      { base: { padding: { top: "24px" } } },
      {
        default: [
          makeNode(
            "core/heading",
            { text: "Welcome", level: "h1" },
            {
              base: { color: "#111", fontSize: "40px" },
              mobile: { fontSize: "28px" },
            }
          ),
          makeNode("core/paragraph", { text: "Built with the page builder." }),
          makeNode(
            "core/grid",
            { columns: 2 },
            {
              base: {
                display: "grid",
                gridTemplateColumns: "repeat(2, 1fr)",
                gap: "16px",
              },
            },
            {
              default: [
                makeNode("core/image", {
                  url: "/hero.jpg",
                  alt: "Hero",
                  width: 800,
                  height: 600,
                }),
                makeNode("core/button", {
                  text: "Get started",
                  link: { href: "/signup" },
                }),
              ],
            }
          ),
          makeNode("core/video", {
            provider: "youtube",
            videoId: "dQw4w9WgXcQ",
          }),
        ],
      }
    ),
  };
}

describe("seeded page (all 7 blocks)", () => {
  it("passes structural validation", () => {
    expect(validateDocument(seededPage(), defaultBlockRegistry)).toBe(true);
  });

  it("renders every block with scoped CSS and correct semantics", () => {
    const html = renderToStaticMarkup(
      <PageRenderer document={seededPage()} registry={defaultBlockRegistry} />
    );
    expect(html).toContain("nx-pb-page");
    expect(html).toContain("<style");
    expect(html).toContain("<h1"); // heading level
    expect(html).toContain("Welcome");
    expect(html).toContain("Built with the page builder.");
    expect(html).toContain("@media (max-width: 640px)"); // responsive override
    expect(html).toContain('src="/hero.jpg"');
    expect(html).toContain('href="/signup"');
    expect(html).toContain("youtube-nocookie.com/embed/dQw4w9WgXcQ");
    expect(html).toContain("grid-template-columns: repeat(2, 1fr)");
  });
});
