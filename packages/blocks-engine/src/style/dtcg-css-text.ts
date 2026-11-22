/**
 * Reading CSS text a token holds: a font-family list and each family in it,
 * CSS whitespace, keywords and `var()` calls, CSS escapes, and how a family
 * name is written back as CSS.
 *
 * @module style/dtcg-css-text
 */

/** A family list as one string or an array, which is what the format takes. */
export function familyToDtcg(css: string): string | string[] | undefined {
  const reading = readFamilyList(css);
  // The format stores NAMES, and three of the four readings are not names.
  //
  // `dynamic` — a list holding `var(--brand-font)` has no DTCG form: exporting
  // the text would describe a font literally called `var(--brand-font)` to
  // every tool reading the standard value. The same answer a `clamp()`
  // dimension already gets, and the reason this asks for the READING rather
  // than a usability boolean: the browser reads that value fine, so a shared
  // yes/no would have to call it either broken or exportable, and it is
  // neither.
  //
  // `keyword` — `font-family: inherit` takes the parent's font, so exporting
  // `"inherit"` would name a font nobody has. Quoted, it IS a name somebody
  // chose, which `familyPartKind` already distinguishes.
  //
  // `invalid` — a value no browser reads was never a stack this site rendered.
  if (reading.kind !== "families") return undefined;
  const names = reading.parts.map(p => p.part.name);
  return names.length === 1 ? names[0] : names;
}

/**
 * A CSS family list split into its families.
 *
 * The comma only separates families outside quotes AND outside parentheses.
 * `"ACME, Inc", serif` names two families, not three — a plain split turns a
 * real company's font into a fallback list failing over to a family called
 * `Inc` — and `var(--font, Arial), sans-serif` names two, not three, because
 * the first comma belongs to the custom property's fallback. Quotes are removed
 * because the name is the family, not the spelling, and backslash escapes are
 * resolved for the same reason.
 */
// RELOCATED, not written here — see the docblock of `dtcg.ts`.
// fallow-ignore-next-line complexity
export function splitFamilyList(css: string): FamilyPart[] {
  const parts: FamilyPart[] = [];
  let current = "";
  // What the quotes actually enclosed, collected separately.
  //
  // `current` cannot answer for a quoted item: it accumulates the whitespace
  // around the string as well as the string, so `" Brand "` and ` "Brand" `
  // both arrive as `" Brand "` and are indistinguishable. Trimming served the
  // second and corrupted the first — a quoted name keeps its edge spaces,
  // because inside quotes they are part of the family's name.
  let inner = "";
  let quoted = false;
  let strings = 0;
  let outsideQuotes = "";
  let raw = "";
  let quote: string | undefined;
  // Parenthesis depth, so a comma inside `var(--font, Arial)` is not a
  // separator. Counted rather than flagged: `var(--a, var(--b, serif))` nests,
  // and a boolean would close on the inner `)`.
  let depth = 0;

  for (let index = 0; index < css.length; index++) {
    const char = css[index];
    if (char === "\\") {
      // An escape stands for what it denotes, which is not always the next
      // character: `\26 ` is `&`, so `"ACME\26 Co"` is the family `ACME&Co`.
      // Taking the character after the backslash literally would export the
      // family `ACME26 Co`, a different font stack to every tool that reads the
      // standard value.
      const escape = readCssEscape(css, index);
      current += escape.text;
      // An escape inside quotes is part of the NAME, so it belongs to the
      // quoted content too: `"ACME\\26 Co"` is the family `ACME&Co`.
      if (quote !== undefined) inner += escape.text;
      raw += css.slice(index, escape.next);
      index = escape.next - 1;
      continue;
    }
    if (quote !== undefined) {
      raw += char;
      if (char === quote) quote = undefined;
      else {
        current += char;
        inner += char;
      }
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      raw += char;
      // A second string in one item is what makes `"Bad" "Name"` invalid, so
      // they are counted rather than merely noted.
      strings += 1;
      quoted = true;
      continue;
    }
    if (char === "(") depth += 1;
    else if (char === ")" && depth > 0) depth -= 1;
    if (char === "," && depth === 0) {
      parts.push(
        finishPart(current, inner, quoted, strings, outsideQuotes, raw)
      );
      current = "";
      inner = "";
      raw = "";
      quoted = false;
      strings = 0;
      outsideQuotes = "";
      continue;
    }
    if (quote === undefined) outsideQuotes += char;
    current += char;
    raw += char;
  }
  parts.push(finishPart(current, inner, quoted, strings, outsideQuotes, raw));

  // Empty items are KEPT, marked invalid by `finishPart`. `Brand,` and
  // `Brand,, serif` are parse errors — CSS reads `<family-name>#`, which admits
  // no empty item — and a browser drops the whole declaration. Filtering them
  // out here reported `Brand,` as the single family `Brand`, which is a value
  // the page never rendered.
  return parts;
}

