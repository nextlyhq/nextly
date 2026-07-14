import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { defaultBlockRegistry } from "../../core/registry";
import { makeNode } from "../../core/tree";
import type { BlockNode } from "../../core/types";
import { RenderNode } from "../RenderNode";

import { renderMarkdown } from "./markdown";
import "./index";

const html = (node: BlockNode) =>
  renderToStaticMarkup(
    <RenderNode node={node} registry={defaultBlockRegistry} />
  );

describe("rich text / markdown", () => {
  it("registers core/rich-text", () => {
    expect(defaultBlockRegistry.has("core/rich-text")).toBe(true);
  });

  it("renders headings, bold, italic, code and safe links", () => {
    const md = "# Title\n\n**b** *i* `c` [x](https://ok.com)";
    const out = renderToStaticMarkup(<div>{renderMarkdown(md)}</div>);
    expect(out).toContain("<h1>Title</h1>");
    expect(out).toContain("<strong>b</strong>");
    expect(out).toContain("<em>i</em>");
    expect(out).toContain("<code>c</code>");
    expect(out).toContain('href="https://ok.com"');
  });

  it("renders unordered and ordered lists", () => {
    const ulOut = renderToStaticMarkup(<div>{renderMarkdown("- a\n- b")}</div>);
    expect(ulOut).toContain("<ul><li>a</li><li>b</li></ul>");
    const olOut = renderToStaticMarkup(
      <div>{renderMarkdown("1. one\n2. two")}</div>
    );
    expect(olOut).toContain("<ol><li>one</li><li>two</li></ol>");
  });

  it("drops a javascript: link, keeping the text", () => {
    const out = renderToStaticMarkup(
      <div>{renderMarkdown("[click](javascript:alert(1))")}</div>
    );
    expect(out).not.toContain("javascript:");
    expect(out).toContain("click");
  });

  it("never emits raw HTML from the source", () => {
    const out = html(
      makeNode("core/rich-text", { markdown: "<script>alert(1)</script> hi" })
    );
    expect(out).not.toContain("<script>");
    expect(out).toContain("hi");
  });
});
