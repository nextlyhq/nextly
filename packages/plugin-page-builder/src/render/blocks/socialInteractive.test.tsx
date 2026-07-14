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

describe("batch 4c/4d — social proof + interactive/utility", () => {
  it("registers all remaining blocks", () => {
    for (const t of [
      "testimonial",
      "testimonial-carousel",
      "reviews",
      "logo-cloud",
      "toggle",
      "off-canvas",
      "map",
    ]) {
      expect(defaultBlockRegistry.has(`core/${t}`)).toBe(true);
    }
  });

  it("testimonial renders quote + author", () => {
    const out = html(
      makeNode("core/testimonial", {
        quote: "Great!",
        author: "Sam",
        role: "CEO",
      })
    );
    expect(out).toContain("Great!");
    expect(out).toContain("Sam");
  });

  it("reviews render star icons per item", () => {
    const out = html(
      makeNode("core/reviews", {
        items: [{ author: "A", rating: 4, text: "Nice" }],
      })
    );
    expect(out).toContain("Nice");
    expect((out.match(/<svg/g) ?? []).length).toBe(5);
  });

  it("toggle uses native <details>", () => {
    const out = html(
      makeNode("core/toggle", { title: "Q", content: "A", open: true })
    );
    expect(out).toContain("<details");
    expect(out).toContain("Q");
  });

  it("off-canvas emits the checkbox-hack panel + overlay", () => {
    const out = html(
      makeNode(
        "core/off-canvas",
        { triggerText: "Menu", side: "left" },
        undefined,
        {
          default: [makeNode("core/heading", { text: "Nav" })],
        }
      )
    );
    expect(out).toContain('type="checkbox"');
    expect(out).toContain(":checked");
    expect(out).toContain("Nav");
  });

  it("map builds a validated google-maps embed from a query", () => {
    const out = html(makeNode("core/map", { query: "Paris" }));
    expect(out).toContain("google.com/maps?q=Paris");
    expect(out).toContain("output=embed");
    const explicit = html(
      makeNode("core/map", { src: "https://maps.example.com/x" })
    );
    expect(explicit).toContain('src="https://maps.example.com/x"');
  });
});
