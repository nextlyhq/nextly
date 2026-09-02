/**
 * The page builder, measured against WCAG 2.2 AA by axe.
 *
 * A scan is the only instrument here that can be a BOUNDARY rather than a
 * habit. The unit suites can assert that a control has a label and that a
 * region has a name; they cannot see contrast, because jsdom applies no
 * stylesheet, and they cannot see the tree an assistive technology actually
 * walks, because that tree is the browser's.
 *
 * ## It scans the whole page, deliberately
 *
 * The editor takes the window, so nearly everything visible IS the editor —
 * and a violation on the admin behind it is one an author reaches the moment
 * they leave. Rooting the scan at the editor's own container would read as
 * tighter and would mostly hide the same page from itself.
 *
 * ONE rule is disabled, named below with its reason. An ignore LIST is how a
 * guard stops meaning anything; a single named exclusion with a cause is a
 * boundary someone can argue with.
 *
 * ## Why the violations are ENUMERATED rather than counted
 *
 * `expect(violations).toHaveLength(0)` is the obvious assertion and a bad one:
 * when it fails it says "expected 3 to be 0", which is a number rather than a
 * defect. The helper below reports rule ids and the elements carrying them, so
 * a failure names what to fix.
 *
 * @module tests/builder-a11y.spec
 */
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

import { gotoAdmin } from "./support/admin";

/**
 * The tags that define "AA", stated rather than left to axe's defaults.
 *
 * `wcag22aa` is the level B-23 names. The earlier levels are included because
 * 2.2 is additive: a page failing a 2.0 rule fails 2.2 as well, and omitting
 * them would let a scan pass while breaking something older and more basic.
 */
const AA_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

/**
 * `document-title` (WCAG 2.4.2), excluded because it is the HOST app's to fix
 * and this harness structurally cannot.
 *
 * Next emits `<title>` from a `metadata` export, which only a server component
 * may declare — and the playground's root layout is `"use client"`, because it
 * mounts the admin's providers. So the page under test has no title and no
 * amount of work in `packages/builder` would give it one. A real Nextly app
 * supplies its own.
 *
 * Named as one rule rather than filtered out of the results, so it appears in
 * the run's own record instead of only in this comment.
 */
const HOST_OWNED_RULES = ["document-title"];

/**
 * The readiness anchor — NOT a scan root.
 *
 * `scanEditor` deliberately does not `.include()` this: the scan is whole-page,
 * for the reason the module docblock gives. This constant only answers "has the
 * editor finished opening", so the scan never runs against a page that has not
 * arrived.
 *
 * Stated because the name invites the opposite reading, and acting on that
 * reading would be a regression rather than a tightening: the one violation
 * this suite has caught so far was admin chrome painted with a branded token —
 * a real defect reachable from the builder, which a scan rooted here would not
 * have seen.
 */
const EDITOR_READY_ANCHOR = '[aria-label="Editor panels"]';

interface Finding {
  id: string;
  impact: string;
  help: string;
  targets: string[];
}

/** What axe found, as something a failure message can name. */
async function scanEditor(page: Page): Promise<Finding[]> {
  const results = await new AxeBuilder({ page })
    .withTags(AA_TAGS)
    .disableRules(HOST_OWNED_RULES)
    .analyze();

  /*
   * The POPULATION, before any verdict. A scan that ran against nothing reports
   * zero violations exactly as a clean page does — measured here, an early run
   * of this suite reported zero while a deliberately broken button sat on the
   * page, because the result was being read from the wrong field. A passing
   * rule count is what separates "clean" from "did not look".
   */
  expect(
    results.passes.length,
    "axe reported no passing rules, so it scanned nothing — the zero below would mean nothing"
  ).toBeGreaterThan(10);

  return results.violations.map(violation => ({
    id: violation.id,
    impact: violation.impact ?? "unknown",
    help: violation.help,
    targets: violation.nodes.flatMap(node => node.target.map(String)),
  }));
}

/*
 * The control that opens the page builder, in EITHER state.
 *
 * The card names itself for the document it is showing — an empty page invites
 * you to build it, a populated one to open the builder — so a helper naming one
 * wording breaks whenever the fixture gains or loses blocks, and breaks with a
 * timeout that names the editor rather than the button. Kept as a literal
 * because this suite is deliberately black box and imports no product code;
 * the source of both strings is `PageBuilderCard`.
 */
const OPEN_BUILDER_ACTION = /^(?:Build this page|Open Page Builder)$/;

/** Open a document and put its page builder on screen. */
async function openEditor(page: Page): Promise<void> {
  await gotoAdmin(page, "/singles/homepage");
  await page.getByRole("button", { name: OPEN_BUILDER_ACTION }).click();
  // POPULATION BEFORE VERDICT. "No violations" is satisfied perfectly by an
  // editor that never opened, so the scan must not run until it has.
  await expect(page.locator(EDITOR_READY_ANCHOR)).toBeVisible({
    timeout: 30_000,
  });
}

test.describe("the page builder meets WCAG 2.2 AA", () => {
  test("has no violations when it opens", async ({ page }) => {
    await openEditor(page);

    const findings = await scanEditor(page);

    expect(
      findings,
      `axe reported ${findings.length} violation(s):\n${JSON.stringify(findings, null, 2)}`
    ).toEqual([]);
  });

  test("has no violations with a panel open", async ({ page }) => {
    // The inserter is a different tree from the canvas — a list of options with
    // its own roles — and a scan of the closed editor never reaches it.
    await openEditor(page);
    await page.getByRole("button", { name: "Insert" }).click();
    await expect(page.getByRole("option").first()).toBeVisible({
      timeout: 15_000,
    });

    const findings = await scanEditor(page);

    expect(
      findings,
      `axe reported ${findings.length} violation(s) with the inserter open:\n${JSON.stringify(findings, null, 2)}`
    ).toEqual([]);
  });

  test("has no violations in DARK mode", async ({ page }) => {
    /*
     * Contrast is the rule most likely to differ between the two, and it is the
     * one no unit test can reach: jsdom applies no stylesheet, so every colour
     * assertion in the component suites is really an assertion about a class
     * name. A palette that fails only in dark mode passes every one of them.
     */
    await page.addInitScript(
      ([key, value]) => window.localStorage.setItem(key, value),
      ["nextly-theme", "dark"] as const
    );
    await openEditor(page);

    const findings = await scanEditor(page);

    expect(
      findings,
      `axe reported ${findings.length} violation(s) in dark mode:\n${JSON.stringify(findings, null, 2)}`
    ).toEqual([]);
  });
});
