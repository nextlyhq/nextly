/**
 * The typographic baseline this library renders text against.
 *
 * **Why this is not `baseStyles`.** A block's defaults are keyed by block TYPE
 * and compile to one rule on one shared class. A heading's level is a PROP, so
 * every `core/heading` wears the same block-type class — one default there
 * would give `h1` and `h3` the same size, which is the defect rather than the
 * fix. The element is the only thing that tells the levels apart, so the
 * defaults are keyed by element and the compiler writes them as
 * `:where(<page root> h1)`.
 *
 * **Why it exists at all, and why it is deliberately small.** Under a host's
 * CSS reset an `h1` and an `h3` differ only in tag name — `font-size: inherit`,
 * `margin: 0` — so a correct document renders as undifferentiated text and the
 * canvas reads as broken. Gutenberg, the closest peer that both ships blocks
 * and renders pages, keeps metric defaults OUT of block CSS and defers to a
 * theme layer; Nextly has no populated typography scale yet, so this bridges
 * that gap and is shaped so the fonts manager can supply the same record later.
 *
 * **Scope is heading scale and paragraph rhythm, and nothing else.** Those two
 * are the first things present in every precedent surveyed — Tailwind
 * Typography, Webflow's tag defaults, every WordPress theme's `theme.json`.
 * Lists, tables, code and blockquotes appear in some and not others; link
 * colour is in Tailwind's `prose` and absent from Gutenberg's core CSS; buttons
 * and form controls are not typography at all and are excluded on purpose.
 * Shipping only what every precedent agrees on is what keeps this a baseline
 * rather than a design system nobody chose.
 *
 * **Every value is relative.** `rem` for size so the scale follows the reader's
 * own font size, and `em` for margins so the space around a heading is
 * proportional to that heading rather than fixed — which is what lets one
 * override of `font-size` move the whole block coherently instead of leaving
 * the spacing behind.
 *
 * @module blocks/typography-defaults
 */
import type { NodeStyles, StyleCompileContext } from "@nextlyhq/blocks-engine";

/**
 * A heading's default look at one level.
 *
 * `marginBlockStart` is larger than `marginBlockEnd` on purpose: a heading
 * belongs to the content BELOW it, so the space above separates it from the
 * previous passage and the space below keeps it attached to what it
 * introduces. Equal margins read as though the heading floats between two
 * sections belonging to neither.
 */
function heading(size: string, lineHeight: number): NodeStyles {
  return {
    base: {
      base: {
        fontSize: size,
        lineHeight,
        fontWeight: 700,
        margin: { blockStart: "1.5em", blockEnd: "0.5em" },
      },
    },
  };
}

/**
 * The defaults, keyed by the element each applies to.
 *
 * The scale is the classic major-third-ish ramp every precedent lands near
 * rather than a computed one: a computed ratio has to be tuned per family to
 * stop the small end colliding, and a baseline that ships before the fonts
 * manager cannot know the family. Line height tightens as size grows because a
 * long line of large text needs proportionally less leading to stay readable.
 */
export const TYPOGRAPHY_DEFAULTS: Readonly<Record<string, NodeStyles>> = {
  h1: heading("2.25rem", 1.15),
  h2: heading("1.75rem", 1.2),
  h3: heading("1.375rem", 1.3),
  h4: heading("1.125rem", 1.4),
  h5: heading("1rem", 1.45),
  h6: heading("0.875rem", 1.5),
  /**
   * Paragraph rhythm, and only rhythm: no size, because a paragraph should
   * inherit the reader's body size rather than have this library pick one.
   * `marginBlockStart: 0` so a paragraph following a heading keeps the
   * heading's own `0.5em` rather than adding to it — the adjacent-margin
   * collapse Tailwind Typography spells as `h2 + * { margin-top: 0 }`.
   */
  p: {
    base: {
      base: {
        lineHeight: 1.6,
        margin: { blockStart: "0", blockEnd: "1em" },
      },
    },
  },
};

/**
 * A compile context carrying this library's typographic baseline.
 *
 * ONE function rather than a default applied at each point of use, because the
 * style trace compiles from the same inputs the render does and the panel
 * exists to say where a value came from. A baseline applied on the render path
 * alone makes the trace describe a cascade the page does not have — reporting a
 * heading's size as set by nobody while it plainly is not.
 *
 * A context that states its own is left alone, the courtesy `blockBasesFor`
 * extends to a supplied `blockBases`: an explicit choice by the caller outranks
 * what can be supplied here. `null` is not a state this reads for, because a
 * context omitting the field has no opinion while one stating it has already
 * won.
 */
export function withTypographyDefaults(
  context: StyleCompileContext
): StyleCompileContext {
  return context.elementBases === undefined
    ? { ...context, elementBases: TYPOGRAPHY_DEFAULTS }
    : context;
}
