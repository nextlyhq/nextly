/**
 * The check every value gets: its length and nesting, whether it reads a
 * custom property, and `checkCssValue`, which every other check builds on.
 *
 * @module style/css-value-check
 */
import type { CssNode } from "css-tree";

import {
  decodeIdentifier,
  identifierOf,
  parseValue,
  trimCssWhitespace,
} from "./css-value-syntax";
import { nestedUrlRejection } from "./css-value-urls";
import {
  COMMENT_DELIMITERS,
  type CssValueRejection,
  MAX_VALUE_LENGTH,
  MAX_VALUE_NESTING,
  type MayFetchUrl,
  UNSAFE_VALUE_CHARS,
} from "./css-value-vocabulary";

/**
 * Whether CSS would make a custom-property substitution anywhere in this value.
 *
 * The question, not a spelling. A function token is an identifier immediately
 * followed by `(`, and the identifier is read DECODED — so `v\61 r(--brand)` IS
 * a `var()` to a browser, and any reader matching the literal text `var(` says it
 * is not. That gap is a known sanitiser-bypass shape rather than a curiosity: it
 * is how `url(` and `expression(` filters were historically defeated.
 *
 * **Exported because the answer must not be re-derived per consumer.** The
 * builder's tokens panel refuses to preview a value carrying a reference, since
 * a `var()` there resolves against the PANEL's own `--nx-*` properties and would
 * draw a colour the canvas does not have. It asked that question with a regex
 * over the raw text, so an escaped spelling was previewed — precisely the false
 * preview the guard exists to prevent.
 *
 * **Not the same choice `dtcg.ts` makes, deliberately.** That module reads the
 * raw spelling on purpose, and says so: a `var()` with an escaped name is then
 * read as invalid rather than dynamic, which is safe THERE because its grammar
 * refuses the parentheses anyway. The two want opposite defaults — reading raw
 * fails closed for dtcg and fails OPEN for a preview, where unseen means drawn.
 *
 * **An unparseable value answers `true`.** It cannot be shown not to substitute,
 * and every caller is deciding whether to render something whose appearance would
 * be wrong; declining to draw a value that would not have rendered anyway costs
 * nothing, while drawing one that substitutes is the defect. Fail-closed is a
 * property of the question rather than of this implementation.
 *
 * `env()` is excluded. It substitutes, but from user-agent values that are the
 * same in a panel and on a canvas, so it cannot produce the disagreement this
 * exists to catch.
 */
export function referencesCustomProperty(value: string): boolean {
  const reading = readVarCalls(value);
  return reading === undefined || reading.calls > 0;
}

/**
 * The custom properties a value reads through `var()`, by the names CSS reads
 * them as, or `undefined` where the value cannot be read whole: it does not
 * parse, or it nests deeper than {@link MAX_VALUE_NESTING}.
 *
 * The same walk {@link referencesCustomProperty} asks, so the two cannot
 * disagree about what a reference is: a fallback is read as the raw text the
 * parser hands back, and a name is read DECODED, so `var(--site-colo\72)`
 * names `--site-color` as a browser reads it. A name keeps its case, since a
 * custom property's name is case-sensitive. A `var()` whose head is not a
 * custom property names nothing, and the browser drops it.
 *
 * `undefined` is a value the style compiler does not emit: `checkCssValue`
 * refuses one that does not parse, and its nesting bound counts the brackets
 * this walk counts, so a value this cannot read whole is refused there as
 * too deeply nested. A caller asking what a stored value makes the page read
 * may therefore take `undefined` as naming nothing.
 */
export function customPropertiesReferenced(
  value: string
): readonly string[] | undefined {
  return readVarCalls(value)?.names;
}

/** What one walk of a value found: how many `var()` calls, and their names. */
interface VarCalls {
  calls: number;
  readonly names: string[];
}

/** The value's `var()` calls, or `undefined` where it cannot be read whole. */
function readVarCalls(value: string): VarCalls | undefined {
  const parsed = parseValue(value);
  if (parsed === null) return undefined;
  const found: VarCalls = { calls: 0, names: [] };
  return collectVarCalls(parsed, 0, found) ? found : undefined;
}

/**
 * Record each `var()` under `node`, answering whether it was read whole.
 *
 * Depth-bounded for the reason the URL walk is: parsing and walking are both
 * recursive, so a deeply nested value exhausts the stack. The depth is the
 * bracket nesting, counted as `checkCssValue` counts it (each function,
 * parenthesis and square bracket opens one level, and a fallback's raw text
 * sits inside its `var()`'s level), so a value read in part here is one the
 * compiler refuses, and every value it emits is read whole. Past the bound
 * the answer is "not read whole", which {@link referencesCustomProperty}
 * reads as a reference, keeping it fail-closed.
 */
