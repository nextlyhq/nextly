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

  it("registers list, icon-list, button-group, columns", () => {
    for (const t of ["list", "icon-list", "button-group", "columns"]) {
      expect(defaultBlockRegistry.has(`core/${t}`)).toBe(true);
    }
  });

  it("list renders ol/ul items", () => {
    const ul = html(
      makeNode("core/list", { ordered: false, items: [{ text: "a" }] })
    );
    expect(ul).toContain("<ul");
    expect(ul).toContain("<li>a</li>");
    const ol = html(
      makeNode("core/list", { ordered: true, items: [{ text: "b" }] })
    );
    expect(ol).toContain("<ol");
  });

  it("icon-list renders an icon + text per item and links when present", () => {
    const out = html(
      makeNode("core/icon-list", {
        items: [{ icon: "Check", text: "done", link: { href: "/x" } }],
      })
    );
    expect(out).toContain("<svg");
    expect(out).toContain("done");
    expect(out).toContain('href="/x"');
  });

  it("button-group renders each button, anchor when linked", () => {
    const out = html(
      makeNode("core/button-group", {
        buttons: [
          { text: "Go", link: { href: "/go" } },
          { text: "Plain", link: {} },
        ],
      })
    );
    expect(out).toContain('href="/go"');
    expect(out).toContain("Go");
    expect(out).toContain("<button");
    expect(out).toContain("Plain");
  });

  it("columns wraps each child in a flex column", () => {
    const node = makeNode("core/columns", {}, undefined, {
      default: [makeNode("core/heading", { text: "col-a" })],
    });
    const out = html(node);
    expect(out).toContain("col-a");
    expect(out).toContain("display:flex");
  });

  it("heading wraps text in an anchor when a link is set", () => {
    const out = html(
      makeNode("core/heading", { text: "Titled", link: { href: "/h" } })
    );
    expect(out).toContain('href="/h"');
    expect(out).toContain("Titled");
  });

  it("button renders an icon when configured", () => {
    const out = html(
      makeNode("core/button", { text: "Next", icon: "ArrowRight" })
    );
    expect(out).toContain("<svg");
    expect(out).toContain("Next");
  });
});
