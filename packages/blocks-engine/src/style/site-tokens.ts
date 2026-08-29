/**
 * Site tokens and font faces: what a site defines once and every page reads.
 *
 * A token is a NAME the styling layer already knows how to reference —
 * `tokenCustomProperty` turns `color.primary` into `--site-color-primary`, and
 * the catalog decides which properties may hold which kind. What was missing
 * was the other half: the table those names resolve in, and the CSS that makes
 * them resolve at all.
 *
 * ## Names are dot paths; the CSS prefix is applied at emission
 *
 * `color.primary`, `space.4`, `content.width`. The prefix is the site's choice
 * (`--site-` by default) and is validated rather than trusted, because two of
 * them are reserved: `--nx-` is the admin's own namespace and `--tw-` is
 * Tailwind's internals. A site that took either would restyle surfaces it does
 * not own.
 *
 * ## Modes are in the model from the start
 *
 * Not because dark mode is being built here, but because retrofitting a second
 * value onto a one-value token is a data migration, and adding it now costs one
 * optional field. What activates a mode is the HOST's decision — it owns the
 * document, and it may already have a theme toggle — so this emits the values
 * under a strategy and takes no position on who flips it.
 *
 * ## Identity is `id` when there is one, and the name otherwise
 *
 * A name is a label an author edits. Two things key off a token's IDENTITY and
 * neither can move when that label does: the custom property emitted into every
 * compiled sheet, and the `$token` string every stored document holds. So the
 * identity is a separate field, exactly as `NamedClass` splits `id` from
 * `slug` — and for the same reason, since an unresolved custom property
 * invalidates the declaration rather than reporting, so a moved one loses the
 * style with no symptom to follow.
 *
 * `id` is OPTIONAL, and that is the whole continuity argument rather than a
 * convenience. Every token stored before the field existed has none, so its
 * identity is its name, so it emits the property it already emitted and the
 * documents referencing it already resolve. Nothing migrates. A rename then
 * FREEZES the identity at the name it had — {@link renameSiteToken} is the one
 * place that rule lives — and moves only the label.
 *
 * One consequence is worth stating because it is not obvious: ids and names
 * share one custom-property space, so renaming `color.primary` does not fully
 * free that name. A new token claiming it collides with the frozen id of the
 * token that left it, and {@link emitTokenBlocks} refuses the second rather
 * than letting one token resolve to the other's value.
 *
 * @module style/site-tokens
 */
import { isPlainRecord } from "../plain-record";
import type { ValidationIssue } from "../validation";

import type { TokenKind } from "./catalog-types";
import { parseColor } from "./contrast";
import {
  asciiLower,
  checkCssValue,
  checkUrlValue,
  decodeIdentifier,
  isCssWideKeyword,
  unitCategory,
} from "./css-value";
import {
  MAX_TOKEN_NAME_LENGTH,
  MAX_TOKEN_NAME_SEGMENTS,
  MAX_TOKEN_PREFIX_LENGTH,
  isAuthorableTokenName,
  isTokenName,
  safeTokenPrefix,
  tokenCustomProperty,
} from "./declarations";

/** The modes a token may carry a value for. */
export type TokenMode = "light" | "dark";

export const TOKEN_MODES: readonly TokenMode[] = ["light", "dark"];

/**
 * How a dark-mode token block is made to apply.
 *
 * `attribute` is the default because it is the only one the site can control:
 * a host with a theme toggle sets `data-nx-theme="dark"` and the values follow.
 * `media` follows the operating system instead, which is right for a site with
 * no toggle and wrong for one that has it — hence a choice rather than a
 * constant.
 */
export type DarkModeStrategy = "attribute" | "media";

/** One site token: a name, what kind of value it holds, and that value. */
export interface SiteToken {
  /**
   * Stable identity, when the token has been given one.
   *
   * What the emitted custom property and a document's `$token` key off, and
   * what a rename never changes. Held to the same grammar as a name, because it
   * reaches CSS through the same `tokenCustomProperty` call.
   *
   * Absent means the name IS the identity, which is what every token stored
   * before this field existed relies on — see the module note.
   */
  id?: string;
  /** Dot-path name, as authors read and write it. Free to change. */
  name: string;
  kind: TokenKind;
  /**
   * The value for each mode.
   *
   * `light` is required and is what a document with no mode resolves — a token
   * defined only for dark would vanish for every reader who never turns it on.
   */
  values: { light: string; dark?: string };
  /** Author-facing note, carried through DTCG import/export. */
  description?: string;
  /**
   * Vendor data from other tools, carried untouched.
   *
   * The DTCG format requires it: "Tools that process design token files MUST
   * preserve any extension data they do not themselves understand." A token
   * that came from Figma or Style Dictionary and goes back to it has to arrive
   * with whatever those tools wrote about it, so importing has somewhere to
   * put data this system has no opinion on.
   */
  extensions?: Readonly<Record<string, unknown>>;
  /**
   * Fields found under THIS system's own extension key that this build does not
   * read, kept so it can write them back out.
   *
   * A reverse-domain key names the vendor, not the build. Under
   * `com.nextlyhq.nextly` a field this build has no reader for is exactly as
   * foreign as another vendor's block, and the reason the format gives for
   * preserving one applies unchanged to the other: a tool that cannot interpret
   * data should not be the tool that destroys it. The format's own requirement
   * covers only other vendors, and says nothing about a producer meeting a
   * newer version of itself — so this is the same rule, extended to the case
   * the format leaves open.
   *
   * Separate from `extensions` because that field is what other tools wrote and
   * this is what a different build of THIS one wrote. Merging them would make
   * `com.nextlyhq.nextly` look like a foreign vendor to every later reader, and
   * the emitter regenerates that key from the model on every export.
   *
   * Safe to re-emit because the format asks that extension data stay "optional
   * meta-data that is not crucial to understanding that token's value": a
   * conforming producer puts nothing here that a stale copy could corrupt. The
   * cost that remains is staleness — a preserved field describing something the
   * model later changes is written back as it arrived.
   */
  unreadExtension?: Readonly<Record<string, unknown>>;
}

