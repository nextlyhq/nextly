/**
 * Site tokens as a DTCG file, and back.
 *
 * The Design Tokens Community Group format is what Figma, Style Dictionary and
 * Tokens Studio read and write, so this is the door a site's tokens leave and
 * arrive through. The token KINDS were chosen as a subset of DTCG's `$type`
 * vocabulary for exactly this reason: the mapping is a projection rather than a
 * translation.
 *
 * ## A dot-path name is a PATH, not a name
 *
 * DTCG reserves the period: "the following characters MUST NOT be used anywhere
 * in a token or group name: `{`, `}`, `.`". So `color.primary` is not a DTCG
 * name at all — it is the token `primary` inside the group `color`. Export
 * nests, import flattens, and because the spec forbids a period inside a name
 * the two directions cannot disagree about where a path divides.
 *
 * ## Most DTCG values are objects now
 *
 * A dimension is `{"value": 16, "unit": "px"}` and only `px` or `rem` are
 * allowed; a duration is the same shape; a colour is
 * `{"colorSpace", "components", "alpha?", "hex?"}` and a bare hex string is no
 * longer valid on its own. That has a consequence worth stating plainly rather
 * than discovering later: a token holding `1.5em`, `100%`, `clamp(...)` or a
 * `var()` reference **cannot be written as a conformant DTCG value at all**.
 *
 * So the export carries two things for every token it can: the native DTCG
 * value, for the tools this exists to talk to, and the exact CSS under this
 * vendor's `$extensions` key. Import prefers the extension when it is there,
 * which makes a Nextly-to-Nextly round trip exact, and falls back to converting
 * the native value, which makes a file from Figma import correctly. A token
 * with no representable value is reported rather than emitted with a shape that
 * would be a lie about what it holds.
 *
 * Foreign extension data is carried in both directions untouched, because the
 * format requires it: "Tools that process design token files MUST preserve any
 * extension data they do not themselves understand."
 *
 * ## A token's identity travels in the extension, because DTCG has none
 *
 * The format knows a token by its path and nothing else — there is no id, and
 * an alias `{color.primary}` resolves by name. A `SiteToken`'s identity is
 * therefore not expressible in the format's own vocabulary, and inventing a
 * `$id` for it would take a prefix the spec reserves for itself. So it rides in
 * `$extensions` beside the exact CSS, which is both the conformant place for it
 * and a preserved one.
 *
 * That leaves the two directions asymmetric, deliberately. A file this wrote
 * comes back with the identity it left with. A file from anywhere else has no
 * identity to read, and gets none invented for it: its tokens arrive with their
 * names as identities, which is what a token with no id means everywhere else.
 *
 * @module style/dtcg
 */
import type { ValidationIssue } from "../validation";

import type { TokenKind } from "./catalog-types";
// The colour reader the contrast utility already uses. One parser rather than
// two, because a second would have to be kept in step with it by hand and the
// symptom of failure is silent: an exported `$value` that describes a different
// colour from the one the site renders.
import { parseColor } from "./contrast";
import type { Rgb } from "./contrast";
import { asciiLower, checkCssValue, decodeIdentifier } from "./css-value";
import type { SiteToken, SiteTokenSet } from "./site-tokens";
import {
  isAuthorableTokenName,
  MAX_TOKEN_NAME_LENGTH,
  MAX_TOKEN_NAME_SEGMENTS,
  tokenNamingProblem,
  tokenValueFetches,
} from "./site-tokens";

/** The key this vendor's data lives under, in the notation the format asks for. */
export const NEXTLY_EXTENSION = "com.nextlyhq.nextly";

/** What this writes under its own extension key. */
interface NextlyExtension {
  /** The exact CSS per mode, which is what makes a round trip exact. */
  css: { light: string; dark?: string };
  kind: TokenKind;
  /**
   * The token's stable identity, when it has one distinct from its name.
   *
   * It rides HERE because the format leaves nowhere else for it. DTCG has no
   * concept of a token id — a name is the only identity it knows, and `{a.b}`
   * aliases resolve by path — while every property the format defines is
   * `$`-prefixed and that prefix is reserved for future versions of the spec,
   * so a `$id` of this system's invention would squat on it. `$extensions`
   * under a reverse-domain key is what the spec offers instead, and what it
   * guarantees: extension data a tool does not understand MUST be preserved,
   * so an identity that leaves through Figma or Style Dictionary comes back.
   *
   * Omitted when the name IS the identity, so a file this exports carries no
   * field a reader has to interpret to arrive at the token that was written.
   */
  id?: string;
}

/** A DTCG group or token; the format is a tree of plain JSON. */
export type DtcgNode = { [key: string]: unknown };

/** The `$type` each kind projects onto, or `undefined` where DTCG has none. */
const DTCG_TYPE: Partial<Record<TokenKind, string>> = {
  color: "color",
  dimension: "dimension",
  fontFamily: "fontFamily",
  fontWeight: "fontWeight",
  number: "number",
  duration: "duration",
  shadow: "shadow",
};

/** The kinds a `$type` projects back onto. */
const KIND_BY_TYPE = new Map<string, TokenKind>(
  Object.entries(DTCG_TYPE).map(([kind, type]) => [type, kind as TokenKind])
);

