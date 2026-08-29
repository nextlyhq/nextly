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
 * **Every value is relative, and sizes are `em` rather than `rem`.** This is
 * what lets an author's typography reach a heading at all. These defaults are
 * emitted as `:where(h1)`, a rule on the ELEMENT, while anything an author sets
 * on the page or on a containing block arrives by INHERITANCE — and a direct
 * rule beats an inherited value no matter what either weighs, so no amount of
 * specificity work makes the authored value win. `em` sidesteps the contest by
 * making the default a MULTIPLE of whatever was inherited.
 *
 * Measured in a browser, page setting `20px` and block value `18px` against a
 * host reset: with `rem` the `h1` was 36px in both, ignoring each author value
 * completely; with `em` it was 45px and 40.5px. Where nobody has set anything
 * the two are identical — 36px from a 16px root — and a host's own
 * `.content h1` still wins at 11px either way. So `em` costs nothing in the
 * case the baseline exists for and restores authored control in the rest.
 *
 * Margins are `em` for the neighbouring reason: the space around a heading is
 * proportional to that heading, so one override of `font-size` moves the whole
 * block coherently instead of leaving the spacing behind.
 *
 * `fontWeight` has no relative form and stays absolute, so an author's weight
 * on a container does not reach a heading. That is the same limitation every
 * precedent here carries, and it is the one property where a fixed default is
 * closest to universal.
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
 * Typed as the compiler's own field rather than `Record<string, NodeStyles>`,
 * because the compiler holds the elements to a closed list and DROPS a tag
 * outside it. A misspelled key would otherwise typecheck, compile to nothing,
 * and show up as one heading level that never got its size — the quietest
 * possible failure. Derived from the field it feeds so the two cannot disagree
 * about which elements exist.
 *
 * The scale is the classic major-third-ish ramp every precedent lands near
 * rather than a computed one: a computed ratio has to be tuned per family to
 * stop the small end colliding, and a baseline that ships before the fonts
 * manager cannot know the family. Line height tightens as size grows because a
 * long line of large text needs proportionally less leading to stay readable.
 */
export const TYPOGRAPHY_DEFAULTS: NonNullable<
  StyleCompileContext["elementBases"]
> = {
  h1: heading("2.25em", 1.15),
  h2: heading("1.75em", 1.2),
  h3: heading("1.375em", 1.3),
  h4: heading("1.125em", 1.4),
  h5: heading("1em", 1.45),
  h6: heading("0.875em", 1.5),
  /**
   * Paragraph rhythm, and only rhythm: no size, because a paragraph should
   * inherit the reader's body size rather than have this library pick one.
   * `marginBlockStart: 0` so a paragraph following a heading keeps the
   * heading's own `0.5em` rather than adding to it — the adjacent-margin
   * collapse Tailwind Typography spells as `h2 + * { margin-top: 0 }`.
   *
   * **No `line-height` either, and that is the harder call.** A comfortable
   * default reads better out of the box, but line-height INHERITS and this tier
   * emits a rule on the `p` ITSELF — so a declaration here beats whatever an
   * author set on a containing block, and `core/rich-text` puts its paragraphs
   * below a styled `div`. An author setting the leading of a passage would see
   * nothing happen, with no control anywhere that could fix it.
   *
   * `em` rescued the heading scale because a size can be a multiple of what it
   * inherited. Leading has no such form: `1.6em` resolves against the
   * element's OWN font size and stops descendants inheriting a ratio, which is
   * worse than either. So the choice is a nicer default or a working control,
   * and the control wins — a paragraph now inherits the leading from wherever
   * the author set one, and falls back to the reader's browser default when
   * nobody has.
   *
   * Headings keep theirs, and the asymmetry is deliberate: large text needs
   * proportionally tighter leading than body text, so a single inherited value
   * cannot serve both. An author changing a heading's leading does it on the
   * heading block, which is a rule on the same element at a higher weight and
   * wins.
   */
  p: {
    base: {
      base: {
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
