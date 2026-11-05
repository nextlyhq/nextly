import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

/**
 * Where the expose icon sits beside a property in a component's own view,
 * asserted against the sheet that decides it.
 *
 * jsdom applies no stylesheet, so a render test passes whatever the sheet
 * says about columns. The plausible broken layout is the one this replaced: a
 * column of its own for the icon, which takes its width from the CONTROL's
 * column and clips a wide control (a heading's H1 to H6) or wraps it ("This
 * tab · A new tab"). The property that separates the two is that the prop row
 * keeps ONE column, the field's own, and the icon is drawn in the field's
 * first row at the end of its label column, the label keeping room for it.
 *
 * @module expose-toggle-styles.test
 */
const CHROME = readFileSync(
  fileURLToPath(new URL("./styles/builder-chrome.css", import.meta.url)),
  "utf8"
);

/** The declarations of one rule, found by its exact selector. */
function ruleBody(selector: string): string {
  const open = CHROME.indexOf(`${selector} {`);
  if (open === -1) throw new Error(`no rule for selector: ${selector}`);
  const start = open + `${selector} {`.length;
  return CHROME.slice(start, CHROME.indexOf("}", start));
}

/** The label column's width, as the field grid declares it. */
function labelColumn(): string {
  const columns = /grid-template-columns:\s*minmax\(0,\s*([\d.]+rem)\)/.exec(
    ruleBody(".nx-inspector__field")
  );
  if (columns?.[1] === undefined) throw new Error("no label column");
  return columns[1];
}

describe("the expose icon beside a property", () => {
  it("takes no column of the control's: the prop row keeps the field's one", () => {
    const row = ruleBody(".nx-inspector__prop");
    expect(row).toContain("grid-template-columns: minmax(0, 1fr);");
    expect(row).not.toMatch(/auto/);
  });

  it("is drawn in the field's first row, at the end of its label column", () => {
    const toggle = ruleBody(".nx-expose__toggle");
    expect(toggle).toContain("grid-column: 1;");
    expect(toggle).toContain("grid-row: 1;");
    expect(toggle).toContain("justify-self: start;");
    // The label column's own width, less the icon's: its trailing edge,
    // reaching half into the gap before the control and no further.
    expect(toggle).toContain(
      `margin-left: calc(${labelColumn()} + 0.25rem - var(--nx-expose-toggle-size));`
    );
    expect(ruleBody(".nx-inspector__field")).toContain("column-gap: 0.5rem;");
  });

  it("leaves the label room for it, held or not", () => {
    // Found by the rule's first selector: a long selector list is wrapped
    // across lines by the formatter, so the whole list is read up to `{`.
    const first = ".nx-inspector__prop > .nx-inspector__field > label,";
    const at = CHROME.indexOf(first);
    expect(at).toBeGreaterThan(-1);
    const open = CHROME.indexOf("{", at);
    const selectors = CHROME.slice(at, open).replace(/\s+/g, " ");
    const body = CHROME.slice(open + 1, CHROME.indexOf("}", open));
    expect(selectors).toContain(
      ".nx-inspector__prop > .nx-inspector__held > .nx-inspector__field > label"
    );
    expect(body).toContain("padding-right: var(--nx-expose-toggle-size);");
  });

  it("is drawn over the Shown row's words too, not on a row of its own", () => {
    expect(ruleBody(".nx-expose-shown .nx-expose__shown")).toContain(
      "grid-row: 1;"
    );
  });
});

describe("a variant's value row", () => {
  it("reuses the inspector's row grid rather than a copy of its own", () => {
    // The row is an `.nx-inspector__field` (see the variants panel test), so
    // its columns are that grid's; a template of its own here is the copy
    // that drifted, with a wider label and a narrower value.
    expect(ruleBody(".nx-variants__value")).not.toContain(
      "grid-template-columns"
    );
    expect(ruleBody(".nx-inspector__field")).toContain(
      "grid-template-columns: minmax(0, 6.5rem) minmax(0, 1fr);"
    );
  });

  it("keeps its dot in the label column, and Reset in a 24px slot", () => {
    const label = ruleBody(".nx-variants__value > .nx-variants__value-label");
    expect(label).toContain("grid-column: 1;");
    expect(label).toContain("grid-row: 1;");
    const slot = ruleBody(".nx-variants__reset-slot");
    expect(slot).toContain("flex: 0 0 1.5rem;");
    expect(slot).toContain("width: 1.5rem;");
  });
});
