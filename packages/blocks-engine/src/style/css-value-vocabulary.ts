/**
 * What a CSS value is checked against: why a value is refused, the URL
 * fetch predicate, the characters and URL schemes refused, the keywords
 * and units a length may use, the functions that produce one, and the
 * limits on a value's length and nesting.
 *
 * @module style/css-value-vocabulary
 */

/** Why a value was refused. Each maps to a stable validation issue code. */
export type CssValueRejection =
  | "unparsable"
  | "unsafe-characters"
  | "unsafe-url-scheme"
  | "unsafe-url-characters"
  | "url-host-not-allowed"
  | "too-deeply-nested"
  | "too-long"
  | "not-a-length"
  | "not-a-color";

/**
 * Whether this site will fetch a URL, asked of every URL a stylesheet emits.
 *
 * A PREDICATE rather than a list of patterns, so the engine stays free of the
 * matching rules and the caller keeps one answer for every channel it owns. It
 * is optional everywhere it appears: a caller with no host policy asks nothing
 * and gets the scheme allowlist alone.
 */
export type MayFetchUrl = (url: string) => boolean;

/**
 * Characters that must never reach a declaration, even inside a value that
 * parses. `{`, `}` and `;` would end the declaration or rule; `<` and `>` allow
 * a `</style>` sequence to close the element the stylesheet is emitted into,
 * and a quoted CSS string keeps both intact through parsing.
 */
export const UNSAFE_VALUE_CHARS: RegExp = /[{};<>]/;

/**
 * Comment delimiters, which the parser treats as trivia and therefore accepts.
 * An unterminated comment opener emitted into a declaration swallows whatever
 * follows it, and a lone closer ends a comment the emitter opened around
 * something else. Neither belongs in a stored value.
 */
export const COMMENT_DELIMITERS: RegExp = /\/\*|\*\//;

/**
 * URL schemes allowed inside `url()`. An allowlist rather than a blocklist:
 * a blocklist has to predict every dangerous scheme, and misses the next one.
 *
 * Having no scheme is not the same as naming no host. A relative or absolute
 * path resolves against the page's own origin, but `//cdn.example/a.png` carries
 * no scheme and still reaches ANOTHER host, inheriting only the page's protocol.
 * This list cannot tell those apart, so which hosts may be reached is a separate
 * question, asked of `mayFetchUrl` in `checkUrlValue` (`css-value-urls`).
 */
export const ALLOWED_URL_SCHEMES: readonly string[] = ["http", "https"];

/** Any leading `scheme:` in a URL, tolerating the whitespace a value may carry. */
export const URL_SCHEME: RegExp = /^\s*([a-z][a-z0-9+.-]*):/i;

/**
 * Characters that would break out of `url(...)`, split the declaration across
 * lines, or close the `<style>` element the stylesheet is emitted into. Quotes
 * and parentheses can close the function early, a backslash can re-introduce
 * them through an escape, and the HTML parser honours `</style>` inside a URL
 * regardless of how the CSS quotes it.
 */
