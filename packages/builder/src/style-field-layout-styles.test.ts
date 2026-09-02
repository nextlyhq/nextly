import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

/**
 * How a style field lays out, asserted against the sheet that decides it.
 *
 * A field's shape is not observable from a render test: jsdom applies no
 * stylesheet, so every assertion about which column a control sits in passes
 * whatever the sheet says. The declarations ARE the behaviour here, and this
 * reads them from the source sheet — `dist` is gitignored, so a check against
 * the built copy answers differently before and after a build.
 *
 * Each test below asserts a declaration inside the block that owns it, rather
 * than a substring of the file. A 2000-line sheet contains most short strings
 * somewhere, so `toContain` alone would go green on a declaration sitting in an
 * unrelated rule — which is the reading these tests exist to rule out.
 *
 * @module style-field-layout-styles.test
 */
const CHROME = readFileSync(
  fileURLToPath(new URL("./styles/builder-chrome.css", import.meta.url)),
  "utf8"
);

/**
 * The declarations of one rule, found by its exact selector.
 *
 * Scoped to the selector's own braces so a declaration is attributed to the
 * rule that makes it. Declaration blocks here hold no nested braces, so the
 * first `}` closes the rule.
 *
 * @param sheet - the stylesheet to read
 * @param selector - the selector text, exactly as written in the sheet
 * @returns the text between that rule's braces
 */
function ruleBody(sheet: string, selector: string): string {
  const open = sheet.indexOf(`${selector} {`);
  if (open === -1) throw new Error(`no rule for selector: ${selector}`);
  const start = open + `${selector} {`.length;
  const close = sheet.indexOf("}", start);
  if (close === -1) throw new Error(`unterminated rule: ${selector}`);
  return sheet.slice(start, close);
}

describe("a style field is a row", () => {
  it("puts the label in the label column by being a LABEL, not by position", () => {
    /*
     * The property that survives a field whose children arrive in another
     * order. A positional rule answers the same way for an ordinary field and
     * gets a checkbox row exactly backwards, so the sheet must not be
     * addressing the first child.
     */
    expect(ruleBody(CHROME, ".nx-inspector__field > label")).toContain(
      "grid-column: 1"
    );
    expect(CHROME).not.toContain(".nx-inspector__field > :first-child");
  });

  it("finds nothing for a selector that was never written", () => {
    /*
     * The control. Every assertion here is a search over one long file, and one
     * needle that MUST be absent is what shows the search can come out empty
     * rather than matching something incidental.
     */
    expect(CHROME).not.toContain(".nx-inspector__field > :nth-child(97)");
  });
});

describe("a checkbox row opts out of the label column", () => {
  it("restates display, which is what the grid makes necessary", () => {
    /*
     * The defect this replaces: the modifier set flex properties only, and a
     * flex property does not displace `display: grid`. The checkbox was then
     * sized to the label column with its words in the column beside it.
     */
    const inline = ruleBody(
      CHROME,
      ".nx-inspector__field.nx-inspector__field--inline"
    );

    expect(inline).toContain("display: flex");
    expect(inline).toContain("flex-direction: row");
  });

  it("wins regardless of where the two rules sit in the file", () => {
    /*
     * Two single-class selectors of equal specificity are decided by source
     * order, which makes the layout a property of the file's arrangement. The
     * doubled class states the precedence instead, so moving either rule cannot
     * silently put the checkbox back in the label column.
     */
    expect(CHROME).toContain(
      ".nx-inspector__field.nx-inspector__field--inline {"
    );
  });
});

describe("the segmented control", () => {
  it("draws each shared edge once, for three buttons as well as two", () => {
    /*
     * With two buttons "the last one" and "every one after the first" select
     * the same button, so the narrower rule looked correct for as long as two
     * was the only width offered. At three it leaves the first seam two borders
     * wide and the second one, and the segments stop reading as one control.
     */
    expect(
      ruleBody(CHROME, ".nx-style-inspector__toggle > button + button")
    ).toContain("border-inline-start-width: 0");
  });

  it("no longer takes the shared edge off the last button alone", () => {
    /*
     * The other half of the same decision. Left in place it would remove the
     * border a second time on the final button, which is harmless, and leave
     * the reason for the seam split between two rules that disagree about what
     * decides it.
     */
    expect(
      ruleBody(CHROME, ".nx-style-inspector__toggle > button:last-child")
    ).not.toContain("border-inline-start-width");
  });

  it("lets its buttons shrink, so the control cannot overflow the rail", () => {
    /*
     * A flex item's automatic minimum is its content, so without this the
     * control keeps its full text width and overflows the panel rather than
     * fitting inside it. This is what makes the control answer for its own
     * width at any rail size, and therefore what stops the field's stacking
     * threshold from being a second answer to the same question.
     */
    expect(ruleBody(CHROME, ".nx-style-inspector__toggle > button")).toContain(
      "min-width: 0"
    );
  });
});

describe("the field stacks before a control runs out of room", () => {
  it("asks the container, not the viewport", () => {
    /*
     * The rail is resizable while the window stays wide, so a media query would
     * answer for the wrong box.
     *
     * Read from the fields rule's own body rather than from the file. Three
     * comments elsewhere in this sheet discuss `container-type: inline-size`,
     * and a bare search over the file is satisfied by that prose — measured, by
     * removing the declaration and watching this test go on passing.
     */
    const fields = ruleBody(CHROME, ".nx-inspector__fields");

    expect(fields).toContain("container-type: inline-size");
    expect(fields).toContain("container-name: nx-inspector-fields");
  });

  it("stacks at a width the supported minimum rail actually reaches", () => {
    /*
     * The inspector's minimum is 280px and it carries 0.75rem of padding on
     * each side, which leaves 16rem of container. A threshold below that never
     * fires at the narrowest size the panel supports, so the row stays
     * two-column exactly where it has least room to be.
     *
     * Asserted as the number rather than as "some threshold" because the
     * arithmetic is the decision: 6.5rem of label and 0.5rem of gap leave under
     * 11rem for a control below 18rem.
     */
    expect(CHROME).toContain(
      "@container nx-inspector-fields (max-width: 18rem)"
    );
  });
});
