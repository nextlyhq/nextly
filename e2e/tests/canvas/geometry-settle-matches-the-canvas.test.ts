/**
 * The drop-zone timing the probe's settle allowance is chosen against.
 *
 * `poc-driver` declares `geometrySettleMs` — how long the canvas may still be moving a zone edge
 * after the pointer enters it — while the canvas decides that timing in its own stylesheets. Two
 * statements of one fact, in files that do not refer to each other, so this holds them together.
 *
 * It asserts two things and needs both:
 *
 * - each drop-zone state still moves for as long as {@link PINNED_SPANS_MS} records;
 * - the driver's allowance still covers every one of those spans.
 *
 * Either alone is satisfiable while the pair is wrong. Pinning only the spans passes when the
 * allowance is lowered underneath them; checking only the allowance passes when a transition is
 * lengthened and the pin is updated without anyone re-deriving the wait.
 *
 * ## Why this MEASURES rather than reads CSS
 *
 * Deciding from CSS means representing CSS, and then representing the cascade around it: rules
 * split across sheets, `@media` and `@supports` groups, ancestry selectors, inline styles, a
 * delay declared apart from its duration, a later rule overriding an earlier one, and `animation`
 * as an alternative to `transition` entirely. Each spelling handled reveals another, because the
 * surface is the whole cascade.
 *
 * `getComputedStyle` of a real drop zone has already resolved all of it, so this reads the element
 * that will actually move.
 *
 * What that does and does not buy is worth being exact about, because the two are easy to run
 * together. The BROWSER resolves the cascade — which rule wins, what a shorthand expands to, what
 * a `var()` evaluates to, whether an `@media` block applies. This helper still parses the COMPUTED
 * VALUE it gets back: splitting comma-separated lists, reading serialized times, and recognising
 * keywords like `none`, `infinite`, `auto` and `all`. So the edge cases it owns are those of the
 * computed-value grammar, which is small and stable, rather than those of the cascade, which is
 * not.
 *
 * The pin is therefore a SPAN, not a declaration. Two stylesheets can differ in every character
 * and animate identically, and one character can change the timing — pinning the measurement
 * makes a cosmetic edit free and a timing edit visible, which is the direction to want.
 */
import {
  expect,
  test,
  type APIRequestContext,
  type Frame,
  type Page,
} from "@playwright/test";

