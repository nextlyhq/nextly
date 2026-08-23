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
    // This is the assertion the first version of this file was missing, and its
    // absence is why a real defect shipped: with FIXED outer tracks the three
    // columns total only `measure + 2 * gutter`, so in a wider panel the grid
    // stops short and `full-start`/`full-end` stop with it. Measured in a
    // browser at a 1200px panel, a `Bleed` spanned 960px — exactly
    // `56rem + 2 * 2rem` — rather than running edge to edge as documented.
    //
    // `minmax(gutter, 1fr)` is what separates the correct grid from that one:
    // the gutter is the track's MINIMUM and `1fr` lets it take the surplus.
    expect(flat).toContain("[full-start] minmax(var(--nx-gutter), 1fr)");
    expect(flat).toContain("[content-end] minmax(var(--nx-gutter), 1fr)");

    // The bare form is the defect. Naming it explicitly means a revert to it
    // fails here rather than passing on the line-name assertions alone.
    expect(flat).not.toContain("[full-start] var(--nx-gutter)");
  });

  it("reads the measure through the custom property the component sets", () => {
    // `PageShell` writes `--nx-shell-measure` inline per `width`. If the
    // template stopped reading it, every width would render at the fallback and
    // the prop would silently do nothing — which the component test cannot
    // detect, because the property would still be set correctly.
    expect(flat).toContain(
      "minmax(0, var(--nx-shell-measure, var(--nx-measure-form)))"
    );
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
    // The other assertion this file was missing, and the other real defect it
    // let through. A container query can style only elements INSIDE its
    // container, and `:root` / `.nextly-admin` are ancestors of the `<main>`
    // that names `content` — so a rule targeting them never matches and the
    // gutter silently keeps its desktop value at every panel width. Measured in
    // a browser at a 700px container: assigning to `:root` left it at 2rem
    // while assigning to a descendant gave the intended 1rem.
    //
    // Checking only that an `@container` block EXISTS cannot separate those two
    // implementations, which is precisely how the broken one passed.
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
