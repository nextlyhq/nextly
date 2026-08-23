/**
 * The colour view of a stored style value, and the choices a control may offer
 * over it.
 *
 * Pure, for the reason `style-numeric.ts` is: which tokens a leaf may hold,
 * what a value resolves to, and whether a pair has enough contrast are all
 * derivation, and a jsdom test of the rendered field cannot separate a correct
 * answer from a plausible wrong one — both draw a swatch with a colour in it.
 *
 * ## A colour is a PROJECTION over the string, never a model of it
 *
 * A `color` leaf carries no rules of its own, but the value it holds is far
 * wider than a hex: `checkColorValue` accepts the CSS named colours, the system
 * colours, `transparent`, `currentcolor`, the CSS-wide keywords, and sixteen
 * functions including `oklch()`, `color-mix()`, `light-dark()` and `var()` — as
 * well as a `{ $token }` reference, which is a record and nonetheless a scalar.
 *
 * A picker that MODELLED the value as RGBA could represent one of those and
 * would write the rest away the moment it opened. So the text field remains the
 * control and the swatch, the picker and the readout are affordances layered on
 * it, each answering `undefined` rather than guessing.
 *
 * ## Three questions, three domains, and they genuinely differ
 *
 * Conflating them would be the tempting simplification and the wrong one:
 *
 * - what may be STORED is `checkColorValue`'s question, and the write path
 *   already asks it;
 * - what a contrast figure may be computed from is `parseColor`'s, which reads
 *   hex and `rgb()`/`rgba()` ONLY and says why: a figure from a colour it
 *   misread "is worse than no figure, because it is a number somebody will act
 *   on";
 * - what the PICKER can open on is narrower still, because it is seeded from a
 *   hex.
 *
 * Nothing here restates any of them. The engine is asked in every case.
 *
 * ## What a swatch may be painted with, and why it is narrower than CSS
 *
 * A swatch is painted only with a colour this module resolved ITSELF — a token
 * looked up in the site's table, or a literal `parseColor` reads. That is
 * narrower than what a browser can paint, and the exclusion is principled
 * rather than incidental: every value it leaves out means "resolve this
 * somewhere else", and the inspector is not that somewhere.
 *
 * `var(--site-color-primary)` painted into the panel resolves against the
 * PANEL's custom properties rather than the canvas's, so it lands on a
 * different colour or on none. `currentcolor` takes the panel's own text
 * colour. `inherit` takes the swatch's parent. Each would show an author a
 * colour their page does not have, which is the one failure a colour control
 * must not have. Telling those apart from `oklch()` and the named colours —
 * which a browser would paint correctly — needs a grammar this package has no
 * business owning, so the honest line is drawn at what can be resolved here.
 *
 * The cost is a named colour showing no swatch. The value is still displayed,
 * still typeable and never rewritten, which is the cheap direction to be wrong
 * in.
 *
 * @module style-colour
 */

import {
  checkContrast,
  parseColor,
  STYLE_CATALOG,
  tokenIdentity,
  type ContrastResult,
  type Rgb,
  type SiteToken,
  type SiteTokenSet,
  type StyleLeaf,
  type StyleValue,
} from "@nextlyhq/blocks-engine";
import { toHex } from "@nextlyhq/ui/color";

/**
 * One token a colour control may offer, in the three forms it is needed in.
 *
 * The split between {@link identity} and {@link name} is the whole point of the
 * type and is not a convenience. A stored `{ $token }` holds the IDENTITY:
 * `emitTokenBlocks` writes each token's custom property from
 * `tokenCustomProperty(tokenIdentity(token), prefix)`, while the compiler turns
 * a reference into `var(...)` from the stored string verbatim, with no lookup
 * against the table. So the two agree only when the stored string is the
 * identity — and after a rename an identity and a name differ.
 *
 * Storing the name instead would compile to a custom property nothing declares.
 * That invalidates the declaration rather than reporting, so the page keeps
 * rendering with the style missing and nothing says what happened: exactly the
 * failure `SiteToken.id` was added to prevent, reintroduced by the control that
 * writes the reference.
 */
export interface ColourToken {
  /** What a reference STORES, and what a rename never changes. */
  readonly identity: string;
  /** What the author reads and edits. Free to change. */
  readonly name: string;
  /** The literal this token holds, for painting and for measuring. */
  readonly colour: string;
}

