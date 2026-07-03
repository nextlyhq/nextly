import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { defaultBlockRegistry } from "../core/registry";
import { makeNode } from "../core/tree";

import { RenderNode } from "./RenderNode";
import "./blocks";

describe("RenderNode bindings", () => {
  it("resolves a bound prop from the threaded loop item at depth", () => {
    const heading = makeNode("core/heading", { text: "fallback", level: "h2" });
    heading.bindings = { text: { source: "field", path: "title" } };
    const container = makeNode("core/container", {}, undefined, {
      default: [heading],
    });
    const html = renderToStaticMarkup(
      <RenderNode
        node={container}
        registry={defaultBlockRegistry}
        item={{ title: "From Item" }}
      />
    );
    expect(html).toContain("From Item");
    expect(html).not.toContain("fallback");
  });

  it("uses literal props when no item is threaded", () => {
    const heading = makeNode("core/heading", { text: "Static", level: "h2" });
    heading.bindings = { text: { source: "field", path: "title" } };
    const html = renderToStaticMarkup(
      <RenderNode node={heading} registry={defaultBlockRegistry} />
    );
    expect(html).toContain("Static");
  });
});
