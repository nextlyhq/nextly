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

import { DROP_ZONES, POC_GEOMETRY_SETTLE_MS } from "./poc-driver";

const CANVAS_CSS = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../../packages/plugin-page-builder/src/admin/canvas/IframeCanvas.tsx"
);

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
const PINNED_DECLARATION =
  '".nx-pb-dropzone{height:0;border-radius:3px;transition:height .1s ease,background .1s ease}",';

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
 * Custom properties the fixture defines, for a rule that reads one.
 *
 * The probe injects the pinned rule into a bare document rather than into the canvas, so a
 * `var()` naming something defined elsewhere — a theme token, another canvas rule — resolves to
 * nothing here. CSS then treats the declaration as invalid at computed-value time and
 * `getComputedStyle` reports the INITIAL `0s`, which is the dangerous direction: a zone moving
 * for 200ms measures as instant and any allowance covers it.
 *
 * So an unresolved reference is refused rather than measured, and this is where the definition
 * goes to make it measurable. Empty because the pinned rule reads no variable today.
 */
const PROBE_CUSTOM_PROPERTIES: Record<string, string> = {};

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
  const result = await page.evaluate(
    ([css, safe, states, geometry, classes, customProps]) => {
      const props = customProps as Record<string, string>;
      const vars = document.createElement("style");
      vars.textContent = `:root{${Object.entries(props)
        .map(([name, value]) => `${name}:${value}`)
        .join(";")}}`;
      document.head.append(vars);

      const style = document.createElement("style");
      style.textContent = css as string;
      document.head.append(style);
      const el = document.createElement("div");
      document.body.append(el);
      const cleanup = () => {
        el.remove();
        style.remove();
        vars.remove();
      };

      // The rule must actually apply to the probe, or every timing read below is the browser's
      // initial value and the span comes out zero — indistinguishable from a transition that was
      // deliberately removed. The selector is taken as text and handed to `matches`, so nothing
      // here interprets it; class and state are tried in turn because a rule on the empty
      // placeholder, or qualified by a state, is an ordinary edit rather than a strange one.
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
          unresolvedVars: [] as string[],
        };
      }

      // The browser DROPS a declaration it cannot parse and leaves the rule standing, so the
      // computed style falls back to the initial `all 0s` — a silent zero that any allowance
      // covers. Asked of the parsed rule rather than of the computed value, because the computed
      // value is identical for "no transition declared" and "transition of zero length".
      const parsed = (style.sheet?.cssRules[0] as CSSStyleRule | undefined)
        ?.style;
      const declaresTransition = Boolean(
        parsed &&
          (parsed.transition ||
            parsed.transitionProperty ||
            parsed.transitionDuration)
      );
      if (!declaresTransition) {
        cleanup();
        return {
          matched: true,
          ms: 0,
          unclassified: [] as string[],
          unresolvedVars: [] as string[],
          dropped: true,
        };
      }

      const computed = getComputedStyle(el);

      // A custom property that resolves to nothing makes the whole declaration invalid at
      // computed-value time, and the browser then reports the INITIAL transition rather than an
      // error. Checked directly against the element instead of inferred from a zero duration,
      // which a legitimately instant transition also produces.
      const referenced = [
        ...new Set(
          [...(css as string).matchAll(/var\(\s*(--[A-Za-z0-9_-]+)/g)].map(
            m => m[1]
          )
        ),
      ];
      const unresolvedVars = referenced.filter(
        name => computed.getPropertyValue(name).trim() === ""
      );
      if (unresolvedVars.length > 0) {
        cleanup();
        return {
          matched: true,
          ms: 0,
          unclassified: [],
          unresolvedVars,
          dropped: false,
        };
      }

      const seconds = (value: string) =>
        value.split(",").map(v => Number.parseFloat(v.trim()) * 1000);
      const properties = computed.transitionProperty
        .split(",")
        .map(v => v.trim());
      const durations = seconds(computed.transitionDuration);
      const delays = seconds(computed.transitionDelay);
      // CSS CYCLES a timing list that is shorter than `transition-property`: with three
      // properties and one duration, all three take that duration. Treating a missing index as
      // zero would read those as instant and report a geometry transition as taking no time.
      const cycled = (list: number[], i: number) =>
        list.length === 0 ? 0 : list[i % list.length];
      const spanAt = (i: number) => cycled(durations, i) + cycled(delays, i);

      // `all` MATCHES every property, so it is a competing entry for each named one rather than a
      // separate row: with `height,all`, CSS gives height the `all` entry's timing because it
      // comes later. Comparing only identical strings keeps the two apart and reports height's
      // own earlier entry, which over-states the span.
      const lastAll = properties.lastIndexOf("all");
      const named = [
        ...new Set(properties.filter(p => p !== "all" && p !== "none")),
      ];

      const unclassified: string[] = [];
      // `all` covers the geometry properties nothing else names, so its own entry counts whatever
      // the named ones say.
      let longest = lastAll === -1 ? 0 : spanAt(lastAll);
      for (const property of named) {
        if ((safe as string[]).includes(property)) continue;
        if (!(geometry as string[]).includes(property)) {
          // On neither list: it may move the edge and this cannot tell. Collected rather than
          // skipped, so it refuses below instead of being charged as zero.
          unclassified.push(property);
          continue;
        }
        // The LAST entry naming this property wins, and `all` is one of the things that can name
        // it — so the effective entry is whichever of the two comes later.
        const effective = Math.max(properties.lastIndexOf(property), lastAll);
        longest = Math.max(longest, spanAt(effective));
      }
      cleanup();
      return {
        matched: true,
        ms: longest,
        unclassified,
        unresolvedVars,
        dropped: false,
      };
    },
    [
      rule,
      [...NON_GEOMETRY_PROPERTIES],
      PROBE_STATES,
      [...GEOMETRY_PROPERTIES],
      PROBE_CLASSES,
      PROBE_CUSTOM_PROPERTIES,
    ] as const
  );

  if (!result.matched) {
    throw new Error(
      `the pinned rule "${rule}" matches no drop-zone probe element, so its timing cannot be ` +
        `read and a zero span here would be indistinguishable from a removed transition. Add the ` +
        `state it is qualified by to PROBE_STATES.`
    );
  }
  if (result.dropped) {
    throw new Error(
      `the browser parsed the pinned rule but DROPPED its transition declaration, so the computed ` +
        `style is the initial 0s — a zero that covers any allowance. The declaration is malformed ` +
        `for this browser; fix the rule rather than re-pinning it.`
    );
  }
  if (result.unresolvedVars.length > 0) {
    throw new Error(
      `the pinned rule reads ${result.unresolvedVars.join(", ")}, which resolve to nothing in this ` +
        `fixture — so the browser discards the declaration and reports the initial 0s, which any ` +
        `allowance covers. Add each to PROBE_CUSTOM_PROPERTIES with the value the canvas gives it.`
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
  // No `spanMs > 0` guard here, and its absence is deliberate. It was standing in for "the
  // derivation actually worked", which is now answered where it can be answered properly: an
  // unmatched selector and an unclassifiable property both THROW, so the only way to reach this
  // line with 0 is a rule that genuinely disables movement — `transition: height 0s`, or a delay
  // cancelling its duration. That is a legitimate result the allowance covers, and asserting it
  // away would fail a correct canvas. The derivation's positive controls live in the test below,
  // where they pin known nonzero values instead of merely asking for "not nothing".
  const spanMs = await geometrySpanMs(page, PINNED_DECLARATION);

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
  // A timing list SHORTER than the property list is cycled by CSS, not padded with zeros: one
  // duration across three properties applies to all three. Read as missing, the geometry entry
  // here would report 0 and pass any allowance.
  expect(
    await span(
      "transition-property:color,background,height;transition-duration:.15s"
    )
  ).toBe(150);

  // An individual transform property moves the box, and it is the case that showed an allowlist
  // cannot be trusted to be complete: skipped, this reads as 0 and the allowance passes over a
  // zone still travelling.
  expect(await span("transition:translate .2s ease")).toBe(200);

  // CSS resolves a repeated property to its LAST entry, not its longest. Taking the maximum
  // reports 300 here and sends whoever reads the failure off to lengthen every wait in the probe
  // for a transition that finished 200ms earlier.
  expect(
    await span("transition-property:height,height;transition-duration:.3s,.1s")
  ).toBe(100);

  // The same rule with the entries swapped, which is what separates "reads the last" from "reads
  // the first" — a fixed pick of either index satisfies one of these two and not both.
  expect(
    await span("transition-property:height,height;transition-duration:.1s,.3s")
  ).toBe(300);

  // A rule that deliberately disables movement is a real answer of zero, not a failed derivation.
  // The allowance covers it, and asserting it away would fail a correct canvas.
  expect(await span("transition:height 0s")).toBe(0);

  // `all` is a competing entry for `height`, not a separate row: it comes later, so CSS gives
  // height ITS timing. Keeping the two apart reports height's own earlier 300 and over-states the
  // span, which fails the allowance and sends the reader off to lengthen every wait.
  expect(
    await span("transition-property:height,all;transition-duration:.3s,.1s")
  ).toBe(100);

  // The same pair the other way round, which is what separates "resolve against all" from "always
  // take the last entry". Here `all` is EARLIER, so height keeps its own 100 — while `all` still
  // governs every geometry property height does not name, and 300 is the honest answer.
  expect(
    await span("transition-property:all,height;transition-duration:.3s,.1s")
  ).toBe(300);
});

