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
  emitTokenBlocks,
  isTokenRef,
  parseColor,
  resolveSiteTokens,
  STYLE_CATALOG,
  tokenCustomProperty,
  tokenIdentity,
  type ContrastResult,
  type Rgb,
  type NodeStyles,
  type SiteToken,
  type SiteTokenSet,
  type TokenKind,
  type TokenMode,
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
  /** What the token holds, so a leaf can be asked whether it admits one. */
  readonly kind: TokenKind;
  /** The literal this token holds, as the site recorded it. */
  readonly colour: string;
  /**
   * The colour a preset swatch may be PAINTED with, or `undefined` when this
   * package cannot resolve one.
   *
   * Carried rather than left to the call site, because a token's value is a
   * string like any other and may be `var(--brand)`, `currentcolor` or a
   * CSS-wide keyword. Painted raw into a preset button those resolve against
   * the INSPECTOR rather than the canvas — the exact failure
   * {@link colourHexOf} exists to prevent for the main swatch, arrived at by a
   * second route. Resolving here means both swatches answer the same way.
   */
  readonly swatch: string | undefined;
}

/**
 * Which mode's value a token resolves to on the canvas right now.
 *
 * `emitTokenBlocks` writes a second block for every token carrying a dark
 * value, and WHEN it applies is the site's strategy: `media` wraps it in
 * `@media (prefers-color-scheme:dark)`, so a viewer whose system prefers dark
 * sees the dark value with nothing else having to happen. A control resolving
 * `values.light` regardless would then paint a swatch and report a ratio for a
 * colour the canvas is not showing — the one failure this module exists to
 * prevent, reached through the mode rather than through the notation.
 *
 * `attribute` — the default — answers `light`, and that is a STATED LIMIT
 * rather than a claim. The dark block is written under
 * `[data-nx-theme="dark"]`, which the HOST sets on an ancestor of its choosing;
 * nothing tells this panel whether it did. Reading the DOM to find out would
 * make a pure projection depend on where the canvas happens to be mounted.
 */
export function activeTokenMode(
  tokens: SiteTokenSet | undefined,
  prefersDark: boolean
): TokenMode {
  return tokens?.darkMode === "media" && prefersDark ? "dark" : "light";
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
  tokens: SiteTokenSet | undefined,
  mode: TokenMode = "light"
): readonly ColourToken[] {
  return offeredTokens(tokens, mode).filter(token =>
    leaf.tokenKinds.includes(token.kind)
  );
}

/**
 * Every token the canvas will resolve, in the mode it is showing.
 *
 * THE one projection, and everything else here reads it. Which tokens exist,
 * which of them the canvas actually declares, and what each resolves to are one
 * question asked once — so the list a picker offers, the table a stored
 * reference is looked up in, and the colours a contrast figure is measured from
 * cannot disagree. Each of those was a separate search before, and each was
 * wrong in a different way.
 *
 * `resolveSiteTokens` FIRST, because that is what the renderer does:
 * `PageRenderer` compiles with `resolveSiteTokens(siteInput?.tokens)`, which
 * layers the engine's own defaults under the site's overrides. A site that
 * defines nothing still emits `color.text`, `color.primary` and the rest, so a
 * picker reading the raw override set offered none of them and could not
 * resolve a document that referenced one.
 *
 * `undefined` still means the question was never asked and answers empty — NOT
 * the defaults. A host that has not said what the site holds has not said that
 * it holds the defaults either.
 */
function offeredTokens(
  tokens: SiteTokenSet | undefined,
  mode: TokenMode
): readonly ColourToken[] {
  if (tokens === undefined) return [];
  const byMode = cache.get(tokens) ?? new Map<TokenMode, ColourToken[]>();
  const hit = byMode.get(mode);
  if (hit !== undefined) return hit;
  const resolved = resolveSiteTokens(tokens);
  const built = emittableTokens(resolved, mode).map(token =>
    colourTokenOf(token, mode)
  );
  byMode.set(mode, built);
  cache.set(tokens, byMode);
  return built;
}

/**
 * Built projections, by the set they came from.
 *
 * Held because building one emits every token individually to ask the engine
 * whether it accepts it, and a control rebuilds on every render of every colour
 * field. Keyed on the set's identity, which is safe for the same reason the
 * engine's own `memoizeTokenLookup` is: these are immutable props, so a set
 * that is the same object is the same data.
 */
