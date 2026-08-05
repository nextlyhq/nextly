/**
 * The rules that decide what a NAME in custom CSS means.
 *
 * A companion to `css-sanitize.corpus.test.ts`, which asks whether anything can
 * escape a declaration. This asks the quieter question that produced far more
 * defects: given that nothing escapes, does every name still mean what the
 * author's CSS said it meant?
 *
 * Written as four invariants rather than as a list of cases, because the cases
 * were not independent. Reviewing this layer turned up the same four mistakes
 * repeatedly, in different functions, each found only after the identical rule
 * had already been fixed somewhere else — the definition side before the
 * reference side, `animation` before `font-family`, a declaration before the
 * custom property holding the same text. A table per invariant is what makes
 * the next occurrence fail here instead of being found one surface at a time.
 *
 * Each entry names the CSS a browser would apply, so a reader can check the
 * expectation against the specification rather than against this code.
 */
import {
  escapeIdentifier,
  namespacedGlobalName,
} from "@nextlyhq/blocks-engine";
import { describe, expect, it } from "vitest";

import { sanitizeCustomCss } from "./css-sanitize";

const SCOPE = "nx-pb-page";
const ns = (name: string): string => namespacedGlobalName(name, SCOPE);
const clean = (css: string): string => sanitizeCustomCss(css, SCOPE).css;

/** A `@font-face` that is valid, so a test is about the rule it is testing. */
const FACE = (family: string): string =>
  `@font-face { font-family: ${family}; src: url("/f.woff2") }`;

describe("invariant: what CSS discards, this does not make usable", () => {
  /**
   * The most repeated defect in this layer, and the most dangerous shape of it.
   *
   * These inputs all contain something a browser reads and throws away. The
   * failure was never that the sanitizer emitted them — it was that it REPAIRED
   * them: a malformed rule renamed into a well-formed private one, an invalid
   * family run joined into a single valid string. The author's CSS did nothing;
   * the output did something. A declaration that silently starts working is
   * worse than one that silently stops, because nothing prompts anyone to look.
   */
  const cases: Array<{ what: string; css: string; mustNotContain: string }> = [
    {
      what: "@keyframes with more than a name in its prelude",
      css: `@keyframes fade 1 { from { opacity: 0 } } .x { animation: fade 1s }`,
      mustNotContain: ns("fade"),
    },
    {
      what: "@keyframes named with a reserved word",
      css: `@keyframes none { from { opacity: 0 } } .x { animation-name: "none" }`,
      mustNotContain: ns("none"),
    },
    {
      what: "a @font-face whose src names nothing loadable",
      css: `@font-face { font-family: X; src: garbage } .x { font-family: X, serif }`,
      mustNotContain: ns("X"),
    },
    {
      what: "a font-family descriptor that is two strings",
      css: `@font-face { font-family: "A" "B"; src: url("/f.woff2") } .x { font-family: A B }`,
      mustNotContain: ns("A B"),
    },
    {
      what: "a font-family reference mixing a string and an identifier",
      css: `${FACE('"My Font"')} .x { font-family: "My" Font }`,
      mustNotContain: `.x{font-family:"${ns("My Font")}"}`,
    },
  ];

  it.each(cases)("leaves $what alone", ({ css, mustNotContain }) => {
    expect(clean(css)).not.toContain(mustNotContain);
  });
});

describe("invariant: a bare word is a keyword, a quoted one is a name", () => {
  /**
   * CSS tells a keyword from a name of the same spelling by the quotes and
   * nothing else. `animation-name: none` cancels an animation; `"none"` names
   * the rule `@keyframes "none"`. `font-family: serif` is whatever the reader
   * installed; `"serif"` is a face somebody chose to call that.
   *
   * Every one of these was found separately, on a different surface, after the
   * rule was already right on another one — which is why they are one table.
   */
  it.each([
    {
      what: "an animation keyword in a declaration",
      css: `@keyframes "none" { from { opacity: 0 } } .x { animation-name: none }`,
      keep: "animation-name:none",
    },
    {
      what: "an animation keyword in a custom property",
      css: `@keyframes "none" { from { opacity: 0 } } .x { --a: none; animation-name: var(--a) }`,
      keep: "--a: none",
    },
    {
      what: "a generic family in a declaration",
      css: `${FACE('"serif"')} .x { font-family: serif }`,
      keep: ".x{font-family:serif}",
    },
    {
      what: "a generic family in a custom property",
      css: `${FACE('"serif"')} .x { --f: serif; font-family: var(--f) }`,
      keep: "--f: serif",
    },
    {
      what: "the iteration count of an animation shorthand",
      css: `@keyframes infinite { from { opacity: 0 } } .x { animation: pulse 1s infinite }`,
      keep: "animation:pulse 1s infinite",
    },
    {
      what: "the style keyword of a font shorthand",
      css: `${FACE("italic")} .x { font: italic 16px Arial }`,
      keep: "font:italic 16px Arial",
    },
  ])("keeps $what as the keyword", ({ css, keep }) => {
    expect(clean(css)).toContain(keep);
  });

  it.each([
    {
      what: "a quoted keyframes name spelled like a keyword",
      css: `@keyframes "none" { from { opacity: 0 } } .x { animation-name: "none" }`,
      expected: () => `animation-name:"${ns("none")}"`,
    },
    {
      what: "a quoted family spelled like a generic",
      css: `${FACE('"serif"')} .x { font-family: "serif" }`,
      expected: () => `.x{font-family:"${ns("serif")}"}`,
    },
  ])("still renames $what", ({ css, expected }) => {
    // The other half of the same rule. A skip that swallowed these would look
    // correct in every test above and break the feature outright.
    expect(clean(css)).toContain(expected());
  });
});