/** Words that are keywords rather than family names when written bare. */
/**
 * Words an unquoted family name may not be, and what each one is.
 *
 * These stand for the whole declaration — `font-family: inherit` takes the
 * parent's font — so a lone one is a valid value naming no family.
 *
 * `default` is deliberately NOT here. It must be quoted to name a font, which
 * is why {@link FAMILY_MUST_QUOTE} carries it for the importer, but it is not a
 * CSS-wide keyword: the font-family grammar excludes it from `<family-name>`,
 * so a browser drops a declaration reading it bare. Reading it as a working
 * whole-value keyword is how a dropped declaration reports as healthy.
 */
const CSS_WIDE_KEYWORDS = new Set([
  "inherit",
  "initial",
  "unset",
  "revert",
  "revert-layer",
]);

// The five characters CSS calls whitespace. JavaScript's `\s` is a wider set —
// it counts a vertical tab, and every non-breaking and exotic space — so using
// it here accepts separators CSS does not: a family split by a vertical tab is
// not a run of identifiers to a browser, which drops the declaration reading
// it, and this grammar exists precisely to say so before the value is exported.
const CSS_WS = "[ \\t\\r\\n\\f]";
/** A run of identifiers, which is all an unquoted family item may be. */
const IDENT_CHAR = `(?:[A-Za-z0-9_\\-\\u00a0-\\uffff]|\\\\[0-9a-fA-F]{1,6}${CSS_WS}?|\\\\.)`;
// An identifier may open with one or two dashes — `--brand` is a family name a
// site can legitimately have — and any run of whitespace separates one
// identifier from the next. Both were narrower here than CSS allows, so valid
// tokens were reported as ones the format cannot express.
const IDENT_START = `(?:(?:--?)?(?:[A-Za-z_\\u00a0-\\uffff]|\\\\[0-9a-fA-F]{1,6}${CSS_WS}?|\\\\.))`;
const UNQUOTED_FAMILY = new RegExp(
  `^${IDENT_START}${IDENT_CHAR}*(?:${CSS_WS}+${IDENT_START}${IDENT_CHAR}*)*$`
);
const CSS_WS_EDGES = new RegExp(`^${CSS_WS}+|${CSS_WS}+$`, "g");
/** A run of CSS whitespace, which separates identifiers within one family. */
const CSS_WS_RUN = new RegExp(`${CSS_WS}+`, "g");

/** Strip the whitespace CSS recognises from both ends, and only that. */
function trimCssWhitespace(text: string): string {
  return text.replace(CSS_WS_EDGES, "");
}

/**
 * The CSS generic families, plus the `ui-*` system aliases. Exported so a
 * picker offers exactly the keywords the engine accepts.
 *
 * Unquoted, these are KEYWORDS rather than names: `font-family: serif` asks for
 * the browser's serif default, and no `@font-face` can claim it — the engine
 * emits every face family quoted, so only a quoted value can name one.
 */
