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
import {
  expect,
  test,
  type APIRequestContext,
  type Frame,
  type Page,
} from "@playwright/test";

import { FLAT_LIST_FIXTURE, seedPage } from "./fixtures";
import {
  canvasFrameOf,
  createPocDriver,
  DROP_ZONES,
  POC_GEOMETRY_SETTLE_MS,
} from "./poc-driver";

/**
 * Properties whose transition moves the vertical edge this probe measures, so its timing counts.
 *
 * Paired with {@link NON_GEOMETRY_PROPERTIES}, and the pairing is the point: a property on
 * neither list is REFUSED. Two lists rather than one because the third state — "this test does
 * not know" — has nowhere to go in a single allowlist, where it collapses into "skip" and is
 * charged as zero.
 */
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
  "translate",
  "scale",
  "rotate",
  "all",
]);

/**
 * Properties whose transition CANNOT move that edge, so its timing is not charged.
 *
 * The reason this list exists rather than "everything not in the geometry list" is the failure
 * direction. A lone allowlist silently SKIPS what it has not heard of, so the first property
 * nobody thought of is charged as zero and the allowance passes over an edge that is still
 * travelling — `translate` is the ready example, an individual transform property that moves the
 * box and would not have been on a list written before it existed.
 *
 * With both lists, an unrecognised property is neither counted nor ignored: it stops the test and
 * names itself, and someone decides which list it belongs on. Both lists may be incomplete, and
 * being incomplete now costs a refusal rather than a false pass.
 *
 * Membership means "changes no box geometry": a paint-only property. `border-color` qualifies and
 * `border-width` does not, which is why the colour longhands are named individually rather than a
 * `border` prefix being matched.
 */
const NON_GEOMETRY_PROPERTIES = new Set([
  "background",
  "background-color",
  "background-position",
  "border-color",
  "border-top-color",
  "border-right-color",
  "border-bottom-color",
  "border-left-color",
  "box-shadow",
  "color",
  "fill",
  "outline-color",
  "opacity",
  "stroke",
  "text-shadow",
  "visibility",
]);

/**
 * How long a REAL drop zone's geometry keeps moving, read off the element itself.
 *
 * This asks the browser for the resolved answer rather than reconstructing it. Everything that
 * decides whether a zone animates — which sheet a rule lives in, its position in the cascade, an
 * `@media` or `@supports` wrapper, an ancestry selector, a `transition-delay` declared separately
 * from its duration, an inline `style` prop, or an `animation` instead of a `transition` — is
 * already resolved in `getComputedStyle` of the element that will actually move.
 *
 * Enumerating RULES cannot be made complete: each spelling handled reveals another, and the list
 * is the whole cascade. Reading the computed style of the real element has no such list.
 *
 * Both `transition` and `animation` are read, because either can move an edge and the probe waits
 * on the edge rather than on a mechanism.
 */
