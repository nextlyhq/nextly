/**
 * The drop-zone timing the probe's settle allowance is chosen against.
 *
 * `poc-driver` declares `geometrySettleMs` — how long the canvas may still be moving a zone edge
 * after the pointer enters it — while the canvas animates that geometry in its own stylesheet.
 * Two statements of one fact, in files that do not refer to each other, so this holds them
 * together.
 *
 * It asserts two things, and needs both:
 *
 * - the stylesheet declaration is UNCHANGED, so a timing edit cannot pass unnoticed;
 * - the driver's allowance still covers the span that declaration produces.
 *
 * Either alone is satisfiable while the pair is wrong. Pinning only the text passes when the
 * allowance is lowered underneath it; checking only the allowance passes when the transition is
 * lengthened.
 *
 * ## Why the declaration is PINNED rather than parsed
 *
 * Computing a span from CSS source means representing CSS: comma-separated entries whose commas
 * may belong to a timing function, times that may be signed or written as `calc()` or resolved
 * through a variable, properties that may appear last or be implicit, longhand declarations that
 * override the shorthand, and only some properties moving the edge this probe measures. A regex
 * cannot represent that, and each spelling handled reveals another.
 *
 * Pinning makes no semantic claim, which is what makes it complete: every one of those spellings
 * changes the text, so every one trips this, and none requires the test to understand what it
 * changed to. The cost is that a cosmetic edit trips it as well — which is the direction to want,
 * because whoever edits that line is who should re-derive the allowance.
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { expect, test, type Page } from "@playwright/test";

import { POC_GEOMETRY_SETTLE_MS } from "./poc-driver";

const CANVAS_CSS = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../../packages/plugin-page-builder/src/admin/canvas/IframeCanvas.tsx"
);

/**
 * The drop-zone geometry, as ONE statement: the declaration exactly as the canvas writes it, and
 * how long the geometry in it keeps moving.
 *
 * Kept in a single structure so the two cannot be updated apart. They were separate constants, and
 * separate constants invite the half-edit: paste the new declaration, leave the number, and both
 * assertions below pass while the probe tolerates less than the canvas takes. Editing this literal
 * puts the span under the reader's cursor at the moment they change the text.
 *
 * `spanMs` is read off `declaration` by a person. It cannot go stale on its own — the only thing
 * that changes it is an edit to that text, which the first assertion refuses.
 */
const PINNED_DECLARATION =
  '".nx-pb-dropzone{height:0;border-radius:3px;transition:height .1s ease,background .1s ease}",';

/** Properties whose transition moves the vertical edge this probe measures. */
const GEOMETRY_PROPERTIES = new Set([
  "height",
  "min-height",
  "max-height",
  "block-size",
  "margin",
  "margin-top",
  "margin-bottom",
  "padding",
  "padding-top",
  "padding-bottom",
  "top",
  "bottom",
  "inset",
  "transform",
  "all",
]);

/**
 * How long the geometry in a rule keeps moving, computed BY THE BROWSER.
 *
 * The rule is injected into a real document and the resulting `transition-*` longhands are read
 * back off a matching element. Those are already resolved: the shorthand is expanded, each
 * property paired with its own duration and delay, times normalised to seconds, and `calc()`,
 * `var()` and signed values evaluated. Nothing here interprets CSS syntax.
 *
 * That is the point. Computing this span from source text means reimplementing CSS, and the only
 * implementation guaranteed to agree with the canvas is the one the canvas runs in.
 */
async function geometrySpanMs(
  page: Page,
  declaration: string
): Promise<number> {
  // The pinned literal is a quoted, comma-suffixed line of a TypeScript array; the rule inside it
  // is what a browser can accept.
  const rule = declaration.trim().replace(/^"/, "").replace(/",?$/, "");
  return page.evaluate(
    ([css, geometry]) => {
      const style = document.createElement("style");
      style.textContent = css as string;
      document.head.append(style);
      const el = document.createElement("div");
      el.className = "nx-pb-dropzone";
      document.body.append(el);
      const computed = getComputedStyle(el);
      const seconds = (value: string) =>
        value.split(",").map(v => Number.parseFloat(v.trim()) * 1000);
      const properties = computed.transitionProperty
        .split(",")
        .map(v => v.trim());
      const durations = seconds(computed.transitionDuration);
      const delays = seconds(computed.transitionDelay);
      let longest = 0;
      properties.forEach((property, i) => {
        if (!(geometry as string[]).includes(property)) return;
        longest = Math.max(longest, (durations[i] ?? 0) + (delays[i] ?? 0));
      });
      el.remove();
      style.remove();
      return longest;
    },
    [rule, [...GEOMETRY_PROPERTIES]] as const
  );
}

/** Every drop-zone line declaring a transition, trimmed, in file order. */
function transitionLines(source: string): string[] {
  return source
    .split("\n")
    .map(line => line.trim())
    .filter(
      line => line.includes("nx-pb-dropzone") && line.includes("transition")
    );
}

test("the drop-zone geometry timing has not changed under the probe", () => {
  const found = transitionLines(readFileSync(CANVAS_CSS, "utf8"));

  // A selector that matched nothing would satisfy an equality against an empty expectation and
  // certify a file it never read.
  expect(found.length).toBeGreaterThan(0);

  expect(
    found,
    "the canvas drop-zone transition changed. Update PINNED_DECLARATION here; the span it " +
      "produces is computed by the browser, so nothing else needs recalculating — but raise " +
      "POC_GEOMETRY_SETTLE_MS in poc-driver.ts if the new span exceeds it."
  ).toEqual([PINNED_DECLARATION]);
});

test("the driver's settle allowance covers that geometry", async ({ page }) => {
  const spanMs = await geometrySpanMs(page, PINNED_DECLARATION);

  // A computation that returned 0 for every input would satisfy the comparison below by being
  // smaller than any allowance, so the derivation is required to have found something.
  expect(spanMs).toBeGreaterThan(0);

  expect(
    POC_GEOMETRY_SETTLE_MS,
    `geometrySettleMs is ${String(POC_GEOMETRY_SETTLE_MS)}ms and the drop-zone geometry moves for ` +
      `${String(spanMs)}ms, so the probe can re-measure an edge that is still travelling. Raise it ` +
      "in poc-driver.ts."
  ).toBeGreaterThanOrEqual(spanMs);
});

test("the span derivation reads geometry and ignores the rest", async ({
  page,
}) => {
  // Controls on the derivation itself, since the pinned rule exercises only one shape. The browser
  // resolves the syntax; what is asserted here is that the RIGHT properties are counted and that a
  // delay is included.
  const span = (rule: string) =>
    geometrySpanMs(page, `".nx-pb-dropzone{${rule}}",`);

  expect(await span("transition:height .1s ease")).toBe(100);
  expect(await span("transition:height .1s ease .05s")).toBe(150);
  // A colour moves no edge this probe measures, so its longer timing is not charged.
  expect(await span("transition:height .1s ease,background .3s ease")).toBe(
    100
  );
  // The browser evaluates what a regex could not.
  expect(await span("transition:height calc(.04s + .03s) ease")).toBe(70);
});