function issue(message: string): ValidationIssue {
  return {
    path: "siteTokens",
    code: "invalid-style-value",
    severity: "warning",
    message,
  };
}

/* ------------------------------------------------------------------ export */

/**
 * A site's tokens as a DTCG document, with what could not be represented.
 *
 * Reported rather than dropped in silence: a designer handed a file with three
 * tokens missing has no way to know, and the ones that go missing are the
 * interesting ones — the `clamp()` that took an afternoon to get right.
 */
export function tokensToDtcg(set: SiteTokenSet): {
  document: DtcgNode;
  issues: ValidationIssue[];
} {
  const document: DtcgNode = {};
  const issues: ValidationIssue[] = [];

  for (const token of set.tokens) {
    const entry = dtcgEntry(token, issues);
    // Skipped rather than placed: `dtcgEntry` has already said why, and a name
    // it refused is one `place` would split into a path anyway.
    if (entry === undefined) continue;
    place(document, token.name.split("."), entry, issues);
  }

  return { document, issues };
}

/**
 * One token as the format holds it, or nothing when it cannot be written.
 *
 * Split from the checks the way {@link readToken} is split from its assembly,
 * and for the same reason: deciding whether a token can cross the boundary and
 * building the node that crosses it are separate jobs, and a guard added to the
 * builder would be a second place that answers the first question.
 */
function dtcgEntry(
  token: SiteToken,
  issues: ValidationIssue[]
): DtcgNode | undefined {
  const writable = exportableValue(token, issues);
  if (writable === undefined) return undefined;
  return entryFor(token, writable.type, writable.value);
}

/**
 * What this token becomes in the format, or nothing with the reason reported.
 *
 * Returns the converted value rather than merely approving the token, so the
 * caller does not convert it a second time — two conversions of one value is
 * the shape that lets an approval and an emission disagree about what was
 * approved.
 */
function exportableValue(
  token: SiteToken,
  issues: ValidationIssue[]
): { type: string; value: unknown } | undefined {
  const naming = tokenNamingProblem(token);
  if (naming !== undefined) {
    // One rule, phrased for this gate. The identity carries the cap and the
    // display name carries only the grammar, so a renamed token with a long
    // label exports normally — refusing it here would drop a working token from
    // the file while Nextly went on rendering it.
    issues.push(
      issue(
        naming.reason === "depth"
          ? `"${String(token.name)}" is nested too deeply, so it was not exported. A token name holds at most ${MAX_TOKEN_NAME_SEGMENTS} dot-separated parts.`
          : naming.reason === "length"
            ? `"${String(token.name)}" is written under more than ${MAX_TOKEN_NAME_LENGTH} characters, so it was not exported. The ${naming.field} a token is written under is at most ${MAX_TOKEN_NAME_LENGTH} characters.`
            : naming.field === "name"
              ? `"${token.name}" is not a token name, so it was not exported.`
              : `"${token.name}" has an id that is not a token name, so it was not exported. Its value is still here in Nextly.`
      )
    );
    return undefined;
  }
  // The id is covered by the same answer above, and refused rather than
  // written: writing it produces a file this module's own importer refuses on
  // the way back in — and it refuses the WHOLE token, because an id it cannot
  // read is an identity it cannot honour. An exporter emitting a document that
  // fails its own round trip is the one shape this module exists to prevent.

  const type = DTCG_TYPE[token.kind];
  const value = type === undefined ? undefined : toDtcgValue(token);
  if (type === undefined || value === undefined) {
    issues.push(
      issue(
        `"${token.name}" holds a value the design-token format cannot express, so it was not exported. Its value is still here in Nextly.`
      )
    );
    return undefined;
  }
  return { type, value };
}

/** The node for a token already established as writable. */
function entryFor(token: SiteToken, type: string, value: unknown): DtcgNode {
  const extension: NextlyExtension = {
    css:
      token.values.dark === undefined
        ? { light: token.values.light }
        : { light: token.values.light, dark: token.values.dark },
    kind: token.kind,
    // Written only when the token carries one. Exporting `id: name` for every
    // token that never moved would make the field say nothing about identity
    // and everything about which version of this exporter ran.
    ...(token.id === undefined ? {} : { id: token.id }),
  };
  const entry: DtcgNode = {
    $type: type,
    $value: value,
    $extensions: {
      ...(token.extensions ?? {}),
      // `unreadIn` is what keeps the two halves apart, HERE as much as on the
      // way in: a token stored while a field was unread still carries a copy of
      // it, and once this build learns to read that field the stored copy is a
      // stale statement of a value the site may since have changed. The filter
      // drops it, so the model is the only thing that can state it.
      //
      // Spread order says the same thing a second way and cannot be observed
      // while the filter holds, since no key survives it that the fields below
      // could collide with.
      [NEXTLY_EXTENSION]: { ...unreadIn(token.unreadExtension), ...extension },
    },
  };
  if (token.description !== undefined) entry.$description = token.description;
  return entry;
}