/** Everything a site defines for its pages to read. */
export interface SiteTokenSet {
  tokens: readonly SiteToken[];
  /** Custom-property prefix; `--site-` when unset. */
  prefix?: string;
  darkMode?: DarkModeStrategy;
}

/**
 * What this token is, as against what it is called.
 *
 * The one answer to that question, because three things ask it — the custom
 * property the emitter writes, the key a tier merge overrides on, and the
 * string a document stores — and they have to agree by construction. Two of
 * them agreeing today and drifting later has no symptom: a token whose
 * identity moved emits a property nothing references, which reads exactly like
 * a token whose value did not apply.
 */
export function tokenIdentity(token: SiteToken): string {
  return token.id ?? token.name;
}

/**
 * The token under a new name, with its identity pinned where it already was.
 *
 * The rename rule lives here rather than in each editor that offers one,
 * because getting it wrong is silent in the direction that loses work: setting
 * `id` to the NEW name moves the custom property and every stored `$token`
 * stops resolving, which is the defect the field exists to prevent, and the
 * page still renders — just without the style.
 *
 * Idempotent across repeated renames: the second one reads the id the first
 * froze, so an identity is pinned once and never again.
 */
export function renameSiteToken(token: SiteToken, name: string): SiteToken {
  const current = tokenIdentity(token);
  // An identity this engine cannot write is not resolving for anything, so
  // carrying it forward pins a token permanently unusable: the rename is
  // accepted, the label changes, and the token still emits nothing with no
  // remaining way to repair it.
  //
  // Re-pinning is safe in exactly that case and only there. A WORKING identity
  // must never move, because every stored `$token` reads it — which is what
  // this function exists to protect. One that cannot be emitted resolves for
  // nothing, so no reference that WORKS is lost by replacing it.
  //
  // What that does not mean is that no references exist. A name refused today
  // may have been valid when a document was saved, so stored `$token` values
  // can still name it — already resolving to nothing, and still doing so after
  // the token is repaired under a new identity. This makes the TOKEN usable
  // again; the documents pointing at the old name are a separate repair, and
  // one this helper cannot make: it is handed a token and never sees them.
  if (
    identityProblem(current, token.id === undefined ? "name" : "id") !==
    undefined
  ) {
    return { ...token, id: undefined, name };
  }
  return { ...token, id: current, name };
}

/** One file a font face can be loaded from. */
export interface FontSource {
  /**
   * A path on this site. Absolute-with-host is refused — see
   * {@link validateFontFace}.
   */
  url: string;
  /** `woff2`, `woff`, … Emitted as `format(…)` when present. */
  format?: string;
}

/** A `@font-face` a site self-hosts. */
export interface FontFaceDef {
  family: string;
  src: readonly FontSource[];
  weight?: string;
  style?: string;
  /** Defaults to `swap`: text is readable while the file loads. */
  display?: string;
  unicodeRange?: string;
}

/**
 * The attribute a host sets to activate dark values.
 *
 * Named rather than themed: it says what it selects and belongs to no design
 * system, so a host wiring its own toggle to it is not adopting anything else.
 */
export const DARK_MODE_ATTRIBUTE = "data-nx-theme";

/** The `format()` hints a face may declare: plain keywords, nothing else. */
/**
 * The longest font format this engine will write.
 *
 * The grammar below constrains the alphabet and not the length, and a format is
 * emitted into `format("...")` on every source of every face. Real values are
 * `woff2`, `truetype`, `opentype` — so this sits far above anything meaningful
 * and is only met by data already wrong.
 */
export const MAX_FONT_FORMAT_LENGTH = 32;

/**
 * The longest selector `emitTokenBlocks` will write a token block under.
 *
 * The selector is supplied by the caller and inserted into the emitted CSS
 * verbatim — once for the light block and once more for a dark one — so an
 * oversized one is copied into the sheet rather than merely held.
 *
 * Generous against what a caller passes: a page-scope class or `:root`.
 */
export const MAX_TOKEN_SELECTOR_LENGTH = 256;

const FONT_FORMAT = /^[a-z0-9-]+$/i;

/**
 * The prefix to emit under, with a reason when the requested one is refused.
 *
 * The rule itself lives with the compiler, which is the other half of the same
 * decision: this side writes the definitions and that side writes the `var()`
 * that reads them, so a prefix either side refused alone would leave the two
 * pointing at different custom properties. Only the shape of the report differs
 * here, because the token table answers in issues rather than strings.
 *
 * A refused prefix falls back rather than throwing, in keeping with the rest of
 * the compiler: one bad setting should cost the site its naming choice, not its
 * stylesheet.
 */
export function resolveTokenPrefix(prefix: string | undefined): {
  prefix: string;
  issue?: ValidationIssue;
} {
  const safe = safeTokenPrefix(prefix);
  return safe.warning === undefined
    ? { prefix: safe.prefix }
    : { prefix: safe.prefix, issue: tokenIssue(safe.warning) };
}