export const GENERIC_FONT_FAMILIES: readonly string[] = [
  "serif",
  "sans-serif",
  "monospace",
  "cursive",
  "fantasy",
  "system-ui",
  "ui-serif",
  "ui-sans-serif",
  "ui-monospace",
  "ui-rounded",
  "math",
  "emoji",
  "fangsong",
];

const GENERIC_FAMILIES: ReadonlySet<string> = new Set(GENERIC_FONT_FAMILIES);

/**
 * How CSS reads ONE item of a family list.
 *
 * Five outcomes rather than a boolean, because the callers ask different
 * questions of the same text and a shared yes/no answers neither well. The DTCG
 * export needs to know whether an item is a NAME it can write down; a surface
 * reporting on a site needs to know whether the browser will resolve it, and
 * what to say when it cannot.
 *
 * - `name` — a real family: a quoted string, or an unquoted identifier run.
 * - `generic` — an unquoted generic keyword. Always resolves, names no file.
 * - `dynamic` — carries a `var()` substitution. Valid CSS whose value is not
 *   knowable from the text, which is a THIRD state and not a failure.
 * - `keyword` — an unquoted CSS-wide keyword. Valid alone, and a parse error
 *   in a list.
 * - `invalid` — the grammar rejects it: `10px`, `"Bad" "Name"`, or an empty
 *   item left by a stray comma.
 */
export type FamilyPartKind =
  | "name"
  | "generic"
  | "dynamic"
  | "keyword"
  | "invalid";

/**
 * The opening of a `var(` call. Case-insensitive: CSS functions are.
 *
 * The name must TOUCH the paren. CSS produces a function token only when an
 * identifier is immediately followed by `(`, so `var (--brand)` is an
 * identifier standing beside a parenthesised block and never a substitution.
 * Allowing whitespace here read that as dynamic, which is an all-clear for a
 * declaration the browser drops.
 */
const VAR_CALL_SOURCE = `\\bvar\\(`;

/** One character CSS reads as whitespace. */
const CSS_WS_CHAR = new RegExp(`^${CSS_WS}$`);

/** One unescaped character an identifier may carry. */
const IDENT_CODE_POINT = /^[A-Za-z0-9_\-\u00a0-\uffff]$/;

/** Where the run of CSS whitespace starting at `at` ends. */
function skipCssWhitespace(text: string, at: number): number {
  let next = at;
  while (CSS_WS_CHAR.test(text[next] ?? "")) next += 1;
  return next;
}

/**
 * Whether the text opens with a first `var()` argument CSS will substitute.
 *
 * `var()` takes a custom-property name and then either a comma introducing a
 * fallback or its own closing paren. `--` is what makes an identifier a custom
 * property, so `var(foo)` substitutes nothing; and a name followed by anything
 * else — `var(--brand extra)` — is a syntax error rather than a value, so the
 * terminator is checked as well as the opening.
 *
 * An escape inside the name is stepped over with {@link readCssEscape}, the same
 * routine that decodes the name, so the two cannot disagree about where an
 * escape ends. They did while this was a pattern stepping over a backslash and
 * ONE character: `--\62 rand` decoded to `--brand`, while the pattern took the
 * space that terminates `\62 ` for the end of the name and refused the call.
 *
 * A backslash before a newline is not an escape to CSS, so it ends the name
 * here rather than being consumed with the newline.
 */
function varArgumentWellFormed(text: string): boolean {
  let at = skipCssWhitespace(text, 0);
  if (!text.startsWith("--", at)) return false;
  at += 2;
  for (;;) {
    const char = text[at] ?? "";
    if (char === "\\" && !/^[\n\r\f]$/.test(text[at + 1] ?? "")) {
      at = readCssEscape(text, at).next;
    } else if (IDENT_CODE_POINT.test(char)) {
      at += 1;
    } else {
      break;
    }
  }
  const terminator = text[skipCssWhitespace(text, at)];
  return terminator === "," || terminator === ")";
}

/**
 * Whether every parenthesis in the text is closed.
 *
 * A `var()` that never closes is a syntax error and the browser drops the
 * declaration, so checking the first argument alone accepted
 * `var(--brand, serif` as a working substitution. Escapes are stepped over:
 * `\(` is a literal character rather than a nesting level, and counting it
 * would report a balanced value as broken.
 */
