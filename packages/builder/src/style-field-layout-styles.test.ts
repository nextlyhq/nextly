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
     * Every button gives its leading border up and the first takes it back, so
     * the number of buttons cannot enter into it. The alternative — removing
     * the border from the LAST button — is right only while there are exactly
     * two, because at two "the last one" and "every one after the first" select
     * the same element. At three it leaves the first seam two borders wide and
     * the second one, and the segments stop reading as one control.
     */
    expect(ruleBody(CHROME, ".nx-style-inspector__toggle > button")).toContain(
      "border-inline-start-width: 0"
    );
    expect(
      ruleBody(CHROME, ".nx-style-inspector__toggle > button:first-child")
    ).toContain("border-inline-start-width: 1px");
  });

  it("no longer takes the shared edge off the last button alone", () => {
    /*
     * The other half of the same decision, and the reason this is stated from
     * the first button rather than the last: a rule keyed on the final button
     * is a rule about the count, and it agrees with this one only at two.
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

describe("a segmented choice's selected state", () => {
  /** The one rule every chosen segment and toggle is drawn by. */
  const chosen = () =>
    ruleBody(
      CHROME,
      '.nx-style-inspector__toggle > button[aria-pressed="true"],\n.nx-style-inspector__toggle > button[aria-checked="true"],\n.nx-segment__option[aria-checked="true"],\n.nx-icon-choice__option[aria-checked="true"]'
    );

  it("is told by its words' weight and colour, not by its fill alone", () => {
    // The accent fill alone measured about 1.7:1 against the unselected
    // background in dark, under 3:1: "This tab" and "New tab" could not be
    // told apart.
    const button = ruleBody(CHROME, ".nx-style-inspector__toggle > button");
    expect(button).toContain("font-weight: 500");
    expect(button).toContain("color: var(--nx-muted-foreground)");
    expect(chosen()).toContain("font-weight: 600");
  });

  it("is filled with the panel's text colour, never the brand accent", () => {
    // The accent is the site's brand colour, set at run time: an orange one
    // measured 1.83:1 under the white label in dark. The panel's own pair is
    // the most contrast either mode has, for the label and the fill.
    expect(chosen()).toContain("background: var(--nx-foreground)");
    expect(chosen()).toContain("color: var(--nx-background)");
    expect(chosen()).not.toContain("--nx-accent");
    expect(CHROME).not.toContain(
      '.dark .nx-style-inspector__toggle > button[aria-checked="true"]'
    );
  });
});

describe("Visible on", () => {
  it("is separate toggles, a gap between them, each with its own edge", () => {
    // A joined strip reads as "pick one"; this is "pick any".
    expect(ruleBody(CHROME, ".nx-visible-on")).toContain("gap: 0.375rem");
    const button = ruleBody(CHROME, ".nx-visible-on > button");
    expect(button).toContain("border-inline-start-width: 1px");
    expect(button).toContain("border-radius: var(--radius-md)");
  });

  it("marks the device being edited with a dot, not a line", () => {
    const marker = ruleBody(
      CHROME,
      ".nx-visible-on > button[data-editing]::before"
    );
    expect(marker).toContain("border-radius: 50%");
    expect(marker).toContain("background: var(--nx-ring)");
    expect(
      ruleBody(CHROME, ".nx-visible-on > button[data-editing]")
    ).not.toContain("box-shadow");
  });
});

describe("an inspector switch", () => {
  it("is a 24px target, with no other target needed out of its way", () => {
    // The shared switch is 18px tall. A target under 24px passes only when no
    // other target sits within 12px of its centre, and an on/off row ends
    // directly above "Visible on", so the switch is sized to pass alone.
    const root = ruleBody(
      CHROME,
      ':is(.nx-inspector, .nx-style-inspector) [data-slot="switch"]'
    );
    expect(root).toContain("block-size: 1.5rem");
    expect(root).toContain("inline-size: 2.5rem");
    // Its thumb grows with it, so the track's inset stays one pixel a side:
    // 2.5rem less a 1px border each side, less the thumb, is the 18px that
    // the thumb's `calc(100% - 2px)` travel covers.
    expect(
      ruleBody(
        CHROME,
        ':is(.nx-inspector, .nx-style-inspector) [data-slot="switch-thumb"]'
      )
    ).toContain("block-size: 1.25rem");
  });
});

describe("opacity's slider and field", () => {
  it("lays the slider across the row, the number and its percent sign after it", () => {
    const row = ruleBody(CHROME, ".nx-style-inspector__opacity");
    expect(row).toContain("display: flex");
    expect(row).toContain("align-items: center");
    // The number holds three digits and no more of the row.
    expect(
      ruleBody(
        CHROME,
        ".nx-style-inspector__opacity > .nx-style-inspector__numeric"
      )
    ).toContain("flex: 0 0 3.5rem");
    expect(ruleBody(CHROME, ".nx-style-inspector__percent")).toContain(
      "color: var(--nx-builder-text-muted)"
    );
  });
});

describe("a custom aspect ratio", () => {
  it("puts its width and height on one line under the menu", () => {
    const ratio = ruleBody(CHROME, ".nx-style-inspector__ratio");
    expect(ratio).toContain("display: grid");
    expect(ratio).toContain("row-gap: 0.375rem");
    const custom = ruleBody(CHROME, ".nx-style-inspector__ratio-custom");
    expect(custom).toContain("display: grid");
    expect(custom).toContain(
      "grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr)"
    );
  });
});

describe("an icon choice's help line", () => {
  it("takes a line of its own under the icons, rather than a column beside them", () => {
    // Beside the strip it had what was left of the row, one word a line.
    expect(ruleBody(CHROME, ".nx-icon-choice")).toContain("flex-wrap: wrap");
    expect(ruleBody(CHROME, ".nx-icon-choice__help")).toContain(
      "flex-basis: 100%"
    );
  });
});

describe("text decoration's icons and style", () => {
  it("puts Style… beside the icons, and the popover's parts in rows", () => {
    const row = ruleBody(CHROME, ".nx-style-inspector__decoration");
    expect(row).toContain("display: flex");
    expect(row).toContain("flex-wrap: wrap");
    // A control's height and a quiet edge, as the inspector's other buttons.
    const style = ruleBody(CHROME, ".nx-style-inspector__decoration-style");
    expect(style).toContain("block-size: var(--nx-builder-control-height)");
    expect(style).toContain("border: 1px solid var(--nx-builder-border)");
    expect(ruleBody(CHROME, ".nx-style-inspector__decoration-part")).toContain(
      "grid-template-columns: 5.5rem minmax(0, 1fr)"
    );
    // A square segment, so the four icons and it fit the control column.
    expect(style).toContain("inline-size: var(--nx-builder-control-height)");
    // Mounted outside the inspector, the popover takes its density itself:
    // without it, its text and fields were the page's 16px and 40px.
    const popover = ruleBody(
      CHROME,
      '[data-slot="popover-content"].nx-style-inspector__decoration-popover'
    );
    expect(popover).toContain("font-size: var(--nx-builder-font-size)");
    expect(popover).toContain(
      "--nx-control-height: var(--nx-builder-control-height)"
    );
  });
});
