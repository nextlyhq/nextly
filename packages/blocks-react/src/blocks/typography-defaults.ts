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
 * **Scope is heading scale, and the outer margins this library takes away.**
 * The heading scale is the first thing present in every precedent surveyed —
 * Tailwind Typography, Webflow's tag defaults, every WordPress theme's
 * `theme.json`. Link colour is in Tailwind's `prose` and absent from
 * Gutenberg's core CSS; buttons and form controls are not typography at all and
 * are excluded on purpose. Shipping only what every precedent agrees on is what
 * keeps this a baseline rather than a design system nobody chose.
 *
 * **No element here has an outer margin.** The space between two blocks is
 * the gap of the container holding them (`childGap` on its definition), and the
 * space between the paragraphs of rich text is that block's own gap, inside
 * it. A margin on the element would leak out of the block instead, and
 * collapse through any parent with no padding of its own. So every element a block renders text or a list as is zeroed on the block
 * axis, which also takes away a host's browser defaults where it has no reset.
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
 * `fontWeight` has no relative form and stays absolute, so an author's weight
 * on a container does not reach a heading. That is the same limitation every
 * precedent here carries, and it is the one property where a fixed default is
 * closest to universal.
 *
 * @module blocks/typography-defaults
 */
import type { NodeStyles, StyleCompileContext } from "@nextlyhq/blocks-engine";

import { CLASSIC_ELEMENT_BASES } from "./classic-spacing";

/**
 * No outer margin on the block axis: what every element here carries, and
 * all that a paragraph, a list, a figure, a quotation and a rule carry.
 *
 * A function rather than a shared value: the defaults are a published,
 * mutable export, and an entry adjusted in place must not move every other
 * entry holding the same object.
 */
function flushMargin(): { blockStart: string; blockEnd: string } {
  return { blockStart: "0", blockEnd: "0" };
}

/** An element whose default is only {@link flushMargin}, as objects of its own. */
function flush(): NodeStyles {
  return { base: { base: { margin: flushMargin() } } };
}

/** A heading's default look at one level: its size, leading and weight. */
function heading(size: string, lineHeight: number): NodeStyles {
  return {
    base: {
      base: {
        fontSize: size,
        lineHeight,
        fontWeight: 700,
        margin: flushMargin(),
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
   * A paragraph is zeroed and nothing more: no size, because a paragraph should
   * inherit the reader's body size rather than have this library pick one.
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
   * and the control wins.
   *
   * Headings keep theirs, and the asymmetry is deliberate: large text needs
   * proportionally tighter leading than body text, so a single inherited value
   * cannot serve both.
   */
  p: flush(),
  // Rendered by List, Quote, Image and rich text, each with a browser margin
  // a host without a reset keeps.
  blockquote: flush(),
  // Flush on every side: a browser also indents a figure inline, and an
  // image with no caption is a bare `img` with no such inset.
  figure: {
    base: {
      base: {
        margin: { ...flushMargin(), inlineStart: "0", inlineEnd: "0" },
      },
    },
  },
  hr: flush(),
  ol: flush(),
  ul: flush(),
  // A code block in rich text, with the browser's block margins otherwise.
  pre: flush(),
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
  if (context.elementBases !== undefined) return context;
  // The baseline of the context's spacing model: a classic site keeps the
  // element margins it was built with.
  return {
    ...context,
    elementBases:
      context.spacingMode === "classic"
        ? CLASSIC_ELEMENT_BASES
        : TYPOGRAPHY_DEFAULTS,
  };
}