function parensBalanced(text: string): boolean {
  let depth = 0;
  for (let at = 0; at < text.length; at += 1) {
    const char = text[at];
    if (char === "\\") {
      // Nothing an escape denotes can open or close anything. The whole escape
      // is stepped over with the routine the decoder uses, so this and the
      // name check agree on where it ends.
      at = readCssEscape(text, at).next - 1;
      continue;
    }
    if (char === "(") depth += 1;
    else if (char === ")") {
      depth -= 1;
      // A close with nothing open is as broken as one that never closes.
      if (depth < 0) return false;
    }
  }
  return depth === 0;
}

/**
 * Whether every `var(` in the text opens a call CSS will actually make.
 *
 * Answers for the whole text rather than per call, because one malformed call
 * spoils the declaration however many well-formed ones sit beside it. A
 * fallback carrying its own `var()` is reached by the same scan, so nesting
 * needs no separate rule.
 *
 * Read against the RAW spelling rather than the decoded name. A custom property
 * may legitimately carry an escaped space — `var(--brand\ face)` names one
 * identifier to a browser — and the reader has already turned that escape into
 * a literal space by the time the name exists, where it is indistinguishable
 * from the whitespace that ends an argument. The raw text still has the
 * backslash, so the two cases stay apart.
 */
function varCallsWellFormed(text: string): boolean {
  if (!parensBalanced(text)) return false;
  const calls = new RegExp(VAR_CALL_SOURCE, "gi");
  for (let call = calls.exec(text); call !== null; call = calls.exec(text)) {
    const argument = text.slice(call.index + call[0].length);
    if (!varArgumentWellFormed(argument)) return false;
  }
  return true;
}

/** Whether the text carries a `var(` call at all, well-formed or not. */
function hasVarCall(text: string): boolean {
  return new RegExp(VAR_CALL_SOURCE, "i").test(text);
}

/** Classify one family-list item. */
export function familyPartKind(part: FamilyPart): FamilyPartKind {
  if (!part.valid) return "invalid";
  if (part.quoted) return "name";
  const lower = part.name.toLowerCase();
  // `var()` is checked before the grammar, because the grammar rejects the
  // parentheses and would report a valid, common value as broken. It is checked
  // for WELL-FORMEDNESS rather than presence: CSS requires the first argument
  // to be a custom-property name, so `var(foo)` computes to an invalid
  // `font-family` and the browser drops the declaration rather than falling
  // through to the next family. Reading every `var(` as dynamic gave that an
  // all-clear, which is the same shape as reading a dropped declaration as a
  // working keyword.
  /*
   * Detection and validation read the SAME text, which is the raw spelling.
   *
   * Reading one from the decoded name and the other from the raw text made
   * them answer about different sets of calls: a function name written with an
   * escape — `v\61 r(foo)` — is a `var(` to the decoded reader and nothing at
   * all to the raw one, so every call went unvalidated and the value was
   * certified as a working substitution.
   *
   * The cost of choosing raw is stated rather than hidden: a var() whose own
   * NAME is escaped is read as invalid instead of dynamic. It is still refused
   * for the right reason — the grammar below rejects the parentheses — and a
   * function name spelled with escapes is not a value this format can express
   * either way.
   */
  if (hasVarCall(part.raw)) {
    return varCallsWellFormed(part.raw) ? "dynamic" : "invalid";
  }
  if (CSS_WIDE_KEYWORDS.has(lower)) return "keyword";
  // Reserved, and not a whole-value keyword: bare `default` names no family and
  // the declaration is dropped, so it is invalid rather than a working value.
  if (lower === "default") return "invalid";
  if (GENERIC_FAMILIES.has(lower)) return "generic";
  if (!UNQUOTED_FAMILY.test(part.raw) || /[()]/.test(part.name))
    return "invalid";
  return "name";
}

