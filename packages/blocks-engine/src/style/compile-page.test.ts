import { describe, expect, it } from "vitest";

import type { BlockDocument, BlockNode } from "../document";
import { validate } from "../validation";
import { FIXTURE_BREAKPOINTS } from "../validation.fixtures";

import { compilePageCss } from "./compile-page";
import type { StyleCompileContext } from "./compile-page";
import { nodeClassName, nodeClassNames } from "./node-class";
import {
  MAX_STYLE_ISSUES,
  MAX_STYLE_ISSUE_PATH_BYTES,
} from "./validate-style-value";

const CTX: StyleCompileContext = { breakpoints: FIXTURE_BREAKPOINTS };

function doc(nodes: BlockNode[], settings?: BlockDocument["settings"]) {
  return {
    formatVersion: 1,
    kind: "page",
    nodes,
    ...(settings === undefined ? {} : { settings }),
  } as BlockDocument;
}

function node(id: string, styles?: unknown, extra?: object): BlockNode {
  return {
    id,
    type: "core/box",
    version: 1,
    props: {},
    ...(styles === undefined ? {} : { styles }),
    ...extra,
  } as BlockNode;
}

/** Compile and return the CSS alone, for the cases that assert on output. */
function css(document: BlockDocument, ctx: StyleCompileContext = CTX): string {
  return compilePageCss(document, ctx).css;
}

describe("a node's own styles", () => {
  it("writes one anchored rule at the node's class", () => {
    const out = css(doc([node("n1", { base: { base: { color: "#fff" } } })]));
    expect(out).toBe(`.nx-pb-page .${nodeClassName("n1")} { color: #fff }`);
  });

  it("writes logical properties as the catalog stores them", () => {
    // The document says "space before the text-start edge", and so does the
    // CSS, which is what makes one stored value correct in both directions.
    const out = css(
      doc([
        node("n1", {
          base: {
            base: { padding: { inlineStart: "2rem", blockEnd: "1rem" } },
          },
        }),
      ])
    );
    expect(out).toContain("padding-inline-start: 2rem");
    expect(out).toContain("padding-block-end: 1rem");
    expect(out).not.toContain("padding-left");
  });

  it("keeps direction-relative values relative", () => {
    // One stored value has to be right in both directions, because the same
    // document serves an English page and an Arabic one. `start` is the whole
    // mechanism: written out as `left` here, a translated page would come back
    // with its text on the wrong edge and the only fix would be a second copy
    // of the styles per locale.
    const out = css(
      doc([node("n1", { base: { base: { textAlign: "start" } } })])
    );
    expect(out).toContain("text-align: start");
    expect(out).not.toContain("left");
  });

  it("sorts declarations so key order cannot change the bytes", () => {
    const written = css(
      doc([node("n1", { base: { base: { color: "#fff", display: "block" } } })])
    );
    const reversed = css(
      doc([node("n1", { base: { base: { display: "block", color: "#fff" } } })])
    );
    expect(written).toBe(reversed);
    expect(written).toContain("color: #fff; display: block");
  });
});

describe("design tokens", () => {
  it("compiles a reference to the custom property it reads", () => {
    const out = css(
      doc([
        node("n1", { base: { base: { color: { $token: "color.primary" } } } }),
      ])
    );
    expect(out).toContain("color: var(--site-color-primary)");
  });

  it("honours a site's configured prefix", () => {
    const out = css(
      doc([
        node("n1", { base: { base: { color: { $token: "color.primary" } } } }),
      ]),
      { ...CTX, tokenPrefix: "--acme-" }
    );
    expect(out).toContain("color: var(--acme-color-primary)");
  });

  it("refuses a name that could close the function it sits in", () => {
    // A token name reaches the stylesheet unquoted, so a name carrying a
    // bracket would end the `var()` and start a declaration of its own. This is
    // the one path where document data could otherwise write arbitrary CSS.
    const result = compilePageCss(
      doc([
        node("n1", {
          base: { base: { color: { $token: "x); color: red; --y:(" } } },
        }),
      ]),
      CTX
    );
    expect(result.css).toBe("");
    expect(result.warnings.map(w => w.path)).toContain(
      "/nodes/0/styles/base/base/color"
    );
  });
});

