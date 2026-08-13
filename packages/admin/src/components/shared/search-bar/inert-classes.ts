/**
 * Which classes do nothing when passed to `SearchBar`.
 *
 * `SearchBar`'s `className` lands on its WRAPPER. That is the right place for
 * it — every call site uses it for layout (`w-full`, `max-w-sm`, `flex-1`) and
 * layout belongs to the element that owns the box. But it means a class aimed
 * at the FIELD does nothing, and does nothing silently: the wrapper draws no
 * edge of its own, so `border-input` sets a colour on a border that is never
 * painted. Eighteen call sites carried one of these, in three spellings, which
 * reads as people trying tokens until one worked. None ever did.
 *
 * The rule lives here rather than in either of the two places that ask it. The
 * component warns at runtime and a test reads the sources, and those are the
 * same question asked of different inputs — so they share this, and cannot
 * drift into disagreeing about what "inert" means.
 */

/** Colour utilities that only reach the field, never the wrapper. */
const FIELD_ONLY =
  /^(?:border-(?:input|border|control-border)|bg-background|text-foreground)$/;

/**
 * Utilities that give the wrapper a border to colour.
 *
 * Without one of these a `border-*` colour is inert, which is the whole point.
 * WITH one, the caller has deliberately drawn an edge on the wrapper and the
 * colour is doing exactly what they asked — so reporting it would reject
 * correct code, and a check that fires on correct code gets worked around.
 */
const BORDER_WIDTH = /^border(?:-[0-9]+)?$|^border-[xytrbl](?:-[0-9]+)?$/;

/**
 * A width utility that paints nothing. `border-0` and `border-x-0` are widths,
 * so they satisfy the pattern above, and they draw no edge — which puts a
 * colour beside them right back in the inert case the exemption exists to
 * carve out.
 */
const ZERO_WIDTH = /^border(?:-[xytrbl])?-0$/;

/**
 * A utility's base, with Tailwind's variant prefixes and `!` removed.
 *
 * `hover:border-input` and `md:dark:border-input` set the same property on the
 * same element as the bare utility; the variant only says WHEN. Comparing the
 * whole token missed every stateful and responsive spelling — which are the
 * ones an author reaches for once the plain one appears to do nothing.
 */
export function baseUtility(token: string): string {
  const withoutVariants = token.slice(token.lastIndexOf(":") + 1);
  const withoutImportant = withoutVariants.replace(/^!/, "").replace(/!$/, "");
  // A trailing `/NN` is Tailwind's colour-opacity syntax and still emits the
  // same colour property, so the modifier says how MUCH rather than what — the
  // same relationship a variant has to the utility, and the same reason to
  // remove it before comparing. Arbitrary values take the same form.
  //
  // Written without a concrete example on purpose: the alpha-utility guard in
  // packages/ui greps admin SOURCE for these tokens and does not skip comments,
  // so naming one here fails that suite from a file that renders nothing.
  return withoutImportant.replace(/\/(?:\[[^\]]*\]|[0-9]+%?)$/, "");
}

/**
 * Decode the character references a class string may carry.
 *
 * `className="border&#45;input"` renders as `border-input`. Reading the raw
 * text compares against a string the browser never sees.
 */
export function decodeEntities(text: string): string {
  const named: Record<string, string> = {
    amp: "&",
    lt: "<",
    gt: ">",
    quot: '"',
    apos: "'",
    nbsp: " ",
  };
  return text.replace(
    /&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g,
    (whole, body: string) => {
      if (body.startsWith("#x") || body.startsWith("#X")) {
        return String.fromCodePoint(Number.parseInt(body.slice(2), 16));
      }
      if (body.startsWith("#")) {
        return String.fromCodePoint(Number.parseInt(body.slice(1), 10));
      }
      return named[body.toLowerCase()] ?? whole;
    }
  );
}

/**
 * The classes in `className` that reach the wrapper and do nothing there.
 *
 * Returns the token with its variants intact — `hover:border-input`, not
 * `border-input` — so a message names something the reader can search for.
 * Character references are resolved first and therefore come back decoded,
 * which is the rendered form rather than the written one; that is the right
 * trade for a spelling nobody writes deliberately.
 */
export function inertClassesIn(className: string): string[] {
  const tokens = decodeEntities(className).split(/\s+/).filter(Boolean);
  // A border colour is only inert while nothing gives the wrapper a border.
  const hasBorderWidth = tokens.some(token => {
    const base = baseUtility(token);
    return BORDER_WIDTH.test(base) && !ZERO_WIDTH.test(base);
  });
  return tokens.filter(token => {
    const base = baseUtility(token);
    if (!FIELD_ONLY.test(base)) return false;
    if (hasBorderWidth && base.startsWith("border-")) return false;
    return true;
  });
}

/** The message shown for an inert class, shared so both callers say the same thing. */
export function inertClassMessage(classes: string[]): string {
  return (
    `SearchBar received ${classes.map(name => `\`${name}\``).join(", ")}, ` +
    `which reach its wrapper rather than its input and therefore do nothing. ` +
    `Use className for layout only (w-full, max-w-sm, flex-1). To change the ` +
    `field itself, change Input or the token it reads.`
  );
}