/**
 * How CSS reads a WHOLE family list.
 *
 * - `families` — the browser reads it and every item is resolvable from the text.
 * - `dynamic` — the browser reads it, and at least one item is a `var()` whose
 *   value this code cannot see. Reportable, but not as a fault.
 * - `keyword` — a lone CSS-wide keyword. Valid, and names no family at all, so
 *   there is nothing to resolve rather than something that failed to.
 * - `invalid` — the browser drops the declaration.
 */
export type FamilyListKind = "families" | "dynamic" | "keyword" | "invalid";

/** One classified item of a family list. */
export interface ReadFamilyPart {
  readonly part: FamilyPart;
  readonly kind: FamilyPartKind;
}

/** A family list, split and classified in one call. */
export interface FamilyListReading {
  readonly kind: FamilyListKind;
  readonly parts: readonly ReadFamilyPart[];
}

/**
 * Split a `font-family` value and say how CSS reads it.
 *
 * The one place that judgement lives. `familyToDtcg` and any surface reporting
 * on a site ask this and then apply their own narrower rule to the answer,
 * rather than each re-deriving the grammar — two derivations of one question
 * agree on the day they are written and diverge on the values that matter.
 */
export function readFamilyList(css: string): FamilyListReading {
  const split = splitFamilyList(css);
  const parts = split.map(part => ({ part, kind: familyPartKind(part) }));
  if (parts.length === 0) return { kind: "invalid", parts };
  if (parts.some(p => p.kind === "invalid")) return { kind: "invalid", parts };
  const keywords = parts.filter(p => p.kind === "keyword");
  if (keywords.length > 0) {
    // A CSS-wide keyword stands for the WHOLE value. `inherit, serif` is a
    // parse error, not a stack with a fallback.
    return parts.length === 1
      ? { kind: "keyword", parts }
      : { kind: "invalid", parts };
  }
  if (parts.some(p => p.kind === "dynamic")) return { kind: "dynamic", parts };
  return { kind: "families", parts };
}

/** One family from a list, how it was written, and whether CSS accepts it. */
export interface FamilyPart {
  name: string;
  /** As written, before escapes were resolved. */
  raw: string;
  quoted: boolean;
  valid: boolean;
}

/**
 * One item of a family list, judged against the grammar CSS applies to it.
 *
 * `<family-name>` is one string OR a run of identifiers, exclusively. `"Bad"
 * "Name"` is neither, and a browser drops the declaration that holds it — so
 * joining the two into `Bad Name` would export a font stack the site never
 * rendered to any tool reading the standard value.
 */
function finishPart(
  current: string,
  inner: string,
  quoted: boolean,
  strings: number,
  outsideQuotes: string,
  raw: string
): FamilyPart {
  // A QUOTED item is its quoted content verbatim: `" Brand "` names a family
  // whose name has those spaces, and is a different family from `Brand`.
  // Unquoted, the surrounding whitespace is separation and is trimmed.
  const name = quoted ? inner : current.trim();
  const valid =
    name !== "" &&
    (quoted ? strings === 1 && outsideQuotes.trim() === "" : strings === 0);
  // The raw spelling is kept because the identifier-run check has to read what
  // was WRITTEN. `\\31 0px` is a legal identifier naming the family `10px`;
  // tested after decoding it looks like a dimension and a valid token is lost.
  //
  // Trimmed by the same whitespace set that separates identifiers within it.
  // `String.trim` strips characters CSS does not treat as whitespace, so a
  // family led by one would have it removed here and pass a check the browser
  // fails.
  // CSS separates the identifiers of an unquoted family with any run of its
  // whitespace, and treats every run alike — `Brand   Sans` selects the face
  // named `Brand Sans`. Keeping the author's spelling made an equivalent value
  // compare unequal against the family a face declares. A QUOTED name keeps its
  // spelling exactly: there the spaces are part of the name.
  const collapsed = quoted ? name : name.replace(CSS_WS_RUN, " ");
  return { name: collapsed, raw: trimCssWhitespace(raw), quoted, valid };
}