describe("urls", () => {
  it("wraps a stored path in url(), because a path is not a CSS value", () => {
    const out = css(
      doc([node("n1", { base: { base: { background: { url: "/a.png" } } } })])
    );
    expect(out).toContain('background-image: url("/a.png")');
  });

  it("leaves a keyword alone rather than going looking for a file", () => {
    // `none` is how an image set at an earlier state is cleared. Wrapped, it
    // becomes a request for a file called "none".
    const out = css(
      doc([node("n1", { base: { base: { background: { url: "none" } } } })])
    );
    expect(out).toContain("background-image: none");
    expect(out).not.toContain("url(");
  });

  it("escapes what would otherwise end the quoted string", () => {
    const out = css(
      doc([node("n1", { base: { base: { background: { url: '/a".png' } } } })])
    );
    // Either the value is refused outright or it is quoted safely; what must
    // never happen is a bare quote closing the argument early.
    expect(out).not.toContain('url("/a".png")');
  });
});

describe("states", () => {
  it("compiles each stored state to its pseudo-class", () => {
    const out = css(
      doc([
        node("n1", {
          base: { base: { color: "#111" } },
          hover: { base: { color: "#222" } },
          focus: { base: { color: "#333" } },
          active: { base: { color: "#444" } },
        }),
      ])
    );
    const cls = nodeClassName("n1");
    expect(out).toBe(
      [
        `.nx-pb-page .${cls} { color: #111 }`,
        `.nx-pb-page .${cls}:hover { color: #222 }`,
        // Focus styling follows `:focus-visible`, so a mouse click does not
        // paint a ring the author only meant for keyboard users.
        `.nx-pb-page .${cls}:focus-visible { color: #333 }`,
        `.nx-pb-page .${cls}:active { color: #444 }`,
      ].join("\n")
    );
  });
});

describe("breakpoints", () => {
  it("emits viewport widths descending, then container widths", () => {
    const out = css(
      doc([
        node("n1", {
          base: {
            base: { color: "#000" },
            mobile: { color: "#333" },
            tablet: { color: "#222" },
            "card-narrow": { color: "#444" },
          },
        }),
      ])
    );
    const cls = nodeClassName("n1");
    expect(out).toBe(
      [
        `.nx-pb-page .${cls} { color: #000 }`,
        // Desktop-first: the unconditional rule is the widest layout, and each
        // narrower breakpoint has to come later to override it.
        `@media (max-width: 1024px) {`,
        `  .nx-pb-page .${cls} { color: #222 }`,
        `}`,
        `@media (max-width: 640px) {`,
        `  .nx-pb-page .${cls} { color: #333 }`,
        `}`,
        // Container queries last, so an element responding to its own box wins
        // over the same value keyed to the window.
        `@container (max-width: 320px) {`,
        `  .nx-pb-page .${cls} { color: #444 }`,
        `}`,
      ].join("\n")
    );
  });

  it("groups rules that share an at-rule into one block", () => {
    const out = css(
      doc([
        node("a", { base: { tablet: { color: "#111" } } }),
        node("b", { base: { tablet: { color: "#222" } } }),
      ])
    );
    expect(out.match(/@media \(max-width: 1024px\)/g)).toHaveLength(1);
  });
});

