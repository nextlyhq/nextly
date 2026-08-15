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
 * The drop-zone rule carrying the transition, exactly as the canvas writes it.
 *
 * The only thing here maintained by hand, and deliberately so: an exact-text comparison is what
 * makes a timing edit VISIBLE rather than silently absorbed. How long that timing lasts is not
 * written down — {@link geometrySpanMs} computes it in a browser — so there is no second value to
 * keep in step.
 *
 * Do not edit this to clear a failure without reading what changed. The failure is the
 * notification that the geometry timing moved.
 */
const PINNED_RULES: readonly string[] = [
  ".nx-pb-dropzone { position: absolute; left: 0px; right: 0px; top: -3px; height: 6px; border-radius: 3px; background: transparent; pointer-events: none; z-index: 3; transition: background 0.1s; }",
];

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
 * States a drop zone is drawn in, so a rule qualified by one is still measurable.
 *
 * The canvas carries its geometry on the unqualified rule today and declares `[data-drag]` and
 * `[data-active]` beside it, so a transition moved onto one of those is an ordinary edit rather
 * than an exotic one. A probe element that only ever wears the class would match nothing, compute
 * a zero span, and report that the geometry had stopped moving.
 */
const PROBE_STATES = [null, "data-drag", "data-active"];

/**
 * Every class the driver measures, DERIVED from the driver's own selector.
 *
 * `nx-pb-dropzone-empty` does not carry `nx-pb-dropzone` — they are two classes, not a class and
 * a modifier — and the driver waits on both. A probe that only ever wore the first could not
 * measure a transition added to the empty placeholder, so the allowance for a target the driver
 * really does wait on would have no maintenance path at all.
 *
 * Split from `DROP_ZONES` rather than restated here, so a third zone shape added to the driver is
 * measurable by this test without anyone remembering to come back.
 */
const PROBE_CLASSES = DROP_ZONES.split(",").map(part =>
  part.trim().replace(/^\./, "")
);

/**
 * How long the geometry in a rule keeps moving, measured INSIDE THE CANVAS.
 *
 * The rule is injected into the canvas frame and the resulting `transition-*` longhands are read
 * off a matching element there. Everything that decides those values is already correct in that
 * document: the cascade, the selector scope, the theme tokens the canvas inherits, and `var()`
 * with or without a fallback. Nothing here interprets CSS or TypeScript syntax.
 *
 * Measuring anywhere else means REBUILDING that context, and the context is not reconstructible —
 * a custom property's value is decided by the cascade rather than by any one declaration.
 */
