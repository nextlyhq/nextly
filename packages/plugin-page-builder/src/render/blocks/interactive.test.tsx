import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { sanitizeEmbedHtml } from "../../core/embed-sanitize";
import { defaultBlockRegistry } from "../../core/registry";
import type { RemotePattern } from "../../core/url-policy";
import { makeNode } from "../../core/tree";
import type { BlockNode } from "../../core/types";
import { RenderNode } from "../RenderNode";

import "./index";

const html = (node: BlockNode, remotePatterns?: RemotePattern[]) =>
  renderToStaticMarkup(
    <RenderNode
      node={node}
      registry={defaultBlockRegistry}
      remotePatterns={remotePatterns}
    />
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

  it("embeds an https iframe only from a declared host", () => {
    // The iframe is lazy, so whether it loads depends on where it renders and
    // CSS decides that. https says the transport is encrypted and nothing about
    // where the request goes, so the host is declared like any other media.
    const node = makeNode("core/embed", {
      mode: "url",
      url: "https://example.com/x",
    });
    expect(html(node)).toBe("");
    const ok = html(node, [{ protocol: "https", hostname: "example.com" }]);
    expect(ok).toContain("<iframe");
    expect(ok).toContain('src="https://example.com/x"');
    const bad = html(
      makeNode("core/embed", { mode: "url", url: "http://insecure.com" }),
      [{ hostname: "insecure.com" }]
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

  it("holds every fetching attribute to the origin allowlist", () => {
    // Scheme safety is not the whole question. A sanitized fragment can still
    // name any host, and each of these fetches WITHOUT a user action — the
    // lazy iframe only when something renders it, which CSS in the same page
    // decides. That is the conditional request the origin policy exists to
    // stop, so the raw-HTML branch cannot be the one place it is not applied.
    for (const dirty of [
      '<iframe loading="lazy" src="https://evil.example/a"></iframe>',
      '<img src="https://evil.example/a.png">',
      '<img srcset="https://evil.example/a.png 1x, /ok.png 2x">',
      '<video poster="https://evil.example/p.jpg"></video>',
      '<div style="background:url(https://evil.example/a.png)">x</div>',
    ]) {
      expect(sanitizeEmbedHtml(dirty), dirty).not.toContain("evil.example");
    }
  });

  it("keeps a declared host, so the restriction is not just a removed feature", () => {
    const patterns = [
      { protocol: "https" as const, hostname: "player.example" },
    ];
    const out = sanitizeEmbedHtml(
      '<iframe loading="lazy" src="https://player.example/v/1"></iframe>',
      patterns
    );
    expect(out).toContain("https://player.example/v/1");

    // An undeclared host is still refused with the same patterns in hand, so
    // the allowlist is being consulted rather than merely being non-empty.
    expect(
      sanitizeEmbedHtml(
        '<iframe src="https://evil.example/a"></iframe>',
        patterns
      )
    ).not.toContain("evil.example");
  });

  it("keeps same-origin references, which need no pattern", () => {
    const out = sanitizeEmbedHtml(
      '<img src="/media/a.png"><div style="background:url(/media/b.png)">x</div>'
    );
    expect(out).toContain("/media/a.png");
    expect(out).toContain("/media/b.png");
  });

  it("removes the attribute rather than the element around it", () => {
    // The author's surrounding markup is theirs; only the request is refused.
    const out = sanitizeEmbedHtml(
      '<figure><img src="https://evil.example/a.png"><figcaption>Caption</figcaption></figure>'
    );
    expect(out).toContain("<figure>");
    expect(out).toContain("Caption");
    expect(out).not.toContain("evil.example");
  });

  it("gates an SVG resource href, which fetches without a click", () => {
    // `href` is navigation in HTML and a RESOURCE reference in SVG: the browser
    // resolves `<feImage href>` on its own whenever the filter is applied, and
    // `filter: url(#p)` in the page's CSS decides whether it is. Both spellings,
    // since SVG 1.1 content still uses the namespaced one.
    for (const dirty of [
      '<svg><filter id="p"><feImage href="https://evil.example/a"/></filter></svg>',
      '<svg><filter id="p"><feImage xlink:href="https://evil.example/a"/></filter></svg>',
      '<svg><image href="https://evil.example/a.png"/></svg>',
      '<svg><use href="https://evil.example/s.svg#i"/></svg>',
    ]) {
      expect(sanitizeEmbedHtml(dirty), dirty).not.toContain("evil.example");
    }
  });

  it("leaves an ordinary link alone, in HTML and in SVG", () => {
    // A link is followed by a person, so where it points is the author's
    // business and no request happens without an action. Gating it would be a
    // restriction with nothing to show for it.
    expect(
      sanitizeEmbedHtml('<a href="https://example.com/x">go</a>')
    ).toContain("https://example.com/x");
    expect(
      sanitizeEmbedHtml(
        '<svg><a href="https://example.com/x"><text>go</text></a></svg>'
      )
    ).toContain("https://example.com/x");
  });

  it("refuses a URL smuggled through a custom property", () => {
    // Declarations are checked one at a time, so `--u` reads as a bare string
    // and the declaration consuming it holds only `var(--u)`. Neither sees a
    // URL; the pair fetches one. A custom property is therefore judged as
    // though its value could land in any position.
    const dirty =
      "<div style='--u:\"https://evil.example/a\";background-image:image-set(var(--u) 1x)'>x</div>";
    expect(sanitizeEmbedHtml(dirty)).not.toContain("evil.example");
  });

  it("keeps a custom property that names an allowed origin", () => {
    const out = sanitizeEmbedHtml(
      "<div style='--u:\"https://player.example/a.png\";background-image:image-set(var(--u) 1x)'>x</div>",
      [{ protocol: "https", hostname: "player.example" }]
    );
    expect(out).toContain("player.example");
  });

  it("does not leave its hook registered for the next call", () => {
    // DOMPurify keeps hooks on a shared instance, so one left behind would
    // judge later fragments against whichever patterns this call was holding.
    sanitizeEmbedHtml('<img src="https://player.example/a.png">', [
      { protocol: "https", hostname: "player.example" },
    ]);
    expect(
      sanitizeEmbedHtml('<img src="https://player.example/a.png">')
    ).not.toContain("player.example");
  });
});
