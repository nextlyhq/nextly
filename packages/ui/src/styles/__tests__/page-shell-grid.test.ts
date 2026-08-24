/**
 * The component half of the page shell and its STYLESHEET half are one
 * decision, and this pins the half jsdom cannot see.
 *
 * `page-shell.test.tsx` asserts that `PageShell` emits `.nx-page-shell` and
 * that `Bleed` emits `.nx-bleed`. Neither assertion moves if the rules those
 * classes name are deleted from `theme.css`, because no stylesheet is applied
 * in jsdom — so the whole layout could stop working with every component test
 * green. That is the shape this file exists to close.
 *
 * It reads the stylesheet as TEXT rather than through a CSS parser on purpose:
 * the property under test is that a specific declaration is present and spelled
 * the way the component expects, and a parser would add a dependency to assert
 * strictly less. Precedent in this repo: `typecheck-config.test.ts` parses
 * `tsconfig.json` and `layering.test.ts` parses `vitest.config.ts` for the same
 * reason.
 *
 * What it deliberately does NOT claim: that the resulting boxes land where they
 * should. Only a real browser can answer that, and the Playwright check added
 * once a page consumes the shell is what covers it.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const themeCss = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "..", "theme.css"),
  "utf8"
);

/** Collapse whitespace so an assertion is about the declaration, not its wrapping. */
const flat = themeCss.replace(/\s+/g, " ");

