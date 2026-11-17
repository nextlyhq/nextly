/**
 * "Animation when it appears": a block that fades, rises, slides or zooms into
 * view, written as CSS alone, with nothing hidden from anyone it cannot play for.
 *
 * Stored as one style value with four parts, an effect, a duration, a delay
 * and a start, each compiled to a custom property of its own. The effect also
 * writes the animation's longhands, which read the other three through those
 * properties, each with a fallback. That split is what lets every part be set
 * per device like any style value: a narrower device that says "None", or
 * only another duration, changes that part and inherits the rest from the
 * wider one, because each part is its own declaration in its own rule.
 *
 * **The hidden start lives in the animation alone.** Nothing but a keyframe
 * ever makes a block transparent or moves it, and the keyframes exist only
 * while the browser asks for motion on a screen: they are defined inside
 * `@media screen and (prefers-reduced-motion: no-preference)`. Printed, or
 * for a visitor who asks for reduced motion, the animation names keyframes
 * that are not there, so it does not run and the block is drawn as it is.
 *
 * **"When scrolled into view" is a scroll-driven animation**, on the block's
 * own view timeline, across the range in which it enters the window. It plays
 * only where the browser supports that: without support the animation is
 * named `none`, through a gate the page root sets under
 * `@supports not (animation-timeline: view())`, because a browser that drops
 * the timeline would otherwise play it once on load. The range ends when the
 * block has fully entered, which the window always reaches, so a block at the
 * very end of a page is never left part-way in. "When the page loads" is an
 * ordinary animation, which every browser runs.
 *
 * **Only opacity and the transform move**: `translate` and `scale`, the
 * transform's own properties, so an author's `transform` still applies on top
 * of them and nothing a block's layout reads changes. A slide still makes a
 * block overflow its page sideways while it waits to come in, so a sheet using
 * one clips the page root's sideways overflow, at no weight, so a site's own
 * rule wins.
 *
 * Everything the custom properties need on the page is one prelude, written
 * once by a sheet that reads them, as the overlay's reset is.
 *
 * @module style/appear
 */

import type { KeywordExpansion } from "./catalog-types";
import { namespacedGlobalName } from "./global-name";
import { PAGE_ROOT_CLASS } from "./node-class";

/**
 * What every custom property the animation writes starts with, for a reader;
 * each one below is spelled out with it.
 */
const APPEAR_PREFIX = "--nx-pb-appear";

/** The effect, as its custom property. */
export const APPEAR_EFFECT_PROPERTY = "--nx-pb-appear-effect";

/** How long the animation runs, in milliseconds, as its custom property. */
export const APPEAR_DURATION_PROPERTY = "--nx-pb-appear-duration";

/** How long it waits before it starts, in milliseconds, as its custom property. */
export const APPEAR_DELAY_PROPERTY = "--nx-pb-appear-delay";

/** What starts it, as its custom property. */
export const APPEAR_START_PROPERTY = "--nx-pb-appear-start";

/**
 * What stops one block's animation: `none` where it may not play, nothing
 * where it may. The start writes it, from one of the two page gates below.
 */
const APPEAR_STOP = "--nx-pb-appear-stop";

/** The timeline the start chose. */
const APPEAR_TIMELINE = "--nx-pb-appear-timeline";

/**
 * The page's gate for "When scrolled into view": `none` where the browser
 * cannot run a scroll-driven animation, unset where it can. Inherited from the
 * page root, so a surface that must show every block still (the editor's
 * canvas) closes it there.
 */
export const APPEAR_SCROLL_GATE = "--nx-pb-appear-scroll";

/** The page's gate for "When the page loads": unset unless a surface closes it. */
export const APPEAR_LOAD_GATE = "--nx-pb-appear-load";

/** The effects, in the order an editor offers them. */
export const APPEAR_EFFECTS = [
  "none",
  "fade-in",
  "rise",
  "slide-in-left",
  "slide-in-right",
  "zoom-in",
] as const;

/** An effect that moves something. */
type MovingEffect = Exclude<(typeof APPEAR_EFFECTS)[number], "none">;

/** What starts the animation, in the order an editor offers them. */
export const APPEAR_STARTS = ["scroll", "load"] as const;

/** The duration when none is set, in milliseconds. */
const APPEAR_DEFAULT_DURATION = 600;

/** The longest duration or delay, in milliseconds: ten seconds. */
export const APPEAR_MAX_MILLISECONDS = 10_000;

/**
 * Where each effect starts from: opacity always, and a short move. Measured
 * in `rem`, so it keeps its size at every zoom, and short, so a block never
 * starts far from where it ends. `translate` and `scale` are the transform's
 * own properties, so nothing here replaces an author's `transform`.
 *
 * The slides name the screen's sides, as their words do ("Slide in from the
 * left"), rather than the text's start and end: the motion is a picture, which
 * a right-to-left page shows as it is, as it shows an image.
 */
const STARTING_PLACES: Readonly<Record<MovingEffect, string>> = {
  "fade-in": "opacity: 0;",
  rise: "opacity: 0; translate: 0 2rem;",
  "slide-in-left": "opacity: 0; translate: -2rem 0;",
  "slide-in-right": "opacity: 0; translate: 2rem 0;",
  "zoom-in": "opacity: 0; scale: 0.92;",
};

