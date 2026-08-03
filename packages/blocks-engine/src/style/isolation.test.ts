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

/** The namespaced spelling of a name, as the compiler would write it. */
const ns = (name: string): string => namespacedGlobalName(name, SCOPE);

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

  it("checks inside every at-rule that wraps ordinary rules", () => {
    // Each of these holds real selectors, so a leak can hide in any of them.
    // `@container` is the one this compiler emits most.
    for (const prelude of [
      "@container (max-width: 100px)",
      "@supports (display: grid)",
      "@scope (.a) to (.b)",
    ]) {
      expect(
        findUnscopedRules(`${prelude} { body { color: red } }`, SCOPE)
      ).toHaveLength(1);
      expect(
        findUnscopedRules(`${prelude} { .${SCOPE} .a { color: red } }`, SCOPE)
      ).toEqual([]);
    }
  });

  it("does not call a valid at-rule prelude a leak", () => {
    // css-tree validates at-rule preludes against a grammar it ships, and that
    // grammar rejects every `@container` query. Reporting those as findings
    // would condemn a feature this compiler emits on any responsive document.
    expect(
      findUnscopedRules(
        `@container card (min-width: 1px) and (max-width: 320px) { .${SCOPE} .a { color: red } }`,
        SCOPE
      )
    ).toEqual([]);
    expect(
      findUnnamespacedGlobals(
        `@container (max-width: 320px) { .${SCOPE} .a { color: red } }`,
        SCOPE
      )
    ).toEqual([]);
  });
});