describe("page shell stylesheet", () => {
  it("declares every token the grid template reads", () => {
    // A missing token does not error in CSS — the `var()` falls back or the
    // declaration is dropped, and the page renders with no gutter at all. So
    // each one is named rather than inferred from the template compiling.
    expect(flat).toContain("--nx-gutter: 2rem");
    expect(flat).toContain("--nx-measure-form: 56rem");
    expect(flat).toContain("--nx-measure-wide: 72rem");
  });

  it("ships the section rhythm as a rule, not only as a token", () => {
    // The token alone is inert. The rule that spends it has to live in the theme
    // too, or a consumer on the v3 preset compiles the component and gets no
    // padding — the token resolves fine and nothing applies it.
    expect(flat).toContain(
      ".nx-form-section-rows > * { padding-block: var(--nx-field-gap); }"
    );
  });

  it("declares the section rhythm token FormSection reads", () => {
    // A missing custom property does not error: the padding utility that reads
    // it resolves to nothing and the section silently loses its rhythm again,
    // which is the defect the token exists to end.
    //
    // Note the utility is NOT spelled out here. Tailwind scans this file, and a
    // complete arbitrary-value token in a comment is extracted exactly as one in
    // JSX would be — a comment naming the v3 square-bracket form emitted a rule
    // with a literal `...` as its value, which fails the whole stylesheet.
    expect(flat).toContain("--nx-field-gap: 1.25rem");
  });

  it("names the four grid lines the shell and Bleed both depend on", () => {
    // `content` is what every ordinary child resolves to and `full` is what
    // `Bleed` resolves to. Renaming either line silently makes the other half
    // inert rather than failing loudly.
    expect(flat).toContain("[full-start]");
    expect(flat).toContain("[content-start]");
    expect(flat).toContain("[content-end]");
    expect(flat).toContain("[full-end]");
  });

  it("lets the outer tracks absorb surplus width, so `full` reaches the panel edges", () => {
    // With FIXED outer tracks the three columns total only
    // `measure + 2 * gutter`, so in any wider panel the grid stops short of the
    // edges and `full-start`/`full-end` stop with it. `minmax(gutter, 1fr)` is
    // what separates the two: the gutter is the track's MINIMUM and `1fr` lets
    // it absorb the surplus.
    expect(flat).toContain("[full-start] minmax(var(--nx-gutter), 1fr)");
    expect(flat).toContain("[content-end] minmax(var(--nx-gutter), 1fr)");

    // Rejecting the bare form explicitly, because the line-name assertions
    // above are satisfied by it too.
    expect(flat).not.toContain("[full-start] var(--nx-gutter)");
  });

  it("reads the measure through the custom property the component sets", () => {
    // `PageShell` writes `--nx-shell-measure` inline per `width`. If the
    // template stopped reading it, every width would render at the declared
    // default and the prop would silently do nothing — which the component test
    // cannot detect, because the property would still be set correctly.
    expect(flat).toContain("minmax(0, var(--nx-shell-measure))");
  });

  it("declares the measure token rather than leaning on a var() fallback", () => {
    // A token read but never declared cannot be retuned by a theme: it resolves
    // to whatever fallback the one call site happened to write, so a palette
    // change moves every surface around it and leaves this one where it was.
    // `admin-token-reachability` enforces that across the admin, and this keeps
    // the pairing visible from the stylesheet's own suite.
    expect(flat).toContain("--nx-shell-measure: var(--nx-measure-form);");

    // The fallback form is what an undeclared token forces. Rejecting it here
    // means a revert to that shape fails, rather than passing on the assertion
    // above alone.
    expect(flat).not.toContain("var(--nx-shell-measure, ");
  });

  it("puts ordinary children in the content column and Bleed in the full one", () => {
    expect(flat).toContain(".nx-page-shell > * { grid-column: content;");
    expect(flat).toContain(".nx-page-shell > .nx-bleed { grid-column: full; }");
  });

  it("scopes the bleed rule to a DIRECT child", () => {
    // A descendant selector here would look like it worked while resolving
    // against a grid that never declared the named lines. The child combinator
    // is what keeps the constraint honest, so its absence must fail.
    expect(flat).not.toMatch(/\.nx-page-shell \.nx-bleed\s*\{/);
  });

  it("centres the column through equal outer tracks, not auto margins", () => {
    // Centring is a CONSEQUENCE of the two outer tracks being identical, so
    // there is nothing extra to declare. `margin-inline: auto` on a max-width
    // box would not do the job anyway: it does nothing at panel widths where
    // the cap does not bind, which is why the previous layout only appeared
    // centred because of its paddings.
    const template = flat.slice(
      flat.indexOf(".nx-page-shell {"),
      flat.indexOf("[full-end]")
    );
    const outerTracks = template.match(/minmax\(var\(--nx-gutter\), 1fr\)/g);
    expect(outerTracks).toHaveLength(2);

    // `justify-content` would have no free space to distribute once the tracks
    // flex, so declaring it would imply an effect it cannot have.
    expect(flat).not.toContain("justify-content: center;");
  });

  it("steps the gutter with the content container, not the viewport", () => {
    // A media query here would read the WINDOW, so the gutter would not react
    // to a sidebar opening — which is the thing that actually changes the
    // panel's width in this admin.
    expect(flat).toContain("@container content (max-width: 1024px)");
    expect(flat).toContain("@container content (max-width: 768px)");
  });

  it("applies the gutter override to a DESCENDANT of the container, never an ancestor", () => {
    // A container query styles only elements INSIDE its container, so a rule
    // naming `:root` or `.nextly-admin` — both ancestors of the `<main>` that
    // declares `content` — never matches, and the gutter keeps its widest value
    // at every panel size. Asserting that an `@container` block EXISTS cannot
    // separate that from a correct one, so the selector itself is read.
    for (const query of [
      "@container content (max-width: 1024px)",
      "@container content (max-width: 768px)",
    ]) {
      const block = flat.slice(flat.indexOf(query));
      // Step past the container's OWN opening brace first, then read up to the
      // inner rule's brace — that span is the selector under test. Reading to
      // the first brace instead yields the empty string, which would silently
      // satisfy both negative assertions below.
      const containerBrace = block.indexOf("{");
      const selector = block.slice(
        containerBrace + 1,
        block.indexOf("{", containerBrace + 1)
      );
      expect(selector).toContain(".nx-page-shell");
      expect(selector).not.toContain(":root");
      expect(selector).not.toContain(".nextly-admin");
    }
  });
});