describe("invariant: names are compared decoded and emitted escaped", () => {
  /**
   * `font\2d family` IS `font-family`, and `@keyframes \66 ade` IS named
   * `fade`, so a comparison against raw text is one an author walks straight
   * past. The reverse holds on the way out: a name decoded for comparison and
   * written back bare emits tokens the parser reads apart.
   *
   * Both directions, because fixing only the first left a rename that produced
   * CSS nothing could resolve.
   */
  it("reads an escaped property as the descriptor it is", () => {
    const out = clean(
      `@font-face { font\\2d family: Inter; src: url("/f.woff2") }`
    );
    expect(out).toContain(ns("Inter"));
    expect(out).not.toMatch(/:\s*Inter\b/i);
  });

  it("reads an escaped at-rule name as the at-rule it is", () => {
    // `@\6d edia` is `@media`, which is supported; the rule survives.
    expect(clean(`@\\6d edia screen { .x { color: red } }`)).toContain(
      `.${SCOPE} .x`
    );
  });

  it("reads an escaped keyframes name as the name it is", () => {
    const out = clean(
      `@keyframes \\66 ade { from { opacity: 0 } } .x { animation: fade 1s }`
    );
    expect(out).toContain(`animation:${ns("fade")} 1s`);
  });

  it.each([
    {
      where: "the definition and the reference",
      css: `@keyframes a\\ b { from { opacity: 0 } } .x { animation: a\\ b 1s }`,
      expected: () => [
        `@keyframes ${escapeIdentifier(ns("a b"))}{`,
        `animation:${escapeIdentifier(ns("a b"))} 1s`,
      ],
    },
    {
      where: "a custom property",
      css: `@keyframes a\\ b { from { opacity: 0 } } .x { --a: a\\ b; animation: var(--a) 1s }`,
      expected: () => [`--a:${escapeIdentifier(ns("a b"))}`],
    },
  ])("escapes a renamed identifier in $where", ({ css, expected }) => {
    const out = clean(css);
    for (const fragment of expected()) expect(out).toContain(fragment);
    // The escape has to actually be there, or this passes on a name that
    // happened to need none.
    expect(escapeIdentifier(ns("a b"))).toContain("\\ ");
  });
});

describe("invariant: a rule holds wherever the value can reach", () => {
  /**
   * The half-fixed set. Every guard in this layer has more than one way in —
   * a declaration, a custom property read by `var()`, a rule nested inside
   * another rule — and a rule applied to one of them passes every test written
   * about that one.
   *
   * So each case here is the SAME name reached three ways. A guard added to the
   * declaration path and forgotten elsewhere fails here rather than in review.
   */
  const reaches = (inner: string): string[] => [
    `.x { ${inner} }`,
    `.x { .nested { ${inner} } }`,
    `@media screen { .x { ${inner} } }`,
  ];

  it.each(reaches("animation: fade 1s"))(
    "renames a keyframes reference in %s",
    body => {
      const out = clean(`@keyframes fade { from { opacity: 0 } } ${body}`);
      expect(out).toContain(`animation:${ns("fade")} 1s`);
      expect(out).not.toMatch(/animation:\s*fade\b/);
    }
  );

  it.each(reaches("font-family: Brand, serif"))(
    "renames a family reference in %s",
    body => {
      const out = clean(`${FACE("Brand")} ${body}`);
      expect(out).toContain(`"${ns("Brand")}",serif`);
    }
  );

  it("applies the origin policy at every one of those depths too", () => {
    // The same three shapes, checked for the rule this layer exists for: a
    // guard that reaches a name but not a URL would be a boundary with a hole
    // in exactly the place the nesting was added to close.
    for (const body of reaches(
      'background: url("https://evil.example/a.png")'
    )) {
      expect(clean(body)).not.toContain("evil.example");
    }
  });
});
