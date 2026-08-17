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
 *
 * Whether a class is inert is a question about the RENDERED box, not about the
 * token. Each entry below is inert only while the wrapper stays the bare
 * positioning context it is by default: give it a border and a border colour
 * paints, give it padding and a background shows around the field. Those
 * conditions are part of the rule rather than exceptions to it, because a
 * caller who writes them has asked for something real.
 */
import { cn } from "@admin/lib/utils";

/** The wrapper's own classes, shared so the check reads what the DOM gets. */
export const WRAPPER_BASE = "relative w-full max-w-lg";

/** Colour utilities that only reach the field, never the wrapper. */
const FIELD_ONLY =
  /^(?:border-(?:input|border|control-border)|bg-background|text-foreground)$/;

/**
 * Any border utility at all, colour or width.
 *
 * Written as a PREFIX rather than as a list of width spellings, and that is the
 * substantive decision in this file. Enumerating widths means keeping up with
 * `border-2`, `border-x`, the logical `border-s`/`border-e`, arbitrary
 * `border-[3px]`, and whatever Tailwind adds next — an unbounded surface where
 * every gap reports a caller's deliberate border as inert. A prefix cannot have
 * that kind of gap.
 *
 * The cost is deliberate and one-directional: a token that is border-ish but
 * paints nothing suppresses the warning. That errs toward SILENCE, which is the
 * right direction — a missed dead class costs a line of CSS, while a warning on
 * correct code teaches the reader to ignore the next one.
 */
const BORDER_TOKEN = /^border(?:$|-)/;

/**
 * A width utility that paints nothing. `border-0` and `border-x-0` are borders
 * by the prefix above, and they draw no edge — which puts a colour beside them
 * right back in the inert case the exemption exists to carve out.
 */
const ZERO_WIDTH = /^border(?:-[xytrbles])?-0$/;

/**
 * Padding on the wrapper, which is what makes its background visible.
 *
 * The input fills the wrapper's CONTENT box. With no padding the two coincide
 * and a background on the wrapper is covered entirely; add padding and the
 * wrapper paints a visible frame around the field, so `bg-background` is doing
 * exactly what the caller asked.
 */
const PADDING_TOKEN = /^p[xytrbles]?-/;

/**
 * Padding that adds no box. `p-0` and `px-0` are padding utilities by the
 * pattern above and leave the field covering the wrapper exactly, which puts a
 * background beside them back in the inert case the condition carves out — the
 * same relationship `border-0` has to a border colour.
 */
const ZERO_PADDING = /^p[xytrbles]?-0$/;

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
  // A code point outside Unicode's range makes `String.fromCodePoint` throw,
  // and this runs inside the development effect -- so an unparseable reference
  // in a class string would take the component down rather than produce a
  // warning. A diagnostic must never be able to break what it reports on, so an
  // out-of-range reference is left exactly as written instead.
  const fromCodePoint = (value: number, whole: string): string =>
    Number.isInteger(value) && value >= 0 && value <= 0x10ffff
      ? String.fromCodePoint(value)
      : whole;

  return text.replace(
    /&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g,
    (whole, body: string) => {
      if (body.startsWith("#x") || body.startsWith("#X")) {
        return fromCodePoint(Number.parseInt(body.slice(2), 16), whole);
      }
      if (body.startsWith("#")) {
        return fromCodePoint(Number.parseInt(body.slice(1), 10), whole);
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
  const bases = tokens.map(baseUtility);

  // A border colour is only inert while nothing gives the wrapper a border, and
  // a background only while the wrapper's box is covered by the field.
  const drawsBorder = bases.some(
    base =>
      BORDER_TOKEN.test(base) &&
      !FIELD_ONLY.test(base) &&
      !ZERO_WIDTH.test(base)
  );
  const hasPadding = bases.some(
    base => PADDING_TOKEN.test(base) && !ZERO_PADDING.test(base)
  );

  return tokens.filter((_, index) => {
    const base = bases[index] ?? "";
    if (!FIELD_ONLY.test(base)) return false;
    if (base.startsWith("border-") && drawsBorder) return false;
    if (base === "bg-background" && hasPadding) return false;
    return true;
  });
}

/**
 * The inert classes in what a caller passed, judged on the string the DOM gets.
 *
 * The caller's `className` is not what lands on the element: `cn` merges it
 * with the wrapper's own classes and drops the losers of any conflict, so
 * `border-input border-destructive` reaches the DOM as `border-destructive`
 * alone. Reporting the discarded token would describe markup that was never
 * rendered.
 *
 * So both askers go through here rather than reading the raw prop. The
 * component has this string already; the test builds the same one from a
 * literal. Neither classifies anything `cn` did not keep.
 */
export function inertClassesFor(className: string | undefined): string[] {
  if (!className) return [];
  return inertClassesIn(cn(WRAPPER_BASE, className));
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