describe("cascade tiers", () => {
  it("emits page settings, then block defaults, then node values", () => {
    const out = css(
      doc([node("n1", { base: { base: { color: "#333" } } })], {
        styles: { base: { base: { color: "#111" } } },
      }),
      {
        ...CTX,
        blockBases: { "core/box": { base: { base: { color: "#222" } } } },
      }
    );
    expect(out).toBe(
      [
        `.nx-pb-page { color: #111 }`,
        `.nx-pb-page .nx-bt-core--box { color: #222 }`,
        `.nx-pb-page .${nodeClassName("n1")} { color: #333 }`,
      ].join("\n")
    );
  });

  it("puts a whole tier before the next, so a node beats a wider default", () => {
    // A node's own value outranks its block type's at every width. That only
    // holds if the block tier finishes, media blocks included, before the node
    // tier starts: everything sits at one specificity and order decides.
    const out = css(
      doc([node("n1", { base: { base: { color: "#0f0" } } })], undefined),
      {
        ...CTX,
        blockBases: {
          "core/box": {
            base: { base: { color: "#aaa" }, tablet: { color: "#bbb" } },
          },
        },
      }
    );
    const nodeRule = out.indexOf(nodeClassName("n1"));
    const baseMedia = out.indexOf("@media");
    expect(baseMedia).toBeGreaterThan(-1);
    expect(nodeRule).toBeGreaterThan(baseMedia);
  });

  it("writes one rule per block type, not one per node using it", () => {
    const out = css(doc([node("a"), node("b"), node("c")]), {
      ...CTX,
      blockBases: { "core/box": { base: { base: { color: "#111" } } } },
    });
    expect(out.match(/nx-bt-core--box/g)).toHaveLength(1);
  });
});

describe("properties that style something inside the block", () => {
  it("gives a link colour its own rule rather than the node's", () => {
    const out = css(
      doc([
        node("n1", {
          base: { base: { color: "#111", linkColor: "#00f" } },
        }),
      ])
    );
    const cls = nodeClassName("n1");
    expect(out).toBe(
      [
        `.nx-pb-page .${cls} { color: #111 }`,
        `.nx-pb-page .${cls} a { color: #00f }`,
      ].join("\n")
    );
  });
});

describe("visibility", () => {
  it("hides a node at the breakpoints it is marked hidden for", () => {
    const out = css(
      doc([
        node("n1", undefined, { visibility: { devices: { mobile: false } } }),
      ])
    );
    expect(out).toBe(
      [
        `@media (max-width: 640px) {`,
        // The class is doubled so hiding outranks a `display` stored on a
        // state; a plain rule loses to `:focus-visible` however late it comes.
        `  .nx-pb-page .${nodeClassName("n1")}.${nodeClassName("n1")} { display: none }`,
        `}`,
      ].join("\n")
    );
  });
});

