import { describe, it, expect } from "vitest";

import {
  nodeClass,
  compileNodeCss,
  compileDocumentCss,
  compileTokensCss,
  DEFAULT_BREAKPOINTS,
} from "./style-compiler";
import { makeNode } from "./tree";

describe("nodeClass", () => {
  it("is deterministic and prefixed", () => {
    expect(nodeClass("pb-abc")).toBe(nodeClass("pb-abc"));
    expect(nodeClass("pb-abc")).toMatch(/^nx-pb-[a-z0-9]+$/);
    expect(nodeClass("pb-abc")).not.toBe(nodeClass("pb-def"));
  });
});

describe("style compiler", () => {
  it("emits base declarations under the node's class", () => {
    const n = makeNode(
      "core/container",
      {},
      {
        base: { padding: { top: "24px" }, backgroundColor: "#111" },
      }
    );
    const css = compileNodeCss(n);
    expect(css).toContain(`.${nodeClass(n.id)}`);
    expect(css).toContain("padding-top: 24px");
    expect(css).toContain("background-color: #111");
  });

  it("compiles a token palette into CSS custom properties on the root", () => {
    const css = compileTokensCss("nx-pb-page", { "color.primary": "#7c3aed" });
    expect(css).toContain(".nx-pb-page");
    expect(css).toContain("--nx-color-primary: #7c3aed");
  });

  it("emits :hover rules + a transition from styleHover", () => {
    const n = makeNode(
      "core/button",
      {},
      { base: { backgroundColor: "#333" } }
    );
    n.styleHover = { base: { backgroundColor: "#4f46e5" } };
    const css = compileNodeCss(n);
    const cls = nodeClass(n.id);
    expect(css).toContain(`.${cls}:hover`);
    expect(css).toContain("background-color: #4f46e5");
    expect(css).toContain("transition:");
  });

  it("resolves design-token references to CSS vars", () => {
    const n = makeNode(
      "core/heading",
      {},
      {
        base: { color: { token: "color.primary" } },
      }
    );
    expect(compileNodeCss(n)).toContain("color: var(--nx-color-primary)");
  });

  it("wraps tablet/mobile overrides in max-width media queries (desktop-first)", () => {
    const n = makeNode(
      "core/container",
      {},
      { mobile: { padding: { top: "8px" } } }
    );
    const css = compileNodeCss(n);
    const mobile = DEFAULT_BREAKPOINTS.find(b => b.id === "mobile")!;
    expect(css).toContain(`@media (max-width: ${mobile.maxWidth}px)`);
    expect(css).toContain("padding-top: 8px");
  });

  it("drops a style value that tries to break out of the declaration block", () => {
    const n = makeNode(
      "core/container",
      {},
      {
        base: { color: "red } body { display:none", backgroundColor: "#fff" },
      }
    );
    const css = compileNodeCss(n);
    expect(css).not.toContain("display:none");
    expect(css).toContain("background-color: #fff"); // safe value still emitted
  });

  it("emits a background-image url() safely and rejects javascript: urls", () => {
    const ok = compileNodeCss(
      makeNode("core/container", {}, { base: { backgroundImage: "/a.jpg" } })
    );
    expect(ok).toContain('background-image: url("/a.jpg")');
    const bad = compileNodeCss(
      makeNode(
        "core/container",
        {},
        { base: { backgroundImage: "javascript:alert(1)" } }
      )
    );
    expect(bad).not.toContain("javascript:");
  });

  it("compileDocumentCss includes rules for every node", () => {
    const doc = {
      version: 1 as const,
      root: makeNode(
        "core/container",
        {},
        { base: { color: "#fff" } },
        {
          default: [
            makeNode("core/paragraph", {}, { base: { color: "#000" } }),
          ],
        }
      ),
    };
    const css = compileDocumentCss(doc);
    expect(css).toContain("#fff");
    expect(css).toContain("#000");
  });
});

describe("compileNodeCss — extended scalars", () => {
  it("emits extended typography + dimensions", () => {
    const n = makeNode(
      "core/heading",
      {},
      {
        base: {
          fontWeight: "700",
          letterSpacing: "0.05em",
          textTransform: "uppercase",
          minHeight: "200px",
          objectFit: "cover",
          overflow: "hidden",
          opacity: "0.5",
        },
      }
    );
    const css = compileNodeCss(n);
    expect(css).toContain("font-weight: 700");
    expect(css).toContain("letter-spacing: 0.05em");
    expect(css).toContain("text-transform: uppercase");
    expect(css).toContain("min-height: 200px");
    expect(css).toContain("object-fit: cover");
    expect(css).toContain("overflow: hidden");
    expect(css).toContain("opacity: 0.5");
  });

  it("drops values that fail css-tree validation", () => {
    const n = makeNode(
      "core/heading",
      {},
      { base: { fontWeight: "700; color:red" } }
    );
    expect(compileNodeCss(n)).not.toContain("color:red");
  });
});

describe("compileNodeCss — structured values", () => {
  it("emits per-side border + style + color", () => {
    const css = compileNodeCss(
      makeNode(
        "core/container",
        {},
        {
          base: {
            border: {
              width: { top: "2px", bottom: "2px" },
              style: "solid",
              color: "#333",
            },
          },
        }
      )
    );
    expect(css).toContain("border-top-width: 2px");
    expect(css).toContain("border-bottom-width: 2px");
    expect(css).toContain("border-style: solid");
    expect(css).toContain("border-color: #333");
  });

  it("emits position with offsets and z-index", () => {
    const css = compileNodeCss(
      makeNode(
        "core/container",
        {},
        {
          base: {
            position: { type: "absolute", top: "10px", left: "0", zIndex: "5" },
          },
        }
      )
    );
    expect(css).toContain("position: absolute");
    expect(css).toContain("top: 10px");
    expect(css).toContain("left: 0");
    expect(css).toContain("z-index: 5");
  });

  it("emits background image object + gradient", () => {
    const css = compileNodeCss(
      makeNode(
        "core/container",
        {},
        {
          base: {
            backgroundImageObj: {
              url: "/x.jpg",
              position: "center",
              size: "cover",
              repeat: "no-repeat",
            },
            backgroundGradient: "linear-gradient(90deg, #fff, #000)",
          },
        }
      )
    );
    expect(css).toContain('background-image: url("/x.jpg")');
    expect(css).toContain("background-position: center");
    expect(css).toContain("background-size: cover");
    expect(css).toContain("background-repeat: no-repeat");
    expect(css).toMatch(/background-image: linear-gradient/);
  });

  it("rejects a javascript: url in the background object", () => {
    const css = compileNodeCss(
      makeNode(
        "core/container",
        {},
        { base: { backgroundImageObj: { url: "javascript:alert(1)" } } }
      )
    );
    expect(css).not.toContain("javascript");
  });
});