async function geometrySpanMs(frame: Frame, rule: string): Promise<number> {
  const result = await frame.evaluate(
    ([css, safe, states, geometry, classes]) => {
      const style = document.createElement("style");
      style.textContent = css as string;
      document.head.append(style);
      const el = document.createElement("div");
      document.body.append(el);
      const cleanup = () => {
        el.remove();
        style.remove();
      };

      // The rule must actually apply to the probe, or every timing read below is the browser's
      // initial value and the span comes out zero — indistinguishable from a transition that was
      // deliberately removed. The selector is handed to `matches` as text, so nothing here
      // interprets it; class and state are tried in turn because a rule on the empty placeholder,
      // or qualified by a drag state, is an ordinary edit rather than a strange one.
      const selector = (css as string)
        .slice(0, (css as string).indexOf("{"))
        .trim();
      let matched = false;
      for (const cls of classes as string[]) {
        for (const state of states as (string | null)[]) {
          el.className = cls;
          for (const attr of states as (string | null)[]) {
            if (attr) el.removeAttribute(attr);
          }
          if (state) el.setAttribute(state, "");
          if (el.matches(selector)) {
            matched = true;
            break;
          }
        }
        if (matched) break;
      }
      if (!matched) {
        cleanup();
        return {
          matched: false,
          ms: 0,
          unclassified: [] as string[],
          discarded: false,
        };
      }

      // Whether the declaration survived PARSING. A value the browser cannot parse is dropped and
      // the rule stands, leaving the computed style at the initial `all 0s` — a silent zero that
      // covers any allowance.
      const parsed = (style.sheet?.cssRules[0] as CSSStyleRule | undefined)
        ?.style;
      const declared = parsed
        ? parsed.transition ||
          parsed.transitionProperty ||
          parsed.transitionDuration
        : "";

      const computed = getComputedStyle(el);
      const properties = computed.transitionProperty
        .split(",")
        .map(v => v.trim());
      const durations = computed.transitionDuration
        .split(",")
        .map(v => Number.parseFloat(v.trim()) * 1000);
      const delays = computed.transitionDelay
        .split(",")
        .map(v => Number.parseFloat(v.trim()) * 1000);

      // Declared something, computed the INITIAL value: the declaration was discarded after
      // parsing — an unresolved `var()` with no fallback is the way that happens. Asked as
      // "declared but not applied" rather than by scanning the text for `var(`, because a
      // fallback makes an undefined property perfectly valid and a name scan cannot see that.
      const isInitial =
        properties.length === 1 &&
        properties[0] === "all" &&
        durations.every(d => d === 0);
      const discarded =
        Boolean(declared) && isInitial && !declared.includes("all");
      if (!declared || discarded) {
        cleanup();
        return { matched: true, ms: 0, unclassified: [], discarded: true };
      }

      // CSS CYCLES a timing list shorter than `transition-property`: with three properties and one
      // duration, all three take that duration. Reading a missing index as zero would report a
      // geometry transition as instant.
      const cycled = (list: number[], i: number) =>
        list.length === 0 ? 0 : list[i % list.length];
      const spanAt = (i: number) => cycled(durations, i) + cycled(delays, i);

      // `all` MATCHES every property, so it competes with each named entry rather than sitting
      // beside it: with `height,all`, CSS gives height the `all` entry's timing because it comes
      // later. Its own entry still counts, for the geometry properties nothing else names.
      const lastAll = properties.lastIndexOf("all");
      const named = [
        ...new Set(properties.filter(p => p !== "all" && p !== "none")),
      ];
      const unclassified: string[] = [];
      let longest = lastAll === -1 ? 0 : spanAt(lastAll);
      for (const property of named) {
        if ((safe as string[]).includes(property)) continue;
        if (!(geometry as string[]).includes(property)) {
          unclassified.push(property);
          continue;
        }
        longest = Math.max(
          longest,
          spanAt(Math.max(properties.lastIndexOf(property), lastAll))
        );
      }
      cleanup();
      return { matched: true, ms: longest, unclassified, discarded: false };
    },
    [
      rule,
      [...NON_GEOMETRY_PROPERTIES],
      PROBE_STATES,
      [...GEOMETRY_PROPERTIES],
      PROBE_CLASSES,
    ] as const
  );

  if (!result.matched) {
    throw new Error(
      `the rule "${rule}" matches no drop-zone probe element, so its timing cannot be read and a ` +
        `zero span would be indistinguishable from a removed transition. Add the state it is ` +
        `qualified by to PROBE_STATES.`
    );
  }
  if (result.discarded) {
    throw new Error(
      `the browser did not apply the transition in "${rule}" — it parsed to nothing, or was ` +
        `discarded at computed-value time. Either way the computed style is the initial 0s, which ` +
        `covers any allowance, so this refuses rather than reporting zero.`
    );
  }
  if (result.unclassified.length > 0) {
    throw new Error(
      `the transition names ${result.unclassified.join(", ")}, which this test cannot place. Add ` +
        `each to GEOMETRY_PROPERTIES if it can move the zone's vertical edge, or to ` +
        `NON_GEOMETRY_PROPERTIES if it changes only paint. It is refused rather than skipped ` +
        `because skipping charges it as zero and passes the allowance over an edge still moving.`
    );
  }
  return result.ms;
}

/**
 * The rules that give a drop zone a transition, read from the RUNNING canvas.
 *
 * Two questions, and both are answered structurally rather than by matching text.
 *
 * WHICH RULES APPLY: each rule's selector is tested against the probe elements with `matches`,
 * not searched for the substring `nx-pb-dropzone`. A rule can reach a drop zone without naming
 * its class — `[data-active]{transition:height .2s}` applies to one and contains no such text —
 * and a text filter drops it while the base rule keeps the pin equal, so the allowance passes
 * over a zone that moves for 200ms.
 *
 * WHICH DECLARE A TRANSITION: asked of the parsed declaration rather than of the rule's text, so
 * a shorthand, a longhand and a `var()` all answer the same way.
 *
 * Read from the stylesheet the browser parsed — `<style id="nx-pb-overlay">` in the canvas frame —
 * rather than from `IframeCanvas.tsx`. Reading the source would mean representing TypeScript,
 * where an array entry may be an identifier, a template literal or a call, and it cannot represent
 * the cascade at all, which is where a custom property's value is decided.
 */