describe("visibility", () => {
  it("keeps a node hidden at every width below the one that hid it", () => {
    const out = css(
      doc([
        node("n1", undefined, { visibility: { devices: { tablet: false } } }),
      ])
    );
    // No lower bound: hiding inherits downward like every other value in a
    // desktop-first model.
    expect(out).toContain("@media (max-width: 1024px) {");
    expect(out).not.toContain("width >");
  });

  it("stops hiding where a narrower breakpoint says to show it again", () => {
    // The wider rule still matches at the narrower width, so an explicit `true`
    // below it does nothing unless the wider rule is bounded. A strict lower
    // bound rather than the next whole pixel: breakpoint widths are arbitrary
    // numbers, and fractional viewports are what a device pixel ratio produces.
    const out = css(
      doc([
        node("n1", undefined, {
          visibility: { devices: { tablet: false, mobile: true } },
        }),
      ])
    );
    expect(out).toBe(
      [
        `@media (max-width: 1024px) and (width > 640px) {`,
        `  .nx-pb-page .${nodeClassName("n1")}.${nodeClassName("n1")} { display: none }`,
        `}`,
      ].join("\n")
    );
  });

  it("bounds a base-breakpoint hide that a narrower breakpoint undoes", () => {
    // The base context carries no at-rule, so hiding there emitted an
    // unconditional rule an explicit `true` below could never undo.
    const cls = nodeClassName("n1");
    const out = css(
      doc([
        node("n1", undefined, {
          visibility: { devices: { base: false, mobile: true } },
        }),
      ])
    );
    expect(out).toBe(
      [
        `@media (width > 640px) {`,
        `  .nx-pb-page .${cls}.${cls} { display: none }`,
        `}`,
      ].join("\n")
    );
  });

  it("outranks a display stored on a state", () => {
    const cls = nodeClassName("n1");
    const out = css(
      doc([
        node(
          "n1",
          { focus: { base: { display: "block" } } },
          { visibility: { devices: { mobile: false } } }
        ),
      ])
    );
    expect(out).toContain(`.${cls}.${cls} { display: none }`);
  });

  it("says so when a visibility setting names a breakpoint the site dropped", () => {
    const result = compilePageCss(
      doc([
        node("n1", undefined, { visibility: { devices: { retired: false } } }),
      ]),
      CTX
    );
    expect(result.css).toBe("");
    expect(result.warnings.some(w => w.code === "unknown-breakpoint")).toBe(
      true
    );
  });

  it("bounds a container band the way it bounds a viewport one", () => {
    // The container branch dropped its width, so a container band had no lower
    // bound to end at and the node stayed hidden below the breakpoint that
    // showed it again.
    const cls = nodeClassName("n1");
    const out = css(
      doc([
        node("n1", undefined, {
          visibility: { devices: { "card-base": false, "card-narrow": true } },
        }),
      ])
    );
    expect(out).toBe(
      [
        `@container (width > 320px) {`,
        `  .nx-pb-page .${cls}.${cls} { display: none }`,
        `}`,
      ].join("\n")
    );
  });

  it("points a stale visibility warning at the setting it is about", () => {
    // Two stale ids sharing one pointer means a consumer cannot say which
    // setting was dropped, or highlight it.
    const result = compilePageCss(
      doc([
        node("n1", undefined, {
          visibility: { devices: { retired: false, alsoGone: false } },
        }),
      ]),
      CTX
    );
    expect(
      result.warnings
        .filter(w => w.code === "unknown-breakpoint")
        .map(w => w.path)
    ).toEqual([
      "/nodes/0/visibility/devices/alsoGone",
      "/nodes/0/visibility/devices/retired",
    ]);
  });

  it("treats the two axes separately", () => {
    // A container breakpoint neither inherits from nor cancels a viewport one:
    // they ask about different boxes.
    const out = css(
      doc([
        node("n1", undefined, {
          visibility: { devices: { tablet: false, "card-narrow": true } },
        }),
      ])
    );
    expect(out).toContain("@media (max-width: 1024px) {");
    expect(out).not.toContain("width >");
  });
});

describe("breakpoints the site no longer defines", () => {
  it("says so rather than dropping the values in silence", () => {
    const result = compilePageCss(
      doc([node("n1", { base: { retired: { color: "#fff" } } })]),
      CTX
    );
    expect(result.css).toBe("");
    const issue = result.warnings.find(w => w.code === "unknown-breakpoint");
    expect(issue?.path).toBe("/nodes/0/styles/base/retired");
  });
});

describe("the container axis stays inside its container", () => {
  it("wraps a container breakpoint with no max width in a query too", () => {
    // Emitted unconditionally, a container's own base values would apply to a
    // node with no query container above it, and outrank every viewport rule
    // while doing it.
    const out = css(
      doc([node("n1", { base: { "card-base": { color: "#fff" } } })])
    );
    expect(out).toContain("@container (min-width: 0) {");
  });
});