/**
 * One CSS escape sequence, and where the text continues after it.
 *
 * Two forms, and only one of them is "the next character". A backslash followed
 * by up to six hex digits is that code point, and a single whitespace after the
 * digits belongs to the escape rather than to the name — that trailing space is
 * how `\26 Co` says `&Co` instead of leaving the parser to guess where the hex
 * ended. Anything else after a backslash stands for itself.
 *
 * Covered: one to six digits, with or without the terminator; a terminator that
 * is a space, tab, LF, CR, FF, or a CRLF pair; and a non-hex escape such as
 * `\ ` for a literal space. The terminator is CSS whitespace only — a no-break
 * space is an identifier character to CSS, so it stays in the name.
 *
 * Both the family-list decoder and the `var()` name check step over escapes
 * with this, so they agree on where every escape ends.
 */
function readCssEscape(
  text: string,
  at: number
): { text: string; next: number } {
  const hex = /^[0-9a-fA-F]{1,6}/.exec(text.slice(at + 1, at + 7));
  if (hex === null) {
    return { text: text[at + 1] ?? "", next: at + 2 };
  }
  const digits = hex[0];
  let next = at + 1 + digits.length;
  // One whitespace is consumed as the terminator. CSS turns CRLF into a single
  // newline before it tokenises, so that pair counts as the one character.
  if (text.startsWith("\r\n", next)) next += 2;
  else if (CSS_WS_CHAR.test(text[next] ?? "")) next += 1;
  const code = Number.parseInt(digits, 16);
  // A zero or out-of-range code point is the replacement character, which is
  // what CSS says a parser must substitute.
  const safe = code === 0 || code > 0x10ffff ? 0xfffd : code;
  return { text: String.fromCodePoint(safe), next };
}

/**
 * A family name written so CSS reads back the name the file gave.
 *
 * `<family-name>` is a string or a run of identifiers, so a name that already
 * IS such a run is left bare — which matters beyond tidiness, because the
 * generic families (`serif`, `system-ui`, `monospace`) mean the generic only
 * while unquoted. Quoting `serif` would ask for a font actually installed under
 * that name and lose the fallback the file was describing.
 *
 * Everything else is quoted and escaped: a comma would otherwise split one
 * family into two, and a quote would end the string and leave the rest of the
 * declaration to be read as CSS.
 */
export function cssFamilyName(name: string): string {
  const text = name.trim();
  // A CSS-wide keyword bare is that keyword, not a font: `font-family: inherit`
  // takes the parent's font rather than one called "inherit". The generics are
  // the opposite case and must stay bare, which is why this is a list of the
  // words that change meaning rather than a rule about identifiers.
  if (
    SAFE_FAMILY_IDENTS.test(text) &&
    !FAMILY_MUST_QUOTE.has(text.toLowerCase())
  ) {
    return text;
  }

  let escaped = "";
  for (const char of text) {
    const code = char.codePointAt(0) ?? 0;
    if (char === "\\" || char === '"') {
      escaped += `\\${char}`;
    } else if (code < 0x20 || code === 0x7f) {
      // A raw control character cannot appear in a CSS string. The hex escape
      // can, and the trailing space is what ends the escape.
      escaped += `\\${code.toString(16)} `;
    } else {
      escaped += char;
    }
  }
  return `"${escaped}"`;
}

/**
 * Names that mean something else when written bare.
 *
 * The CSS-wide keywords and `default` are not font names in a declaration, so a
 * file describing a family called `inherit` has to get it back quoted.
 */
const FAMILY_MUST_QUOTE = new Set([
  "inherit",
  "initial",
  "unset",
  "revert",
  "revert-layer",
  "default",
]);

/** A run of identifiers, which is the one family spelling needing no quotes. */
const SAFE_FAMILY_IDENTS =
  /^[A-Za-z_][A-Za-z0-9_-]*(?: [A-Za-z_][A-Za-z0-9_-]*)*$/;