const cache = new WeakMap<SiteTokenSet, Map<TokenMode, ColourToken[]>>();

/**
 * The tokens the canvas will actually declare a custom property for.
 *
 * `emitTokenBlocks` drops a token for more reasons than are obvious from
 * outside, and a partial copy of that list is worse than none: it reads as
 * complete, agrees with the engine on the cases someone thought of, and offers
 * a token the canvas silently drops for any case they did not — which stores a
 * reference to a property nothing declares and loses the style with no symptom.
 */
function emittableTokens(
  set: SiteTokenSet,
  mode: TokenMode
): readonly SiteToken[] {
  const seen = new Set<string>();
  const emittable: SiteToken[] = [];
  for (const token of set.tokens) {
    if (!emits(token, mode)) continue;
    // Which of two ACCEPTED tokens actually gets the property is the one thing
    // the emitter cannot be asked, because both are individually fine and only
    // their order decides. `tokenCustomProperty` composes the key, so the
    // normalisation is still the engine's; only first-one-wins is repeated.
    //
    // The prefix is omitted deliberately: it is the same string in front of
    // every property, so it can neither create a collision nor prevent one, and
    // the site's real prefix is resolved by a function the engine keeps private.
    const property = tokenCustomProperty(tokenIdentity(token), "");
    if (seen.has(property)) continue;
    seen.add(property);
    emittable.push(token);
  }
  return emittable;
}

/**
 * Whether the canvas will declare a custom property for this token.
 *
 * ASKED, by emitting the token and seeing what comes out, rather than by
 * restating the emitter's rules here where they would drift from it.
 *
 * Asked TWICE, because the emitter reaches two kinds of verdict and they have
 * different scopes. A refusal — an unusable name or id, a missing or non-string
 * light value, a value that is not safe CSS, a value that would make the page
 * fetch a file — costs the token in EVERY mode: the emitter scans both values
 * and skips the whole token, so a dark `url(…)` leaves the light value
 * undeclared too. A kind mismatch is the opposite: it is reported and the value
 * is written anyway, so it costs only the mode whose value is wrong.
 *
 * Judging the whole token by its active value alone would miss the first kind,
 * and offer a preset whose reference resolves to nothing. Judging it by both
 * values would apply the second kind too widely, and withhold a token whose
 * light value is a perfectly good colour.
 */
function emits(token: SiteToken, mode: TokenMode): boolean {
  // The refusals, asked of the WHOLE token. Nothing WRITTEN is the emitter's
  // own verdict, read from its output rather than from its commentary: a future
  // refusal that forgot to report would otherwise arrive here as an accepted
  // token that declares nothing.
  //
  // The set's prefix is deliberately not passed. It cannot decide any of these
  // rules, and supplying an unusable one would add an issue about the SET to
  // every token in it — turning one bad prefix into an empty picker.
  if (emitTokenBlocks({ tokens: [token] }, ":root").css === "") return false;

  // The kind mismatch, asked of the ACTIVE value alone. Every other objection
  // was ruled out above, so anything said about a token carrying only this one
  // value is that check — which is why the question can be asked without
  // matching the message text, wording nobody promised to keep, and without
  // `checkTokenKind`, which the engine does not export.
  //
  // It matters because the browser drops the declaration where the token is
  // USED, not where it is defined: a colour token holding `16px` is written,
  // resolves, and does nothing, so a picker offering it hands over a reference
  // with no symptom to follow.
  const active = token.values[mode] ?? token.values.light;
  const alone = emitTokenBlocks(
    { tokens: [{ ...token, values: { light: active } }] },
    ":root"
  );
  return alone.issues.length === 0;
}

/**
 * One site token in the forms a control needs it in.
 *
 * Shared by every reader rather than written at each, so the identity rule is
 * applied once: a second copy is one edit from storing the NAME, which compiles
 * to a custom property nothing declares and loses the style with no symptom.
 */