async function transitionRules(frame: Frame): Promise<string[]> {
  const rules = await frame.evaluate(
    ([classes, states]) => {
      const overlay = document.getElementById(
        "nx-pb-overlay"
      ) as HTMLStyleElement | null;
      if (!overlay?.sheet) return null;

      const probe = document.createElement("div");
      document.body.append(probe);
      const applies = (selector: string) => {
        for (const cls of classes as string[]) {
          for (const state of states as (string | null)[]) {
            probe.className = cls;
            for (const attr of states as (string | null)[]) {
              if (attr) probe.removeAttribute(attr);
            }
            if (state) probe.setAttribute(state, "");
            try {
              if (probe.matches(selector)) return true;
            } catch {
              // A selector this browser cannot parse matches nothing here, and the rule it came
              // from cannot be measured either; the pin below reports it as a change.
              return false;
            }
          }
        }
        return false;
      };

      const found = [...overlay.sheet.cssRules]
        .filter((rule): rule is CSSStyleRule => "selectorText" in rule)
        .filter(
          rule =>
            Boolean(
              rule.style.transition ||
                rule.style.transitionProperty ||
                rule.style.transitionDuration
            ) && applies(rule.selectorText)
        )
        .map(rule => rule.cssText);
      probe.remove();
      return found;
    },
    [PROBE_CLASSES, PROBE_STATES] as const
  );
  // An absent sheet would read as "no transitions here", which is the reassuring direction and
  // would certify a canvas nobody looked at.
  if (rules === null) {
    throw new Error(
      "the canvas has no parsed #nx-pb-overlay stylesheet, so this test cannot see what the " +
        "browser was given. It refuses rather than reporting an empty rule list."
    );
  }
  return rules;
}

// The canvas iframe is only rendered above a certain width: the editor's rail, block library and
// inspector claim the row first, and below roughly 1280px the preview is dropped rather than
// squeezed. At the default viewport `mountTree` therefore waits out its full timeout on an iframe
// that is present but never sized, which reads as a broken canvas rather than a narrow window.
// The same width `acceptance.spec.ts` uses, so every canvas spec measures the same layout.
test.use({ viewport: { width: 2560, height: 1400 } });