test("the span derivation refuses what it cannot answer", async ({ page }) => {
  // The other half of the controls above: what the derivation does when it CANNOT decide. Each of
  // these previously produced a confident zero, which is the answer that passes any allowance.
  const span = (rule: string) =>
    geometrySpanMs(page, `".nx-pb-dropzone{${rule}}",`);

  // A property on neither list. `font-size` does move a box, but the point is not which list it
  // belongs on — it is that an unrecognised name stops the test and names itself instead of being
  // charged as zero.
  await expect(span("transition:font-size .2s ease")).rejects.toThrow(
    /cannot place/
  );

  // A rule the probe element does not match. The canvas already declares `[data-drag]` and
  // `[data-active]` rules, so a transition moved onto a state is an ordinary edit — and one the
  // fixture must either measure or refuse, never silently report as zero.
  await expect(
    geometrySpanMs(
      page,
      '".nx-pb-dropzone[data-nonexistent]{transition:height .2s}",'
    )
  ).rejects.toThrow(/matches no drop-zone probe element/);

  // The state the canvas really uses IS measured rather than refused, which is what keeps the
  // refusal above from being a blanket "anything qualified fails".
  expect(
    await geometrySpanMs(
      page,
      '".nx-pb-dropzone[data-drag]{transition:height .2s}",'
    )
  ).toBe(200);

  // The EMPTY placeholder is the driver's other target and does not carry `nx-pb-dropzone`, so a
  // probe wearing only that class could never measure a transition added here. Its allowance is
  // waited on exactly as the between-item zone's is.
  expect(
    await geometrySpanMs(
      page,
      '".nx-pb-dropzone-empty{transition:height .2s}",'
    )
  ).toBe(200);

  // A rule reading a custom property nothing defines is REFUSED, not measured. The browser
  // discards the declaration and reports the initial 0s, which any allowance covers — so this is
  // the shape that passes while a zone is still moving.
  await expect(
    geometrySpanMs(
      page,
      '".nx-pb-dropzone{transition:height var(--zone-duration)}",'
    )
  ).rejects.toThrow(/--zone-duration/);

  // A value this browser cannot parse is DROPPED, leaving the rule standing and the computed
  // style at the initial `all 0s`. Measured: the sheet still reports one rule, so counting rules
  // cannot see this — the parsed declaration being empty is what separates it from a rule that
  // legitimately declares a zero-length transition.
  await expect(
    geometrySpanMs(page, '".nx-pb-dropzone{transition:height notatime}",')
  ).rejects.toThrow(/DROPPED/);
});

test("a variable-backed duration resolves once the fixture defines it", async ({
  page,
}) => {
  // The positive control on the refusal above: it must be a missing DEFINITION that refuses, not
  // the presence of `var()`. Without this, a derivation that rejected every variable would pass
  // the rejection case and leave the documented remedy — add it to PROBE_CUSTOM_PROPERTIES —
  // broken, which is the maintenance path the refusal message promises.
  PROBE_CUSTOM_PROPERTIES["--zone-duration"] = ".2s";
  try {
    expect(
      await geometrySpanMs(
        page,
        '".nx-pb-dropzone{transition:height var(--zone-duration)}",'
      )
    ).toBe(200);
  } finally {
    delete PROBE_CUSTOM_PROPERTIES["--zone-duration"];
  }
});