function tokenIssue(
  message: string,
  severity: ValidationIssue["severity"] = "warning"
): ValidationIssue {
  return { path: "siteTokens", code: "invalid-style-value", severity, message };
}

/**
 * Whether a name may be turned into a custom property.
 *
 * The compiler's grammar, not a second one: it is what a `$token` reference is
 * held to, and a table that accepted names references cannot name would hold
 * tokens that exist and resolve to nothing. Re-exported because this is where
 * a reader of the token table looks for it.
 *
 * The check matters beyond agreement, too — the name becomes the custom
 * PROPERTY, so a name carrying `}` closes the rule the emitter opened and
 * everything after it is CSS the site never wrote. `x:1}body{color` is the
 * whole attack.
 */
export {
  isAuthorableTokenName,
  isTokenName,
  MAX_TOKEN_NAME_LENGTH,
  MAX_TOKEN_NAME_SEGMENTS,
  MAX_TOKEN_PREFIX_LENGTH,
};

/**
 * A font descriptor that goes inside a quoted CSS string, made safe to put
 * there.
 *
 * A family name is author data and reaches the stylesheet inside quotes, so a
 * quote in it closes the string and the rest is read as CSS —
 * `Brand";src:url(/ok)}body{display:none}/*` ends the rule and writes another.
 * Escaped rather than refused, because a backslash or a quote in a family name
 * is legal CSS and the escape is what the spec provides for exactly this.
 */
/**
 * A value as the CONTENT of a CSS string, escaped so it cannot end one.
 *
 * Published because a family name reaches CSS from more than one place: the
 * compiler writes `font-family:"…"` into the site sheet, and a surface drawing
 * a specimen writes the same name into an inline style. Wrapping author data in
 * quotes without this produces `"ACME "Pro""` for the perfectly legal family
 * `ACME "Pro"` — the browser drops the declaration, and the specimen silently
 * demonstrates the fallback instead of the face it names.
 */
export function cssString(value: string): string {
  let out = "";
  for (const char of value) {
    const code = char.codePointAt(0) ?? 0;
    if (char === "\\" || char === '"') {
      out += `\\${char}`;
    } else if (code < 0x20 || code === 0x7f) {
      // A raw control character cannot appear in a CSS string — a newline ends
      // it outright, so the whole `@font-face` is discarded and the uploaded
      // font never loads. The hex escape is what the grammar provides, and the
      // trailing space is what ends the escape.
      out += `\\${code.toString(16)} `;
    } else {
      out += char;
    }
  }
  return out;
}

/**
 * Descriptor values that are written unquoted, so they are checked instead.
 *
 * `font-weight`, `font-style`, `font-display` and `unicode-range` land in the
 * rule as written. `checkCssValue` is the same guard the style compiler applies
 * to any stored value, and it refuses the characters that end a declaration or
 * a rule.
 */
function unquotedDescriptor(value: string): boolean {
  return checkCssValue(value) === null;
}

/**
 * Functions in a token value that can make the browser fetch something.
 *
 * `url()` is the obvious one; `image-set()` and `cross-fade()` hold URLs of
 * their own, `element()` and `paint()` name a source, and `attr()` reads its
 * destination out of the DOM at use time, where nothing here can see it.
 */
