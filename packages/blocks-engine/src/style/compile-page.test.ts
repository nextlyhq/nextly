import { describe, expect, it } from "vitest";

import type { BlockDocument, BlockNode } from "../document";
import {
  MAX_BLOCK_TYPE_LENGTH,
  MAX_BREAKPOINTS_PER_AXIS,
  MAX_BREAKPOINT_ID_LENGTH,
} from "../document";
import { DEFAULT_LIMITS } from "../limits";
import { validate } from "../validation";
import { FIXTURE_BREAKPOINTS } from "../validation.fixtures";

import {
  compilePageCss,
  MAX_SCANNED_KEYS,
  MAX_SCOPE_LENGTH,
} from "./compile-page";
import type { StyleCompileContext } from "./compile-page";
import {
  nodeClassName,
  nodeClassNames,
  PAGE_ROOT_SELECTOR,
} from "./node-class";
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
    expect(out).toBe(
      `${PAGE_ROOT_SELECTOR} .${nodeClassName("n1")} { color: #fff }`
    );
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
        `${PAGE_ROOT_SELECTOR} .${cls} { color: #111 }`,
        // `:where()` matches the same elements and adds no specificity, so what
        // a state rule beats is decided by where it sits, not by the pseudo-
        // class it carries.
        `${PAGE_ROOT_SELECTOR} .${cls}:where(:hover) { color: #222 }`,
        // Focus styling follows `:focus-visible`, so a mouse click does not
        // paint a ring the author only meant for keyboard users.
        `${PAGE_ROOT_SELECTOR} .${cls}:where(:focus-visible) { color: #333 }`,
        `${PAGE_ROOT_SELECTOR} .${cls}:where(:active) { color: #444 }`,
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
        `${PAGE_ROOT_SELECTOR} .${cls} { color: #000 }`,
        // Desktop-first: the unconditional rule is the widest layout, and each
        // narrower breakpoint has to come later to override it.
        `@media (max-width: 1024px) {`,
        `  ${PAGE_ROOT_SELECTOR} .${cls} { color: #222 }`,
        `}`,
        `@media (max-width: 640px) {`,
        `  ${PAGE_ROOT_SELECTOR} .${cls} { color: #333 }`,
        `}`,
        // Container queries last, so an element responding to its own box wins
        // over the same value keyed to the window.
        `@container (max-width: 320px) {`,
        `  ${PAGE_ROOT_SELECTOR} .${cls} { color: #444 }`,
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
        `${PAGE_ROOT_SELECTOR} { color: #111 }`,
        // Inside `:where()`: a block type's default weighs nothing, so it
        // loses to the node value below by CONSTRUCTION rather than by being
        // written first.
        `:where(${PAGE_ROOT_SELECTOR} .nx-bt-core--box) { color: #222 }`,
        `${PAGE_ROOT_SELECTOR} .${nodeClassName("n1")} { color: #333 }`,
      ].join("\n")
    );
  });

  it("gives a block default no specificity, descendants included", () => {
    const out = css(doc([node("n1", {})], {}), {
      ...CTX,
      blockBases: {
        "core/box": {
          base: {
            base: {
              color: "#222",
              // `linkColor` is a catalog property whose shape carries the
              // descendant `a`, so this fixture emits a SECOND rule whose
              // selector has a part after the block class. Without it the test
              // sees only the root rule and cannot tell a wrapper around the
              // whole selector from one around the base alone — measured: a
              // base-only wrap passed the earlier version of this test.
              linkColor: "#333",
            },
          },
        },
      },
    });

    const blockRules = out
      .split("\n")
      .filter(line => line.includes("nx-bt-core--box"));
    // The population first: two rules, the root one and the descendant one.
    // Asserting only "every rule is wrapped" is satisfied by a run that emitted
    // one rule and never reached the case this test is named for.
    expect(blockRules).toHaveLength(2);
    expect(blockRules.some(rule => rule.includes("nx-bt-core--box a"))).toBe(
      true
    );

    for (const rule of blockRules) {
      const selector = rule.slice(0, rule.indexOf("{")).trim();
      expect(selector.startsWith(":where(")).toBe(true);
      // And it CLOSES at the end: `:where(root .type) a` leaves the `a`
      // outside, weighing 0-0-1, which is the partial guarantee this rejects.
      expect(selector.endsWith(")")).toBe(true);
    }
  });

  it("refuses a block type longer than the cap, so two cannot compile apart", () => {
    // The type grammar constrains the ALPHABET and not the length, so a type of
    // megabytes of valid characters satisfies it and is copied into a selector
    // for every rule its defaults produce.
    //
    // The PAIR is what matters, not the single refusal. The page-artifact stamp
    // keeps at most `MAX_VALUE_LENGTH` characters of any string it reads, and
    // sends each block type through that same reduction — so two overlong types
    // agreeing to the truncation point and differing after it once stamped
    // alike while emitting DIFFERENT selectors, and a stored stylesheet built
    // for one was served for the other. Under the cap both emit nothing, which
    // makes identical output the honest answer rather than a collision.
    const shared = `core/${"a".repeat(MAX_BLOCK_TYPE_LENGTH)}`;
    // The document has to USE the type, or the base is narrowed away before the
    // cap is ever consulted and both sides emit nothing whatever the cap says.
    const cssFor = (type: string) =>
      css(doc([node("n1", {}, { type })]), {
        ...CTX,
        blockBases: { [type]: { base: { base: { color: "#222" } } } },
      });

    const first = cssFor(`${shared}b`);
    expect(first).toBe(cssFor(`${shared}c`));
    expect(first).not.toContain("nx-bt-");
  });

  it("still writes a block type at the cap", () => {
    // A cap that took the boundary with it would be a different rule from the
    // one documented, and the off-by-one is invisible to any test supplying a
    // type well clear of it.
    const atCap = `core/${"a".repeat(MAX_BLOCK_TYPE_LENGTH - "core/".length)}`;
    expect(atCap.length).toBe(MAX_BLOCK_TYPE_LENGTH);

    const out = css(doc([node("n1", {}, { type: atCap })]), {
      ...CTX,
      blockBases: { [atCap]: { base: { base: { color: "#222" } } } },
    });
    expect(out).toContain("nx-bt-");
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
        `${PAGE_ROOT_SELECTOR} .${cls} { color: #111 }`,
        `${PAGE_ROOT_SELECTOR} .${cls} a { color: #00f }`,
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
        `  ${PAGE_ROOT_SELECTOR} .${nodeClassName("n1")}.${nodeClassName("n1")} { display: none }`,
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
        `  ${PAGE_ROOT_SELECTOR} .${nodeClassName("n1")}.${nodeClassName("n1")} { display: none }`,
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
        `  ${PAGE_ROOT_SELECTOR} .${cls}.${cls} { display: none }`,
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
        `  ${PAGE_ROOT_SELECTOR} .${cls}.${cls} { display: none }`,
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
    expect(out).toContain(".nx-bt-foo-bar--baz)");
    expect(out).toContain(".nx-bt-foo--bar-baz)");
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
    expect(scoped).toContain(`${PAGE_ROOT_SELECTOR}.nx-doc-a {`);
    expect(scoped).toContain(
      `${PAGE_ROOT_SELECTOR}.nx-doc-a .${nodeClassName("n1")}`
    );
    // A renderer showing one document at a time passes nothing and is unchanged.
    expect(css(document)).toContain(`${PAGE_ROOT_SELECTOR} {`);
  });

  it("ignores a scope that is not a class name", () => {
    // The scope lands in a selector, so it is held to what a class may contain
    // rather than trusted.
    const out = css(doc([node("n1", { base: { base: { color: "#fff" } } })]), {
      ...CTX,
      scope: "a, .other { color: red } .x",
    });
    expect(out).not.toContain("color: red");
    expect(out).toContain(`${PAGE_ROOT_SELECTOR} .`);
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
  it("compiles rather than overflowing, and stops at the document limits", () => {
    // A stored document is not required to have been validated before it is
    // compiled, so a deeply nested slot chain must return a stylesheet rather
    // than fail the request with a RangeError.
    //
    // Iterating instead of recursing is only half of that. Every queued level
    // retains the cumulative pointer to it, so a chain this deep holds path
    // text growing with its own depth at every level; walking it all would
    // trade a stack overflow for a memory one. It stops where validation would
    // have stopped, and says which subtree went unstyled.
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
    expect(result.warnings.map(issue => issue.code)).toContain(
      "node-count-exceeded"
    );
    // Nothing past the bound was read, so the leaf below it is not styled.
    expect(result.css).not.toContain("color: #fff");
  });

  it("stops on depth alone, well before the node count is reached", () => {
    // Fifty nested nodes is far under `maxNodes` and far over `maxDepth`, so
    // this pins the depth bound rather than letting the node bound cover for it.
    let nested: BlockNode = node("leaf", { base: { base: { color: "#fff" } } });
    for (let i = 0; i < 50; i += 1) {
      nested = {
        ...node(`n${i}`),
        slots: { children: [nested] },
      } as BlockNode;
    }
    const out = compilePageCss(doc([nested]), CTX);
    expect(out.css).not.toContain("color: #fff");
    expect(out.warnings.map(issue => issue.code)).toContain(
      "node-count-exceeded"
    );
  });

  it("still styles a document that sits inside the limits", () => {
    // The bound is the document model's, not a new one: a tree a document may
    // legitimately contain is compiled in full, leaf included.
    let nested: BlockNode = node("leaf", { base: { base: { color: "#fff" } } });
    for (let i = 0; i < DEFAULT_LIMITS.maxDepth - 2; i += 1) {
      nested = {
        ...node(`n${i}`),
        slots: { children: [nested] },
      } as BlockNode;
    }
    expect(css(doc([nested]))).toContain("color: #fff");
  });
});