function collectVarCalls(
  node: CssNode,
  depth: number,
  found: VarCalls
): boolean {
  if (depth > MAX_VALUE_NESTING) return false;
  // A fallback arrives as raw text rather than as parsed children, so a
  // reference nested inside one (`var(--a, v\61 r(--b))`) is invisible to a
  // walk that only descends `children`. One that does not parse names
  // nothing, as before.
  if (node.type === "Raw") {
    const inner = parseValue(node.value);
    return inner === null || collectVarCalls(inner, depth, found);
  }
  if (isVarCall(node)) {
    found.calls += 1;
    const name = customPropertyNameOf(node);
    if (name !== undefined) found.names.push(name);
  }
  const inner = opensLevel(node) ? depth + 1 : depth;
  for (const child of childrenOf(node)) {
    if (!collectVarCalls(child, inner, found)) return false;
  }
  return true;
}

/** Whether THIS node is the substitution, as CSS reads its name. */
function isVarCall(node: CssNode): boolean {
  return node.type === "Function" && identifierOf(node) === "var";
}

/** Whether a node's children sit one bracket deeper than the node. */
function opensLevel(node: CssNode): boolean {
  return (
    node.type === "Function" ||
    node.type === "Parentheses" ||
    node.type === "Brackets"
  );
}

/** The decoded custom property a `var()` names, or none where its head is not one. */
function customPropertyNameOf(node: CssNode): string | undefined {
  const [head] = childrenOf(node);
  if (head?.type !== "Identifier") return undefined;
  const name = decodeIdentifier(head.name);
  return name.startsWith("--") ? name : undefined;
}

/**
 * The children a node carries, or none.
 *
 * Separated so the walk reads as one loop rather than a guard and a loop. A
 * node whose `children` is absent or null is a leaf, and a leaf has nothing to
 * descend into — which is the same answer as an empty list.
 */
function childrenOf(node: CssNode): Iterable<CssNode> {
  if (!("children" in node) || node.children === null) return [];
  return node.children;
}

/** True when a stored string is longer than any declaration should carry. */
export function isOverlongValue(value: string): boolean {
  return value.length > MAX_VALUE_LENGTH;
}

/**
 * Deepest bracket nesting in a value.
 *
 * Counted the way the parser reads the text, not by tallying raw characters. A
 * backslash escapes whatever follows it, so `\)` is an ordinary character
 * inside an identifier and closes nothing; a bracket inside a quoted string is
 * likewise just text. A counter blind to either reads a closer that is not
 * there, undercounts the depth, and lets a value through that then exhausts the
 * stack while being walked — which is a crash rather than a rejection, on
 * input a stranger can write.
 */
// RELOCATED, not written here — see the docblock of `css-value.ts`.
// fallow-ignore-next-line complexity
function nestingDepth(value: string): number {
  let depth = 0;
  let deepest = 0;
  let quote: string | null = null;
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (character === "\\") {
      // Skip the escaped character itself, whatever it is.
      index += 1;
      continue;
    }
    if (quote !== null) {
      if (character === quote) quote = null;
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
      continue;
    }
    // Square brackets nest the parser and walker exactly as parentheses do —
    // counting only one of them leaves the other free to exhaust the stack.
    if (character === "(" || character === "[") {
      depth += 1;
      if (depth > deepest) deepest = depth;
    } else if (character === ")" || character === "]") {
      // Floor at zero: an unbalanced leading closer would otherwise buy the
      // rest of the value that much extra depth before the cap notices.
      if (depth > 0) depth -= 1;
    }
  }
  return deepest;
}

/**
 * Check a CSS value for parseability and unsafe characters. Returns `null` when
 * the value is safe to emit.
 */
export function checkCssValue(
  value: string,
  mayFetchUrl?: MayFetchUrl
): CssValueRejection | null {
  // The size cap goes first because it is the only constant-time check here:
  // trimming an oversized string scans and copies all of it before anything
  // decides the value was never going to be read.
  if (value.length > MAX_VALUE_LENGTH) return "too-long";
  if (trimCssWhitespace(value) === "") return "unparsable";
  if (UNSAFE_VALUE_CHARS.test(value)) return "unsafe-characters";
  if (COMMENT_DELIMITERS.test(value)) return "unsafe-characters";
  if (nestingDepth(value) > MAX_VALUE_NESTING) return "too-deeply-nested";
  const ast = parseValue(value);
  if (ast === null) return "unparsable";
  // A URL nested in a free-form value reaches the stylesheet exactly as a
  // dedicated URL property's does, and several properties emit the same CSS
  // property by either route, so both get the same allowlist. The check runs on
  // the PARSED node rather than the raw text because the parser decodes CSS
  // escapes: `url("\6a avascript:...")` arrives here as `javascript:...`, which
  // a scan of the original string would not recognise.
  return nestedUrlRejection(ast, mayFetchUrl);
}
