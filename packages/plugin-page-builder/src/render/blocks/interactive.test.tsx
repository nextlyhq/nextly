import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { sanitizeEmbedHtml } from "../../core/embed-sanitize";
import { defaultBlockRegistry } from "../../core/registry";
import { makeNode } from "../../core/tree";
import type { BlockNode } from "../../core/types";
import { RenderNode } from "../RenderNode";

import "./index";

const html = (node: BlockNode) =>
  renderToStaticMarkup(
    <RenderNode node={node} registry={defaultBlockRegistry} />
  );

describe("interactive & utility blocks", () => {
  it("registers tabs, accordion, table, social-icons, embed", () => {
    for (const t of ["tabs", "accordion", "table", "social-icons", "embed"]) {
      expect(defaultBlockRegistry.has(`core/${t}`)).toBe(true);
    }
  });

  it("accordion renders native <details> with titles", () => {
    const out = html(
      makeNode("core/accordion", {
        items: [{ title: "FAQ", content: "Answer" }],
      })
    );
    expect(out).toContain("<details");
    expect(out).toContain("FAQ");
    expect(out).toContain("Answer");
  });

  it("tabs renders labels, panels and a scoped style", () => {
    const out = html(
      makeNode("core/tabs", {
        items: [
          { title: "A", content: "alpha" },
          { title: "B", content: "beta" },
        ],
      })
    );
    expect(out).toContain("A");
    expect(out).toContain("alpha");
    expect(out).toContain('type="radio"');
    expect(out).toContain(":checked");
  });

  it("table renders headers and pipe-separated cells", () => {
    const out = html(
      makeNode("core/table", {
        headers: "X, Y",
        rows: [{ cells: "1 | 2" }],
      })
    );
    expect(out).toContain("<th");
    expect(out).toContain("<td");
    expect(out).toContain("1");
    expect(out).toContain("2");
  });

  it("social icons render icon links with rel/target", () => {
    const out = html(
      makeNode("core/social-icons", {
        items: [{ network: "Github", url: "https://github.com/x" }],
      })
    );
    expect(out).toContain('href="https://github.com/x"');
    expect(out).toContain('rel="noopener noreferrer"');
    expect(out).toContain("<svg");
  });

  it("embed url mode renders a validated https iframe", () => {
    const ok = html(
      makeNode("core/embed", { mode: "url", url: "https://example.com/x" })
    );
    expect(ok).toContain("<iframe");
    expect(ok).toContain('src="https://example.com/x"');
    const bad = html(
      makeNode("core/embed", { mode: "url", url: "http://insecure.com" })
    );
    expect(bad).toBe("");
  });
});

describe("sanitizeEmbedHtml", () => {
  it("strips scripts, handlers and dangerous schemes", () => {
    const out = sanitizeEmbedHtml(
      '<p onclick="x()">hi</p><script>alert(1)</script><a href="javascript:bad()">l</a>'
    );
    expect(out).not.toContain("<script");
    expect(out).not.toContain("onclick");
    expect(out).not.toContain("javascript:");
    expect(out).toContain("hi");
  });

  it("blocks encoded/whitespace-obfuscated dangerous schemes", () => {
    // Char references and inserted whitespace decode to `javascript:` in the
    // browser after a raw-text matcher has passed them — the sanitizer must
    // decode before validating the scheme.
    const cases = [
      '<a href="java&#x73;cript:alert(1)">x</a>',
      '<a href="java&#115;cript:alert(1)">x</a>',
      "<p>abc<iframe//src=jAva&Tab;script:alert(3)>def</iframe></p>",
    ];
    for (const dirty of cases) {
      const out = sanitizeEmbedHtml(dirty).toLowerCase();
      expect(out).not.toContain("javascript:");
      expect(out).not.toMatch(/on\w+=/);
    }
  });

  it("forbids iframe srcdoc while allowing a plain iframe", () => {
    const out = sanitizeEmbedHtml(
      '<iframe src="https://example.com" srcdoc="<script>alert(1)</script>"></iframe>'
    );
    expect(out).not.toContain("srcdoc");
    expect(out).not.toContain("<script");
    expect(out).toContain("<iframe");
  });
});