/**
 * Put a token at its path, creating the groups it passes through.
 *
 * Every lookup asks for an OWN key. A document node is an ordinary object, so
 * reading a segment directly finds whatever `Object.prototype` supplies:
 * `node["constructor"]` is a function rather than `undefined`, and a token
 * named `constructor` — which `isTokenName` accepts, because it is a perfectly
 * ordinary name — was refused as though the site already held it. The document
 * came back `{}` with "exported more than once" beside it, so the token could
 * not leave this system at all. `toString`, `valueOf` and the rest of the
 * prototype behaved the same way, at a leaf or at any segment on the way down.
 *
 * `__proto__` is the one name that would also corrupt the ASSIGNMENT rather
 * than only the lookup, and it cannot arrive here: `exportableValue` refuses a
 * name `isTokenName` rejects, and that regex requires a letter first.
 */
function place(
  root: DtcgNode,
  path: string[],
  entry: DtcgNode,
  issues: ValidationIssue[]
): void {
  let node = root;
  for (let index = 0; index < path.length - 1; index++) {
    const segment = path[index] ?? "";
    const existing = Object.hasOwn(node, segment) ? node[segment] : undefined;
    if (existing === undefined) {
      const group: DtcgNode = {};
      node[segment] = group;
      node = group;
      continue;
    }
    if (!isPlainObject(existing) || "$value" in existing) {
      // A token and a group cannot share a path: `color.primary` and
      // `color.primary.hover` ask for `primary` to be both.
      issues.push(
        issue(
          `"${path.join(".")}" cannot be exported, because "${path.slice(0, index + 1).join(".")}" is already a token.`
        )
      );
      return;
    }
    node = existing;
  }
  const leaf = path[path.length - 1] ?? "";
  if (Object.hasOwn(node, leaf)) {
    issues.push(issue(`"${path.join(".")}" is exported more than once.`));
    return;
  }
  node[leaf] = entry;
}

/**
 * The units the format allows, named once for both directions.
 *
 * Export restricting them while import accepted any string is how a file
 * exported from here could fail to come back: the two sides of one rule, and
 * only one of them was written down.
 */
const DTCG_LENGTH_UNITS = ["px", "rem"];
const DTCG_TIME_UNITS = ["ms", "s"];

/** A token's light value in the shape its `$type` requires, or `undefined`. */
function toDtcgValue(token: SiteToken): unknown {
  const css = token.values.light.trim();
  switch (token.kind) {
    case "color":
      return colorToDtcg(css);
    case "dimension":
      return measureToDtcg(css, DTCG_LENGTH_UNITS);
    case "duration":
      return measureToDtcg(css, DTCG_TIME_UNITS);
    case "fontFamily":
      return familyToDtcg(css);
    case "fontWeight":
      return weightToDtcg(css);
    case "number":
      return numberToDtcg(css);
    // A CSS shadow is a list of lengths and a colour in an order DTCG models as
    // named fields. Converting it means parsing the shorthand, which is the
    // kind of guessing this file exists to avoid; the extension carries it.
    case "shadow":
      return undefined;
    default:
      return undefined;
  }
}

/** `16px` as `{value, unit}`, when the unit is one the format allows. */
function measureToDtcg(
  css: string,
  units: readonly string[]
): { value: number; unit: string } | undefined {
  const match = CSS_MEASURE.exec(css);
  if (!match) return undefined;
  const value = Number.parseFloat(match[1] ?? "");
  // A unit is an identifier, so a browser reads `1r\\65m` as `1rem`. Comparing
  // the raw text against the allowed units reports a good measurement as one
  // the format cannot express.
  const unit = asciiLower(decodeIdentifier(match[2] ?? ""));
  if (!Number.isFinite(value) || !units.includes(unit)) return undefined;
  return { value, unit };
}

/** A hex or `rgb()` colour in the format's object form. */
function colorToDtcg(css: string): DtcgNode | undefined {
  const rgb: Rgb | undefined = parseColor(css);
  if (rgb === undefined) return undefined;
  const component = (value: number): number =>
    Math.round((value / 255) * 10000) / 10000;
  const node: DtcgNode = {
    colorSpace: "srgb",
    components: [component(rgb.r), component(rgb.g), component(rgb.b)],
    hex: toHex(rgb),
  };
  if (rgb.a < 1) node.alpha = rgb.a;
  return node;
}

