/**
 * The element tier a page compiles with, from the site's text.
 *
 * **Why this is not `baseStyles`.** A block's defaults are keyed by block TYPE
 * and compile to one rule on one shared class. A heading's level is a PROP, so
 * every `core/heading` wears the same block-type class — one default there
 * would give `h1` and `h3` the same size. The element is the only thing that
 * tells the levels apart, so the tier is keyed by element and the compiler
 * writes it as `:where(<page root> h1)`.
 *
 * **One source.** This library holds no heading table of its own. The site's
 * text map (`siteText` on the compile context, from the site's token set)
 * says what each heading level, Body, Links and Captions look like, and the
 * engine's `siteTextElementBases` turns it into the tier, with each element's
 * own defaults (no outer margin, bold headings) under the rows. A context
 * carrying no map gets the engine's built-in rows: each heading at the
 * built-in type size of its level, and nothing for the rest, so a host's own
 * typography keeps working until an author sets a row.
 *
 * **Sizes are `rem`.** The built-in type sizes equal the heading sizes this
 * library drew before at a 16px root. A heading inside a container that sets
 * its own text size no longer scales with it; an author sizes it on the
 * heading, or on the Heading row of Site text, instead.
 *
 * @module blocks/typography-defaults
 */
import {
  siteTextElementBases,
  type StyleCompileContext,
} from "@nextlyhq/blocks-engine";

/**
 * A compile context carrying the site's element tier.
 *
 * ONE function rather than a tier applied at each point of use, because the
 * style trace compiles from the same inputs the render does and the panel
 * exists to say where a value came from. A tier applied on the render path
 * alone makes the trace describe a cascade the page does not have.
 *
 * A context that states its own `elementBases` is left alone, the courtesy
 * `blockBasesFor` extends to a supplied `blockBases`: an explicit choice by
 * the caller outranks what can be derived here.
 */
export function withTypographyDefaults(
  context: StyleCompileContext
): StyleCompileContext {
  if (context.elementBases !== undefined) return context;
  // The site's classes too: a row following a text style writes that text
  // style's look, read from the same library the class tier is written from.
  return {
    ...context,
    elementBases: siteTextElementBases(context.siteText, context.namedClasses),
  };
}