/**
 * The tokens a colour control may offer at this leaf.
 *
 * Both halves of the filter are the ENGINE's answer rather than this module's.
 * Which kinds a leaf admits is `leaf.tokenKinds`, taken from the catalog, so a
 * leaf that admits no token offers no picker without a rule being written here;
 * and a token's own `kind` is what the site recorded. A control that offered a
 * token the write path then refused would be the visible half of a drift, and
 * the invisible half is a token wrongly withheld.
 *
 * `undefined` tokens means the question was never asked — the host supplied no
 * table — and answers empty, which is the same shape a site with no colour
 * tokens produces. The two are deliberately not distinguished HERE: what
 * differs is what the panel should SAY about an empty list, and that is the
 * panel's to decide from the same `undefined` it already has.
 *
 * The light-mode value is what a swatch carries, because `values.light` is the
 * one a token is guaranteed to have and the one a document with no mode
 * resolves. A dark-only preview would be a second question and is not this
 * control's.
 */
export function colourTokensFor(
  leaf: StyleLeaf,
  tokens: SiteTokenSet | undefined
): readonly ColourToken[] {
  if (tokens === undefined) return [];
  return tokens.tokens
    .filter(token => leaf.tokenKinds.includes(token.kind))
    .map(colourTokenOf);
}

/**
 * One site token in the three forms a control needs it in.
 *
 * Shared by the list and the single lookup rather than written at each, so the
 * identity rule is applied once: a second copy is one edit from storing the
 * NAME, which compiles to a custom property nothing declares and loses the
 * style with no symptom.
 */
function colourTokenOf(token: SiteToken): ColourToken {
  return {
    identity: tokenIdentity(token),
    name: token.name,
    colour: token.values.light,
  };
}

/**
 * The token a stored reference names, or `undefined` when the site defines
 * none by that identity.
 *
 * Looked up by identity because that is what the reference holds. A site that
 * renamed the token still answers, and answers with its CURRENT name — which is
 * what makes a renamed token readable in the panel rather than showing the
 * label it carried when the reference was written.
 *
 * `undefined` for a reference to a token this site does not define. That is a
 * warning rather than an error in the engine's own issue table, so the value
 * goes on compiling and the control must go on showing it.
 */
export function colourTokenFor(
  identity: string,
  tokens: SiteTokenSet | undefined
): ColourToken | undefined {
  if (tokens === undefined) return undefined;
  const token = tokens.tokens.find(entry => tokenIdentity(entry) === identity);
  return token === undefined ? undefined : colourTokenOf(token);
}

/**
 * The channels a stored colour resolves to, or `undefined` when nothing here
 * can read it.
 *
 * The one place a value becomes channels, so the swatch, the picker seed and
 * the contrast readout cannot disagree about what a value IS — they differ only
 * in what they do with the answer. A token is resolved through the table first,
 * so a reference is as readable as the literal it points at; everything else is
 * handed to the engine.
 *
 * A non-string that is not a token reference — an object at a scalar position
 * from an import or the API — is refused here rather than coerced, for the
 * reason `measurementOf` refuses one: a control that offered to edit it would
 * be offering to replace it with something else entirely.
 */
function colourChannelsOf(
  value: StyleValue | undefined,
  tokens: SiteTokenSet | undefined
): Rgb | undefined {
  const literal = resolvedColourOf(value, tokens);
  return literal === undefined ? undefined : parseColor(literal);
}

/**
 * The literal CSS colour a stored value denotes, as far as this package can
 * resolve it.
 *
 * A token reference becomes the colour the site's table holds for it. A string
 * is already a literal and is returned as written — including the spellings
 * `parseColor` cannot read, because whether a value can be MEASURED is a
 * different question from what it says, and the two have different callers.
 *
 * Not exported: every caller wants one of the two narrower answers below, and a
 * third caller taking the raw literal would be a fourth domain to keep straight.
 */
function resolvedColourOf(
  value: StyleValue | undefined,
  tokens: SiteTokenSet | undefined
): string | undefined {
  if (typeof value === "string") return value;
  // A token reference is one value spelled as a record, so it arrives as an
  // object. Matched on the `$token` key rather than through `isTokenRef`, which
  // could only ever agree with the test already made here, and which would then
  // be a second place this module decides what a reference looks like.
  if (
    typeof value === "object" &&
    value !== null &&
    "$token" in value &&
    typeof value.$token === "string"
  ) {
    return colourTokenFor(value.$token, tokens)?.colour;
  }
  return undefined;
}

