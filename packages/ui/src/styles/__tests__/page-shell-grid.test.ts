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

  it("centres the column rather than relying on auto margins", () => {
    // `margin-inline: auto` on a max-width box does nothing at panel widths
    // where the cap does not bind, which is why the previous layout appeared
    // centred only because of its paddings.
    expect(flat).toContain("justify-content: center;");
  });

  it("steps the gutter with the content container, not the viewport", () => {
    // A media query here would read the WINDOW, so the gutter would not react
    // to a sidebar opening — which is the thing that actually changes the
    // panel's width in this admin.
    expect(flat).toContain("@container content (max-width: 1024px)");
    expect(flat).toContain("@container content (max-width: 768px)");
  });
});