function colourTokenOf(token: SiteToken, mode: TokenMode): ColourToken {
  // `light` is required and `dark` is not, so a token defined only for light
  // resolves to it in either mode — which is what the canvas does too: no dark
  // declaration is emitted for it, so the light one goes on applying.
  const colour = token.values[mode] ?? token.values.light;
  return {
    identity: tokenIdentity(token),
    name: token.name,
    kind: token.kind,
    colour,
    // Resolved with an EMPTY table, which is what stops this recursing: a token
    // whose value is itself a reference would otherwise re-enter the lookup that
    // is building this record. Unresolvable then means unpainted, which is the
    // honest answer for a value this package cannot follow.
    swatch: colourHexOf(colour, undefined),
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
  tokens: SiteTokenSet | undefined,
  mode: TokenMode = "light"
): ColourToken | undefined {
  // The OFFERED projection, not the raw set. Searching the raw set resolved a
  // reference the canvas never declares — an imported document naming a token
  // the emitter rejects painted its value anyway — and, for two identities that
  // collide, showed the loser while the page resolves the winner's declaration.
  return offeredTokens(tokens, mode).find(token => token.identity === identity);
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
  tokens: SiteTokenSet | undefined,
  mode: TokenMode
): Rgb | undefined {
  const literal = resolvedColourOf(value, tokens, mode);
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
  tokens: SiteTokenSet | undefined,
  mode: TokenMode
): string | undefined {
  if (typeof value === "string") return value;
  // The ENGINE's own test for a reference, which is also what
  // {@link colourShowable} routes on — so what counts as a token here and what
  // the panel sends to a colour control cannot drift apart.
  if (isTokenRef(value)) {
    return colourTokenFor(value.$token, tokens, mode)?.colour;
  }
  return undefined;
}

/**
 * The hex a stored colour denotes, or `undefined` when nothing here can read it.
 *
 * ONE function for the swatch, the picker seed and the contrast readout, rather
 * than one named for each. They are three uses of a single question — what hex
 * is this value — and giving each its own function would be three expressions
 * that agree today and drift apart silently, because each looks correct on its
 * own. A use that genuinely diverges gets its own function THEN, when there is
 * a difference to express.
 *
 * Composed as hex from the channels rather than passed through as written, and
 * that is what makes the module note's rule hold by construction rather than by
 * a check that could be forgotten: `var()`, `currentcolor` and the CSS-wide
 * keywords all fail to become channels, so none of them can reach a `style`
 * attribute through here and resolve against the panel instead of the canvas.
 */
export function colourHexOf(
  value: StyleValue | undefined,
  tokens: SiteTokenSet | undefined,
  mode: TokenMode = "light"
): string | undefined {
  const channels = colourChannelsOf(value, tokens, mode);
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
 * Whether a colour control can show this stored value at all.
 *
 * A colour surface has two shapes — a literal string it puts in a text field,
 * and a `{ $token }` reference it names — plus the unset case. Anything else is
 * a value no colour control can represent: an object at a scalar position from
 * an import or the API, or a number. Those keep the panel's own read-only
 * surface, which shows the value and offers to clear it, rather than being
 * projected to an empty field that reads as unset while the value goes on
 * compiling.
 *
 * Asked HERE rather than in the panel so that the routing question and the
 * resolution below cannot disagree about what a colour value is.
 */
export function colourShowable(value: StyleValue | undefined): boolean {
  return value === undefined || typeof value === "string" || isTokenRef(value);
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
 * The verdict is the ENGINE's — `checkContrast` — and is never recomputed here.
 * A contrast ratio is a property of two colours rather than of this panel, and a
 * second implementation would drift from the one the compiler and the validator
 * already answer with, silently, because both spellings look correct. What this
 * adds is only the resolution step in front of it, so a pair written as tokens
 * is judged rather than declined: both sides go through
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
  tokens: SiteTokenSet | undefined,
  mode: TokenMode = "light"
): ContrastResult | undefined {
  // Through the same function the swatch is painted from, so a pair the panel
  // drew two swatches for is a pair this can measure — and a value that shows
  // no swatch shows no figure. Asking `parseColor` separately here would be a
  // second answer to what a value resolves to, and the two would disagree first
  // on tokens, where one of them consults the table and the other does not.
  const fg = colourHexOf(foreground, tokens, mode);
  const back = colourChannelsOf(background, tokens, mode);
  if (fg === undefined || back === undefined) return undefined;
  // A TRANSLUCENT background has no contrast this can compute, because what
  // shows through it is not known here. `checkContrast` composites the
  // background over WHITE, which is a reasonable default for a page and wrong
  // for a block sitting on another block, on a site background, or on a dark
  // canvas — and it fails in the direction that matters: white text on
  // `rgba(0,0,0,.5)` reports as PASSING after white compositing while
  // rendering nearly invisible over a dark backdrop. Withheld rather than
  // reported, for the same reason the engine withholds a figure for a colour it
  // cannot read.
  //
  // A translucent FOREGROUND is fine and is not refused: it composites over the
  // background, which is a colour this does know.
  if (back.a < 1) return undefined;
  return checkContrast(fg, hexOf(back));
}

/**
 * Catalog properties whose value changes what colour actually reaches the eye.
 *
 * A contrast figure is about two colours drawn on top of each other. Each of
 * these puts something else between them or over them: a background image or
 * gradient covers the background colour, `opacity` and `filter` change both,
 * and `mixBlendMode` makes the result depend on what is underneath the node
 * entirely. A ratio computed from the two colour properties alone is then a
 * number about a rendering that does not happen — black text on `#ffffff` with
 * an opaque black gradient over it reports 21:1 and renders black on black.
 *
 * A list rather than a catalog-derived set, and the honest reason is that the
 * catalog does not record this: nothing marks a property as pixel-altering, so
 * there is no structural question to ask. It is therefore a floor rather than a
 * proof — a property added later that also obscures will not appear here until
 * someone adds it — and it errs toward WITHHOLDING, which is the safe direction
 * for a figure an author acts on.
 */
const OBSCURING_PROPERTIES: readonly string[] = [
  "background",
  "backgroundGradient",
  "opacity",
  "filter",
  "mixBlendMode",
  // An INSET shadow is painted over the background and can replace the colour
  // behind the text entirely — black text on `#ffffff` under an opaque black
  // inset shadow reports 21:1 and renders black on black. Counted whether or
  // not the value says `inset`, because telling the two apart means reading
  // the grammar of a shadow, and a `cssValue` leaf is validated for SYNTAX
  // only: the catalog does not decide what a shadow means, so neither can
  // this. An outer shadow therefore withholds a verdict it need not, which is
  // the direction everything else in this list errs in.
  "boxShadow",
];

/**
 * The property standing between this pair, or `undefined` when none is set.
 *
 * Takes a READER rather than the stored values, so the caller keeps ownership
 * of which node, state and breakpoint is being asked about — the same address
 * the control is reading its own value at — and this stays a pure question
 * about a set of property names.
 */
export function contrastObscuredBy(
  valueAt: (property: string) => StyleValue | undefined
): string | undefined {
  return OBSCURING_PROPERTIES.find(property => valueAt(property) !== undefined);
}

/**
 * The property standing between a pair anywhere on this node, or `undefined`.
 *
 * Every state and every breakpoint, not the one address being edited. A base
 * `backgroundGradient` goes on covering the background while a hover rule sets
 * only the two colours, so an address-scoped look sees no gradient and reports
 * a ratio for pixels the gradient hides — the guard failing OPEN, which is the
 * one direction it must not fail in.
 *
 * This OVER-withholds, and that is the deliberate trade: a gradient set only at
 * a narrow breakpoint suppresses the verdict at every width. Answering exactly
 * needs `styleOrigin`, which has already settled tier order, both breakpoint
 * axes, states and specificity — and needs a trace of compiled declarations
 * that nothing supplies to this panel. Between a verdict that is sometimes
 * absent and a verdict that is sometimes wrong, this takes the first.
 *
 * A named class carrying one of these is still not seen, for the same reason,
 * and that limit is not closed here. Nor is a stored breakpoint the site no
 * longer defines: its values never compile, so counting them withholds a
 * verdict that would have been correct. Both err the same way as the rest of
 * this function, which is why neither is treated as urgent.
 */
export function contrastObscuredIn(
  styles: NodeStyles | undefined
): string | undefined {
  if (styles === undefined) return undefined;
  for (const breakpoints of Object.values(styles)) {
    if (breakpoints === undefined) continue;
    for (const values of Object.values(breakpoints)) {
      if (values === undefined) continue;
      const found = contrastObscuredBy(property =>
        Object.hasOwn(values, property) ? values[property] : undefined
      );
      if (found !== undefined) return found;
    }
  }
  return undefined;
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
  tokens: SiteTokenSet | undefined,
  mode: TokenMode = "light"
): ContrastResult | undefined {
  const role = contrastRoleOf(leaf);
  if (role === undefined) return undefined;
  return role === "background"
    ? contrastOf(partner, own, tokens, mode)
    : contrastOf(own, partner, tokens, mode);
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