/**
 * The hex a stored colour denotes, or `undefined` when nothing here can read it.
 *
 * ONE function for the swatch, the picker seed and the contrast readout, rather
 * than one named for each. They are three uses of a single question — what hex
 * is this value — and giving each its own function would be three expressions
 * that agree today: the shape that produced six of the twenty-four findings on
 * the control that came before this one. A use that genuinely diverges gets its
 * own function THEN, when there is a difference to express.
 *
 * Composed as hex from the channels rather than passed through as written, and
 * that is what makes the module note's rule hold by construction rather than by
 * a check that could be forgotten: `var()`, `currentcolor` and the CSS-wide
 * keywords all fail to become channels, so none of them can reach a `style`
 * attribute through here and resolve against the panel instead of the canvas.
 */
export function colourHexOf(
  value: StyleValue | undefined,
  tokens: SiteTokenSet | undefined
): string | undefined {
  const channels = colourChannelsOf(value, tokens);
  return channels === undefined ? undefined : hexOf(channels);
}

/**
 * The engine's channels as the hex notation the picker reads and writes.
 *
 * THE ONE PLACE THE TWO SCALES MEET, and the reason it is a function rather
 * than an expression at each call site. `@nextlyhq/blocks-engine`'s `Rgb` is
 * 0-255 and `@nextlyhq/ui`'s is [0, 1] — two types with the same name, both in
 * scope in this file. `toHex` CLAMPS to [0, 1], so handing it the engine's
 * shape does not fail: every channel above 1 becomes 255 and the answer is
 * `#ffffff`, silently, for every colour but black. A scale factor written twice
 * is one edit away from that.
 *
 * Alpha crosses as it is, since both packages already carry it as [0, 1], and
 * `toHex` omits the pair at 1 so an opaque colour comes back in the six-digit
 * form an author typed.
 */
function hexOf(rgb: Rgb): string {
  return toHex({ r: rgb.r / 255, g: rgb.g / 255, b: rgb.b / 255 }, rgb.a);
}

/**
 * Which side of a contrast pair a leaf sits on, or `undefined` when it sits on
 * neither.
 *
 * Read from the leaf's own `cssProperty` rather than from a list of catalog
 * keys, which is what makes it cover `linkColor` and `linkColorHover` — both of
 * which write `color`, at ` a` and ` a:hover` — without naming them, and what
 * keeps a sixth colour property working with no edit here.
 *
 * `border-color` is deliberately neither. A border is not text and has no
 * background of its own in this pairing, so reporting it against the block's
 * background would answer a question nobody asked with a threshold that does
 * not apply to it.
 */
export function contrastRoleOf(
  leaf: StyleLeaf
): "foreground" | "background" | undefined {
  if (leaf.kind !== "color") return undefined;
  if (leaf.cssProperty === "color") return "foreground";
  if (leaf.cssProperty === "background-color") return "background";
  return undefined;
}

/**
 * The catalog property holding the other half of this leaf's contrast pair, or
 * `undefined` when it has none.
 *
 * FOUND in the catalog rather than named here. Writing `"backgroundColor"` as a
 * string would be this package asserting a catalog key it does not own — the
 * proxy `derived-checks.md` warns about — and it would go on compiling after a
 * rename while quietly pairing against nothing. Searching for the leaf that
 * emits the partner CSS property asks the structural question instead.
 *
 * Only a leaf with no `descendant` is eligible. `linkColor` emits `color` at
 * ` a`, so a search that ignored the selector could pair the block's background
 * against a link's colour, or return `linkColor` as the partner OF the
 * background — reporting a ratio for two things that are not drawn on top of
 * each other.
 */
export function contrastPartnerOf(leaf: StyleLeaf): string | undefined {
  const role = contrastRoleOf(leaf);
  if (role === undefined) return undefined;
  const wanted = role === "foreground" ? "background-color" : "color";
  const entries = STYLE_CATALOG as unknown as readonly {
    property: string;
    shape: StyleLeaf;
  }[];
  const found = entries.find(candidate =>
    emitsContrastPartner(candidate.shape, wanted)
  );
  return found?.property;
}

