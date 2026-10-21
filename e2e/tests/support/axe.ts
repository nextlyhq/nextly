/**
 * axe's WCAG 2.2 AA scan of a whole admin page, for the specs that hold a
 * screen to it.
 *
 * The violations are enumerated by rule and element rather than counted, so
 * a failure names what to fix. The rule set and the one known shared-chrome
 * defect set aside are stated here once, so every spec scanning an admin
 * screen scans it the same way.
 *
 * @module e2e/tests/support/axe
 */
import AxeBuilder from "@axe-core/playwright";
import { expect, type Page } from "@playwright/test";

/** WCAG 2.2 AA and every level below it, as `builder-a11y.spec.ts` states. */
const AA_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

/**
 * The host app's `<title>`, which the playground's client root layout cannot
 * declare. The reason is given in full in `builder-a11y.spec.ts`.
 */
const HOST_OWNED_RULES = ["document-title"];

/**
 * One known defect in the shared chrome, set aside by rule AND place.
 *
 * The sidebar's icon rail shows an icon only on each link, with the name in a
 * tooltip, so axe reports `link-name` on every one of them, on every admin
 * screen. It is a real defect in the admin's shared chrome, filed to be fixed
 * there; when that lands, this goes. Until then the scan drops exactly those
 * results: `link-name` nodes inside the rail. Every other rule still runs on
 * the rail, and `link-name` still fails anywhere else, so a new problem in
 * either place is not hidden the way excluding the element would hide it.
 */
const KNOWN_DEFECT = { rule: "link-name", within: "aside nav" } as const;

/** axe's AA violations on the whole page, named so a failure says what to fix. */
export async function expectNoAxeViolations(page: Page): Promise<void> {
  const results = await new AxeBuilder({ page })
    .withTags(AA_TAGS)
    .disableRules(HOST_OWNED_RULES)
    .analyze();
  // A scan of nothing reports no violations too; enough passing rules shows
  // it looked at a drawn page.
  expect(
    results.passes.length,
    "axe reported no passing rules, so it scanned nothing"
  ).toBeGreaterThan(10);
  const findings = [];
  for (const v of results.violations) {
    const targets: string[] = [];
    for (const node of v.nodes) {
      const selector = node.target.map(String).join(" ");
      if (v.id === KNOWN_DEFECT.rule) {
        // Asked of the page itself: a selector alone cannot say where its
        // element sits.
        const inRail = await page.evaluate(
          ([sel, within]) =>
            document.querySelector(sel)?.closest(within) != null,
          [selector, KNOWN_DEFECT.within] as const
        );
        if (inRail) continue;
      }
      targets.push(selector);
    }
    if (targets.length > 0) {
      findings.push({ id: v.id, impact: v.impact ?? "unknown", targets });
    }
  }
  expect(
    findings,
    `axe reported ${findings.length} violation(s):\n${JSON.stringify(findings, null, 2)}`
  ).toEqual([]);
}
