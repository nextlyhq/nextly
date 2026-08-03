import { describe, expect, it } from "vitest";

import type { BlockDocument, BlockNode } from "../document";
import {
  VALIDATION_FIXTURES,
  FIXTURE_BREAKPOINTS,
} from "../validation.fixtures";

import { compilePageCss } from "./compile-page";
import {
  findUnnamespacedGlobals,
  findUnscopedRules,
  namespacedGlobalName,
} from "./isolation";
import { PAGE_ROOT_CLASS, PAGE_ROOT_SELECTOR } from "./node-class";

const SCOPE = PAGE_ROOT_CLASS;

describe("what counts as anchored", () => {
  it("accepts a selector descending from the page root", () => {
    expect(findUnscopedRules(`.${SCOPE} .a { color: red }`, SCOPE)).toEqual([]);
    expect(findUnscopedRules(`.${SCOPE} > .a { color: red }`, SCOPE)).toEqual(
      []
    );
    expect(findUnscopedRules(`.${SCOPE} { color: red }`, SCOPE)).toEqual([]);
    // Later combinators stay inside: `.b` shares a parent with `.a`, which is
    // already within the subtree.
    expect(
      findUnscopedRules(`.${SCOPE} .a + .b { color: red }`, SCOPE)
    ).toEqual([]);
  });

  it("refuses a sibling of the page root", () => {
    // `+` and `~` leave the subtree entirely: these match elements beside the
    // mounted root, which belong to the host page.
    for (const combinator of ["+", "~"]) {
      const found = findUnscopedRules(
        `.${SCOPE} ${combinator} .a { color: red }`,
        SCOPE
      );
      expect(found).toHaveLength(1);
    }
  });

  it("refuses a class that merely starts with the scope's name", () => {
    // A substring test accepts this. It is a different class on a different
    // element, and every rule under it would land on the host page.
    const found = findUnscopedRules(
      `.${SCOPE}-header .a { color: red }`,
      SCOPE
    );
    expect(found).toHaveLength(1);
  });

  it("refuses a scope that appears only inside a negation", () => {
    // Being NOT the page root is the opposite of being inside it.
    const found = findUnscopedRules(`.a:not(.${SCOPE}) { color: red }`, SCOPE);
    expect(found).toHaveLength(1);
  });

  it("refuses a selector list where only some parts are anchored", () => {
    // The whole reason to check parts independently: a prelude containing the
    // scope anywhere would pass, and `body` would restyle the host page. This
    // is the shape a stored block type produced when it reached a selector
    // unescaped.
    const found = findUnscopedRules(`.${SCOPE} .a, body { color: red }`, SCOPE);
    expect(found).toHaveLength(1);
    expect(found[0]?.selector).toBe("body");
  });

  it("refuses the selectors a leak is usually made of", () => {
    for (const selector of ["html", "body", ":root", "*", "h1", ".prose"]) {
      expect(
        findUnscopedRules(`${selector} { color: red }`, SCOPE)
      ).toHaveLength(1);
    }
  });

  it("does not ask whether keyframe steps are anchored", () => {
    // Percentage steps match no element, so anchoring is a category error for
    // them. Their risk is a global NAME, which namespacing answers.
    expect(
      findUnscopedRules(
        `@keyframes x { from { opacity: 0 } to { opacity: 1 } }`,
        SCOPE
      )
    ).toEqual([]);
    expect(
      findUnscopedRules(
        `@font-face { font-family: x; src: url(a.woff2) }`,
        SCOPE
      )
    ).toEqual([]);
  });

  it("checks inside a media query, where rules do match elements", () => {
    expect(
      findUnscopedRules(
        `@media (max-width: 100px) { body { color: red } }`,
        SCOPE
      )
    ).toHaveLength(1);
    expect(
      findUnscopedRules(
        `@media (max-width: 100px) { .${SCOPE} .a { color: red } }`,
        SCOPE
      )
    ).toEqual([]);
  });
});