describe("a stylesheet that does not parse cleanly is not a clean stylesheet", () => {
  // css-tree parses tolerantly: a malformed sheet recovers rather than
  // throwing, so a `try`/`catch` alone reports nothing and the recovered tree
  // is missing the very parts worth checking.
  const RECOVERED = [
    // A stray closing brace. The browser drops it and applies `body`.
    `.${SCOPE} .a{} } body { color:red }`,
    `} body { color:red }`,
    `.${SCOPE} .a{}} .b { color:red }`,
  ];

  it("reports a rule the parser recovered past", () => {
    for (const css of RECOVERED) {
      expect(findUnscopedRules(css, SCOPE).length).toBeGreaterThan(0);
    }
  });

  it("reports it on the naming axis too", () => {
    // Both invariants read the same sheet; one of them silently returning
    // "nothing found" for input it could not read is the same hole twice.
    for (const css of RECOVERED) {
      expect(findUnnamespacedGlobals(css, SCOPE).length).toBeGreaterThan(0);
    }
  });

  it("names the selector it could not read, not just the sheet", () => {
    // Reporting only "this did not parse" leaves the reader to find the rule
    // themselves. The prelude the parser gave up on is the thing to go and
    // look at, so it is reported alongside.
    const found = findUnscopedRules(`.a, { color: red }`, SCOPE);
    expect(found.map(entry => entry.selector)).toContain(".a,");
  });

  it("keeps checking the rules it could read", () => {
    // A sheet that recovered is still worth walking: the parse error and the
    // leak it recovered into are two separate things to fix, and stopping at
    // the first hides the second.
    const found = findUnscopedRules(
      `.a, { color: red } body { color: blue }`,
      SCOPE
    );
    expect(found.map(entry => entry.selector)).toContain("body");
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
  it("namespaces a name so the check accepts it back", () => {
    // Asserted as a round trip rather than against a spelling, so the two
    // halves cannot drift: whatever this produces is what the invariant must
    // then consider namespaced.
    expect(
      findUnnamespacedGlobals(
        `@keyframes ${ns("fade")} { from { opacity: 0 } }`,
        SCOPE
      )
    ).toEqual([]);
    expect(ns("fade")).toContain("fade");
  });

  it("keeps a custom property's leading dashes at the front", () => {
    // `@property` only accepts a dashed ident, so moving the dashes inward
    // would produce a name CSS refuses outright.
    expect(ns("--gap").startsWith("--")).toBe(true);
    expect(
      findUnnamespacedGlobals(`@property ${ns("--gap")} { syntax: "*" }`, SCOPE)
    ).toEqual([]);
  });

  it("gives two scopes different names for names that would otherwise meet", () => {
    // Concatenating scope and name with a single dash is not injective: scope
    // "a" with name "b-c" and scope "a-b" with name "c" would both spell
    // "a-b-c". Two documents differing only that way would define one animation
    // between them, and the later would win for both — the namespace
    // reintroducing the collision it exists to prevent.
    expect(namespacedGlobalName("b-c", "a")).not.toBe(
      namespacedGlobalName("c", "a-b")
    );
    // And each is still recognised under its OWN scope, not the other's.
    expect(
      findUnnamespacedGlobals(
        `@keyframes ${namespacedGlobalName("b-c", "a")} { from { opacity: 0 } }`,
        "a"
      )
    ).toEqual([]);
    expect(
      findUnnamespacedGlobals(
        `@keyframes ${namespacedGlobalName("b-c", "a")} { from { opacity: 0 } }`,
        "a-b"
      )
    ).toHaveLength(1);
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
        `@keyframes ${ns("fade")} { from { opacity: 0 } }`,
        SCOPE
      )
    ).toEqual([]);
    expect(
      findUnnamespacedGlobals(`@property ${ns("--gap")} { syntax: "*" }`, SCOPE)
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
        `@font-face { font-family: "${ns("Fade")}"; src: url(a.woff2) }`,
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

  it("reports a named page, which no other check looks at", () => {
    // `@page` is exempt from anchoring because it holds no element selectors.
    // That exemption is exactly why its name has to be checked here: a rule
    // skipped by both invariants is a rule nothing looks at.
    const found = findUnnamespacedGlobals(`@page cover { margin: 1cm }`, SCOPE);
    expect(found).toHaveLength(1);
    expect(found[0]?.name).toBe("cover");
    expect(
      findUnnamespacedGlobals(`@page ${ns("cover")} { margin: 1cm }`, SCOPE)
    ).toEqual([]);
  });

  it("reads the name off a page that also selects one of its pages", () => {
    const found = findUnnamespacedGlobals(
      `@page cover:first { margin: 1cm }`,
      SCOPE
    );
    expect(found).toHaveLength(1);
    expect(found[0]?.name).toBe("cover");
  });

  it("does not invent a name for a page that defines none", () => {
    // `@page :first` selects the first page of a flow that already exists; it
    // names nothing, so there is nothing to collide.
    expect(findUnnamespacedGlobals(`@page { margin: 1cm }`, SCOPE)).toEqual([]);
    expect(
      findUnnamespacedGlobals(`@page :first { margin: 1cm }`, SCOPE)
    ).toEqual([]);
  });

  it("reports each font family a feature-values rule attaches to", () => {
    const found = findUnnamespacedGlobals(
      `@font-feature-values Fade { @styleset { nice: 1 } }`,
      SCOPE
    );
    expect(found).toHaveLength(1);
    expect(found[0]?.name).toBe("Fade");
    expect(
      findUnnamespacedGlobals(
        `@font-feature-values ${ns("Fade")} { @styleset { nice: 1 } }`,
        SCOPE
      )
    ).toEqual([]);
  });

  it("keeps an unquoted multi-word family together", () => {
    // Read token by token, `Fade Two` would be reported as two names, and a
    // namespaced family followed by a second word would be a false finding.
    const found = findUnnamespacedGlobals(
      `@font-feature-values "Fade Two", Other { @styleset { nice: 1 } }`,
      SCOPE
    );
    expect(found.map(entry => entry.name)).toEqual(["Fade Two", "Other"]);
    expect(
      findUnnamespacedGlobals(
        `@font-feature-values ${ns("Fade Two")} { @styleset { nice: 1 } }`,
        SCOPE
      )
    ).toEqual([]);
  });

  it("reports a colour profile, which resolves by name like the rest", () => {
    const found = findUnnamespacedGlobals(
      `@color-profile --brand { src: url(a.icc) }`,
      SCOPE
    );
    expect(found).toHaveLength(1);
    expect(found[0]?.name).toBe("--brand");
    expect(
      findUnnamespacedGlobals(
        `@color-profile ${ns("--brand")} { src: url(a.icc) }`,
        SCOPE
      )
    ).toEqual([]);
  });

  it("reads a page name that is not spelled in ASCII", () => {
    // A CSS identifier may be non-ASCII or carry escapes. A pattern narrower
    // than the grammar finds no name here, and finding no name reads as
    // "nothing to collide" rather than "could not tell".
    for (const [prelude, name] of [
      ["封面", "封面"],
      ["\\63 over", "\\63 over"],
      ["cover:first", "cover"],
    ]) {
      const found = findUnnamespacedGlobals(
        `@page ${prelude} { margin: 1cm }`,
        SCOPE
      );
      expect(found).toHaveLength(1);
      expect(found[0]?.name).toBe(name);
    }
  });

  it("reads the font family a face actually defines", () => {
    // A later descriptor wins inside a block, so the family this rule defines
    // is the last one. Stopping at the first lets a namespaced decoy stand in
    // front of the name that really lands.
    const found = findUnnamespacedGlobals(
      `@font-face { font-family: ${ns("safe")}; font-family: Host; src: url(a.woff2) }`,
      SCOPE
    );
    expect(found).toHaveLength(1);
    expect(found[0]?.name).toBe("Host");
  });

  it("accepts a nested layer under a namespaced one", () => {
    // `@layer a { @layer b { … } }` defines `a.b`, so an inner name carrying no
    // namespace of its own is still namespaced by the layer it sits in.
    expect(
      findUnnamespacedGlobals(
        `@layer ${ns("theme")} { @layer utilities { .a { color: red } } }`,
        SCOPE
      )
    ).toEqual([]);
    // The outermost still has to carry it.
    expect(
      findUnnamespacedGlobals(
        `@layer host { @layer utilities { .a { color: red } } }`,
        SCOPE
      )
    ).toHaveLength(1);
  });

  it("reports every layer a prelude names", () => {
    // A host layer of the same name is the same layer, so two orderings that
    // were meant to be independent merge into one.
    const found = findUnnamespacedGlobals(`@layer base, components;`, SCOPE);
    expect(found.map(entry => entry.name)).toEqual(["base", "components"]);
  });

  it("reports an at-rule nobody has classified", () => {
    // The gap that produced three separate findings: an at-rule absent from the
    // table was skipped by the naming check AND, being selectorless, by the
    // anchoring one. Unknown now means "answer the question", not "carry on".
    const found = findUnnamespacedGlobals(
      `@invented-rule --x { color: red }`,
      SCOPE
    );
    expect(found).toHaveLength(1);
    expect(found[0]?.atRule).toBe("invented-rule");
  });

  it("does not ask a descriptor block to classify itself", () => {
    // `@styleset` is part of `@font-feature-values`, not a rule of its own, and
    // the family name on its parent is what could collide.
    expect(
      findUnnamespacedGlobals(
        `@font-feature-values ${ns("Fade")} { @styleset { nice: 1 } }`,
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