import { BOTH_ZONE_SHAPES_FIXTURE, seedPage } from "./fixtures";
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
        return {
          zones: 0,
          ms: 0,
          unclassified: [] as string[],
          nonDocumentTimelines: [] as string[],
        };

      // A value that is not a time cannot be measured, and `|| 0` would report it as instant —
      // the silent zero this file exists to remove. `NaN` is preserved and refused by the caller.
      const ms = (value: string) =>
        value.split(",").map(v => Number.parseFloat(v.trim()) * 1000);
      const cycled = (list: number[], i: number) =>
        list.length === 0 ? 0 : list[i % list.length];

      const unclassified: string[] = [];
      const nonDocumentTimelines: string[] = [];
      let longest = 0;

      for (const zone of zones) {
        const el = zone as HTMLElement;
        // A state may be a SET of attributes: the canvas can carry data-drag and data-active at
        // once, and a rule keyed on both is invisible to either alone.
        // Only the states this VARIANT can really enter. `DropZone` renders `data-drag` on the
        // between-item zone and not on the empty placeholder, which carries `data-active` alone —
        // so applying `data-drag` to an empty zone would measure a rule the canvas can never
        // trigger, and pin a span for movement that cannot happen.
        const rendered = (zone as HTMLElement).classList.contains(
          "nx-pb-dropzone-empty"
        )
          ? ["data-active"]
          : ["data-drag", "data-active"];
        const attrs = (
          appliedState ? (appliedState as string).split(" ") : []
        ).filter(a => rendered.includes(a));
        const had = attrs.filter(a => el.hasAttribute(a));
        // The VALUE React renders, not an empty string. `DropZone` passes
        // `data-active={isDropTarget || undefined}`, so the real DOM carries `data-active="true"`
        // and a rule keyed on that value would not match a probe that set `""`.
        for (const a of attrs) el.setAttribute(a, "true");
        // The element and its pseudo-elements. A `::before` that animates height inside an
        // auto-sized zone moves the zone's own bottom edge, and its timing appears in no computed
        // longhand of the element itself.
        // Three ways an effect's real timing is not in any computed longhand read below, and all
        // three are REFUSED rather than ignored: this file measures DECLARED CSS timing on the
        // zone and its pseudo-elements, and an effect it cannot read moves the edge just as surely.
        //
        // 1. A JS-driven animation carries its timing in the Web Animations API alone.
        // 2. A DECLARATIVE animation whose playback rate has been changed through that same API is
        //    still a `CSSAnimation`, so a class test accepts it, while `animationDuration` keeps
        //    reporting the declared time. At rate 0.5 the edge moves for twice as long; at rate 0
        //    it never finishes. The declaration has stopped being a statement about the edge.
        // 3. A declarative effect on a DESCENDANT. An in-flow child that animates its own height
        //    or margin moves an auto-sized zone's bottom edge, and its timing is in no longhand of
        //    the zone — so accepting it here while reading timing only from the zone reports zero
        //    for movement that is happening. Refused rather than measured because the two are
        //    different questions: what a descendant contributes to its ancestor's box depends on
        //    layout, and an animation's keyframes are not inspectable from here at all, so there
        //    is no honest number to charge.
        //
        // `subtree: true` is what makes 1 and 3 visible. It is required for 1 regardless, since
        // this function charges `::before` and `::after` CSS timing a few lines below and a
        // narrower population would refuse on the element while waving the pseudo-element through.
        // The surfaces whose longhands are actually read below. A pseudo-element's effect reports
        // the ORIGINATING element as its target, so a target test alone accepts EVERY pseudo —
        // including `::marker`, `::first-letter` and `::backdrop`, which this loop never reads and
        // which can change a line box inside an auto-sized zone. `pseudoElement` is what
        // distinguishes them, and anything outside this set is refused rather than read as zero.
        const READ_SURFACES = new Set([null, "::before", "::after"]);
        const own = (a: Animation) => {
          const effect = a.effect as KeyframeEffect | null;
          if (!effect || effect.target !== el) return false;
          return READ_SURFACES.has(effect.pseudoElement ?? null);
        };
        const unreadable = el
          .getAnimations({ subtree: true })
          .filter(
            a =>
              (!(a instanceof CSSAnimation) && !(a instanceof CSSTransition)) ||
              a.playbackRate !== 1 ||
              !own(a)
          );
        if (unreadable.length > 0) {
          // Restored BEFORE returning. An early return that skips cleanup leaves the probe's
          // attributes on a real canvas element, so every later read in this run — and the
          // author's own canvas — sees a state the probe invented.
          for (const a of attrs) if (!had.includes(a)) el.removeAttribute(a);
          return {
            zones: -1,
            ms: 0,
            unclassified: [] as string[],
            nonDocumentTimelines: [] as string[],
          };
        }

        // The element and BOTH pseudo-elements, through one reader. A pseudo that animates or
        // transitions an in-flow dimension moves an auto-sized zone's own edge, and its timing is
        // in no computed longhand of the element. One loop over all three rather than a separate
        // pseudo path: every mechanism charged here — iteration counts, delays, transitions —
        // applies identically to a pseudo-element, so a second accounting could only be a shorter
        // copy of this one.
        for (const surface of [
          getComputedStyle(el),
          getComputedStyle(el, "::before"),
          getComputedStyle(el, "::after"),
        ]) {
          if (surface.animationName !== "none") {
            // Driven by the NAME list, because that decides how many animations run. CSS cycles a
            // shorter timing list across every name, so iterating durations would stop at the
            // first and miss the rest.
            const names = surface.animationName.split(",");
            const durations = ms(surface.animationDuration);
            const delays = ms(surface.animationDelay);
            // Each cycle moves the edge again, so the span is duration x ITERATIONS, not one
            // pass. `infinite` parses as `Infinity`: an edge that never settles cannot be covered
            // by any allowance, and the caller refuses on it. A count of ZERO is legitimate and
            // means the animation never runs, so it survives rather than defaulting to a pass.
            const counts = surface.animationIterationCount.split(",").map(v => {
              const text = v.trim();
              if (text === "infinite") return Infinity;
              const parsed = Number.parseFloat(text);
              return Number.isNaN(parsed) ? 1 : parsed;
            });
            // Which CLOCK each animation runs on. `auto` is the document timeline, where a
            // duration is the wall-clock time this probe assumes. A scroll or view timeline drives
            // progress from scroll position instead, so a perfectly ordinary `.1s` describes no
            // elapsed time at all and the edge keeps moving on the next scroll — the declared
            // number is not wrong, it is about something else. Refused rather than charged.
            //
            // Read through `??` because a browser without timeline support exposes no such
            // longhand; there the value is correctly `auto`, since nothing can be driven by a
            // timeline the engine does not implement.
            const timelines = (surface.animationTimeline ?? "auto").split(",");
            names.forEach((name, i) => {
              // `none` occupies a position in every timing list but starts no animation, so its
              // tuple would charge movement that never happens.
              if (name.trim() === "none") return;
              const timeline =
                timelines.length === 0
                  ? ""
                  : timelines[i % timelines.length].trim();
              // An empty entry is not treated as `auto`: it means the longhand could not be read,
              // and defaulting an unreadable clock to the one this probe can measure is the silent
              // pass the file exists to remove.
              if (timeline !== "auto") {
                nonDocumentTimelines.push(timeline || "(unreadable)");
                return;
              }
              // Nor does a zero-iteration entry, and its DELAY is equally irrelevant: under the
              // default fill mode nothing is applied before the first iteration, and there is no
              // first iteration. Charging the delay would report a wait for movement that never
              // begins.
              const count = cycled(counts, i);
              if (count === 0) return;
              longest = Math.max(
                longest,
                cycled(durations, i) * count + cycled(delays, i)
              );
            });
          }

          const properties = surface.transitionProperty
            .split(",")
            .map(v => v.trim());
          const durations = ms(surface.transitionDuration);
          const delays = ms(surface.transitionDelay);
          // `all` MATCHES every property, so it competes with each named entry rather than
          // sitting beside it: with `height,all`, CSS gives height the `all` entry's timing
          // because it comes later. Its own entry still counts, for the geometry properties
          // nothing else names.
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
            longest = Math.max(
              longest,
              cycled(durations, i) + cycled(delays, i)
            );
          }
        }

        for (const a of attrs) if (!had.includes(a)) el.removeAttribute(a);
      }
      return {
        zones: zones.length,
        ms: longest,
        unclassified,
        nonDocumentTimelines,
      };
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
  if (Number.isNaN(result.ms)) {
    throw new Error(
      "a drop zone declares an animation or transition whose duration is not a time this test " +
        "could parse, so its span is unknown. Reporting a number would certify an allowance " +
        "against a movement nobody measured."
    );
  }
  if (result.nonDocumentTimelines.length > 0) {
    throw new Error(
      "a drop-zone animation runs on a non-document timeline (" +
        [...new Set(result.nonDocumentTimelines)].join(", ") +
        "). Its progress is driven by scroll position rather than by elapsed time, so its " +
        "duration is not a wall-clock span and a later scroll moves the edge again. Charging " +
        "that duration would pin a number this probe cannot stand behind."
    );
  }
  if (result.zones === -1) {
    throw new Error(
      "a drop zone is running an effect whose real timing is not in any computed longhand this " +
        "reads: an animation driven by the Web Animations API rather than declared in CSS, a " +
        "declared one whose playback rate was changed through that API, or a declarative effect " +
        "on a DESCENDANT — whose in-flow movement changes an auto-sized zone's own edge while its " +
        "timing appears in no longhand of the zone. This measurement cannot see any of them, so " +
        "it refuses instead of reporting a span that ignores one."
    );
  }
  if (result.zones === 0) {
    throw new Error(
      `no elements matched "${DROP_ZONES}" in the canvas frame, so nothing was measured. A zero ` +
        "span here would be indistinguishable from a canvas whose zones do not move."
    );
  }
  if (!Number.isFinite(result.ms)) {
    throw new Error(
      "a drop zone runs an animation that never ends, so its edge never settles and no allowance " +
        "can cover it. Reporting a number here would certify a wait that cannot be long enough."
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
 * All zero, and the two zone shapes are zero for DIFFERENT reasons — which is why one sentence
 * cannot stand for both, and why the shape that is easier to disturb is worth naming:
 *
 * - `.nx-pb-dropzone` is `position: absolute` at a fixed `height: 6px`, and the only property it
 *   transitions is `background`. Out of flow and fixed, so nothing it animates can move an edge.
 * - `.nx-pb-dropzone-empty` is IN FLOW at an auto height, sized by its own padding and border. It
 *   is zero only because it declares no transition at all and its `[data-active]` rule changes
 *   `border-color`, `background` and `color` — paint alone. A transition added to its padding,
 *   border-width or margin WOULD move its edge, and this pin is what would report that.
 *
 * Do not edit these to clear a failure without reading what changed: a nonzero value here is the
 * canvas moving an edge the probe is about to measure.
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
  // Both at once. `DropZone` sets `data-drag` for the whole drag and `data-active` on top when the
  // zone is the target, so the combined state is what an author sees as a drop lands — and a rule
  // keyed on both is invisible to either alone.
  "data-drag data-active": 0,
};

test.describe("the drop-zone geometry the probe waits on", () => {
  /** Boots the canvas and hands back its frame, which is where every read below happens. */
  async function canvas(
    page: Page,
    request: APIRequestContext
  ): Promise<Frame> {
    await createPocDriver(page).mountTree(
      await seedPage(request, BOTH_ZONE_SHAPES_FIXTURE)
    );
    return canvasFrameOf(page);
  }

  test("the fixture renders BOTH zone shapes, so the guards cover both", async ({
    page,
    request,
  }) => {
    const frame = await canvas(page, request);

    // The population the pin and allowance guards below actually measure. Asserted by MEMBERSHIP
    // rather than by a count: a fixture rendering only between-item zones lets those guards read
    // as covering the canvas while measuring half of it, and that is invisible from their result.
    const shapes = await frame.evaluate(() => ({
      between: document.querySelectorAll(".nx-pb-dropzone").length,
      empty: document.querySelectorAll(".nx-pb-dropzone-empty").length,
    }));

    expect(shapes.between).toBeGreaterThan(0);
    expect(
      shapes.empty,
      "no empty placeholder rendered, so every guard in this file measures only the between-item " +
        "zone while the driver waits on both shapes"
    ).toBeGreaterThan(0);
  });

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

  test("a REPEATED animation is charged for every iteration", async ({
    page,
    request,
  }) => {
    const frame = await canvas(page, request);

    // One pass is 100ms; three passes move the edge for 300ms. Counting a single pass would pin
    // 100, and the allowance would then cover a third of the movement.
    const injected = await frame.evaluate(() => {
      const sheet = (
        document.getElementById("nx-pb-style") as HTMLStyleElement | null
      )?.sheet;
      sheet?.insertRule(
        "@keyframes nx-test-rep { from { height: 0 } to { height: 12px } }",
        sheet.cssRules.length
      );
      sheet?.insertRule(
        ".nx-pb-dropzone { animation: nx-test-rep .1s 3 }",
        sheet.cssRules.length
      );
      return Boolean(sheet);
    });
    expect(injected).toBe(true);

    expect(await geometrySpanMs(frame, null)).toBe(300);
  });

  test("an ENDLESS animation is refused, not certified finite", async ({
    page,
    request,
  }) => {
    const frame = await canvas(page, request);

    // An edge that never settles cannot be covered by any allowance. Reporting its per-pass
    // duration would pin a number and certify a wait that can never be long enough.
    const injected = await frame.evaluate(() => {
      const sheet = (
        document.getElementById("nx-pb-style") as HTMLStyleElement | null
      )?.sheet;
      sheet?.insertRule(
        "@keyframes nx-test-inf { from { height: 0 } to { height: 12px } }",
        sheet.cssRules.length
      );
      sheet?.insertRule(
        ".nx-pb-dropzone { animation: nx-test-inf .1s infinite }",
        sheet.cssRules.length
      );
      return Boolean(sheet);
    });
    expect(injected).toBe(true);

    await expect(geometrySpanMs(frame, null)).rejects.toThrow(/never ends/);
  });

  test("an animation set to run ZERO times moves nothing", async ({
    page,
    request,
  }) => {
    const frame = await canvas(page, request);

    // `iteration-count: 0` is valid CSS and means the animation never runs. Defaulting a falsy
    // parse to 1 would charge a full pass for an edge that never moves - over-reporting, which
    // reads as safe and is how a wrong pin gets written down.
    const injected = await frame.evaluate(() => {
      const sheet = (
        document.getElementById("nx-pb-style") as HTMLStyleElement | null
      )?.sheet;
      sheet?.insertRule(
        "@keyframes nx-test-zero { from { height: 0 } to { height: 12px } }",
        sheet.cssRules.length
      );
      sheet?.insertRule(
        ".nx-pb-dropzone { animation: nx-test-zero .2s 0 }",
        sheet.cssRules.length
      );
      return Boolean(sheet);
    });
    expect(injected).toBe(true);

    expect(await geometrySpanMs(frame, null)).toBe(0);
  });

  test("a SECOND animation name is charged when the timing list is shorter", async ({
    page,
    request,
  }) => {
    const frame = await canvas(page, request);

    // Two names, one duration: CSS cycles the duration across both. Iterating the DURATION list
    // stops after one entry and never reaches the second animation.
    const injected = await frame.evaluate(() => {
      const sheet = (
        document.getElementById("nx-pb-style") as HTMLStyleElement | null
      )?.sheet;
      sheet?.insertRule(
        "@keyframes nx-a { from { height: 0 } to { height: 4px } }",
        sheet.cssRules.length
      );
      sheet?.insertRule(
        "@keyframes nx-b { from { height: 0 } to { height: 8px } }",
        sheet.cssRules.length
      );
      // One duration, one delay list of two: the SECOND name carries the longer delay, so it is
      // only reachable by walking the names.
      sheet?.insertRule(
        ".nx-pb-dropzone { animation-name: nx-a, nx-b; animation-duration: .1s; animation-delay: 0s, .4s }",
        sheet.cssRules.length
      );
      return Boolean(sheet);
    });
    expect(injected).toBe(true);

    // 100ms cycled onto the second name, plus its own 400ms delay.
    expect(await geometrySpanMs(frame, null)).toBe(500);
  });

  test("`none` among animation names charges nothing for that slot", async ({
    page,
    request,
  }) => {
    const frame = await canvas(page, request);

    // `none` holds a position in every timing list but starts no animation. Charging its tuple
    // would report movement that never happens - conservative, but wrong, and a wrong number here
    // gets pinned and then trusted.
    const injected = await frame.evaluate(() => {
      const sheet = (
        document.getElementById("nx-pb-style") as HTMLStyleElement | null
      )?.sheet;
      sheet?.insertRule(
        "@keyframes nx-real { from { height: 0 } to { height: 4px } }",
        sheet.cssRules.length
      );
      sheet?.insertRule(
        ".nx-pb-dropzone { animation-name: none, nx-real; animation-duration: .9s, .1s }",
        sheet.cssRules.length
      );
      return Boolean(sheet);
    });
    expect(injected).toBe(true);

    // Only the real animation is charged; the 900ms belonging to `none` is not movement.
    expect(await geometrySpanMs(frame, null)).toBe(100);
  });

  test("the probe leaves no state behind, even on the refusing path", async ({
    page,
    request,
  }) => {
    const frame = await canvas(page, request);

    // A Web Animations effect, which is the ONE path that returns before the normal cleanup.
    // Without it this test never reaches the branch it exists for: the ordinary path cleans up
    // anyway, so the assertion passes whether or not the early return restores anything.
    const started = await frame.evaluate(() => {
      const zone = document.querySelector(".nx-pb-dropzone");
      if (!zone) return false;
      // Endless, so it cannot finish during the round trip before `getAnimations()` is asked. A
      // finite one makes this control pass on a fast worker and quietly stop testing anything on
      // a loaded one - coverage that evaporates exactly when CI needs it most.
      (zone as HTMLElement).animate([{ height: "0px" }, { height: "12px" }], {
        duration: 300,
        iterations: Infinity,
      });
      return true;
    });
    expect(started).toBe(true);

    // It must refuse - that is the branch under test.
    await expect(
      geometrySpanMs(frame, "data-drag data-active")
    ).rejects.toThrow(/Web Animations API/);

    // And it must not have left the attributes it set on a real canvas element.
    const leftBehind = await frame.evaluate(
      () =>
        [...document.querySelectorAll(".nx-pb-dropzone")].filter(
          el => el.hasAttribute("data-drag") || el.hasAttribute("data-active")
        ).length
    );
    expect(leftBehind).toBe(0);
  });

  test("a rule keyed on the attribute VALUE React renders is matched", async ({
    page,
    request,
  }) => {
    const frame = await canvas(page, request);

    // `DropZone` passes `data-active={isDropTarget || undefined}`, so React renders the string
    // "true". A probe setting `""` matches `[data-active]` but not `[data-active="true"]`, and
    // the miss is silent - the zone reports no movement at all.
    const injected = await frame.evaluate(() => {
      const sheet = (
        document.getElementById("nx-pb-style") as HTMLStyleElement | null
      )?.sheet;
      sheet?.insertRule(
        '.nx-pb-dropzone[data-active="true"] { transition: height .2s }',
        sheet.cssRules.length
      );
      return Boolean(sheet);
    });
    expect(injected).toBe(true);

    expect(await geometrySpanMs(frame, "data-active")).toBe(200);
  });

  test("an animation on a zone PSEUDO-element is charged", async ({
    page,
    request,
  }) => {
    const frame = await canvas(page, request);

    // A ::before animating height inside an auto-sized zone moves the zone's own bottom edge,
    // and its timing is in no computed longhand of the element itself.
    const injected = await frame.evaluate(() => {
      const sheet = (
        document.getElementById("nx-pb-style") as HTMLStyleElement | null
      )?.sheet;
      sheet?.insertRule(
        "@keyframes nx-pseudo { from { height: 0 } to { height: 6px } }",
        sheet.cssRules.length
      );
      sheet?.insertRule(
        '.nx-pb-dropzone::before { content: ""; animation: nx-pseudo .4s }',
        sheet.cssRules.length
      );
      return Boolean(sheet);
    });
    expect(injected).toBe(true);

    expect(await geometrySpanMs(frame, null)).toBe(400);
  });

  test("a pseudo-element TRANSITION is charged like the element's own", async ({
    page,
    request,
  }) => {
    const frame = await canvas(page, request);

    // A transition on a pseudo-element moves an auto-sized zone's edge exactly as an animation
    // does, so both mechanisms are charged on both pseudo-elements.
    const injected = await frame.evaluate(() => {
      const sheet = (
        document.getElementById("nx-pb-style") as HTMLStyleElement | null
      )?.sheet;
      sheet?.insertRule(
        '.nx-pb-dropzone::after { content: ""; transition: height .35s }',
        sheet.cssRules.length
      );
      return Boolean(sheet);
    });
    expect(injected).toBe(true);

    expect(await geometrySpanMs(frame, null)).toBe(350);
  });

  test("a REPEATED pseudo-element animation is charged for every iteration", async ({
    page,
    request,
  }) => {
    const frame = await canvas(page, request);

    // A pseudo-element's span is charged for every iteration, exactly as the element's is: each
    // cycle moves the edge again, so a 100ms animation repeated three times keeps it travelling
    // for 300ms, and an endless one never settles at all.
    const injected = await frame.evaluate(() => {
      const sheet = (
        document.getElementById("nx-pb-style") as HTMLStyleElement | null
      )?.sheet;
      sheet?.insertRule(
        "@keyframes nx-ps-rep { from { height: 0 } to { height: 6px } }",
        sheet.cssRules.length
      );
      sheet?.insertRule(
        '.nx-pb-dropzone::before { content: ""; animation: nx-ps-rep .1s 3 }',
        sheet.cssRules.length
      );
      return Boolean(sheet);
    });
    expect(injected).toBe(true);

    expect(await geometrySpanMs(frame, null)).toBe(300);
  });

  test("a zero-iteration animation charges neither duration nor DELAY", async ({
    page,
    request,
  }) => {
    const frame = await canvas(page, request);

    // Zero iterations with a long delay. Under the default fill mode nothing is applied before
    // the first iteration and there is no first iteration, so the 400ms wait is for movement that
    // never begins - charging it pins a span the canvas cannot produce.
    const injected = await frame.evaluate(() => {
      const sheet = (
        document.getElementById("nx-pb-style") as HTMLStyleElement | null
      )?.sheet;
      sheet?.insertRule(
        "@keyframes nx-zero-delay { from { height: 0 } to { height: 6px } }",
        sheet.cssRules.length
      );
      sheet?.insertRule(
        ".nx-pb-dropzone { animation: nx-zero-delay .2s .4s 0 }",
        sheet.cssRules.length
      );
      return Boolean(sheet);
    });
    expect(injected).toBe(true);

    expect(await geometrySpanMs(frame, null)).toBe(0);
  });

  test("a state the empty zone never renders is not synthesized onto it", async ({
    page,
    request,
  }) => {
    const frame = await canvas(page, request);

    // Measured on the zone the canvas itself rendered, not on an element built here. A
    // hand-made `div` carries the class and nothing else that decides the answer - the markup
    // `DropZone`'s empty branch emits, its place in the tree, and the rules the cascade brings
    // with that place - so it can only ever confirm the probe against the probe's own idea of an
    // empty zone.
    const probe = await frame.evaluate(() => {
      const sheet = (
        document.getElementById("nx-pb-style") as HTMLStyleElement | null
      )?.sheet;
      sheet?.insertRule(
        ".nx-pb-dropzone-empty[data-drag] { transition: height .3s }",
        sheet.cssRules.length
      );
      return {
        injected: Boolean(sheet),
        empty: document.querySelectorAll(".nx-pb-dropzone-empty").length,
      };
    });
    // Both asserted before the verdict, because each failure is silent in the passing
    // direction: with no rule there is nothing to measure, and with no empty zone there is
    // nothing to measure it on. Either way the assertion below reports 0 having looked at
    // nothing.
    expect(probe.injected).toBe(true);
    expect(probe.empty).toBeGreaterThan(0);

    // `DropZone`'s empty branch renders `data-active` only; `data-drag` belongs to the
    // between-item zone. A rule keyed on `[data-drag]` for an empty zone can never fire, so
    // measuring it would pin a span for movement the canvas cannot produce.
    expect(await geometrySpanMs(frame, "data-drag")).toBe(0);
  });

  test("an effect on a pseudo-element this loop never reads is refused", async ({
    page,
    request,
  }) => {
    const frame = await canvas(page, request);

    // `::marker` is a real, layout-bearing pseudo-element whose effect reports the ORIGINATING
    // element as its target — so a target test alone calls it readable while this loop reads only
    // the element, `::before` and `::after`. That combination reports zero for movement inside an
    // auto-sized zone's line box.
    const planted = await frame.evaluate(() => {
      const sheet = (
        document.getElementById("nx-pb-style") as HTMLStyleElement | null
      )?.sheet;
      sheet?.insertRule(
        "@keyframes nx-marker-grow { from { font-size: 8px } to { font-size: 40px } }",
        sheet.cssRules.length
      );
      sheet?.insertRule(
        ".nx-pb-dropzone-empty { display: list-item }",
        sheet.cssRules.length
      );
      sheet?.insertRule(
        ".nx-pb-dropzone-empty::marker { animation: nx-marker-grow .3s 100 }",
        sheet.cssRules.length
      );
      const zone = document.querySelector(".nx-pb-dropzone-empty");
      if (!zone) return null;
      const effects = zone.getAnimations({ subtree: true });
      return {
        count: effects.length,
        // The population that makes this test about `pseudoElement` rather than about `target`:
        // the effect must belong to the ZONE and name a pseudo outside the read set.
        onUnreadPseudo: effects.some(a => {
          const effect = a.effect as KeyframeEffect | null;
          return (
            effect?.target === zone &&
            effect.pseudoElement != null &&
            !["::before", "::after"].includes(effect.pseudoElement)
          );
        }),
      };
    });
    expect(planted).not.toBeNull();
    expect(planted?.count).toBeGreaterThan(0);
    expect(planted?.onUnreadPseudo).toBe(true);

    await expect(geometrySpanMs(frame, "data-active")).rejects.toThrow(
      /timing is not in any computed longhand this reads/
    );
  });

  test("a DESCENDANT's declarative animation is refused, not reported as zero", async ({
    page,
    request,
  }) => {
    const frame = await canvas(page, request);

    // The empty placeholder is in flow at an auto height, so a child growing its own height moves
    // the zone's bottom edge. Nothing about that appears in the zone's own longhands, which is why
    // reading only the zone reports zero while the edge is travelling.
    const planted = await frame.evaluate(() => {
      const sheet = (
        document.getElementById("nx-pb-style") as HTMLStyleElement | null
      )?.sheet;
      sheet?.insertRule(
        "@keyframes nx-child-grow { from { height: 0 } to { height: 40px } }",
        sheet.cssRules.length
      );
      sheet?.insertRule(
        ".nx-pb-child-probe { animation: nx-child-grow .3s 100 }",
        sheet.cssRules.length
      );
      const zone = document.querySelector(".nx-pb-dropzone-empty");
      if (!zone) return null;
      const child = document.createElement("div");
      child.className = "nx-pb-child-probe";
      zone.append(child);
      // The effect must exist and must belong to the CHILD, not to the zone — the whole point of
      // the refusal is the target being someone else.
      const animations = zone.getAnimations({ subtree: true });
      return {
        count: animations.length,
        onChild: animations.some(
          a => (a.effect as KeyframeEffect | null)?.target === child
        ),
      };
    });
    // Population before verdict: no empty zone, no rule, or an effect that never started would
    // each leave the refusal below firing for some other reason, or not at all.
    expect(planted).not.toBeNull();
    expect(planted?.count).toBeGreaterThan(0);
    expect(planted?.onChild).toBe(true);

    await expect(geometrySpanMs(frame, "data-active")).rejects.toThrow(
      /DESCENDANT/
    );
  });

  test("an animation on a SCROLL timeline is refused, not read as its duration", async ({
    page,
    request,
  }) => {
    const frame = await canvas(page, request);

    // A perfectly ordinary `.2s` that describes no elapsed time: `scroll()` drives progress from
    // scroll position, so the edge moves again on the next scroll and no allowance covers it.
    // 200ms is chosen deliberately — it EXCEEDS the driver's allowance, so a probe that read it as
    // wall-clock would produce a span, not a refusal, and this test's rejection can only come from
    // the timeline being recognised.
    const injected = await frame.evaluate(() => {
      const sheet = (
        document.getElementById("nx-pb-style") as HTMLStyleElement | null
      )?.sheet;
      sheet?.insertRule(
        "@keyframes nx-scrolled { from { height: 0 } to { height: 6px } }",
        sheet.cssRules.length
      );
      sheet?.insertRule(
        ".nx-pb-dropzone { animation: nx-scrolled .2s; animation-timeline: scroll() }",
        sheet.cssRules.length
      );
      const zone = document.querySelector(".nx-pb-dropzone");
      return zone
        ? getComputedStyle(zone as HTMLElement).animationTimeline
        : null;
    });
    // The population, before the verdict. A browser without scroll-timeline support resolves this
    // to `auto`, and the refusal below would then be firing for some other reason — or the rule
    // never applied at all. Neither is this test passing.
    expect(injected).toContain("scroll");

    await expect(
      geometrySpanMs(frame, "data-drag data-active")
    ).rejects.toThrow(/non-document timeline/);
  });

  test("a DECLARED animation that was slowed through the API is refused", async ({
    page,
    request,
  }) => {
    const frame = await canvas(page, request);

    // The case a class test cannot see: still a `CSSAnimation`, so it is not "scripted", while its
    // declared 200ms now describes 400ms of movement. Charging the declaration would UNDER-report,
    // which is the direction that lets the allowance pass over an edge still travelling.
    const applied = await frame.evaluate(async () => {
      const sheet = (
        document.getElementById("nx-pb-style") as HTMLStyleElement | null
      )?.sheet;
      sheet?.insertRule(
        "@keyframes nx-slowed { from { height: 0 } to { height: 6px } }",
        sheet.cssRules.length
      );
      // FINITE, and long enough to still be running when the probe reads it. `infinite` would be
      // the obvious choice for the second property and it destroys the first: an endless animation
      // is already refused for being endless, so this control would pass with the playback-rate
      // clause removed and prove nothing about it. At 100 iterations the span is a measurable
      // 20000ms, so without that clause the probe RETURNS a number instead of refusing.
      sheet?.insertRule(
        ".nx-pb-dropzone { animation: nx-slowed .2s 100 }",
        sheet.cssRules.length
      );
      const zone = document.querySelector(".nx-pb-dropzone");
      if (!zone) return null;
      const animation = zone
        .getAnimations()
        .find(a => a instanceof CSSAnimation);
      if (!animation) return null;
      // `updatePlaybackRate` sets a PENDING rate that lands when the animation is next ready, so
      // reading it back immediately would report the old one — and this control would then be
      // measuring an animation still running at rate 1.
      animation.updatePlaybackRate(0.5);
      await animation.ready;
      return { isCssAnimation: true, rate: animation.playbackRate };
    });
    // The population, before the verdict: no rule, no animation, or a rate that never applied all
    // leave the refusal below firing for some other reason, or not firing at all.
    expect(applied).not.toBeNull();
    expect(applied?.isCssAnimation).toBe(true);
    expect(applied?.rate).toBe(0.5);

    await expect(
      geometrySpanMs(frame, "data-drag data-active")
    ).rejects.toThrow(/playback rate/);
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