async function geometrySpanMs(
  frame: Frame,
  state: string | null
): Promise<number> {
  const result = await frame.evaluate(
    ([zoneSelector, geometry, safe, appliedState]) => {
      const zones = [...document.querySelectorAll(zoneSelector as string)];
      if (zones.length === 0)
        return { zones: 0, ms: 0, unclassified: [] as string[] };

      const ms = (value: string) =>
        value.split(",").map(v => Number.parseFloat(v.trim()) * 1000 || 0);
      const cycled = (list: number[], i: number) =>
        list.length === 0 ? 0 : list[i % list.length];

      const unclassified: string[] = [];
      let longest = 0;

      for (const zone of zones) {
        const el = zone as HTMLElement;
        const had = appliedState
          ? el.hasAttribute(appliedState as string)
          : false;
        if (appliedState) el.setAttribute(appliedState as string, "");
        const computed = getComputedStyle(el);

        // A running animation moves the edge for its whole duration whatever it animates, because
        // the keyframes are not inspectable from here. Charged in full rather than skipped.
        if (computed.animationName !== "none") {
          const durations = ms(computed.animationDuration);
          const delays = ms(computed.animationDelay);
          durations.forEach((d, i) => {
            longest = Math.max(longest, d + cycled(delays, i));
          });
        }

        const properties = computed.transitionProperty
          .split(",")
          .map(v => v.trim());
        const durations = ms(computed.transitionDuration);
        const delays = ms(computed.transitionDelay);
        const lastAll = properties.lastIndexOf("all");
        const named = [
          ...new Set(properties.filter(p => p !== "all" && p !== "none")),
        ];
        if (lastAll !== -1) {
          longest = Math.max(
            longest,
            cycled(durations, lastAll) + cycled(delays, lastAll)
          );
        }
        for (const property of named) {
          if ((safe as string[]).includes(property)) continue;
          if (!(geometry as string[]).includes(property)) {
            unclassified.push(property);
            continue;
          }
          const i = Math.max(properties.lastIndexOf(property), lastAll);
          longest = Math.max(longest, cycled(durations, i) + cycled(delays, i));
        }

        if (appliedState && !had) el.removeAttribute(appliedState as string);
      }
      return { zones: zones.length, ms: longest, unclassified };
    },
    [
      DROP_ZONES,
      [...GEOMETRY_PROPERTIES],
      [...NON_GEOMETRY_PROPERTIES],
      state,
    ] as const
  );

  // No zones means this is not the canvas, or the document rendered none — and a zero span from
  // an empty query reads exactly like a canvas that animates nothing.
  if (result.zones === 0) {
    throw new Error(
      `no elements matched "${DROP_ZONES}" in the canvas frame, so nothing was measured. A zero ` +
        "span here would be indistinguishable from a canvas whose zones do not move."
    );
  }
  if (result.unclassified.length > 0) {
    throw new Error(
      `a drop zone transitions ${result.unclassified.join(", ")}, which this test cannot place. ` +
        "Add each to GEOMETRY_PROPERTIES if it can move the zone's vertical edge, or to " +
        "NON_GEOMETRY_PROPERTIES if it changes only paint. Refused rather than skipped, because " +
        "skipping charges it as zero and passes the allowance over an edge still moving."
    );
  }
  return result.ms;
}

/**
 * How long each drop-zone state keeps its geometry moving, in ms, as the canvas behaves TODAY.
 *
 * The value rather than the CSS text, because the value is the fact the probe depends on: two
 * stylesheets can differ in every character and animate identically, and one character can change
 * the timing. Pinning the measurement makes a cosmetic edit free and a timing edit visible, which
 * is the direction that matters.
 *
 * All zero because #813 took the geometry out of flow at a fixed height, leaving only a
 * `background` transition. Do not edit these to clear a failure without reading what changed:
 * a nonzero value here is the canvas moving an edge the probe is about to measure.
 */
// The canvas iframe is only rendered above a certain width: the editor's rail, block library and
// inspector claim the row first, and below roughly 1280px the preview is dropped rather than
// squeezed. At the default viewport the mount waits out its timeout on an iframe that is present
// and never sized, which reads as a broken canvas rather than a narrow window. The same width
// every other canvas spec uses.
test.use({ viewport: { width: 2560, height: 1400 } });

// Booting the editor once per test is minutes across this file, and the default 30s budget is a
// per-test timeout rather than a per-action one.
test.describe.configure({ timeout: 240_000 });

const PINNED_SPANS_MS: Record<string, number> = {
  rest: 0,
  "data-drag": 0,
  "data-active": 0,
};