/** A family list as one string or an array, which is what the format takes. */
function familyToDtcg(css: string): string | string[] | undefined {
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
export function splitFamilyList(css: string): FamilyPart[] {
  const parts: FamilyPart[] = [];
  let current = "";
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
      raw += css.slice(index, escape.next);
      index = escape.next - 1;
      continue;
    }
    if (quote !== undefined) {
      raw += char;
      if (char === quote) quote = undefined;
      else current += char;
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
      parts.push(finishPart(current, quoted, strings, outsideQuotes, raw));
      current = "";
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
  parts.push(finishPart(current, quoted, strings, outsideQuotes, raw));

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
 * The CSS generic families, plus the `ui-*` system aliases.
 *
 * Unquoted, these are KEYWORDS rather than names: `font-family: serif` asks for
 * the browser's serif default, and no `@font-face` can claim it — the engine
 * emits every face family quoted, so only a quoted value can name one.
 */
const GENERIC_FAMILIES: ReadonlySet<string> = new Set([
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
]);

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

/** Classify one family-list item. */
export function familyPartKind(part: FamilyPart): FamilyPartKind {
  if (!part.valid) return "invalid";
  if (part.quoted) return "name";
  const lower = part.name.toLowerCase();
  // `var()` is checked before the grammar, because the grammar rejects the
  // parentheses and would report a valid, common value as broken.
  if (/\bvar\(/i.test(part.name)) return "dynamic";
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
  quoted: boolean,
  strings: number,
  outsideQuotes: string,
  raw: string
): FamilyPart {
  const name = current.trim();
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
 * The CSS `<number>` grammar, which is wider than one canonical spelling.
 *
 * `1.0`, `+2` and `1e3` are all valid numbers a person may reasonably have
 * typed. Accepting only the text `String(Number.parseFloat(x))` happens to
 * produce reports those as inexpressible and drops them from the export, which
 * is a formatting preference presented to the author as a limitation of the
 * format. The exact text is kept in the extension either way, so the round trip
 * stays byte for byte.
 */
// A decimal point is consumed only when a digit follows it: CSS reads `1.` as a
// number and then a delimiter, not as the number `1`. Accepting it let `1.px`
// split into `1` + `px` and export as a dimension the browser would drop.
const CSS_NUMBER_SOURCE = "[+-]?(?:\\d+(?:\\.\\d+)?|\\.\\d+)(?:[eE][+-]?\\d+)?";
const CSS_NUMBER = new RegExp(`^${CSS_NUMBER_SOURCE}$`);

/**
 * The same number, followed by a unit.
 *
 * Built from one source rather than written again, because a measurement is a
 * number with a unit on it and two spellings of "number" is how the two come to
 * disagree — a token exporting as `1e3` while `1e3px` is reported as something
 * the format cannot express.
 */
const CSS_MEASURE = new RegExp(
  `^(${CSS_NUMBER_SOURCE})((?:[a-zA-Z]|\\\\[0-9a-fA-F]{1,6}\\s?|\\\\.)+)$`
);

/** A number token as the format stores it: a JSON number. */
function numberToDtcg(css: string): number | undefined {
  if (!CSS_NUMBER.test(css)) return undefined;
  const value = Number.parseFloat(css);
  return Number.isFinite(value) ? value : undefined;
}

/** A weight as a number, or one of the two keywords the format names. */
function weightToDtcg(css: string): number | string | undefined {
  const numeric = numberToDtcg(css);
  if (numeric !== undefined) return numeric;
  const keyword = css.toLowerCase();
  return keyword === "normal" || keyword === "bold" ? keyword : undefined;
}

/* ------------------------------------------------------------------ import */

/**
 * The tokens a DTCG document describes.
 *
 * Everything it cannot read is reported rather than guessed at, because a token
 * imported with the wrong value is worse than one that did not arrive: the site
 * renders, and nobody looks again.
 */
export function dtcgToTokens(input: unknown): {
  tokens: SiteToken[];
  issues: ValidationIssue[];
} {
  const tokens: SiteToken[] = [];
  const issues: ValidationIssue[] = [];
  if (!isPlainObject(input)) {
    return {
      tokens,
      issues: [issue("The file is not a design-token document.")],
    };
  }
  read(input, [], undefined, tokens, issues);
  return { tokens, issues };
}

/** Walk a group, carrying the `$type` its children inherit. */
function read(
  node: DtcgNode,
  path: string[],
  inherited: string | undefined,
  tokens: SiteToken[],
  issues: ValidationIssue[]
): void {
  const groupType = typeof node.$type === "string" ? node.$type : inherited;

  for (const [key, child] of Object.entries(node)) {
    // `$`-prefixed keys are the format's own; a name may not begin with one.
    if (key.startsWith("$")) continue;
    if (!isPlainObject(child)) continue;
    const here = [...path, key];

    if ("$value" in child) {
      const token = readToken(child, here, groupType, issues);
      if (token !== undefined) tokens.push(token);
      continue;
    }
    // Bounded BEFORE descending. A group path becomes a token's dot-separated
    // name, so the depth rule is the same one — but applying it at the leaf is
    // too late: this walk reaches the leaf by recursing, so a document nested
    // deeply enough exhausts the stack before any leaf is read. A file arrives
    // from outside this package, so that is untrusted input deciding how deep
    // this recursion goes.
    if (here.length > MAX_TOKEN_NAME_SEGMENTS) {
      issues.push(
        issue(
          `"${here.slice(0, 4).join(".")}..." is nested more than ${MAX_TOKEN_NAME_SEGMENTS} groups deep, so it and everything under it was skipped.`
        )
      );
      continue;
    }
    read(child, here, groupType, tokens, issues);
  }
}

/** One token, preferring this vendor's exact CSS over a conversion. */
function readToken(
  node: DtcgNode,
  path: string[],
  inherited: string | undefined,
  issues: ValidationIssue[]
): SiteToken | undefined {
  // Each segment on its own first. The format forbids `.` in a name, so a key
  // spelled `"color.primary"` is malformed — joined into the dot path it is
  // indistinguishable from the nested `color` -> `primary` it would collide
  // with, and the next export would rewrite it into exactly those groups.
  const malformed = path.find(segment => /[.{}]/.test(segment));
  if (malformed !== undefined) {
    issues.push(
      issue(
        `"${malformed}" is not a usable name in a design-token file: a name may not contain ".", "{" or "}". It was skipped.`
      )
    );
    return undefined;
  }
  const name = path.join(".");
  // The grammar only, here. Whether this name is also the string the token is
  // WRITTEN under depends on the id below, which has not been read yet — and a
  // file may legitimately carry a long label for a token whose stated id is
  // short. The cap is applied once the identity is known.
  if (!isAuthorableTokenName(name)) {
    issues.push(
      issue(`"${name}" is not a usable token name, so it was skipped.`)
    );
    return undefined;
  }

  const extensions = isPlainObject(node.$extensions)
    ? { ...node.$extensions }
    : {};
  const own = extensions[NEXTLY_EXTENSION];
  // Carried, not consumed: everything except this vendor's own key goes back
  // out with the token, which is what the format requires of any tool.
  delete extensions[NEXTLY_EXTENSION];
  // Its own key is PARTITIONED instead: the fields below are read into the
  // model, and whatever else it holds is kept beside them so the export can
  // write it back.
  const unread = unreadIn(own);
  reportUnreadMembers(own, name, issues);

  const description =
    typeof node.$description === "string" ? node.$description : undefined;
  const carried = Object.keys(extensions).length > 0 ? extensions : undefined;

  // Read ahead of the branch below, because identity does not depend on which
  // value path is taken: an extension whose `css` is unreadable still says
  // which token this is, and the native `$value` beside it is that same token's
  // value. A file from Figma carries no such key and arrives with no id, which
  // is the same thing as arriving with its name for an identity.
  const stated = isPlainObject(own) ? own.id : undefined;
  if (
    stated !== undefined &&
    !(typeof stated === "string" && isAuthorableTokenName(stated))
  ) {
    issues.push(
      issue(
        `"${name}" carries an id that is not a usable token name, so it was skipped. Importing it without the id would give it a different identity from the one the file states, and every reference written against that identity would stop resolving.`
      )
    );
    return undefined;
  }
  // A stated id equal to the name says exactly what an absent one says, so it
  // is normalised away — `id === undefined` then means one thing everywhere in
  // the model rather than two spellings of it.
  const id = stated === name ? undefined : stated;

  // The cap, now that the identity is settled. Held here rather than on either
  // field alone because the identity is what a stylesheet is written under: a
  // token whose stated id is short imports normally however long its label, and
  // one with no id is capped by that label because the label IS the identity.
  const naming = tokenNamingProblem({ name, id });
  if (naming !== undefined) {
    issues.push(
      issue(
        naming.reason === "depth"
          ? `"${name}" is nested too deeply, so it was skipped. A token name holds at most ${MAX_TOKEN_NAME_SEGMENTS} dot-separated parts.`
          : naming.reason === "length"
            ? `"${name}" is written under more than ${MAX_TOKEN_NAME_LENGTH} characters, so it was skipped. The ${naming.field} a token is written under is at most ${MAX_TOKEN_NAME_LENGTH} characters.`
            : `"${name}" has a ${naming.field} that is not a usable token name, so it was skipped.`
      )
    );
    return undefined;
  }

  // Both value paths below finish identically — same identity, same label, same
  // description, same carried extensions — and differ only in the kind and
  // values they arrived at. Assembled once so the two cannot drift into
  // disagreeing about what a token read from a file IS, which is a
  // disagreement with no symptom: whichever path a given file happens to take
  // is the only one anyone sees.
  const assemble = (
    kind: TokenKind,
    values: { light: string; dark?: string }
  ): SiteToken | undefined => {
    // The guard lives here rather than at each call, so the shorter extension
    // path cannot be the one that skips it: its CSS is arbitrary JSON from a
    // file exactly as `$value` is, and is trusted no further.
    if (!isWritableValue(values, name, issues)) return undefined;
    return {
      ...(id !== undefined ? { id } : {}),
      name,
      kind,
      values,
      ...(description !== undefined ? { description } : {}),
      ...(carried !== undefined ? { extensions: carried } : {}),
      ...(unread !== undefined ? { unreadExtension: unread } : {}),
    };
  };

  // The exact CSS this system wrote, when the file came from here. Read field
  // by field rather than asserted: the extension is arbitrary JSON from a file,
  // and a cast would be this function agreeing to whatever shape it found.
  if (isPlainObject(own)) {
    const css = own.css;
    const kind = own.kind;
    if (isPlainObject(css) && typeof css.light === "string" && isKind(kind)) {
      const dark = css.dark;
      const values =
        typeof dark === "string"
          ? { light: css.light, dark }
          : { light: css.light };
      // Reported HERE, at the moment the choice between the two is made. This
      // is the only place that knows both what the file stated and what was
      // taken instead, so anywhere else would be guessing at that decision.
      reportOverridden(node.$value, css.light, kind, name, issues);
      return assemble(kind, values);
    }
  }

  const type = typeof node.$type === "string" ? node.$type : inherited;
  const kind = type === undefined ? undefined : KIND_BY_TYPE.get(type);
  if (kind === undefined) {
    issues.push(
      issue(
        `"${name}" has the type "${type ?? "none"}", which this site has no token kind for, so it was skipped.`
      )
    );
    return undefined;
  }

  const light = fromDtcgValue(node.$value, kind);
  if (light === undefined) {
    issues.push(
      issue(`"${name}" has a value that could not be read, so it was skipped.`)
    );
    return undefined;
  }

  return assemble(kind, { light });
}

/**
 * The fields this system reads out of its own extension and writes back from
 * the model.
 *
 * The boundary between the two halves of that key: a field named here is the
 * model's to state, and a field not named here is a producer's to keep. Named
 * rather than inferred, because the set is consulted from both ends and a
 * missing name is silent at each — on the way in a model field would be stored
 * a second time as preserved data, and on the way out that stale copy would be
 * written beside the live one.
 *
 * `writesNoFieldItDoesNotDeclare` in the tests is what holds this to the
 * emitter: it reads the key this system writes and requires every field in it
 * to be named here, so adding a field to the emitter without adding it here
 * fails.
 */
const NEXTLY_FIELDS = new Set(["id", "css", "kind"]);

/**
 * The half of this system's OWN extension key that the model does not state.
 *
 * Another vendor's block is carried whole; this key is split, because part of
 * it IS the model — `css`, `kind` and `id` are read into the token and written
 * back from it, so keeping the file's copy of those would let an export state a
 * value the site no longer holds. Everything else came from a producer this
 * build cannot interpret, most likely a newer version of this system, and is
 * kept exactly as it arrived.
 *
 * Filtered here AND again on the way out, which are two different guarantees
 * rather than the same one twice: this call decides what a token stores, and
 * the emitter's decides what a token stored by an EARLIER build may write. A
 * token saved while a field was unread still carries that field, and once this
 * build learns to read it only the emitter's filter can stop the stored copy
 * shadowing the live value.
 *
 * Built with `Object.fromEntries` rather than by assignment: these keys come
 * from a file, and assigning `__proto__` onto an object literal reaches
 * `Object.prototype`'s setter instead of storing anything — the field would
 * vanish from the very set that exists to keep it.
 */
function unreadIn(own: unknown): Readonly<Record<string, unknown>> | undefined {
  if (!isPlainObject(own)) return undefined;
  const kept = Object.entries(own).filter(([key]) => !NEXTLY_FIELDS.has(key));
  return kept.length === 0 ? undefined : Object.fromEntries(kept);
}

/**
 * The members of `css` this system reads.
 *
 * `css` is the one field above with a structure. `id` and `kind` are strings, so
 * a member cannot be added beside what they hold — a newer build widening either
 * into an object fails `isKind` or the id grammar, and the token falls to the
 * `$value` path or is refused, rather than losing something quietly.
 */
const CSS_MEMBERS = new Set(["light", "dark"]);

/**
 * Say which members of a READ field were not kept.
 *
 * The boundary of what preserving reaches, and it is deliberate. `unreadIn`
 * partitions this key at the TOP level only: a member a newer build added inside
 * `css` — a mode this one has no name for — is neither read nor kept, and this
 * is the only thing said about it.
 *
 * Reported rather than preserved, which is the opposite of the choice made one
 * level up, because `css` is not metadata about the token: it IS the token's
 * value, per mode. Writing a preserved member back beside a value the author has
 * since edited would state a mode derived from a value that no longer exists — a
 * colour that renders, looks plausible and is wrong. Losing it is recoverable
 * instead: a build that understands that mode sees it absent and can compute it
 * again, where it cannot see that a value it CAN read is stale.
 *
 * So the round trip is exact for a field this system does not read and lossy for
 * a member inside one it does. Said out loud, because the alternative is a
 * silent difference between the two.
 */
function reportUnreadMembers(
  own: unknown,
  name: string,
  issues: ValidationIssue[]
): void {
  if (!isPlainObject(own)) return;
  const css = own.css;
  if (!isPlainObject(css)) return;
  const dropped = Object.keys(css).filter(key => !CSS_MEMBERS.has(key));
  if (dropped.length === 0) return;
  issues.push(
    issue(
      `"${name}" states ${dropped.map(key => `"${key}"`).join(", ")} among its per-mode values, which this version has no mode for, so it was not kept. That names a value rather than a note about one, and writing it back would state a mode for a colour this version may since have changed.`
    )
  );
}

/**
 * Say when the file's own `$value` did not agree with the CSS taken instead.
 *
 * A token can arrive described twice: the format's `$value`, and the exact CSS
 * this system wrote into its extension. The extension wins, and that is right —
 * it preserves what the author typed, where `$value` is a conversion. But when
 * the two genuinely DISAGREE, the file's value is discarded without a word and
 * the next export rewrites `$value` to match, so a hand-edited file loses the
 * edit and reports success.
 *
 * Only a real difference is named, never the preference itself. Naming the
 * preference would put a line against every token of every round trip, because
 * the two forms differ in SPELLING on files this system wrote: a token stored
 * as `#111` or `rgb(17 17 17)` comes back from `$value` as `#111111`. A report
 * that fires on correct files is the report that gets ignored.
 *
 * Only the LIGHT value is compared, because the format has one `$value` and a
 * dark value exists only in this system's extension — there is nothing there
 * for it to disagree with.
 */
function reportOverridden(
  native: unknown,
  taken: string,
  kind: TokenKind,
  name: string,
  issues: ValidationIssue[]
): void {
  const stated = fromDtcgValue(native, kind);
  // Unreadable on its own is a different question, and not one this can answer:
  // there is no value to disagree with.
  if (stated === undefined) return;
  if (meansTheSame(stated, taken, kind)) return;
  issues.push(
    issue(
      `"${name}" was imported as "${taken}", the value this system stored, and the "${stated}" its "$value" states was not used.`
    )
  );
}

/**
 * Whether two spellings of one kind's value mean the same thing.
 *
 * Silence is the answer whenever this cannot tell, and the direction is
 * deliberate: this feeds an advisory report, where a false alarm costs the
 * whole report and a miss costs one line. So an unequal pair is only called a
 * disagreement when something here can show the two differ in MEANING.
 *
 * Colour is the kind that can be shown, because `parseColor` already reads the
 * spellings the emitter writes. Every other kind compares only as text, and
 * text differing is not enough — `1rem` and `1.0rem` are the same dimension —
 * so those stay silent. That is a real gap and it is stated rather than closed:
 * closing it needs a normaliser per kind, and each one is a second answer to
 * what a value of that kind means.
 */
function meansTheSame(stated: string, taken: string, kind: TokenKind): boolean {
  if (stated === taken) return true;
  if (kind !== "color") return true;
  const left = parseColor(stated);
  const right = parseColor(taken);
  if (left === undefined || right === undefined) return true;
  return sameRgb(left, right);
}

/** Whether two parsed colours are the same colour, alpha included. */
function sameRgb(left: Rgb, right: Rgb): boolean {
  return (
    left.r === right.r &&
    left.g === right.g &&
    left.b === right.b &&
    left.a === right.a
  );
}

/**
 * Whether an imported value could ever be written, reported where it arrived.
 *
 * The emitter refuses these anyway, so nothing unsafe reaches a stylesheet
 * either way. What changes is WHERE the author is told: without this the file
 * imports cleanly, the token is stored, and the reason appears on every page
 * compile from then on instead of once, naming the import that carried it.
 *
 * The same two guards the emitter applies, called from here rather than
 * restated — a value the emitter would refuse and this accepted, or the
 * reverse, is a disagreement with no symptom to follow.
 */
function isWritableValue(
  values: { light: string; dark?: string },
  name: string,
  issues: ValidationIssue[]
): boolean {
  for (const [mode, value] of Object.entries(values)) {
    if (typeof value !== "string") continue;
    if (checkCssValue(value) !== null) {
      issues.push(
        issue(
          `"${name}" has a ${mode} value that cannot be written as CSS, so it was skipped.`
        )
      );
      return false;
    }
    if (tokenValueFetches(value)) {
      issues.push(
        issue(
          `"${name}" has a ${mode} value that would load a file, so it was skipped. A token holds a colour, a length, a duration, a font or a number.`
        )
      );
      return false;
    }
  }
  return true;
}

/**
 * Whether a value is one of this system's token kinds.
 *
 * Exported because {@link readToken} decides whether to take a token's stored
 * CSS on this and two other conditions, and a caller reporting what the reader
 * dropped has to ask the same question rather than restate it. Restating it
 * gets the answer wrong: the kinds this predicate accepts are the ones the
 * FORMAT has a type for, which is not every `TokenKind` — `custom` is a kind
 * and is not one of them.
 */
export function isKind(value: unknown): value is TokenKind {
  return typeof value === "string" && Object.hasOwn(DTCG_TYPE, value);
}

/** A DTCG value as the CSS this system stores, or `undefined`. */
function fromDtcgValue(value: unknown, kind: TokenKind): string | undefined {
  switch (kind) {
    case "color":
      return colorFromDtcg(value);
    case "dimension":
    case "duration": {
      if (!isPlainObject(value)) return undefined;
      const amount = value.value;
      const unit = value.unit;
      // The same units the export side allows, so the two directions agree. A
      // unit is text from a file being concatenated into a stored value: read
      // unchecked, `{ value: 16, unit: "px;color:red" }` becomes CSS nothing
      // here wrote.
      const allowed =
        kind === "dimension" ? DTCG_LENGTH_UNITS : DTCG_TIME_UNITS;
      if (
        typeof amount !== "number" ||
        !Number.isFinite(amount) ||
        typeof unit !== "string" ||
        !allowed.includes(unit.toLowerCase())
      ) {
        return undefined;
      }
      return `${amount}${unit.toLowerCase()}`;
    }
    case "fontFamily":
      // A DTCG family value is a NAME, not CSS. `ACME,Inc` is one family in the
      // file and two the moment it is written into a stylesheet unquoted, and a
      // name holding a quote produces CSS that does not parse at all.
      if (typeof value === "string") return cssFamilyName(value);
      if (Array.isArray(value) && value.every(v => typeof v === "string")) {
        return value.map(cssFamilyName).join(", ");
      }
      return undefined;
    case "fontWeight":
      if (typeof value === "number") return String(value);
      return typeof value === "string" ? value : undefined;
    case "number":
      return typeof value === "number" ? String(value) : undefined;
    default:
      return undefined;
  }
}

/**
 * A DTCG colour as CSS.
 *
 * The `hex` fallback is preferred where the file supplies one, because it is
 * exactly what the format says it is for and it round-trips byte for byte.
 * Otherwise the components are written as `rgb()`, which every browser reads —
 * `color(srgb …)` is newer and this is a value that has to render.
 */
function colorFromDtcg(value: unknown): string | undefined {
  if (!isPlainObject(value)) return undefined;
  // `alpha` is a member of its own, and `hex` is the six-digit fallback for the
  // colour WITHOUT it. Taking the hex on its own therefore imports a
  // half-transparent colour as an opaque one — a value that renders, looks
  // deliberate, and is not the colour the file described.
  // Validated rather than clamped, for the same reason the components are: an
  // alpha of 2 or -0.5 is not an alpha, and folding it to 1 or 0 imports a
  // colour the file did not describe.
  if (
    value.alpha !== undefined &&
    (typeof value.alpha !== "number" ||
      !Number.isFinite(value.alpha) ||
      value.alpha < 0 ||
      value.alpha > 1)
  ) {
    return undefined;
  }
  const alpha = typeof value.alpha === "number" ? value.alpha : 1;
  if (typeof value.hex === "string" && /^#[0-9a-f]{6}$/i.test(value.hex)) {
    // The hex is a FALLBACK for the components beside it, not an alternative to
    // them. Where both are present and disagree — `components: [1, 0, 0]` with
    // `hex: "#000000"` — taking the hex imports black for a token that
    // describes red, so the file is refused rather than silently reinterpreted.
    // Only where the components ARE sRGB channels. In another space they are
    // not comparable to an sRGB hex, and a file supplying a converted fallback
    // — display-p3 components beside their sRGB hex — is perfectly valid.
    if (value.colorSpace === "srgb" && hexDisagreesWithComponents(value)) {
      return undefined;
    }
    if (alpha >= 1) return value.hex;
    const rgb = parseColor(value.hex);
    if (rgb !== undefined) return `rgb(${rgb.r} ${rgb.g} ${rgb.b} / ${alpha})`;
  }
  const components = value.components;
  // Exactly three. sRGB has three channels and alpha is a member of its own, so
  // a fourth entry means the value was not written as the format describes —
  // dropping it silently would import a colour nobody wrote.
  if (!Array.isArray(components) || components.length !== 3) return undefined;
  if (value.colorSpace !== "srgb") return undefined;
  const channels = components;
  if (!channels.every(part => typeof part === "number")) return undefined;
  // Refused rather than clamped. A component outside 0-1 is not an sRGB
  // channel, and folding `[2, 0, 0]` down to red stores a colour the file did
  // not describe — rendered, believed, and never reported.
  if (
    !channels.every(part => Number.isFinite(part) && part >= 0 && part <= 1)
  ) {
    return undefined;
  }
  const [r, g, b] = channels.map(part => Math.round(part * 255));
  return alpha < 1 ? `rgb(${r} ${g} ${b} / ${alpha})` : `rgb(${r} ${g} ${b})`;
}

/**
 * Whether a supplied `hex` describes a different colour from the components.
 *
 * Compared after rounding to the same 8-bit channels the hex can express, so a
 * component that merely lost precision on the way to two digits still agrees.
 */
function hexDisagreesWithComponents(value: Record<string, unknown>): boolean {
  const components = value.components;
  if (!Array.isArray(components) || components.length !== 3) return false;
  if (!components.every(part => typeof part === "number")) return false;
  const fromHex = parseColor(String(value.hex));
  if (fromHex === undefined) return false;
  const channels = components.map(part =>
    Math.round(Math.min(1, Math.max(0, part)) * 255)
  );
  return (
    channels[0] !== fromHex.r ||
    channels[1] !== fromHex.g ||
    channels[2] !== fromHex.b
  );
}

/* ------------------------------------------------------------------ shared */

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * One CSS escape sequence, and where the text continues after it.
 *
 * Two forms, and only one of them is "the next character". A backslash followed
 * by up to six hex digits is that code point, and a single whitespace after the
 * digits belongs to the escape rather than to the name — that trailing space is
 * how `\26 Co` says `&Co` instead of leaving the parser to guess where the hex
 * ended. Anything else after a backslash stands for itself.
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
  // Exactly one whitespace character is consumed as the terminator.
  if (/\s/.test(text[next] ?? "")) next += 1;
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
function cssFamilyName(name: string): string {
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

function toHex(rgb: { r: number; g: number; b: number }): string {
  const part = (value: number): string =>
    Math.round(Math.min(255, Math.max(0, value)))
      .toString(16)
      .padStart(2, "0");
  return `#${part(rgb.r)}${part(rgb.g)}${part(rgb.b)}`;
}
