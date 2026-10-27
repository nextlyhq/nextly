/**
 * axe's WCAG 2.2 AA scan of an admin page: the rule set, the one known
 * shared-chrome defect set aside, and the violations named by rule and
 * element. `axe.ts` holds a spec to it; the visual check reports from it.
 *
 * Plain JavaScript, so the visual check (`scripts/visual-check`) can load it
 * on every Node version `engines` allows, with no type stripping.
 *
 * @module e2e/tests/support/axe-scan
 */
import AxeBuilder from "@axe-core/playwright";

/** WCAG 2.2 AA and every level below it, as `builder-a11y.spec.ts` states. */
const AA_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

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
const KNOWN_DEFECT = { rule: "link-name", within: "aside nav" };

/**
 * Whether one flagged element is the known shared-chrome defect.
 *
 * @param {import("@playwright/test").Page} page
 * @param {string} rule
 * @param {string} selector
 * @returns {Promise<boolean>}
 */
async function isKnownDefect(page, rule, selector) {
  if (rule !== KNOWN_DEFECT.rule) return false;
  // Asked of the page itself: a selector alone cannot say where its element
  // sits. The function runs in the page, so it reads the page's `document`.
  return page.evaluate(
    ([sel, within]) =>
      globalThis.document.querySelector(sel)?.closest(within) != null,
    [selector, KNOWN_DEFECT.within]
  );
}

/**
 * Waits for every running CSS transition to end, so what is measured or
 * captured next is what a reader sees once the page is still.
 *
 * The dark palette is applied by an effect after mount, so an element drawn
 * before it eases its colours across (Tailwind's `transition-colors`), and a
 * scan in that window measures a light-mode colour on the dark background: a
 * contrast failure no reader ever sees. Transitions only: they end, while a
 * skeleton's pulse repeats for good.
 *
 * @param {import("@playwright/test").Page} page
 * @returns {Promise<void>}
 */
export async function settleTransitions(page) {
  await page.evaluate(() =>
    Promise.all(
      globalThis.document
        .getAnimations()
        .filter(animation => animation instanceof globalThis.CSSTransition)
        .map(animation => animation.finished.catch(() => undefined))
    )
  );
}

/**
 * axe's AA scan of the page, or of the elements `scope.include` selects, with
 * the known shared-chrome defect set aside: the raw results, for a caller that
 * judges how much was scanned, and each broken rule with every element it was
 * found on.
 *
 * The one scan both the specs and the visual check run, so a page they both
 * look at is held to the same rules in each.
 *
 * @param {import("@playwright/test").Page} page
 * @param {{ include: string }} [scope]
 * @returns {Promise<{
 *   results: Awaited<ReturnType<AxeBuilder["analyze"]>>,
 *   findings: Array<{ id: string, impact: string, targets: string[] }>
 * }>}
 */
export async function scanAxe(page, scope) {
  // Every AA rule runs, `document-title` included: the admin names the tab
  // for each screen, so the page under test always has a title.
  let builder = new AxeBuilder({ page }).withTags(AA_TAGS);
  if (scope) builder = builder.include(scope.include);
  // Settled before measuring, so no colour is read mid-transition.
  await settleTransitions(page);
  const results = await builder.analyze();
  const findings = [];
  for (const v of results.violations) {
    const targets = [];
    for (const node of v.nodes) {
      const selector = node.target.map(String).join(" ");
      if (!(await isKnownDefect(page, v.id, selector))) targets.push(selector);
    }
    if (targets.length > 0) {
      findings.push({ id: v.id, impact: v.impact ?? "unknown", targets });
    }
  }
  return { results, findings };
}