const FETCHING_FUNCTION =
  /(^|[^\w-])(url|src|image|image-set|-webkit-image-set|cross-fade|-webkit-cross-fade|element|paint|attr)\s*\(/;

/**
 * Whether a token value can reach off this site, which none of them may.
 *
 * A token is emitted as a custom property and read back by `var()` somewhere
 * this cannot see. That is the whole problem: sanitized custom CSS may write
 * `background: var(--site-hero)` with no URL literal anywhere in it, so the
 * origin policy that guards custom CSS has nothing to inspect and the
 * selector-gated request channel it exists to close is open again through
 * stored token data.
 *
 * Refused outright rather than origin-checked, because no token KIND denotes a
 * URL — colours, lengths, durations, families, weights, numbers and shadows are
 * the whole list. A value that fetches is not a restricted token, it is not a
 * token. An image belongs in a block's `backgroundImage`, which carries the
 * declared-hosts policy and is checked where it is written.
 *
 * Read decoded, because `\75 rl(…)` IS `url(…)` to a browser and a check
 * against the raw text is one an author can write straight past.
 */
export function tokenValueFetches(value: string): boolean {
  const read = asciiLower(decodeIdentifier(value));
  return FETCHING_FUNCTION.test(read) || REMOTE_REFERENCE.test(read);
}

/**
 * A remote destination written as text rather than as a call.
 *
 * The function check above is not enough on its own, because the FUNCTION need
 * not be in the token. A token holding the bare string
 * `"https://evil.example/a.png"` is inert until custom CSS writes
 * `background-image: image-set(var(--site-x) 1x)` — and that declaration
 * contains no URL for the origin policy to inspect, only a substitution. The
 * two halves are written in different places by different people, which is
 * exactly why neither half can be judged alone.
 *
 * Same-origin paths are left alone. `/logo.svg` resolves against the site
 * serving the page and needs no allowlisting, which is the same line
 * {@link isSameOriginUrl} draws for a font file. What is refused is anything
 * naming another server: a scheme, or the `//host` form that names one while
 * looking like a path.
 */
const REMOTE_REFERENCE = /\/\/|(?:^|[\s"'(,])[a-z][a-z0-9+.-]*:/;

/**
 * A value whose kind nothing can judge from the text alone.
 *
 * `var()` resolves elsewhere, `calc()` and its relatives compute, and
 * `color-mix()` produces a colour from arguments this is not going to evaluate.
 * A guess about any of them would be a guess, so they are passed.
 */
const OPAQUE_VALUE =
  /^(?:var|calc|clamp|min|max|env|attr|color-mix|light-dark|round|abs)\(/i;

/**
 * A bare number, with the unit it carries — the shape most kinds disagree over.
 *
 * The exponent branch is not decoration: without it `1e3px` does not match at
 * all, so the check reaches no verdict and stays silent about a duration token
 * that will be dropped by the browser. The rest of the token code accepts that
 * spelling, and a grammar narrower here than there is a check that quietly
 * stops covering the values the other side lets through.
 */
/** The only words `font-weight` takes; every other value is a number. */
const FONT_WEIGHT_KEYWORDS = new Set(["normal", "bold", "bolder", "lighter"]);

/** Text that begins the way a number does, whether or not it finishes like one. */
const NUMERIC_LOOKING = /^[+-]?[.\d]/;

const MEASUREMENT =
  /^[+-]?(?:\d+(?:\.\d+)?|\.\d+)(?:[eE][+-]?\d+)?(%|(?:[a-zA-Z]|\\[0-9a-fA-F]{1,6}\s?|\\.)*)$/;

/**
 * Why a value cannot be what its token says it is, when that is knowable.
 *
 * The kind is not decoration: it decides which properties may reference the
 * token, so a `dimension` holding `red` compiles into `padding:var(--site-…)`
 * and the browser drops the declaration at use time. Nothing on the page says
 * why, and the author is left looking at a padding that does not apply.
 *
 * Deliberately one-sided. It reports only what it is CERTAIN of — a length
 * where a colour belongs, a colour where a length belongs — and stays quiet
 * about everything it merely cannot parse, because `oklch()`, a named colour
 * and next year's colour function are all valid CSS this has no business
 * refusing. And it is a warning rather than a refusal for the same reason: a
 * wrong verdict then costs a message, not the token.
 */
export function checkTokenKind(
  kind: TokenKind,
  value: string
): string | undefined {
  const text = value.trim();
  if (text === "" || OPAQUE_VALUE.test(text)) return undefined;
  if (isCssWideKeyword(asciiLower(text))) return undefined;

  const measured = MEASUREMENT.exec(text);
  // Text plainly trying to be a number but failing to be one — `1.px`, `1..2` —
  // reaches no verdict below, because nothing matches and every branch reads
  // `undefined` as "cannot judge". For the kinds that ARE numbers, failing to
  // parse is itself the answer.
  if (
    measured === null &&
    NUMERIC_LOOKING.test(text) &&
    (kind === "dimension" ||
      kind === "duration" ||
      kind === "number" ||
      kind === "fontWeight" ||
      // A colour too. Tightening the measurement pattern moved `1.px` out of
      // the colour branch below without putting it anywhere else, so it stopped
      // being reported at all — the silence this branch exists to end.
      kind === "color")
  ) {
    return kind === "color"
      ? "opens like a number and is not one, so it is not a colour"
      : "is not a number CSS can read";
  }
  // A unit is an identifier, so `1m\\73` IS `1ms`. Read raw, the check reaches
  // no verdict and stays silent about a value the browser drops.
  const rawUnit = measured === null ? undefined : (measured[1] ?? "");
  const unit =
    rawUnit === undefined ? undefined : asciiLower(decodeIdentifier(rawUnit));
  // A percentage is its own token and cannot be spelled with an escape: `1\\%`
  // and `1\\25` decode to a unit reading `%`, but CSS sees an invalid dimension
  // and drops the declaration. Only the literal counts.
  const isPercentage = rawUnit === "%";
  // `unitCategory` resolves the spelling itself, so it is handed the unit as
  // written. Decoding first and passing the result resolves the escape twice,
  // and `1\\5c s` — a dimension whose unit decodes to the two characters `\s`,
  // which measures nothing — comes back reading `s` and passes as a duration
  // the browser drops.
  const measures = rawUnit === undefined ? undefined : unitCategory(rawUnit);
  const amount = measured === null ? undefined : Number.parseFloat(text);
  const isColor = parseColor(text) !== undefined;

  switch (kind) {
    case "color":
      // A number is never a colour, whatever unit it wears.
      return measured
        ? `is a ${unit === "" ? "number" : "measurement"}, not a colour`
        : undefined;
    case "dimension": {
      if (isColor) return "is a colour, not a length";
      if (unit === undefined) return undefined;
      // Only zero may go without a unit; `16` is not `16px` to CSS.
      if (unit === "") {
        return amount === 0
          ? undefined
          : "is a number with no unit, so it is not a length";
      }
      // A percentage stands in for a length wherever a length token is used.
      // Anything else that measures something — `150ms`, `20deg` — measures the
      // wrong quantity, and the browser drops the declaration that reads it.
      // Judged by what the unit MEASURES rather than by a second list of length
      // units kept beside the one the value checker already has.
      if (isPercentage) return undefined;
      return measures === "length"
        ? undefined
        : `is measured in ${unit}, which is ${measures ?? "not a unit CSS knows"}, not a length`;
    }
    case "duration": {
      if (isColor) return "is a colour, not a duration";
      if (unit === undefined) return undefined;
      // CSS allows a unitless zero for a time, and only a unitless one: `0px`
      // is still a length, and `animation-duration: var(--site-time)` reading
      // it is a declaration the browser drops.
      if (unit === "" && amount === 0) return undefined;
      return measures === "time"
        ? undefined
        : `is measured in ${unit === "" ? "no unit" : unit}, not seconds or milliseconds`;
    }
    case "number":
      if (isColor) return "is a colour, not a number";
      return unit !== undefined && unit !== ""
        ? `carries the unit "${unit}", so it is not a plain number`
        : undefined;
    case "fontWeight":
      if (unit !== undefined && unit !== "") {
        return `carries the unit "${unit}", so it is not a font weight`;
      }
      if (amount !== undefined) {
        return amount < 1 || amount > 1000
          ? "is outside the 1 to 1000 a font weight may take"
          : undefined;
      }
      // Not a number, so it has to be one of the four words the property
      // takes. Accepting every other word meant a weight of `heavy` was
      // emitted with nothing said about it and dropped where it was used.
      return FONT_WEIGHT_KEYWORDS.has(asciiLower(text))
        ? undefined
        : `is not a font weight; the words are ${[...FONT_WEIGHT_KEYWORDS].join(", ")}`;
    // A family is any text, a shadow is a list this does not parse, and
    // `custom` exists precisely so a site can hold something with no rules.
    case "fontFamily":
    case "shadow":
    case "custom":
      return undefined;
  }
}

/**
 * The tokens a site starts with.
 *
 * Deliberately small. Every entry here is one an author would otherwise have to
 * invent before the system does anything for them, and `content.width` is the
 * one that earns its place loudest: the Container preset reads it, so editing
 * one token re-widths every container on the site. A default set that tried to
 * be a design system would be a set most sites delete.
 */
/**
 * The token set a site actually renders with: the defaults, with a site's own
 * definitions layered over them by NAME.
 *
 * **Layered rather than replacing, and that is the whole point.** A site that
 * defines a brand colour should not thereby lose `content.width` and
 * `space.4` — every block reading those would fall back to its initial value,
 * silently, because an unresolved custom property invalidates the declaration
 * rather than reporting anything. Replacing is the shape that produces that,
 * and it is the shape a caller writes by accident when the merge is left to
 * them.
 *
 * The three-tier arrangement this implements is the one Gutenberg's
 * `theme.json` reaches: core defaults, then the theme's file, then the user's
 * saved styles, each overriding the last by identity. This function is the
 * first two tiers; a stored per-site override is the third and layers the same
 * way. Gutenberg keys that override on a preset's `slug` rather than on its
 * display `name` for the reason this does: the machine key is the one that
 * must not move when an author edits the label.
 *
 * **ONE implementation of "what tokens does this site have", deliberately.** The
 * emitter and any future editor must not answer it separately — two answers
 * that agree today drift, and the drift is invisible because a missing token
 * looks exactly like a token whose value did not apply.
 *
 * `prefix` and `darkMode` come from the override when it states them, because
 * they are site-wide decisions rather than per-token values. A site that sets a
 * prefix must set it in ONE place: `compileSiteSheet` derives the prefix used
 * for declaring and for referencing from a single value for exactly this
 * reason.
 */
export function resolveSiteTokens(override?: SiteTokenSet): SiteTokenSet {
  // Keyed on IDENTITY rather than on the name, because a tier overrides the
  // token and not the label. A site that renamed a default holds it under the
  // default's identity with a name of its own, and keying on the name would
  // leave the default in place beside it — two entries where the author edited
  // one, colliding on the single custom property they both key off.
  //
  // For a set where nothing carries an id this is the same map it always was:
  // every identity is a name, so no existing token changes tier or slot.
  const byIdentity = new Map<string, SiteToken>();
  for (const token of defaultSiteTokens()) {
    byIdentity.set(tokenIdentity(token), token);
  }
  // Second, so a site's own definition wins the identity. Iterated rather than
  // spread, because a later duplicate WITHIN the override must also win — an
  // imported DTCG file can carry one, and taking the first would apply a value
  // the author replaced.
  for (const token of override?.tokens ?? []) {
    byIdentity.set(tokenIdentity(token), token);
  }
  return {
    tokens: [...byIdentity.values()],
    ...(override?.prefix === undefined ? {} : { prefix: override.prefix }),
    ...(override?.darkMode === undefined
      ? {}
      : { darkMode: override.darkMode }),
  };
}

export function defaultSiteTokens(): SiteToken[] {
  return [
    {
      name: "content.width",
      kind: "dimension",
      values: { light: "72rem" },
      description: "How wide a centred container may grow.",
    },
    {
      name: "color.text",
      kind: "color",
      values: { light: "#111827", dark: "#f9fafb" },
    },
    {
      name: "color.background",
      kind: "color",
      values: { light: "#ffffff", dark: "#0b0f19" },
    },
    {
      name: "color.primary",
      kind: "color",
      values: { light: "#2563eb", dark: "#60a5fa" },
    },
    /**
     * A raised surface: a card, a panel, a table header. DISTINCT from
     * `color.background`, which is the page itself.
     *
     * Its absence is what made four blocks compromise and what created a whole
     * defect class. `core/card` shipped with no background and no border;
     * `badge` was unbuildable, because a tinted background IS the block; the
     * accordion had no divider and the table no border colour. And because
     * nothing in this set could express a surface, **six blocks across three
     * lanes independently reached for `--nx-*`** — the ADMIN namespace, which no
     * published page emits. That is design pressure rather than six mistakes:
     * when the correct mechanism is missing, whatever resembles it gets used.
     *
     * One step off `color.background` in each mode rather than a strong tint, so
     * a surface reads as raised without needing a border to be legible — and
     * still contrasts with one when a border is used.
     */
    {
      name: "color.surface",
      kind: "color",
      values: { light: "#f9fafb", dark: "#151b2b" },
    },
    /**
     * A hairline: a card outline, a table rule, a divider between sections.
     *
     * ONE border colour rather than a subtle/strong scale. A scale is far harder
     * to remove from a guaranteed set than to add to it, and no block has yet
     * asked for the distinction — the admin has three tiers because its density
     * demands them, and a content page is not that. A site wanting more defines
     * its own; `resolveSiteTokens` layers additions by name.
     */
    {
      name: "color.border",
      kind: "color",
      values: { light: "#e5e7eb", dark: "#1f2937" },
    },
    /**
     * Secondary text: a caption, a timestamp, a field hint.
     *
     * Chosen to clear WCAG AA against `color.background` in both modes rather
     * than by eye — `#6b7280` on `#ffffff` is about 4.8:1 and `#9ca3af` on
     * `#0b0f19` is far higher. A "muted" token that fails contrast is worse than
     * none, because it reads as sanctioned.
     */
    {
      name: "color.muted",
      kind: "color",
      values: { light: "#6b7280", dark: "#9ca3af" },
    },
    { name: "font.body", kind: "fontFamily", values: { light: "system-ui" } },
    { name: "space.4", kind: "dimension", values: { light: "1rem" } },
  ];
}

/**
 * A font face a site may actually serve, or the reasons it may not.
 *
 * Self-hosted only, and this is a product rule rather than a technical one: a
 * `@font-face` pointing at somebody else's server makes every visitor's browser
 * announce itself to that server, with their IP address, before a word of the
 * page is readable. A German court found exactly that arrangement unlawful for
 * Google Fonts, so a site cannot be handed a text box that quietly recreates
 * it. The remedy is to upload the file, which is why the message says so.
 */
export function validateFontFace(
  face: FontFaceDef,
  path: string
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const fail = (message: string): void => {
    issues.push({
      path,
      code: "invalid-style-value",
      severity: "error",
      message,
    });
  };

  if (face.family.trim() === "") fail("A font needs a family name.");
  // The family is escaped at emission so a quote cannot close its string, but
  // it is refused outright if it carries structural characters. Escaping alone
  // would leave `{`, `}` and `<` sitting inside a stylesheet that is written
  // into a `<style>` element — and `</style>` inside a quoted CSS string still
  // ends the element, because the HTML parser reads the bytes before the CSS
  // parser ever sees the quotes.
  else if (checkCssValue(face.family) !== null) {
    fail(`"${face.family}" is not a usable font family name.`);
  }
  if (face.src.length === 0) {
    fail(`"${face.family}" has no font file to load.`);
  }

  // Every descriptor is author data that reaches the stylesheet, not only the
  // URL. The family is quoted and therefore escaped at emission; these are
  // written as given, so they are checked here.
  const unquoted: Array<[string, string | undefined]> = [
    ["font-weight", face.weight],
    ["font-style", face.style],
    ["font-display", face.display],
    ["unicode-range", face.unicodeRange],
  ];
  for (const [descriptor, value] of unquoted) {
    if (value !== undefined && !unquotedDescriptor(value)) {
      fail(`"${face.family}" has a ${descriptor} value that cannot be used.`);
    }
  }
  for (const source of face.src) {
    if (
      source.format !== undefined &&
      (typeof source.format !== "string" ||
        source.format.length > MAX_FONT_FORMAT_LENGTH ||
        !FONT_FORMAT.test(source.format))
    ) {
      fail(`"${face.family}" has a font format that cannot be used.`);
    }
  }

  for (const source of face.src) {
    const rejection = checkUrlValue(source.url, "raw");
    if (rejection !== null) {
      fail(`"${face.family}" has a font file URL that cannot be used.`);
      continue;
    }
    if (!isSameOriginUrl(source.url)) {
      fail(
        `"${face.family}" loads a font from "${source.url}", which is on another server. Upload the font file to this site and point it at a path here — a font fetched from elsewhere tells that server every visitor's IP address before the page can be read.`
      );
    }
  }

  return issues;
}

/**
 * Whether a URL stays on the site serving the page.
 *
 * A path, with or without a leading slash, and nothing carrying a scheme or an
 * authority. `//host/f.woff2` is refused with the rest: it names another server
 * while looking like a path, which is the whole reason it is worth naming here.
 */
function isSameOriginUrl(url: string): boolean {
  const value = url.trim();
  if (value === "") return false;
  if (value.startsWith("//")) return false;
  return !/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(value);
}

/**
 * The `@font-face` rules for the faces that passed validation.
 *
 * A face with any error contributes nothing: half a `@font-face` — a family
 * declaring a file the browser will not fetch — renders as the default font
 * rather than as the next family the author listed, so emitting it would be
 * worse than leaving it out.
 */
export function emitFontFaces(faces: readonly FontFaceDef[]): {
  css: string;
  issues: ValidationIssue[];
} {
  const issues: ValidationIssue[] = [];
  const blocks: string[] = [];

  faces.forEach((face, index) => {
    const faceIssues = validateFontFace(face, `fonts[${index}]`);
    issues.push(...faceIssues);
    if (faceIssues.length > 0) return;

    const src = face.src
      .map(source =>
        source.format === undefined || source.format === ""
          ? `url("${cssString(source.url)}")`
          : `url("${cssString(source.url)}") format("${cssString(source.format)}")`
      )
      .join(",");

    const parts = [
      `font-family:"${cssString(face.family)}"`,
      `src:${src}`,
      `font-display:${face.display ?? "swap"}`,
    ];
    if (face.weight !== undefined) parts.push(`font-weight:${face.weight}`);
    if (face.style !== undefined) parts.push(`font-style:${face.style}`);
    if (face.unicodeRange !== undefined) {
      parts.push(`unicode-range:${face.unicodeRange}`);
    }
    blocks.push(`@font-face{${parts.join(";")}}`);
  });

  return { css: blocks.join(""), issues };
}

/**
 * What is wrong with the name a token carries, or nothing.
 *
 * Answered once, for every gate that decides whether a token can be written —
 * the emitter, the DTCG exporter and the DTCG importer all ask it, and each
 * phrases its own message from the result. Returning the PROBLEM rather than a
 * sentence is what lets them share the rule without sharing wording that would
 * be wrong in two of the three.
 *
 * The split between grammar and length is the rule itself. A token's identity is
 * `id ?? name`, so a renamed token is written under its id and its display name
 * reaches no stylesheet and no exported file. Both fields meet the grammar,
 * because either can BE the identity and either would reach a selector; only the
 * identity meets the emission cap. Capping the display name instead drops a
 * working token the moment an author gives it a long label.
 */
export type TokenNamingProblem =
  | { field: "name" | "id"; reason: "grammar" }
  | { field: "name" | "id"; reason: "length" }
  | { field: "name"; reason: "depth" };

/**
 * Why a LABEL cannot be used, or nothing.
 *
 * A label is what an author reads. It never becomes a custom property, so the
 * emission cap does not reach it — that belongs to the identity.
 *
 * It does reach an exported file, though, and that is why it carries rules at
 * all: the DTCG exporter splits it on dots and makes each part a key, so its
 * grammar decides what those keys may contain and its DEPTH decides how far the
 * reader has to descend to find the token underneath them.
 */
export function labelProblem(name: unknown): TokenNamingProblem | undefined {
  // Persisted settings reach here unvalidated, and `RegExp.test` COERCES: a
  // stored `123` becomes "123" and satisfies the grammar, after which the value
  // travels on as a number and throws where a string was assumed.
  if (typeof name !== "string") return { field: "name", reason: "grammar" };
  if (!isAuthorableTokenName(name)) return { field: "name", reason: "grammar" };
  // Counted in place: a label carries no length cap, so splitting it
  // materialises every part of an oversized one only to refuse it.
  let parts = 1;
  for (let at = 0; at < name.length && parts <= MAX_TOKEN_NAME_SEGMENTS; at++) {
    if (name[at] === ".") parts++;
  }
  if (parts > MAX_TOKEN_NAME_SEGMENTS)
    return { field: "name", reason: "depth" };
  return undefined;
}

/**
 * Why an IDENTITY cannot be used, or nothing.
 *
 * An identity is what a token is WRITTEN under — it becomes the custom property
 * and every stored reference reads it — so the emission cap applies. Depth does
 * not: an identity never becomes DTCG groups, and refusing one for its depth is
 * what clears a working id and breaks every reference to it.
 *
 * Separate from {@link labelProblem} rather than a flag on it, because the two
 * subjects take different rules and a caller holding a bare string cannot be
 * relied on to say which it has.
 */
export function identityProblem(
  identity: unknown,
  field: "name" | "id"
): TokenNamingProblem | undefined {
  if (typeof identity !== "string") return { field, reason: "grammar" };
  if (!isAuthorableTokenName(identity)) return { field, reason: "grammar" };
  if (identity.length > MAX_TOKEN_NAME_LENGTH)
    return { field, reason: "length" };
  return undefined;
}

/**
 * Why a token cannot be written, or nothing.
 *
 * Composed from the two rules above so each applies to its own subject: the
 * label is checked as a label, the identity as an identity. A token with an id
 * is checked as both, because the id is the identity and the name is the label.
 */
export function tokenNamingProblem(token: {
  name: unknown;
  id?: unknown;
}): TokenNamingProblem | undefined {
  const label = labelProblem(token.name);
  if (label !== undefined) return label;
  if (token.id !== undefined) {
    const stated = identityProblem(token.id, "id");
    if (stated !== undefined) return stated;
    return undefined;
  }
  // With no id the label IS the identity, so it meets the emission cap too.
  return identityProblem(token.name, "name");
}

/** The emitter's wording for {@link tokenNamingProblem}. */
function tokenNamingRefusal(token: SiteToken): string | undefined {
  const problem = tokenNamingProblem(token);
  if (problem === undefined) return undefined;
  if (problem.reason === "depth") {
    return `"${String(token.name)}" is nested too deeply, so it was not written. A token name holds at most ${MAX_TOKEN_NAME_SEGMENTS} dot-separated parts.`;
  }
  if (problem.reason === "length") {
    return `"${String(token.name)}" is written under more than ${MAX_TOKEN_NAME_LENGTH} characters, so it was not written. The ${problem.field} a token is written under is at most ${MAX_TOKEN_NAME_LENGTH} characters.`;
  }
  return problem.field === "name"
    ? `"${token.name}" is not a token name, so it was not written. A name is dot-separated words of letters, digits and dashes, like "color.primary".`
    : `"${token.name}" has an id that is not a token name, so it was not written. An id is dot-separated words of letters, digits and dashes, like "color.primary".`;
}

export function emitTokenBlocks(
  set: SiteTokenSet,
  selector: string
): { css: string; issues: ValidationIssue[]; emitted: readonly SiteToken[] } {
  const { prefix, issue } = resolveTokenPrefix(set.prefix);
  const issues: ValidationIssue[] = issue ? [issue] : [];

  const light: string[] = [];
  const dark: string[] = [];
  const seen = new Map<string, string>();
  /*
   * The tokens this call actually WROTE.
   *
   * Reported rather than left to be re-derived, because the refusals above are
   * five separate conditions — a name that is not a token name, no light value,
   * a value the guard rejects, a value that fetches, and two identities landing
   * on one custom property — and a caller asking "which tokens does this site
   * emit" would have to restate all five. A second statement of them agrees
   * today and drifts the first time one changes.
   */
  const emitted: SiteToken[] = [];

  for (const token of set.tokens) {
    const naming = tokenNamingRefusal(token);
    if (naming !== undefined) {
      issues.push(tokenIssue(naming));
      continue;
    }
    // A token with no values record at all. Site tokens are one settings row read on every page
    // render and reach here whether or not anything validated them, so a missing field has to
    // cost the token rather than the render: reading through it throws, and one corrupt row would
    // take down every page on the site.
    if (
      !isPlainRecord(token.values) ||
      typeof token.values.light !== "string"
    ) {
      issues.push(
        tokenIssue(
          `"${token.name}" has no light value, so it was not written. Every token needs one: it is what a reader with no mode set resolves.`
        )
      );
      continue;
    }
    // The value is checked with the same guard the style compiler applies to
    // any stored value. Without it a semicolon ends the custom property and
    // whatever follows becomes a declaration on the page root.
    const invalid = TOKEN_MODES.filter(mode => {
      const value = token.values[mode];
      return value !== undefined && checkCssValue(value) !== null;
    });
    if (invalid.length > 0) {
      issues.push(
        tokenIssue(
          `"${token.name}" has a value that cannot be used, so it was not written.`
        )
      );
      continue;
    }
    // Refused as an error rather than reported and written, unlike the kind
    // check below: this one is not about whether the value renders. A token
    // that fetches is read by a `var()` in a stylesheet that has no URL in it
    // for the origin policy to see.
    const fetching = TOKEN_MODES.filter(mode => {
      const value = token.values[mode];
      return value !== undefined && tokenValueFetches(value);
    });
    if (fetching.length > 0) {
      issues.push(
        tokenIssue(
          `"${token.name}" has a value that would load a file, so it was not written. A token holds a colour, a length, a duration, a font or a number; put an image on the block that shows it, where the site's allowed hosts still apply.`,
          "error"
        )
      );
      continue;
    }
    // Composed from the IDENTITY, which is the name until a rename pins one.
    // That is what keeps an already-compiled page working: its CSS references
    // the property this token emitted when the page was built, and only a moved
    // identity moves it.
    const property = tokenCustomProperty(tokenIdentity(token), prefix);
    // Two identities can land on one property — `color.primary-dark` and
    // `color-primary.dark` both give `--site-color-primary-dark`. Emitting both
    // would let one silently resolve to the other's value, so the second is
    // refused and named. Ids share this space with names, so the other way to
    // arrive here is a new token claiming a name that a renamed token still
    // holds as its id.
    const previous = seen.get(property);
    if (previous !== undefined) {
      issues.push(
        tokenIssue(
          `"${token.name}" and "${previous}" both become "${property}", so "${token.name}" was not written. Two tokens cannot share one custom property: rename one of them, or give one a different id.`
        )
      );
      continue;
    }
    seen.set(property, token.name);
    emitted.push(token);

    // Reported, and then written anyway. A value that does not match its kind
    // is dropped by the browser where it is USED, which costs the author the
    // one declaration and no more; a refusal here would cost them the token on
    // a verdict this is deliberately not certain enough to act on.
    for (const mode of TOKEN_MODES) {
      const modeValue = token.values[mode];
      if (modeValue === undefined) continue;
      const mismatch = checkTokenKind(token.kind, modeValue);
      if (mismatch !== undefined) {
        issues.push(
          tokenIssue(
            `"${token.name}" is a ${token.kind} token, but its ${mode} value "${modeValue}" ${mismatch}. It was written as given, and will do nothing where the token is used.`
          )
        );
      }
    }

    light.push(`${property}:${token.values.light}`);
    if (token.values.dark !== undefined) {
      dark.push(`${property}:${token.values.dark}`);
    }
  }

  // Refused rather than truncated: a selector cut in half is a different
  // selector, and writing tokens under it would put the site's values on
  // whatever it happens to match.
  if (
    typeof selector !== "string" ||
    selector.length > MAX_TOKEN_SELECTOR_LENGTH
  ) {
    issues.push(
      tokenIssue(
        `The selector these tokens would be written under is longer than ${MAX_TOKEN_SELECTOR_LENGTH} characters, so none were written.`
      )
    );
    // Nothing is written under an unusable selector, so nothing was emitted —
    // whatever survived the per-token refusals above.
    return { css: "", issues, emitted: [] };
  }
  if (light.length === 0) return { css: "", issues, emitted: [] };

  let css = `${selector}{${light.join(";")}}`;
  if (dark.length > 0) {
    const body = `${selector}{${dark.join(";")}}`;
    css +=
      (set.darkMode ?? "attribute") === "media"
        ? `@media (prefers-color-scheme:dark){${body}}`
        : `[${DARK_MODE_ATTRIBUTE}="dark"] ${body}`;
  }
  return { css, issues, emitted };
}
