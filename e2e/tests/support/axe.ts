/**
 * axe's WCAG 2.2 AA scan of a whole admin page, for the specs that hold a
 * screen to it.
 *
 * The violations are enumerated by rule and element rather than counted, so
 * a failure names what to fix. The rule set and the one known shared-chrome
 * defect set aside are stated once, in `axe-scan.mjs`, so every spec scanning
 * an admin screen scans it the same way.
 *
 * @module e2e/tests/support/axe
 */
import AxeBuilder from "@axe-core/playwright";
import { expect, type Page } from "@playwright/test";

// The scan itself, its rules and the known defect live in plain JavaScript,
// which the visual check loads too.
import { scanAxe } from "./axe-scan.mjs";

type AxeResults = Awaited<ReturnType<AxeBuilder["analyze"]>>;

/**
 * Refuse a scan of nothing, which reports no violations too. Enough passing
 * rules shows a whole-page scan looked at a drawn page; a scoped scan must at
 * least have measured the contrast of something inside its scope.
 */
function expectScannedSomething(
  results: AxeResults,
  scope: { include: string } | undefined
): void {
  if (!scope) {
    expect(
      results.passes.length,
      "axe reported no passing rules, so it scanned nothing"
    ).toBeGreaterThan(10);
    return;
  }
  const measured = [...results.passes, ...results.violations]
    .filter(rule => rule.id === "color-contrast")
    .reduce((count, rule) => count + rule.nodes.length, 0);
  expect(
    measured,
    `axe measured no contrast inside ${scope.include}, so it scanned nothing`
  ).toBeGreaterThan(0);
}

/**
 * axe's AA violations, named so a failure says what to fix: on the whole page,
 * or only inside the elements `scope.include` selects, for a check that holds
 * one part of a screen to the standard.
 */
export async function expectNoAxeViolations(
  page: Page,
  scope?: { include: string }
): Promise<void> {
  if (scope) {
    // At least one of them drawn: a screen can hold a hidden copy of a part
    // (a table and its narrow-screen cards), which axe rightly skips.
    await expect(
      page.locator(scope.include).filter({ visible: true }).first()
    ).toBeVisible();
  }
  const { results, findings } = await scanAxe(page, scope);
  expectScannedSomething(results, scope);
  expect(
    findings,
    `axe reported ${findings.length} violation(s):\n${JSON.stringify(findings, null, 2)}`
  ).toEqual([]);
}

/** What axe measured of one element's contrast. */
interface ContrastMeasure {
  fgColor?: string;
  bgColor?: string;
  contrastRatio?: number;
  expectedContrastRatio?: string;
  messageKey?: string | null;
}

/**
 * The contrast of short text inside `include`, judged even where axe will
 * not judge it.
 *
 * axe declines to fail text of a character or two (`shortTextContent`) and
 * lists it as needing review, although it measured both colours. A day's
 * date and its count are exactly that text, so a scan alone passes a count
 * drawn at 3.9:1. This holds every such measurement to the ratio axe itself
 * expected, alongside the violations it did report; text it could not
 * measure at all (an overlapping layer) is left to the ordinary scan.
 */
export async function expectShortTextReadable(
  page: Page,
  include: string
): Promise<void> {
  const results = await new AxeBuilder({ page })
    .include(include)
    .withRules(["color-contrast"])
    .analyze();
  const short = results.incomplete
    .flatMap(rule => rule.nodes)
    .flatMap(node =>
      node.any
        .map(check => check.data as ContrastMeasure)
        // Measured: both colours read. Short text axe could not measure (a
        // layer over it) carries no colours, and is not judged here.
        .filter(
          data =>
            data.messageKey === "shortTextContent" &&
            Boolean(data.fgColor && data.bgColor)
        )
        .map(data => ({ target: node.target.map(String).join(" "), data }))
    );
  // The control: axe measured some contrast inside the scope, so a pass below
  // is a judgement and not an empty scan. Short text that reads well is a
  // plain pass; only short text that might not is held back for review.
  const measured =
    short.length +
    [...results.passes, ...results.violations].reduce(
      (count, rule) => count + rule.nodes.length,
      0
    );
  expect(
    measured,
    `axe measured no contrast inside ${include}, so this judged nothing`
  ).toBeGreaterThan(0);
  const findings = [
    ...results.violations.flatMap(rule =>
      rule.nodes.map(node => node.target.map(String).join(" "))
    ),
    ...short
      .filter(
        ({ data }) =>
          (data.contrastRatio ?? 0) <
          Number.parseFloat(data.expectedContrastRatio ?? "4.5")
      )
      .map(
        ({ target, data }) =>
          `${target}: ${data.fgColor} on ${data.bgColor} is ${data.contrastRatio}:1, below ${data.expectedContrastRatio}`
      ),
  ];
  expect(findings, `text below AA contrast:\n${findings.join("\n")}`).toEqual(
    []
  );
}

/**
 * The admin's own primary in each scheme, which a brand colour replaces: black
 * in light, white in dark.
 */
const DEFAULT_PRIMARIES = ["oklch(0 0 0)", "oklch(1 0 0)"];

/**
 * Confirm the brand colour is on before a scan that is meant to judge it.
 *
 * The suite's server runs with the playground's brand colours. Checked
 * rather than assumed: on the default palette the primary is the foreground
 * colour, and anything drawn in it passes whatever it is drawn with.
 */
export async function expectBrandColourApplied(page: Page): Promise<void> {
  const primary = await page
    .locator(".nextly-admin")
    .first()
    .evaluate(root =>
      getComputedStyle(root).getPropertyValue("--nx-primary").trim()
    );
  expect(primary, "no primary colour on the admin").not.toBe("");
  expect(
    DEFAULT_PRIMARIES,
    `the admin is on its default primary (${primary}), not a brand colour`
  ).not.toContain(primary);
}