describe("an empty document", () => {
  it("compiles to nothing rather than to an empty rule", () => {
    expect(css(doc([]))).toBe("");
    expect(css(doc([node("n1", { base: { base: {} } })]))).toBe("");
  });
});

describe("stored breakpoint settings are read as untrusted", () => {
  it("compiles a page when an axis is missing or malformed", () => {
    // Settings come from storage, and forgiving validation lets a document
    // through for a reader to still see. Throwing here would take every page on
    // the site down over one corrupt settings record.
    const document = doc([node("n1", { base: { base: { color: "#fff" } } })]);
    const shapes: unknown[] = [
      null,
      {},
      { viewport: null, container: undefined },
      { viewport: "wide", container: 7 },
      { viewport: [null, { id: "tablet", maxWidth: 900 }], container: [] },
    ];
    for (const breakpoints of shapes) {
      const out = compilePageCss(document, {
        breakpoints,
      } as unknown as StyleCompileContext);
      expect(out.css).toContain("color: #fff");
    }
  });

  it("drops a definition whose bound is zero or negative", () => {
    // Quieter than a NaN and just as unusable: `@media (max-width: -1px)` is a
    // well-formed query that nothing can ever match, so kept, the id would count
    // as KNOWN and its styles and hiding would go missing with nothing reported.
    for (const maxWidth of [0, -1]) {
      const out = compilePageCss(
        doc([node("n1", { base: { narrow: { color: "#f00" } } })]),
        {
          breakpoints: {
            viewport: [{ id: "narrow", maxWidth }],
            container: [],
          },
        } as unknown as StyleCompileContext
      );
      expect(out.css).not.toContain("#f00");
      expect(out.warnings.map(issue => issue.code)).toContain(
        "unknown-breakpoint"
      );
    }
  });

  it("drops a definition whose bound is not a finite number", () => {
    // Unbounded is not a safe reading of a broken bound: emitted without its
    // query, the breakpoint's values would apply at every width the author
    // meant to exclude. Dropped, its values are reported like any stale id.
    const out = compilePageCss(
      doc([node("n1", { base: { broken: { color: "#f00" } } })]),
      {
        breakpoints: {
          viewport: [{ id: "broken", maxWidth: Number.NaN }],
          container: [],
        },
      } as unknown as StyleCompileContext
    );
    expect(out.css).not.toContain("#f00");
    expect(out.css).not.toContain("NaN");
    expect(out.warnings.map(issue => issue.code)).toContain(
      "unknown-breakpoint"
    );
  });
});