describe("block type classes", () => {
  it("encodes the namespace separator so two types cannot collide", () => {
    // `foo-bar/baz` and `foo/bar-baz` are different block types; a single dash
    // would give them one selector and one set of defaults.
    const out = css(
      doc([
        { ...node("a"), type: "foo-bar/baz" } as BlockNode,
        { ...node("b"), type: "foo/bar-baz" } as BlockNode,
      ]),
      {
        ...CTX,
        blockBases: {
          "foo-bar/baz": { base: { base: { color: "#111" } } },
          "foo/bar-baz": { base: { base: { color: "#222" } } },
        },
      }
    );
    expect(out).toContain(".nx-bt-foo-bar--baz {");
    expect(out).toContain(".nx-bt-foo--bar-baz {");
  });

  it("escapes the type in a warning pointer", () => {
    // Every block type contains a slash, which a JSON Pointer writes as ~1.
    const result = compilePageCss(doc([node("n1")]), {
      ...CTX,
      blockBases: { "core/box": { base: { base: { color: "nope" } } } },
    });
    expect(result.warnings.map(w => w.path)).toContain(
      "/blockBases/core~1box/base/base/color"
    );
  });
});

describe("a value no union arm accepts", () => {
  it("still explains why it is missing", () => {
    // A union tries each arm and keeps the first that writes something. When
    // none does, the objections were being thrown away with the attempts, so a
    // refused value produced neither CSS nor the explanation this promises.
    const result = compilePageCss(
      doc([
        node("n1", {
          base: { base: { fontWeight: { $token: "not a token name!" } } },
        }),
      ]),
      CTX
    );
    expect(result.css).toBe("");
    expect(result.warnings.map(w => w.path)).toContain(
      "/nodes/0/styles/base/base/fontWeight"
    );
  });
});

describe("the token prefix comes from a caller", () => {
  it("refuses one that would write declarations of its own", () => {
    const result = compilePageCss(
      doc([
        node("n1", { base: { base: { color: { $token: "color.primary" } } } }),
      ]),
      { ...CTX, tokenPrefix: "--x); color: red; --" }
    );
    expect(result.css).not.toContain("color: red");
    expect(result.css).toContain("var(--site-color-primary)");
    expect(result.warnings.length).toBeGreaterThan(0);
  });

  it("refuses one that is not a custom property at all", () => {
    const result = compilePageCss(
      doc([
        node("n1", { base: { base: { color: { $token: "color.primary" } } } }),
      ]),
      { ...CTX, tokenPrefix: "site-" }
    );
    expect(result.css).toContain("var(--site-color-primary)");
    expect(result.warnings.length).toBeGreaterThan(0);
  });
});

describe("nested nodes", () => {
  it("reports a warning at the pointer that reaches the node", () => {
    // A path is a promise that it resolves inside the document being compiled.
    // Numbering nodes in visit order would produce one that reaches a different
    // node, or nothing at all.
    const child = node("child", { base: { base: { color: "not a colour" } } });
    const parent = { ...node("parent"), slots: { children: [child] } };
    const result = compilePageCss(doc([parent as BlockNode]), CTX);
    expect(result.warnings.map(w => w.path)).toContain(
      "/nodes/0/slots/children/0/styles/base/base/color"
    );
  });
});

describe("the compiler does not trust that validation ran", () => {
  it("writes nothing for a value validation refuses", () => {
    const result = compilePageCss(
      doc([
        node("n1", {
          base: {
            base: {
              background: { url: "javascript:alert(1)" },
              color: "#fff",
            },
          },
        }),
      ]),
      CTX
    );
    expect(result.css).not.toContain("javascript");
    // The rest of the node still compiles: one refused value costs that value.
    expect(result.css).toContain("color: #fff");
    expect(result.warnings.map(w => w.path)).toContain(
      "/nodes/0/styles/base/base/background/url"
    );
  });

  it("writes a refused value out of a composite without losing its siblings", () => {
    const result = compilePageCss(
      doc([
        node("n1", {
          base: {
            base: {
              padding: { inlineStart: "2rem", blockStart: "not a length" },
            },
          },
        }),
      ]),
      CTX
    );
    expect(result.css).toContain("padding-inline-start: 2rem");
    expect(result.css).not.toContain("padding-block-start");
  });

  it("writes nothing for a property the catalog does not define", () => {
    const result = compilePageCss(
      doc([node("n1", { base: { base: { madeUp: "1px" } } })]),
      CTX
    );
    expect(result.css).toBe("");
    expect(result.warnings.map(w => w.code)).toContain(
      "unknown-style-property"
    );
  });

  it("compiles every value of a document that validates cleanly", () => {
    // The invariant that keeps the two from drifting: whatever validation
    // accepts, the compiler writes. A compiler with its own slightly stricter
    // opinion silently drops styles from documents nobody was warned about.
    const document = doc([
      node("n1", {
        base: {
          base: {
            color: "#fff",
            padding: { inlineStart: "2rem" },
            display: "flex",
            lineHeight: 1.5,
            backgroundColor: { $token: "color.surface" },
          },
        },
        hover: { base: { color: "#eee" } },
      }),
    ]);
    const issues = validate(document, {
      breakpoints: FIXTURE_BREAKPOINTS,
      mode: "strict",
    });
    expect(issues).toEqual([]);
    expect(compilePageCss(document, CTX).warnings).toEqual([]);
  });
});