describe("the compiler cannot emit a rule that escapes the page root", () => {
  /** Compile and assert the invariant, returning the CSS for further checks. */
  function compiled(
    doc: BlockDocument,
    ctx = { breakpoints: FIXTURE_BREAKPOINTS }
  ) {
    const out = compilePageCss(doc, ctx);
    expect(findUnscopedRules(out.css, SCOPE)).toEqual([]);
    return out;
  }

  it("holds for every document in the validation corpus", () => {
    // The corpus is the adversarial one: malformed nodes, hostile values,
    // unknown types, deep nesting. Every document it holds must compile to an
    // anchored stylesheet, whether or not it is a document anyone would write.
    for (const fixture of VALIDATION_FIXTURES) {
      compiled(fixture.doc);
    }
  });

  it("holds when a stored block type tries to open a selector of its own", () => {
    // The exact shape of the defect this invariant exists to make impossible.
    const hostile = "evil/x, body";
    const out = compiled(
      {
        formatVersion: 1,
        kind: "page",
        nodes: [
          {
            id: "n1",
            type: hostile,
            version: 1,
            props: {},
          } as unknown as BlockNode,
        ],
      } as unknown as BlockDocument,
      {
        breakpoints: FIXTURE_BREAKPOINTS,
        blockBases: { [hostile]: { base: { base: { color: "#f00" } } } },
      } as Parameters<typeof compilePageCss>[1]
    );
    expect(out.css).not.toContain("body");
  });

  it("holds when a scope is supplied, however it is spelled", () => {
    // A scope reaches the selector too, so it is the other identifier that can
    // carry a leak. Escaping is what keeps these anchored.
    for (const scope of ["region", "7f3a", "_r", "-r", "a\\b"]) {
      const out = compilePageCss(
        {
          formatVersion: 1,
          kind: "page",
          nodes: [
            {
              id: "n1",
              type: "core/box",
              version: 1,
              props: {},
              styles: { base: { base: { color: "#fff" } } },
            },
          ],
        } as unknown as BlockDocument,
        { breakpoints: FIXTURE_BREAKPOINTS, scope }
      );
      expect(findUnscopedRules(out.css, SCOPE)).toEqual([]);
    }
  });

  it("holds for a node id that would be a combinator if it were not hashed", () => {
    // Node ids never reach a selector raw — they are hashed to hex — but the
    // invariant should say so rather than assume it.
    const out = compiled({
      formatVersion: 1,
      kind: "page",
      nodes: [
        {
          id: "a, body",
          type: "core/box",
          version: 1,
          props: {},
          styles: { base: { base: { color: "#fff" } } },
        },
      ],
    } as unknown as BlockDocument);
    expect(out.css).not.toContain("body");
  });
});