describe("warnings about stale breakpoint ids are bounded", () => {
  /** A document keying values and visibility to `count` undefined ids. */
  function staleDoc(count: number, keyLength = 1): BlockDocument {
    const ids = Array.from(
      { length: count },
      (_, index) => `stale-${"k".repeat(keyLength)}-${index}`
    );
    return doc([
      node(
        "n1",
        { base: Object.fromEntries(ids.map(id => [id, { color: "#fff" }])) },
        {
          visibility: {
            devices: Object.fromEntries(ids.map(id => [id, false])),
          },
        }
      ),
    ]);
  }

  it("stops after its own allowance and says so once", () => {
    // A stale id costs one warning wherever it appears, and each repeats the
    // whole pointer above it, so a document inside the byte cap can answer with
    // output far larger than itself.
    const out = compilePageCss(staleDoc(400), CTX);
    const stale = out.warnings.filter(
      issue => issue.code === "unknown-breakpoint"
    );
    expect(stale.length).toBeLessThan(400);
    expect(
      out.warnings.filter(issue => issue.code === "style-issues-truncated")
    ).toHaveLength(1);
  });

  it("does not spend the allowance that decides what is written", () => {
    // The style-issue budget gates WRITING: a map reached after it runs out is
    // refused rather than written unchecked. Charging these warnings to it would
    // let renaming one breakpoint blank every page that still referenced it.
    const stale = staleDoc(400);
    const nodes = [
      ...(stale.nodes as BlockNode[]),
      node("n2", { base: { base: { color: "#0f0" } } }),
    ];
    const out = compilePageCss(doc(nodes), CTX);
    expect(out.css).toContain("color: #0f0");
  });
});