/** The effects that move a block sideways, past its page's edge. */
const SIDEWAYS: readonly MovingEffect[] = ["slide-in-left", "slide-in-right"];

/**
 * The keyframes one effect plays, under the page root's namespace, so a site's
 * own `rise` or `fade-in` is never replaced.
 */
export function appearKeyframesName(effect: MovingEffect): string {
  return namespacedGlobalName(`appear-${effect}`, PAGE_ROOT_CLASS);
}

/** The longhands a moving effect writes on the block. */
function moving(effect: MovingEffect): readonly KeywordExpansion[] {
  return [
    {
      property: "animation-name",
      value: `var(${APPEAR_STOP}, ${appearKeyframesName(effect)})`,
    },
    {
      property: "animation-duration",
      value: `calc(var(${APPEAR_DURATION_PROPERTY}, ${APPEAR_DEFAULT_DURATION}) * 1ms)`,
    },
    {
      property: "animation-delay",
      value: `calc(var(${APPEAR_DELAY_PROPERTY}, 0) * 1ms)`,
    },
    { property: "animation-timing-function", value: "ease-out" },
    // Both ways, so the starting place holds through the delay and the end
    // holds after it: neither is a style of the block's own.
    { property: "animation-fill-mode", value: "both" },
    // Never the `animation` shorthand, which would reset the timeline.
    {
      property: "animation-timeline",
      value: `var(${APPEAR_TIMELINE}, view())`,
    },
    // Read only on a scroll-driven timeline: from the block's first pixel
    // entering the window to its last.
    { property: "animation-range", value: "entry 0% entry 100%" },
  ];
}

/** What each effect writes on the block beside its own custom property. */
export const APPEAR_EFFECT_EXPANSIONS: Readonly<
  Record<(typeof APPEAR_EFFECTS)[number], readonly KeywordExpansion[]>
> = {
  // None stops an effect a wider device or another style set.
  none: [{ property: "animation-name", value: "none" }],
  "fade-in": moving("fade-in"),
  rise: moving("rise"),
  "slide-in-left": moving("slide-in-left"),
  "slide-in-right": moving("slide-in-right"),
  "zoom-in": moving("zoom-in"),
};

/** What each start writes on the block beside its own custom property. */
export const APPEAR_START_EXPANSIONS: Readonly<
  Record<(typeof APPEAR_STARTS)[number], readonly KeywordExpansion[]>
> = {
  scroll: [
    { property: APPEAR_STOP, value: `var(${APPEAR_SCROLL_GATE})` },
    { property: APPEAR_TIMELINE, value: "view()" },
  ],
  load: [
    { property: APPEAR_STOP, value: `var(${APPEAR_LOAD_GATE})` },
    { property: APPEAR_TIMELINE, value: "auto" },
  ],
};

/**
 * Every element's own parts, reset at no weight so a block's value wins and a
 * nested block never inherits its container's. The stop resets to the scroll
 * gate, since "When scrolled into view" is the start when none is chosen.
 */
const RESET = `:where(.${PAGE_ROOT_CLASS}, .${PAGE_ROOT_CLASS} *) { ${[
  APPEAR_EFFECT_PROPERTY,
  APPEAR_DURATION_PROPERTY,
  APPEAR_DELAY_PROPERTY,
  APPEAR_START_PROPERTY,
  APPEAR_TIMELINE,
]
  .map(property => `${property}: initial;`)
  .join(" ")} ${APPEAR_STOP}: var(${APPEAR_SCROLL_GATE}); }`;

/** The feature test: without scroll-driven animation, the scroll gate closes. */
const SCROLL_SUPPORT = `@supports not (animation-timeline: view()) {\n  :where(.${PAGE_ROOT_CLASS}) { ${APPEAR_SCROLL_GATE}: none; }\n}`;

/** The keyframes, defined only where motion is asked for, on a screen. */
const KEYFRAMES = `@media screen and (prefers-reduced-motion: no-preference) {\n${(
  Object.keys(STARTING_PLACES) as MovingEffect[]
)
  .map(
    effect =>
      `  @keyframes ${appearKeyframesName(effect)} { from { ${STARTING_PLACES[effect]} } }`
  )
  .join("\n")}\n}`;

/** The page root's sideways overflow, clipped, for a sheet using a slide. */
const SIDEWAYS_CLIP = `:where(.${PAGE_ROOT_CLASS}) { overflow-x: clip; }`;

/**
 * The prelude a sheet carries once when anything in it reads the animation,
 * or `undefined` when nothing does: so a page without one compiles exactly as
 * before. `parts` are the sheet and whatever is kept apart from it to be
 * appended later, which is read as part of the page.
 */
export function appearPrelude(parts: readonly string[]): string | undefined {
  if (!parts.some(part => part.includes(APPEAR_PREFIX))) return undefined;
  const slides = SIDEWAYS.some(effect =>
    parts.some(part => part.includes(appearKeyframesName(effect)))
  );
  return [
    RESET,
    SCROLL_SUPPORT,
    KEYFRAMES,
    ...(slides ? [SIDEWAYS_CLIP] : []),
  ].join("\n");
}