/**
 * Whether a leaf is the one a contrast pair should read its partner from.
 *
 * Exported so the descendant rule can be OBSERVED. Inside
 * {@link contrastPartnerOf} it is invisible: `color` precedes `linkColor` in
 * `STYLE_CATALOG`, so the search returns the right property by array order
 * whether or not the selector is considered, and removing the rule changes no
 * result. A guard nothing can see is one a later edit removes as redundant.
 *
 * The rule itself is worth keeping despite that. Three catalog entries emit
 * `color` and two of them attach to ` a` and ` a:hover`, so the correct answer
 * depends on catalog ORDER unless the selector is read — and order is not
 * something this package should be relying on.
 *
 * A leaf with a descendant styles something INSIDE the block. A block's
 * background and a link's colour are not drawn on top of one another in any
 * way this pairing models, so a ratio between them describes nothing.
 */
export function emitsContrastPartner(
  leaf: StyleLeaf,
  cssProperty: string
): boolean {
  return (
    leaf.kind === "color" &&
    leaf.cssProperty === cssProperty &&
    leaf.descendant === undefined
  );
}

/**
 * How a foreground fares against a background, or `undefined` when either
 * cannot be read.
 *
 * The verdict is the ENGINE's — `checkContrast` — per D-05.4. What this adds is
 * only the resolution step in front of it, so a pair written as tokens is
 * judged rather than declined: both sides go through
 * {@link colourChannelsOf} first, which is the same resolution the swatch used.
 *
 * `undefined` propagates rather than being softened, and the caller is expected
 * to render NOTHING for it. That is the engine's own reasoning applied one
 * level up: a ratio computed from a colour that was misread, or defaulted, is a
 * number an author will act on. There is no honest approximation of a contrast
 * against `var(--brand)`, whose value is not known until the page renders.
 *
 * Measured against the LIGHT mode value of any token involved, because that is
 * the mode a document with no mode resolves. A site whose dark values differ
 * has a second answer this does not give.
 */
export function contrastOf(
  foreground: StyleValue | undefined,
  background: StyleValue | undefined,
  tokens: SiteTokenSet | undefined
): ContrastResult | undefined {
  // Through the same function the swatch is painted from, so a pair the panel
  // drew two swatches for is a pair this can measure — and a value that shows
  // no swatch shows no figure. Asking `parseColor` separately here would be a
  // second answer to what a value resolves to, and the two would disagree first
  // on tokens, where one of them consults the table and the other does not.
  const fg = colourHexOf(foreground, tokens);
  const bg = colourHexOf(background, tokens);
  if (fg === undefined || bg === undefined) return undefined;
  return checkContrast(fg, bg);
}

/**
 * The contrast at one leaf against its partner, in the order the two are drawn.
 *
 * A control knows its own value and its partner's; which of them is the
 * FOREGROUND is a fact about the leaf. Kept here with {@link contrastRoleOf}
 * rather than at the call site, because the order is not cosmetic:
 * `checkContrast` composites the background over white and then the foreground
 * over that, so passing a translucent pair the wrong way round produces a
 * different number rather than the same one.
 */
export function contrastAtLeaf(
  leaf: StyleLeaf,
  own: StyleValue | undefined,
  partner: StyleValue | undefined,
  tokens: SiteTokenSet | undefined
): ContrastResult | undefined {
  const role = contrastRoleOf(leaf);
  if (role === undefined) return undefined;
  return role === "background"
    ? contrastOf(partner, own, tokens)
    : contrastOf(own, partner, tokens);
}

/**
 * How a ratio reads to an author, at the precision the figure supports.
 *
 * One decimal place, which is what every accessibility tool reports and what
 * the thresholds themselves are written to: 4.5 and 3 and 7. More digits would
 * imply a precision the input does not have, since the ratio moves with the
 * eighth of a percent that rounding a channel introduces.
 *
 * Rounded rather than truncated, so a figure is never reported below what it
 * is — but the LEVEL beside it is the engine's, computed from the unrounded
 * ratio, so a value at 4.49 reads as "4.5" and still reports as failing body
 * text. That pair looks contradictory and is the honest reading: the threshold
 * is on the ratio, not on its display.
 */
export function contrastRatioText(result: ContrastResult): string {
  return `${result.ratio.toFixed(1)}:1`;
}
