import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { defaultBlockRegistry } from "../core/registry";
import { makeNode } from "../core/tree";
import type { BlockNode } from "../core/types";

import { RenderNode } from "./RenderNode";
import "./blocks";

const html = (node: BlockNode) =>
  renderToStaticMarkup(
    <RenderNode node={node} registry={defaultBlockRegistry} />
  );

/**
 * Accessibility render guarantees (spec §15) — enforced at the output level so a
 * regression in a block can't silently ship inaccessible markup.
 */
describe("accessibility render guarantees", () => {
  it("Button with no link renders <button> (never href='#')", () => {
    const out = html(makeNode("core/button", { text: "Go", link: {} }));
    expect(out).toContain("<button");
    expect(out).not.toContain("<a ");
    expect(out).not.toContain('href="#"');
  });

  it("Button with a _blank link is safe (rel=noopener noreferrer)", () => {
    const out = html(
      makeNode("core/button", {
        text: "Go",
        link: { href: "https://x.test", target: "_blank" },
      })
    );
    expect(out).toContain('href="https://x.test"');
    expect(out).toContain("noopener noreferrer");
  });

  it("Heading renders the chosen semantic tag, clamped to a valid level", () => {
    expect(
      html(makeNode("core/heading", { text: "A", level: "h1" }))
    ).toContain("<h1");
    // an invalid level falls back to a valid heading, never a <div>
    const bad = html(makeNode("core/heading", { text: "A", level: "h9" }));
    expect(bad).toMatch(/<h[1-6]/);
  });

  it("Image always emits an alt attribute (empty when unset)", () => {
    const out = html(makeNode("core/image", { url: "/a.jpg" }));
    expect(out).toContain("alt=");
  });

  it("Container renders a <section> landmark", () => {
    const out = html(
      makeNode("core/container", {}, undefined, {
        default: [makeNode("core/paragraph", { text: "x" })],
      })
    );
    expect(out).toContain("<section");
  });
});