describe("the override contract, as a user would meet it", () => {
  /** The specificity of a selector, as (id, class, type). */
  function specificity(selector: string): [number, number, number] {
    const ids = (selector.match(/#[\w-]+/g) ?? []).length;
    const classes = (selector.match(/\.[\w-]+|\[[^\]]*\]|:(?!:)[a-z-]+/g) ?? [])
      .length;
    const types = (selector.match(/(^|[\s>+~])[a-z]+[\w-]*/g) ?? []).length;
    return [ids, classes, types];
  }

  it("puts a node's rule above ordinary host CSS", () => {
    // The contest users actually lose: a host theme with a moderately specific
    // rule beating a value they set in the builder, with nothing to explain it.
    const out = compilePageCss(
      {
        formatVersion: 1,
        kind: "page",
        nodes: [
          {
            id: "n1",
            type: "core/box",
            version: 1,
            props: {},
            styles: { base: { base: { color: "#fff" } } },
          },
        ],
      } as unknown as BlockDocument,
      { breakpoints: FIXTURE_BREAKPOINTS }
    );
    const emitted = out.css.slice(0, out.css.indexOf("{")).trim();
    const [, classes] = specificity(emitted);
    // Three classes, so `.content .card h1` (two classes, one type) loses.
    expect(classes).toBeGreaterThanOrEqual(3);
  });

  it("still lets a host override deliberately", () => {
    // The other half of the contract, and the reason `!important` is not used:
    // the page belongs to the user, so a rule that outranks ours must win.
    const ours = `${PAGE_ROOT_SELECTOR} .nx-pb-abc`;
    const deliberate = `.my-theme ${PAGE_ROOT_SELECTOR} .nx-pb-abc`;
    const [, oursClasses] = specificity(ours);
    const [, theirsClasses] = specificity(deliberate);
    expect(theirsClasses).toBeGreaterThan(oursClasses);
  });
});

describe("names CSS resolves for the whole document", () => {
  it("namespaces an animation name, and a custom property keeps its dashes", () => {
    expect(namespacedGlobalName("fade", SCOPE)).toBe(`${SCOPE}-fade`);
    // `@property` only accepts a dashed ident, so moving the dashes would
    // produce a name CSS refuses outright.
    expect(namespacedGlobalName("--gap", SCOPE)).toBe(`--${SCOPE}-gap`);
  });

  it("reports a global name defined without the namespace", () => {
    // Two documents on one page that both define `fade` do not get one each:
    // the later definition wins for BOTH, and which is later depends on the
    // order stylesheets happened to load.
    const found = findUnnamespacedGlobals(
      `@keyframes fade { from { opacity: 0 } }`,
      SCOPE
    );
    expect(found).toHaveLength(1);
    expect(found[0]?.name).toBe("fade");
  });

  it("accepts one that carries the namespace", () => {
    expect(
      findUnnamespacedGlobals(
        `@keyframes ${SCOPE}-fade { from { opacity: 0 } }`,
        SCOPE
      )
    ).toEqual([]);
    expect(
      findUnnamespacedGlobals(`@property --${SCOPE}-gap { syntax: "*" }`, SCOPE)
    ).toEqual([]);
  });

  it("reports a font family, which names itself in a descriptor", () => {
    // `@font-face` is the one at-rule that names itself in a DESCRIPTOR rather
    // than a prelude. The name is every bit as global: a host font and ours by
    // the same name are one font, and which one depends on load order.
    const found = findUnnamespacedGlobals(
      `@font-face { font-family: Fade; src: url(a.woff2) }`,
      SCOPE
    );
    expect(found).toHaveLength(1);
    expect(found[0]?.name).toBe("Fade");
  });

  it("reads a quoted family name the same as a bare one", () => {
    const found = findUnnamespacedGlobals(
      `@font-face { font-family: "Fade"; src: url(a.woff2) }`,
      SCOPE
    );
    expect(found).toHaveLength(1);
    expect(found[0]?.name).toBe("Fade");
  });

  it("accepts a namespaced font family", () => {
    expect(
      findUnnamespacedGlobals(
        `@font-face { font-family: "${SCOPE}-Fade"; src: url(a.woff2) }`,
        SCOPE
      )
    ).toEqual([]);
  });

  it("ignores at-rules that define no global name", () => {
    // `@media` and `@container` scope rules; they name nothing.
    expect(
      findUnnamespacedGlobals(
        `@media (max-width: 1px) { .a { color: red } }`,
        SCOPE
      )
    ).toEqual([]);
  });

  it("holds over the corpus: the compiler defines no un-namespaced name", () => {
    // Nothing emits these yet. The invariant is here FIRST so that the moment
    // tokens or animations begin defining names, an un-namespaced one is a test
    // failure rather than a rendering mystery somebody debugs much later.
    for (const fixture of VALIDATION_FIXTURES) {
      const out = compilePageCss(fixture.doc, {
        breakpoints: FIXTURE_BREAKPOINTS,
      });
      expect(findUnnamespacedGlobals(out.css, SCOPE)).toEqual([]);
    }
  });
});