describe("states carry no specificity, so order decides the cascade", () => {
  it("does not let a block type's state value outrank a node's own value", () => {
    // The tiers are meant to be decided by source order: a node's value beats
    // its block type's default because it is emitted after it. A bare `:hover`
    // is worth a class, so the block's default would win at any distance, and a
    // node given its own colour would still change colour on hover having said
    // nothing about hovering.
    const out = compilePageCss(
      doc([node("n1", { base: { base: { color: "#0f0" } } })]),
      {
        ...CTX,
        blockBases: { "core/box": { hover: { base: { color: "#f00" } } } },
      }
    );
    // Same specificity on both sides…
    expect(out.css).not.toMatch(/[^(]:hover/);
    // …and the node's rule is the later one.
    expect(out.css.indexOf("#f00")).toBeLessThan(out.css.indexOf("#0f0"));
  });

  it("keeps a state value above a narrower breakpoint's base value", () => {
    // The other half of the same decision. Emitted breakpoint-major, the
    // narrower BASE rule would land after the wider HOVER rule and defeat it, so
    // a node coloured on hover everywhere and re-coloured at tablet would stop
    // showing its hover colour there without anyone saying so.
    const out = css(
      doc([
        node("n1", {
          base: { base: { color: "#111" }, tablet: { color: "#333" } },
          hover: { base: { color: "#222" } },
        }),
      ])
    );
    expect(out.indexOf("#111")).toBeLessThan(out.indexOf("#333"));
    expect(out.indexOf("#333")).toBeLessThan(out.indexOf("#222"));
  });

  it("still lets a narrower breakpoint beat a wider one within a state", () => {
    // Desktop-first is unchanged: within one state the narrower value is later.
    const out = css(
      doc([
        node("n1", {
          hover: { base: { color: "#111" }, tablet: { color: "#222" } },
        }),
      ])
    );
    expect(out.indexOf("#111")).toBeLessThan(out.indexOf("#222"));
  });
});

describe("the compile scope", () => {
  it("keeps a class token the CSS grammar cannot spell raw", () => {
    // A class attribute holds any whitespace-free token, and node classes are
    // unique only WITHIN a document, so dropping the scope is not cosmetic: two
    // documents in one DOM cross-apply each other's rules. These are valid
    // classes that simply need escaping.
    for (const scope of ["7f3a-region", "_region", "-region"]) {
      const out = compilePageCss(
        doc([node("n1", { base: { base: { color: "#fff" } } })]),
        { ...CTX, scope }
      );
      expect(out.warnings).toEqual([]);
      // Present, and never as a bare selector that would match something else.
      expect(out.css).not.toContain(
        `${PAGE_ROOT_SELECTOR} .${nodeClassName("n1")} {`
      );
      expect(out.css).toContain("color: #fff");
    }
  });

  it("escapes a leading digit rather than emitting an invalid selector", () => {
    const out = compilePageCss(
      doc([node("n1", { base: { base: { color: "#fff" } } })]),
      { ...CTX, scope: "7f3a" }
    );
    expect(out.css).toContain(`${PAGE_ROOT_SELECTOR}.\\37 f3a`);
  });

  it("says so when a scope cannot be one class", () => {
    // Whitespace is the real exclusion: `a b` in a class attribute is two
    // classes, so no escaping makes it what the renderer attached. Losing the
    // scope silently is what let one document's rules reach another.
    const out = compilePageCss(
      doc([node("n1", { base: { base: { color: "#fff" } } })]),
      { ...CTX, scope: "two words" }
    );
    expect(out.warnings.map(issue => issue.code)).toEqual(["invalid-scope"]);
    expect(out.css).toContain(`${PAGE_ROOT_SELECTOR} .`);
  });
});

describe("compiler-only objections are bounded too", () => {
  it("stops after the allowance when many token names break the grammar", () => {
    // Validation ACCEPTS a `$token` whose name breaks the grammar: only the
    // compiler writes that name into a `var()`, so only the compiler objects.
    // Nothing charges these the style-issue budget, so without a bound of their
    // own a document repeating one across thousands of maps answers with a
    // warning for each, every one carrying its full pointer.
    const nodes = Array.from({ length: 200 }, (_, index) => ({
      id: `n${index}`,
      type: "core/box",
      version: 1,
      props: {},
      styles: { base: { base: { color: { $token: "not a token name!" } } } },
    }));
    const out = compilePageCss(
      doc([...(nodes as unknown as BlockNode[])]),
      CTX
    );
    const objections = out.warnings.filter(
      issue => issue.code === "invalid-style-value"
    );
    expect(objections.length).toBeLessThan(200);
    expect(
      out.warnings.filter(issue => issue.code === "style-issues-truncated")
    ).toHaveLength(1);
  });

  it("does not spend the allowance that decides what is written", () => {
    // Same separation as the stale ids: these are explanations, and paying for
    // them out of the write-gating budget would let one malformed token name
    // blank the rest of the page.
    const nodes = Array.from({ length: 200 }, (_, index) => ({
      id: `n${index}`,
      type: "core/box",
      version: 1,
      props: {},
      styles: { base: { base: { color: { $token: "not a token name!" } } } },
    }));
    const out = compilePageCss(
      doc([
        ...(nodes as unknown as BlockNode[]),
        node("last", { base: { base: { color: "#0f0" } } }),
      ]),
      CTX
    );
    expect(out.css).toContain("color: #0f0");
  });
});

describe("settings the compiler cannot use are dropped, not obeyed", () => {
  it("drops a non-base viewport breakpoint that carries no bound", () => {
    // Emitted, it would carry NO at-rule: a second unconditional context
    // overriding the real base at every width, reachable from a settings record
    // the type system accepts, since `maxWidth` is optional.
    const out = compilePageCss(
      doc([
        node("n1", {
          base: { base: { color: "#0f0" }, rogue: { color: "#f00" } },
        }),
      ]),
      {
        breakpoints: {
          viewport: [{ id: "base" }, { id: "rogue" }],
          container: [],
        },
      } as unknown as StyleCompileContext
    );
    expect(out.css).not.toContain("#f00");
    expect(out.css).toContain("#0f0");
    expect(out.warnings.map(issue => issue.code)).toContain(
      "unknown-breakpoint"
    );
  });

  it("keeps an unbounded CONTAINER breakpoint, which still emits a query", () => {
    // The container axis is not the same case: its widest definition emits
    // `@container (min-width: 0)`, so it stays scoped to a container rather
    // than becoming a second unconditional base.
    const out = css(
      doc([node("n1", { base: { "card-base": { color: "#0f0" } } })])
    );
    expect(out).toContain("@container (min-width: 0)");
    expect(out).toContain("#0f0");
  });

  it("enforces the declared per-axis breakpoint limit", () => {
    // Every style envelope scans the whole context list, so a corrupt settings
    // record costs its size times every node in the document, not once.
    const viewport = [
      { id: "base" },
      ...Array.from({ length: 300 }, (_, index) => ({
        id: `bp${index}`,
        maxWidth: 2000 - index,
      })),
    ];
    // Styled at one breakpoint inside the cap and one far outside it, so the
    // assertion turns on which contexts were kept rather than on how many
    // queries a single base value happens to produce — which is none.
    const out = compilePageCss(
      doc([
        node("n1", {
          base: { bp0: { color: "#0f0" }, bp250: { color: "#f00" } },
        }),
      ]),
      {
        breakpoints: { viewport, container: [] },
      } as unknown as StyleCompileContext
    );
    // The widest survive; everything past the limit is not a breakpoint this
    // site defines, so its values are reported stale like any other.
    expect(out.css).toContain("#0f0");
    expect(out.css).not.toContain("#f00");
    expect(out.warnings.map(issue => issue.code)).toContain(
      "unknown-breakpoint"
    );
    const emitted = [...out.css.matchAll(/max-width: \d+px/g)];
    expect(emitted.length).toBeLessThanOrEqual(MAX_BREAKPOINTS_PER_AXIS);
  });

  it("reads no further along an axis than MAX_SCANNED_KEYS before sorting", () => {
    // The per-axis cap bounds the OUTPUT; this bounds the work. Every reader
    // keyed on which breakpoints a site emits under calls this on each render,
    // including one whose stylesheet is reusable, so a stored axis of a million
    // definitions would be filtered and sorted in full on the way to keeping
    // seven.
    //
    // Asserted through what SURVIVES rather than by timing: the widest
    // definition sits past the bound, so a reading that kept the whole axis
    // would emit it and this one does not. Nothing legitimate is affected — the
    // declared limit is seven — and the trade is that past this many stored
    // definitions the survivors are chosen from a prefix.
    //
    // What this does NOT separate is WHERE the bound is applied. Every entry
    // here is usable, so bounding the raw axis and bounding the filtered one
    // keep the same 256 and this stays green either way. The test below is the
    // one that tells them apart, and it exists because only the raw-axis form
    // bounds the scan.
    const axis = [
      ...Array.from({ length: MAX_SCANNED_KEYS }, (_, i) => ({
        id: `b${i}`,
        label: `B${i}`,
        maxWidth: 100 + i,
      })),
      { id: "widest", label: "Widest", maxWidth: 9999 },
    ];
    const out = compilePageCss(
      doc([node("n1", { base: { widest: { color: "red" } } })]),
      { breakpoints: { viewport: axis, container: [] } }
    );

    expect(out.css).not.toContain("max-width: 9999px");
    // The control: the same definition INSIDE the bound is emitted, so the
    // absence above is the bound rather than the fixture failing to reach the
    // mechanism.
    const within = compilePageCss(
      doc([node("n1", { base: { widest: { color: "red" } } })]),
      {
        breakpoints: {
          viewport: [{ id: "widest", label: "Widest", maxWidth: 9999 }],
          container: [],
        },
      }
    );
    expect(within.css).toContain("max-width: 9999px");
  });

  it("applies that bound to the RAW axis, before anything filters it", () => {
    // The separator the test above cannot be. A bound applied after the filter
    // bounds only the sort: the filter still visits every stored definition and
    // materialises every usable one, which is the cost this is about — the
    // reading runs on every render keyed on what a site emits under, including
    // one whose stylesheet is reusable.
    //
    // Observable because the two forms disagree about which definitions exist
    // at all. A viewport definition with no bound is dropped, so a prefix of
    // them is entirely unusable: bounding the FILTERED list keeps the one valid
    // definition that follows them, and bounding the RAW axis never reaches it.
    const axis = [
      ...Array.from({ length: MAX_SCANNED_KEYS }, (_, i) => ({
        id: `junk${i}`,
        label: `Junk${i}`,
      })),
      { id: "late", label: "Late", maxWidth: 500 },
    ];
    const out = compilePageCss(
      doc([node("n1", { base: { late: { color: "red" } } })]),
      { breakpoints: { viewport: axis, container: [] } }
    );

    expect(out.css).not.toContain("max-width: 500px");
    // The control, so the absence above is the bound rather than the fixture
    // never reaching the mechanism: the SAME definition inside the prefix is
    // emitted.
    const within = compilePageCss(
      doc([node("n1", { base: { late: { color: "red" } } })]),
      {
        breakpoints: {
          viewport: [{ id: "late", label: "Late", maxWidth: 500 }],
          container: [],
        },
      }
    );
    expect(within.css).toContain("max-width: 500px");
  });

  it("drops a breakpoint whose id is longer than the engine will read", () => {
    // `MAX_BREAKPOINTS_PER_AXIS` bounds how many definitions are read and says
    // nothing about their size. An id is a lookup key every reader of the
    // normalised axis carries, so an unbounded one is copied on each call — and
    // that call runs on every render keyed on what a site emits under, including
    // one whose stylesheet is reusable.
    //
    // Dropped rather than truncated, so the id is simply not one this site
    // defines and the values stored under it are reported stale. Truncating
    // would keep it usable under a name no document references, losing those
    // values with nothing reported at all.
    const huge = "b".repeat(MAX_BREAKPOINT_ID_LENGTH + 1);
    const out = compilePageCss(
      doc([node("n1", { base: { [huge]: { color: "red" } } })]),
      {
        breakpoints: {
          viewport: [{ id: huge, label: "Huge", maxWidth: 700 }],
          container: [],
        },
      }
    );

    expect(out.css).not.toContain("max-width: 700px");
    expect(out.warnings.map(issue => issue.code)).toContain(
      "unknown-breakpoint"
    );
    // The control, so the absence is the LENGTH rather than the fixture failing
    // to reach the mechanism: the same definition at the limit is emitted.
    const within = compilePageCss(
      doc([
        node("n1", {
          base: { ["b".repeat(MAX_BREAKPOINT_ID_LENGTH)]: { color: "red" } },
        }),
      ]),
      {
        breakpoints: {
          viewport: [
            {
              id: "b".repeat(MAX_BREAKPOINT_ID_LENGTH),
              label: "At limit",
              maxWidth: 700,
            },
          ],
          container: [],
        },
      }
    );
    expect(within.css).toContain("max-width: 700px");
  });

  it("says so when a stored visibility value is not a boolean", () => {
    // `"false"` reads exactly like the thing it is not, and deciding nothing
    // leaves the node visible — which is the outcome an author would call a bug
    // and never find, since no rule was emitted to look at.
    const out = compilePageCss(
      doc([
        node("n1", undefined, {
          visibility: { devices: { mobile: "false" } },
        }),
      ]),
      CTX
    );
    expect(out.css).not.toContain("display: none");
    expect(out.warnings.map(issue => issue.code)).toContain(
      "invalid-visibility"
    );
  });
});

describe("documents the compiler cannot style unambiguously", () => {
  it("refuses styles for two nodes sharing an id, and says why", () => {
    // A class is derived from the id, and the returned map is keyed by it, so
    // there is no second class to give the second node. Written, both envelopes
    // land on the one selector and the later silently restyles BOTH elements —
    // one of which never asked for it.
    const out = compilePageCss(
      doc([
        node("dup", { base: { base: { color: "#f00" } } }),
        node("dup", { base: { base: { color: "#00f" } } }),
        node("fine", { base: { base: { color: "#0f0" } } }),
      ]),
      CTX
    );
    expect(out.css).not.toContain("#f00");
    expect(out.css).not.toContain("#00f");
    // A node that is not part of the ambiguity is unaffected.
    expect(out.css).toContain("#0f0");
    const duplicates = out.warnings.filter(
      issue => issue.code === "duplicate-node-id"
    );
    expect(duplicates).toHaveLength(1);
  });

  it("resolves one breakpoint id to one definition across both axes", () => {
    // Read per axis, a duplicate becomes two contexts, and one stored value
    // keyed to it is emitted under both queries — responding to viewport width
    // AND container width at once.
    const out = compilePageCss(
      doc([node("n1", { base: { dup: { color: "#0f0" } } })]),
      {
        breakpoints: {
          viewport: [{ id: "base" }, { id: "dup", maxWidth: 900 }],
          container: [{ id: "dup", maxWidth: 400 }],
        },
      } as unknown as StyleCompileContext
    );
    expect(out.css).not.toContain("@container");
    expect([...out.css.matchAll(/#0f0/g)]).toHaveLength(1);
  });

  it("says so when a stored style envelope is not an object", () => {
    const out = compilePageCss(
      doc([node("n1", [] as unknown as Record<string, unknown>)]),
      CTX
    );
    expect(out.warnings.map(issue => issue.code)).toContain(
      "invalid-style-values"
    );
  });
});

describe("what reaches a selector is held to a grammar", () => {
  it("refuses a block type that would break out of its rule", () => {
    // A node type is interpolated into a SELECTOR, and this compiler reads
    // persisted data whether or not a caller validated it. Unchecked, this
    // emits a second selector of the author's choosing and applies a block's
    // defaults to every `body` on the page.
    const hostile = "evil/x, body";
    const out = compilePageCss(
      doc([
        {
          id: "n1",
          type: hostile,
          version: 1,
          props: {},
        } as unknown as BlockNode,
      ]),
      {
        ...CTX,
        blockBases: { [hostile]: { base: { base: { color: "#f00" } } } },
      }
    );
    expect(out.css).not.toContain("body");
    expect(out.css).not.toContain("#f00");
    expect(out.warnings.map(issue => issue.code)).toContain(
      "invalid-node-type"
    );
  });

  it("still writes defaults for a well-formed block type", () => {
    const out = compilePageCss(doc([node("n1")]), {
      ...CTX,
      blockBases: { "core/box": { base: { base: { color: "#0f0" } } } },
    });
    expect(out.css).toContain("#0f0");
    expect(out.warnings).toEqual([]);
  });
});

describe("more of what the compiler skips is now accounted for", () => {
  it("reports a style state it does not recognise", () => {
    const out = compilePageCss(
      doc([node("n1", { pressed: { base: { color: "#f00" } } })]),
      CTX
    );
    expect(out.css).not.toContain("#f00");
    expect(out.warnings.map(issue => issue.code)).toContain(
      "invalid-style-state"
    );
  });

  it("keeps a scope containing a space HTML does not split on", () => {
    // HTML tokenizes a class attribute on ASCII whitespace only, so a scope
    // holding NBSP is one valid class the renderer really attaches. Rejecting
    // it sent the document back to the selector every other document shares.
    const out = compilePageCss(
      doc([node("n1", { base: { base: { color: "#0f0" } } })]),
      { ...CTX, scope: "region\u00a0one" }
    );
    expect(out.warnings).toEqual([]);
    expect(out.css).toContain("#0f0");
  });

  it("treats only one unbounded container definition as the container base", () => {
    // Two both compile to `@container (min-width: 0)`, covering the identical
    // range, so whichever sorts later silently overrides the other.
    const out = compilePageCss(
      doc([node("n1", { base: { "c-two": { color: "#f00" } } })]),
      {
        breakpoints: {
          viewport: [{ id: "base" }],
          container: [{ id: "c-one" }, { id: "c-two" }],
        },
      } as unknown as StyleCompileContext
    );
    expect(out.css).not.toContain("#f00");
    expect(out.warnings.map(issue => issue.code)).toContain(
      "unknown-breakpoint"
    );
  });

  it("counts the viewport base toward the per-axis limit", () => {
    // The unconditional base context is inserted separately and filtered out of
    // the axis list, so counting only survivors honours one definition past the
    // declared limit.
    const viewport = [
      { id: "base" },
      ...Array.from({ length: MAX_BREAKPOINTS_PER_AXIS }, (_, index) => ({
        id: `bp${index}`,
        maxWidth: 2000 - index * 100,
      })),
    ];
    const styles = Object.fromEntries(
      Array.from({ length: MAX_BREAKPOINTS_PER_AXIS }, (_, index) => [
        `bp${index}`,
        { color: "#0f0" },
      ])
    );
    const out = compilePageCss(doc([node("n1", { base: styles })]), {
      breakpoints: { viewport, container: [] },
    } as unknown as StyleCompileContext);
    const queries = [...out.css.matchAll(/max-width: \d+px/g)];
    expect(queries.length).toBe(MAX_BREAKPOINTS_PER_AXIS - 1);
  });

  it("says an unusable token prefix once, not once per styled node", () => {
    // The prefix is one CONFIGURATION fact discovered while compiling every
    // map. Repeated per map it spends the whole allowance restating one
    // setting, then announces truncation — so the values that really were
    // dropped go unexplained.
    const nodes = Array.from({ length: 60 }, (_, index) =>
      node(`n${index}`, { base: { base: { color: "#0f0" } } })
    );
    const out = compilePageCss(doc(nodes), {
      ...CTX,
      tokenPrefix: "not a prefix",
    });
    const prefixWarnings = out.warnings.filter(issue =>
      issue.message.includes("custom-property prefix")
    );
    expect(prefixWarnings).toHaveLength(1);
    expect(
      out.warnings.filter(issue => issue.code === "style-issues-truncated")
    ).toHaveLength(0);
  });
});

describe("malformed envelopes are accounted for at every level", () => {
  it("reports a state whose value is not an object", () => {
    const out = compilePageCss(
      doc([node("n1", { base: [] as unknown as Record<string, unknown> })]),
      CTX
    );
    expect(out.warnings.map(issue => issue.code)).toContain(
      "invalid-style-values"
    );
  });

  it("reports a breakpoint map whose value is not an object", () => {
    const out = compilePageCss(
      doc([node("n1", { base: { base: "red" } })]),
      CTX
    );
    expect(out.css).toBe("");
    expect(out.warnings.map(issue => issue.code)).toContain(
      "invalid-style-values"
    );
  });

  it("stays silent about a breakpoint a node simply says nothing about", () => {
    // `undefined` is the normal case, not a malformed one. Reported, it would
    // be one warning per unstyled breakpoint on every node in the document.
    const out = compilePageCss(
      doc([node("n1", { base: { base: { color: "#0f0" } } })]),
      CTX
    );
    expect(out.warnings).toEqual([]);
  });

  it("reports a visibility envelope that is not an object", () => {
    for (const visibility of [[], "hidden", null]) {
      const out = compilePageCss(
        doc([node("n1", undefined, { visibility })]),
        CTX
      );
      expect(out.css).not.toContain("display: none");
      expect(out.warnings.map(issue => issue.code)).toContain(
        "invalid-visibility"
      );
    }
  });

  it("reports a devices map that is not an object", () => {
    const out = compilePageCss(
      doc([node("n1", undefined, { visibility: { devices: [] } })]),
      CTX
    );
    expect(out.warnings.map(issue => issue.code)).toContain(
      "invalid-visibility"
    );
  });
});

describe("the node walk is bounded by what it reads", () => {
  it("stops at the cap even when every entry is malformed", () => {
    // A malformed entry never reaches `placed`, so counting only successes let
    // an array made entirely of them pass the cap without tripping it.
    const nodes = Array.from(
      { length: DEFAULT_LIMITS.maxNodes + 500 },
      () => null
    ) as unknown as BlockNode[];
    const out = compilePageCss(doc(nodes), CTX);
    expect(out.warnings.map(issue => issue.code)).toContain(
      "node-count-exceeded"
    );
  });

  it("styles nothing past the cap", () => {
    // A guard on the outcome, not on the loop shape: breaking out of the array
    // rather than running `forEach` to its end changes the work done and not
    // the result, so this holds either way and is here to keep it holding.
    const nodes = [
      ...Array.from({ length: DEFAULT_LIMITS.maxNodes + 10 }, (_, index) =>
        node(`n${index}`)
      ),
      node("beyond", { base: { base: { color: "#f00" } } }),
    ];
    const out = compilePageCss(doc(nodes), CTX);
    expect(out.css).not.toContain("#f00");
  });
});

describe("the page scope", () => {
  // The scope prefixes every rule the page emits, so an oversized one is copied
  // once per rule rather than once per sheet — and it was the last emitted
  // string with no cap, which is what `EMITTABLE_STRING_BOUNDS` promises there
  // are none of.
  it("is refused past its bound, so the sheet is unscoped rather than enormous", () => {
    const out = css(doc([node("n1", { base: { base: { color: "#111" } } })]), {
      ...CTX,
      scope: "s".repeat(MAX_SCOPE_LENGTH + 1),
    });
    expect(out).not.toContain("s".repeat(MAX_SCOPE_LENGTH + 1));
  });

  it("still writes a scope AT the bound, so the refusal is not blanket", () => {
    // The control. A compiler that dropped every scope would satisfy the case
    // above and silently unscope every page.
    const atBound = "s".repeat(MAX_SCOPE_LENGTH);
    const out = css(doc([node("n1", { base: { base: { color: "#111" } } })]), {
      ...CTX,
      scope: atBound,
    });
    expect(out).toContain(atBound);
  });
});