describe("determinism", () => {
  const document = doc(
    [
      node("n1", {
        base: { base: { color: "#111", padding: { blockStart: "1rem" } } },
        hover: { tablet: { color: "#222" } },
      }),
      {
        ...node("n2", { base: { base: { display: "flex" } } }),
        slots: {
          b: [node("n4", { base: { base: { color: "#444" } } })],
          a: [node("n3", { base: { base: { color: "#333" } } })],
        },
      } as BlockNode,
    ],
    { styles: { base: { base: { color: "#000" } } } }
  );

  it("produces the same bytes from a structural copy", () => {
    expect(css(structuredClone(document))).toBe(css(document));
  });

  it("produces the same bytes when slots are written in another order", () => {
    const reordered = structuredClone(document);
    const second = reordered.nodes[1];
    if (second?.slots !== undefined) {
      second.slots = { a: second.slots.a, b: second.slots.b };
    }
    expect(css(reordered)).toBe(css(document));
  });

  it("produces the same bytes on repeated compilation", () => {
    expect(css(document)).toBe(css(document));
  });
});

describe("node classes", () => {
  it("derives a class from the id, so styling never renames it", () => {
    const styled = css(
      doc([node("n1", { base: { base: { color: "#111" } } })])
    );
    const restyled = css(
      doc([node("n1", { base: { base: { color: "#222" } } })])
    );
    const cls = nodeClassName("n1");
    expect(styled).toContain(cls);
    expect(restyled).toContain(cls);
  });

  it("disambiguates a hash collision without consulting document order", () => {
    // The real hash makes this unreachable, which is why the collision path is
    // exercised directly: an untested branch on the one path that produces
    // duplicate class names is the branch worth testing.
    const collide = () => "same";
    const forward = nodeClassNames(["b", "a", "c"], collide);
    const reversed = nodeClassNames(["c", "b", "a"], collide);
    expect([...forward.entries()].sort()).toEqual(
      [...reversed.entries()].sort()
    );
    // Ranked by the ids themselves, so moving a node cannot rename it.
    expect(forward.get("a")).toBe("nx-pb-same-0");
    expect(forward.get("b")).toBe("nx-pb-same-1");
    expect(forward.get("c")).toBe("nx-pb-same-2");
  });

  it("gives every id one class even when a document repeats one", () => {
    const names = nodeClassNames(["dup", "dup"]);
    expect(names.size).toBe(1);
    expect(names.get("dup")).toBe(nodeClassName("dup"));
  });

  it("spreads ids across the hash space", () => {
    // A hash that collided often would push documents onto the suffix path and
    // make class names depend on which other nodes happen to be present.
    const ids = Array.from({ length: 5000 }, (_, i) => `node-${i}`);
    expect(new Set(ids.map(nodeClassName)).size).toBe(5000);
  });
});