export const UNSAFE_URL_CHARS: RegExp = /["'()\\<>]/;

/**
 * The same characters minus the parentheses, for a URL the parser has already
 * delimited. Inside `url("…")` or a quoted image-set argument the boundary is
 * the quote, so a parenthesis there is an ordinary path character that cannot
 * close the function: refusing it would reject `photo(1).png`, which is a real
 * filename shape. Quotes and backslashes stay refused, because those are what
 * the boundary is made of.
 */
export const UNSAFE_QUOTED_URL_CHARS: RegExp = /["'\\<>]/;

/**
 * Keywords every property accepts, whatever its value type.
 * Property-specific keywords (`auto` on a margin, `thin` on a border width)
 * are declared by the catalog entry, because a keyword one property accepts is
 * discarded by the browser on another: `margin: auto` is meaningful and
 * `padding: auto` is not.
 */
/** No keyword is legal as a math operand. */
export const NO_KEYWORDS: ReadonlySet<string> = new Set();

export const CSS_WIDE_KEYWORDS: ReadonlySet<string> = new Set([
  "inherit",
  "initial",
  "unset",
  "revert",
  "revert-layer",
]);

/**
 * CSS length units. A `Dimension` node carries any unit at all, so an angle, a
 * duration, a resolution or a grid fraction reaches a length property looking
 * structurally identical to `16px`; only these are measurements of distance.
 */
export const LENGTH_UNITS: ReadonlySet<string> = new Set([
  "px",
  "cm",
  "mm",
  "q",
  "in",
  "pt",
  "pc",
  "em",
  "rem",
  "ex",
  "rex",
  "ch",
  "rch",
  "ic",
  "ric",
  "cap",
  "rcap",
  "lh",
  "rlh",
  "vw",
  "vh",
  "vi",
  "vb",
  "vmin",
  "vmax",
  "svw",
  "svh",
  "svi",
  "svb",
  "svmin",
  "svmax",
  "lvw",
  "lvh",
  "lvi",
  "lvb",
  "lvmin",
  "lvmax",
  "dvw",
  "dvh",
  "dvi",
  "dvb",
  "dvmin",
  "dvmax",
  "cqw",
  "cqh",
  "cqi",
  "cqb",
  "cqmin",
  "cqmax",
]);

/**
 * Functions that can produce a length. Bounded on purpose: treating every
 * function as a measurement would accept `rotate(20deg)` or `rgb(1 2 3)` as a
 * width. `sign()` is deliberately absent — it always yields a number, whatever
 * it is given. `var()` and `env()` are included because what they resolve to is
 * not knowable here, and refusing them would break token references.
 *
 * A function legal on only some properties is not listed here but declared by
 * the catalog entry, exactly as a keyword is: `fit-content()` is a size, so a
 * browser honours it on `width` and discards it on `gap`.
 */
export const DIMENSION_FUNCTIONS: ReadonlySet<string> = new Set([
  "calc",
  "min",
  "max",
  "clamp",
  "round",
  "mod",
  "rem",
  "abs",
  "hypot",
  "var",
  "env",
  "anchor-size",
  "attr",
]);

/**
 * The math functions, and how many comma-separated arguments each one takes.
 * `null` is one or more, which is what `min()`, `max()` and `hypot()` accept.
 *
 * Arity is listed rather than inferred because a comma and a `+` are both
 * `Operator` nodes, and reading them as interchangeable accepts `calc(1px, 2px)`
 * and `clamp(1px)` — declarations a browser discards. This is a narrow enough
 * fact to state: the arity of the math functions is settled, unlike the
 * argument grammars the module deliberately declines to model.
 */
export const MATH_FUNCTION_ARITY: ReadonlyMap<
  string,
  readonly number[] | null
> = new Map([
  ["calc", [1]],
  ["abs", [1]],
  ["min", null],
  ["max", null],
  // The square root of the sum of squares, over as many terms as given.
  ["hypot", null],
  ["clamp", [3]],
  ["mod", [2]],
  ["rem", [2]],
  // A value to round and an optional interval. The strategy is stripped
  // before this is consulted, so it is not counted here.
  ["round", [1, 2]],
]);

/**
 * The functions whose arguments are an arithmetic expression, where operands
 * and operators alternate. Derived from the arity map rather than listed beside
 * it, so the two cannot disagree about which functions those are: a function
 * missing from the map would otherwise be treated as arithmetic while having no
 * arity to check against.
 *
 * Everything else produces a length by its name alone and carries a grammar of
 * its own, which moves faster than anything knowable here.
 * `anchor-size(--hero width)` names an anchor and then an axis, so an
 * arithmetic reading of it refuses a value the browser honours.
 */
export const MATH_FUNCTIONS: ReadonlySet<string> = new Set(
  MATH_FUNCTION_ARITY.keys()
);

/**
 * Maximum bracket nesting in one value. Parsing and walking a value are both
 * recursive, so a deeply nested value exhausts the stack — measured, a few
 * hundred nested `calc()` calls is enough, well inside any document size limit.
 * Counting brackets first is iterative and cannot itself overflow.
 */
export const MAX_VALUE_NESTING = 32;

/**
 * Longest value that will be parsed. Nesting is not the only way to make an
 * expensive parse: a flat value of a few hundred thousand tokens builds an AST
 * node for each. No real declaration approaches this.
 */
/**
 * The longest style value this engine will read.
 *
 * Public for the reason every other bound here is: a value past it is REFUSED
 * before parsing, so a writer that wants its declaration emitted has to honour
 * the same number, and anything walking the same stored values has to stop
 * reading where the compiler stops.
 */
export const MAX_VALUE_LENGTH = 8192;