// Booting the editor once per test is minutes of work across this file, and the default 30s
// budget is a per-test timeout rather than a per-action one.
test.describe.configure({ timeout: 240_000 });

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

  test("the pinned rules are what the canvas still applies", async ({
    page,
    request,
  }) => {
    const frame = await canvas(page, request);
    const found = await transitionRules(frame);

    // A read that found nothing would satisfy an equality against an empty expectation and
    // certify a stylesheet it never saw.
    expect(found.length).toBeGreaterThan(0);

    expect(
      found,
      "the canvas drop-zone transition rules changed. Update PINNED_RULES here; each rule's span " +
        "is computed by the browser, so nothing else needs recalculating — but raise " +
        "POC_GEOMETRY_SETTLE_MS in poc-driver.ts if the new spans exceed it."
    ).toEqual([...PINNED_RULES]);
  });

  test("a rule reaching a zone without naming its class is still found", async ({
    page,
    request,
  }) => {
    const frame = await canvas(page, request);

    // `[data-active]` applies to a drop zone and contains none of its class text, which is the
    // shape a substring filter drops. Appended to the canvas's OWN sheet so the reader meets it
    // exactly as it would meet a future canvas edit, rather than through a second fixture.
    const added = await frame.evaluate(() => {
      const overlay = document.getElementById(
        "nx-pb-overlay"
      ) as HTMLStyleElement | null;
      const rule = "[data-active]{transition:height .2s}";
      overlay?.sheet?.insertRule(rule, overlay.sheet.cssRules.length);
      return Boolean(overlay?.sheet);
    });
    // The injection itself has to be observable: without this the assertion below is satisfied by
    // a sheet that was never touched.
    expect(added).toBe(true);

    const found = await transitionRules(frame);
    expect(found.some(rule => rule.includes("data-active"))).toBe(true);
  });

  test("the driver's settle allowance covers every pinned rule", async ({
    page,
    request,
  }) => {
    const frame = await canvas(page, request);
    // EVERY rule, not just the first. A second drop-zone rule declaring a transition is a normal
    // edit, and pinning one rule while measuring one span would leave the other unmeasured while
    // the driver waits on both shapes.
    for (const rule of PINNED_RULES) {
      const spanMs = await geometrySpanMs(frame, rule);

      // No `spanMs > 0` guard, deliberately. An unmatched selector, a discarded declaration and an
      // unclassifiable property all THROW, so the only way to reach here with 0 is a rule that
      // genuinely moves no geometry — which is exactly what the canvas declares today, since the
      // zone is out of flow at a fixed height and only `background` transitions. Asserting a
      // positive span would fail a correct canvas.
      expect(
        POC_GEOMETRY_SETTLE_MS,
        `geometrySettleMs is ${String(POC_GEOMETRY_SETTLE_MS)}ms and "${rule}" moves geometry for ` +
          `${String(spanMs)}ms, so the probe can re-measure an edge that is still travelling. ` +
          "Raise it in poc-driver.ts."
      ).toBeGreaterThanOrEqual(spanMs);
    }
  });

  test("the span derivation reads geometry and ignores the rest", async ({
    page,
    request,
  }) => {
    const frame = await canvas(page, request);
    const span = (rule: string) =>
      geometrySpanMs(frame, `.nx-pb-dropzone{${rule}}`);

    expect(await span("transition:height .1s ease")).toBe(100);
    expect(await span("transition:height .1s ease .05s")).toBe(150);
    // A colour moves no edge this probe measures, so its longer timing is not charged.
    expect(await span("transition:height .1s ease,background .3s ease")).toBe(
      100
    );
    // The browser evaluates what a regex could not.
    expect(await span("transition:height calc(.04s + .03s) ease")).toBe(70);
    // A timing list SHORTER than the property list is cycled by CSS, not padded with zeros.
    expect(
      await span(
        "transition-property:color,background,height;transition-duration:.15s"
      )
    ).toBe(150);
    // An individual transform property moves the box: skipped, it reads as 0.
    expect(await span("transition:translate .2s ease")).toBe(200);
    // CSS resolves a repeated property to its LAST entry, not its longest.
    expect(
      await span(
        "transition-property:height,height;transition-duration:.3s,.1s"
      )
    ).toBe(100);
    // The same rule reversed, which separates "reads the last" from "reads the first".
    expect(
      await span(
        "transition-property:height,height;transition-duration:.1s,.3s"
      )
    ).toBe(300);
    // `all` competes with a named entry rather than sitting beside it.
    expect(
      await span("transition-property:height,all;transition-duration:.3s,.1s")
    ).toBe(100);
    // And with `all` EARLIER, height keeps its own timing while `all` still governs the rest.
    expect(
      await span("transition-property:all,height;transition-duration:.3s,.1s")
    ).toBe(300);
    // A rule that deliberately disables movement is a real answer of zero.
    expect(await span("transition:height 0s")).toBe(0);
  });

  test("the span derivation refuses what it cannot answer", async ({
    page,
    request,
  }) => {
    const frame = await canvas(page, request);
    const span = (rule: string) =>
      geometrySpanMs(frame, `.nx-pb-dropzone{${rule}}`);

    // A property on neither list stops the test and names itself rather than being charged as 0.
    await expect(span("transition:font-size .2s ease")).rejects.toThrow(
      /cannot place/
    );

    // A rule the probe never matches.
    await expect(
      geometrySpanMs(
        frame,
        ".nx-pb-dropzone[data-nonexistent]{transition:height .2s}"
      )
    ).rejects.toThrow(/matches no drop-zone probe element/);

    // A value the browser cannot parse is DROPPED, leaving the initial 0s.
    await expect(
      geometrySpanMs(frame, ".nx-pb-dropzone{transition:height notatime}")
    ).rejects.toThrow(/did not apply/);

    // An undefined property with NO fallback discards the declaration at computed-value time.
    await expect(
      geometrySpanMs(
        frame,
        ".nx-pb-dropzone{transition:height var(--nx-nope-undefined)}"
      )
    ).rejects.toThrow(/did not apply/);
  });

  test("the span derivation measures what the canvas context supplies", async ({
    page,
    request,
  }) => {
    const frame = await canvas(page, request);
    // The positive controls that keep the refusals above from being blanket rejections.

    // A state the canvas really declares IS measured.
    expect(
      await geometrySpanMs(
        frame,
        ".nx-pb-dropzone[data-drag]{transition:height .2s}"
      )
    ).toBe(200);

    // The EMPTY placeholder, the driver's other target, which carries no `nx-pb-dropzone` class.
    expect(
      await geometrySpanMs(
        frame,
        ".nx-pb-dropzone-empty{transition:height .2s}"
      )
    ).toBe(200);

    // A `var()` FALLBACK is valid CSS and must be measured, not refused. This is what a name-scan
    // for `var(` could never get right: the property is undefined and the rule is still correct.
    expect(
      await geometrySpanMs(
        frame,
        ".nx-pb-dropzone{transition:height var(--nx-nope-undefined,.15s)}"
      )
    ).toBe(150);

    // A theme token the CANVAS inherits resolves here because this runs in the canvas document.
    // Reading the source could never do this: the value is not in that file.
    const themed = await frame.evaluate(() =>
      getComputedStyle(document.documentElement)
        .getPropertyValue("--nx-pb-ed-primary")
        .trim()
    );
    expect(
      themed,
      "the canvas frame should carry the admin theme tokens; if this is empty the probe is not " +
        "running in the canvas document and every measurement above is of the wrong context"
    ).not.toBe("");
  });
});