describe("two documents in one DOM", () => {
  it("keeps each document's rules to its own root when given a scope", () => {
    // Node ids are unique within a document, not across documents, so a page
    // and a region rendered together can hold the same id and therefore the
    // same class. Without a scope their rules cross-apply.
    const document = doc([node("n1", { base: { base: { color: "#fff" } } })], {
      styles: { base: { base: { color: "#000" } } },
    });
    const scoped = css(document, { ...CTX, scope: "nx-doc-a" });
    expect(scoped).toContain(".nx-pb-page.nx-doc-a {");
    expect(scoped).toContain(`.nx-pb-page.nx-doc-a .${nodeClassName("n1")}`);
    // A renderer showing one document at a time passes nothing and is unchanged.
    expect(css(document)).toContain(".nx-pb-page {");
  });

  it("ignores a scope that is not a class name", () => {
    // The scope lands in a selector, so it is held to what a class may contain
    // rather than trusted.
    const out = css(doc([node("n1", { base: { base: { color: "#fff" } } })]), {
      ...CTX,
      scope: "a, .other { color: red } .x",
    });
    expect(out).not.toContain("color: red");
    expect(out).toContain(".nx-pb-page .");
  });
});

describe("diagnostics are bounded across the whole compile", () => {
  it("does not restart the allowance at every style map", () => {
    // Every warning repeats the pointer it came from, so a long slot key plus
    // many bad properties answers with output quadratic in the input. One
    // allowance per style map bounds each map and nothing overall.
    const slot = "s".repeat(2_000);
    const styles: Record<string, unknown> = {};
    for (let i = 0; i < 60; i += 1) styles[`madeUp${i}`] = "1px";
    let deepest: BlockNode = node("leaf", { base: { base: styles } });
    for (let i = 0; i < 40; i += 1) {
      deepest = {
        ...node(`n${i}`, { base: { base: styles } }),
        slots: { [slot]: [deepest] },
      } as BlockNode;
    }
    const result = compilePageCss(doc([deepest]), CTX);
    const bytes = result.warnings.reduce((sum, w) => sum + w.path.length, 0);
    expect(bytes).toBeLessThanOrEqual(MAX_STYLE_ISSUE_PATH_BYTES + 100_000);
    expect(result.warnings.length).toBeLessThanOrEqual(MAX_STYLE_ISSUES + 2);
  });
});

describe("the compiler fails closed", () => {
  it("writes nothing from a map it could not check", () => {
    // Sharing one allowance across the compile means an exhausted budget
    // reports nothing, and this decides what to write from what validation
    // reported. A map reached after the cap would come back clean and be
    // written unchecked, so a stored value can close its own declaration and
    // open a rule of its own.
    const junk: Record<string, unknown> = {};
    for (let i = 0; i < 260; i += 1) junk[`madeUp${i}`] = "1px";
    const result = compilePageCss(
      doc([
        node("a", { base: { base: junk } }),
        node("b", { base: { base: junk } }),
        node("z", {
          base: { base: { color: "red; } .owned { display: block" } },
        }),
      ]),
      CTX
    );
    expect(result.css).not.toContain(".owned");
    expect(result.css).not.toContain("red;");
  });
});

describe("a forest deeper than the stack", () => {
  it("compiles rather than overflowing", () => {
    // A stored document is not required to have been validated before it is
    // compiled, so a deeply nested slot chain must return a stylesheet rather
    // than fail the request with a RangeError.
    let deepest: BlockNode = node("leaf", {
      base: { base: { color: "#fff" } },
    });
    for (let i = 0; i < 20_000; i += 1) {
      deepest = {
        ...node(`n${i}`),
        slots: { children: [deepest] },
      } as BlockNode;
    }
    const result = compilePageCss(doc([deepest]), CTX);
    expect(result.css).toContain("color: #fff");
  });
});

describe("an empty document", () => {
  it("compiles to nothing rather than to an empty rule", () => {
    expect(css(doc([]))).toBe("");
    expect(css(doc([node("n1", { base: { base: {} } })]))).toBe("");
  });
});