test.describe("the drop-zone geometry the probe waits on", () => {
  /** Boots the canvas and hands back its frame, which is where every read below happens. */
  async function canvas(
    page: Page,
    request: APIRequestContext
  ): Promise<Frame> {
    await createPocDriver(page).mountTree(
      await seedPage(request, FLAT_LIST_FIXTURE)
    );
    return canvasFrameOf(page);
  }

  test("every drop-zone state still moves for as long as it did", async ({
    page,
    request,
  }) => {
    const frame = await canvas(page, request);

    const measured: Record<string, number> = {};
    for (const state of Object.keys(PINNED_SPANS_MS)) {
      measured[state] = await geometrySpanMs(
        frame,
        state === "rest" ? null : state
      );
    }

    expect(
      measured,
      "a drop zone's geometry timing changed. Update PINNED_SPANS_MS here after reading what " +
        "moved, and raise POC_GEOMETRY_SETTLE_MS in poc-driver.ts if any span now exceeds it."
    ).toEqual(PINNED_SPANS_MS);
  });

  test("the driver's settle allowance covers every state", async ({
    page,
    request,
  }) => {
    const frame = await canvas(page, request);

    for (const state of Object.keys(PINNED_SPANS_MS)) {
      const spanMs = await geometrySpanMs(
        frame,
        state === "rest" ? null : state
      );
      // No `> 0` guard, deliberately: an empty zone query and an unclassifiable property both
      // THROW, so reaching here with 0 means the geometry genuinely does not move — which is what
      // this canvas declares today. Asserting a positive span would fail a correct canvas.
      expect(
        POC_GEOMETRY_SETTLE_MS,
        `geometrySettleMs is ${String(POC_GEOMETRY_SETTLE_MS)}ms and a drop zone in state ` +
          `"${state}" moves geometry for ${String(spanMs)}ms, so the probe can re-measure an edge ` +
          "that is still travelling. Raise it in poc-driver.ts."
      ).toBeGreaterThanOrEqual(spanMs);
    }
  });

  test("a transition added anywhere the cascade reaches is measured", async ({
    page,
    request,
  }) => {
    const frame = await canvas(page, request);

    // Every shape that defeated a rule-enumerating reader, applied at once: a DIFFERENT sheet
    // than the overlay, an ancestry selector, an `@media` wrapper, and a delay declared apart
    // from its duration. Reading the computed style of the real element resolves all four without
    // knowing about any of them.
    const injected = await frame.evaluate(() => {
      const sheet = (
        document.getElementById("nx-pb-style") as HTMLStyleElement | null
      )?.sheet;
      sheet?.insertRule(
        "@media all { body .nx-pb-dropzone { transition-property: height; transition-duration: .2s; transition-delay: .05s } }",
        sheet.cssRules.length
      );
      return Boolean(sheet);
    });
    expect(injected).toBe(true);

    // 200ms duration + 50ms delay, resolved through a media query, an ancestry selector, a
    // non-overlay sheet and split longhands.
    expect(await geometrySpanMs(frame, null)).toBe(250);
  });

  test("an ANIMATION that moves the edge is charged too", async ({
    page,
    request,
  }) => {
    const frame = await canvas(page, request);

    // A keyframe animation moves the edge without any transition being declared. Its keyframes
    // are not inspectable from here, so it is charged in full rather than skipped.
    const injected = await frame.evaluate(() => {
      const sheet = (
        document.getElementById("nx-pb-style") as HTMLStyleElement | null
      )?.sheet;
      sheet?.insertRule(
        "@keyframes nx-test-grow { from { height: 0 } to { height: 12px } }",
        sheet.cssRules.length
      );
      sheet?.insertRule(
        ".nx-pb-dropzone { animation: nx-test-grow .3s }",
        sheet.cssRules.length
      );
      return Boolean(sheet);
    });
    expect(injected).toBe(true);

    expect(await geometrySpanMs(frame, null)).toBe(300);
  });

  test("it refuses rather than reporting a zero it cannot stand behind", async ({
    page,
    request,
  }) => {
    const frame = await canvas(page, request);

    // A property on neither list stops the test and names itself.
    const injected = await frame.evaluate(() => {
      const sheet = (
        document.getElementById("nx-pb-style") as HTMLStyleElement | null
      )?.sheet;
      sheet?.insertRule(
        ".nx-pb-dropzone { transition: font-size .2s }",
        sheet.cssRules.length
      );
      return Boolean(sheet);
    });
    expect(injected).toBe(true);

    await expect(geometrySpanMs(frame, null)).rejects.toThrow(/cannot place/);
  });

  test("it measures in the canvas document, not the host", async ({
    page,
    request,
  }) => {
    const frame = await canvas(page, request);

    // The host page has no drop zones, so measuring there would find nothing and report zero.
    // This is what separates "the canvas does not move" from "I looked in the wrong document".
    await expect(geometrySpanMs(page.mainFrame(), null)).rejects.toThrow(
      /no elements matched/
    );
    // And the control: the canvas frame DOES have them.
    expect(await geometrySpanMs(frame, null)).toBe(0);
  });
});
