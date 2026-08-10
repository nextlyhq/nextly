import { asciiLower, decodeIdentifier } from "@nextlyhq/blocks-engine";
import * as csstree from "css-tree";

/**
 * Where a stylesheet this package emits is allowed to fetch from. React-free.
 *
 * One module, because "may this be fetched" is one question however many
 * surfaces ask it — custom CSS, structured style values, block attributes and
 * sanitized embed markup all reduce to it. Each of those judges a different
 * thing and reaches its own verdict, but they must agree on what a URL IS and
 * how it normalises, since that is where the subtleties are: a value carrying
 * a leading U+0001 is one URL to the WHATWG parser and another to `trim()`
 * plus a scheme test, and only one of those readings is the browser's.
 *
 * Keeping the definition here rather than per-caller is what makes those
 * agree. A second implementation of a security check is a second thing to be
 * wrong, and the surfaces that share this one cannot drift apart while the
 * scan is a single function.
 *
 * @module core/url-policy
 */

/**
 * Functions whose string arguments are text rather than something to fetch.
 *
 * An allowlist of the SAFE ones, deliberately, and the asymmetry is the reason.
 * Listing the URL-taking functions instead means an unlisted one is a MISS — a
 * leak — and that list is already hard to keep: `image()` and
 * `-webkit-image-set()` were both found only by probing. Listing the text-taking
 * ones means an unlisted function is refused, which costs a false positive and
 * a message. A security control should fail toward the annoyance.
 */
export const TEXT_ARGUMENT_FUNCTIONS = new Set([
  "counter",
  "counters",
  "format",
  "local",
  "symbols",
]);

/**
 * Functions that stand in for a value rather than holding one.
 *
 * Transparent to the question "is this string a URL": what a `var()` or
 * `attr()` fallback becomes depends entirely on where it sits, so it inherits
 * the position rather than defining one.
 */
/**
 * A function name as CSS reads it: escapes decoded, then ASCII-folded.
 *
 * css-tree keeps the spelling it was given, so `a\\74tr(...)` arrives as the
 * name `a\\74tr` while a browser reads it as `attr()`. Folding without decoding
 * first leaves it unrecognised — recorded as an ordinary function, never
 * matched against the substitution set, and never caught by the attr guard that
 * exists because an `attr()` in a URL position has no literal to inspect.
 */
export function functionName(raw: string): string {
  return asciiLower(decodeIdentifier(raw));
}

export const SUBSTITUTION_FUNCTIONS = new Set(["var", "env", "attr"]);

/**
 * An `attr()` standing where the value would be FETCHED rather than read.
 *
 * Unlike every other shape these scans look at, `attr()` has no literal in the
 * stylesheet to inspect: the value arrives from an author-controlled DOM
 * attribute at use time, so `image-set(attr(data-probe) 1x)` names a request
 * whose destination this parser cannot see. In a text position the same
 * function is ordinary — `content: attr(data-label)` — which is why the answer
 * depends on where it sits and not on the function alone.
 *
 * CSS Values 5 forbids the fetching case independently: the working group
 * resolved to make `type(<url>)` invalid inside `attr()`, and an
 * `attr()`-tainted value may not be used in a URL context at all. So refusing
 * costs no legitimate stylesheet anything, and it means the guarantee does not
 * rest on every engine having implemented that taint correctly — support for
 * `attr()` outside `content` is still marked experimental.
 *
 * Shared by both scans deliberately. They reach different verdicts (one
 * compares against an allowlist, the other refuses every remote origin) but
 * they read POSITION the same way, and a second copy of this rule is how one
 * of them would come to disagree with the other.
 */
export function attrFetchesFromDom(
  node: csstree.CssNode,
  position: readonly string[]
): boolean {
  if (node.type !== "Function" || functionName(node.name) !== "attr")
    return false;
  const enclosing = position[position.length - 1];
  return enclosing !== undefined && !TEXT_ARGUMENT_FUNCTIONS.has(enclosing);
}

/**
 * How deep a value may nest `Raw` fragments before the scan gives up.
 *
 * Values are short, so this exists to stop a hostile value recursing without
 * end rather than to bound cost. A real fallback chain bottoms out in a literal
 * after a handful of levels.
 */
export const MAX_VALUE_NESTING = 16;

/** What one value contained, and whether any of it could not be read. */
export interface FetchableValues {
  /** Every string or url the browser may fetch. */
  values: string[];
  /**
   * A fragment the parser could not resolve, and why. Unreadable is not the
   * same as safe: a caller refuses rather than emitting what it could not
   * check.
   */
  unreadable?: "depth" | "syntax" | "attr";
}

/**
 * Every value in a parsed CSS value that the browser may fetch.
 *
 * Three shapes, and missing any of them reopens the channel:
 *
 * A `Url` node, which is the obvious one.
 *
 * A `String` used as a function ARGUMENT, since `image-set("https://…")`
 * fetches while `content: "https://…"` is a caption. Which functions take text
 * is the allowlist above; anything unclassified can fetch.
 *
 * A `Raw` node, which is where css-tree puts what it did not parse into a
 * value — a `var()` fallback among other things. The browser substitutes that
 * fallback in, so `filter: var(--missing, url("https://…"))` is a request that
 * carries its URL inside text this parser skipped. It is re-parsed and walked
 * with the enclosing functions carried across, because the same string is a
 * caption or an image depending on where the `var()` sits.
 */
export function fetchableValues(
  value: csstree.CssNode,
  depth = 0,
  outerPosition: readonly string[] = [],
  // Every string counts, whatever position it sits in. True for a custom
  // property, whose value is checked as though it could land anywhere: the
  // declaration that consumes it holds only `var(--x)` and carries no literal
  // of its own, so the string has to be judged where it is written or nowhere.
  anyPositionFetches = false
): FetchableValues {
  const values: string[] = [];
  const raws: { text: string; position: string[] }[] = [];
  const functions: string[] = [];
  // An `attr()` standing where a URL would be fetched. Recorded rather than
  // returned mid-walk so the values found so far still reach the caller.
  let attrInFetchPosition = false;
  csstree.walk(value, {
    enter(node: csstree.CssNode) {
      if (node.type === "Function") functions.push(functionName(node.name));
      // The nearest enclosing function that actually decides what a string is;
      // substitutions stand in for a value and decide nothing, so the position
      // they sit in is the one that counts.
      const position = [
        ...outerPosition,
        ...functions.filter(name => !SUBSTITUTION_FUNCTIONS.has(name)),
      ];
      // No literal to read: the URL would arrive from a DOM attribute at use
      // time, so this is a request whose destination the scan cannot see.
      if (
        node.type === "Function" &&
        functionName(node.name) === "attr" &&
        (anyPositionFetches || attrFetchesFromDom(node, position))
      )
        attrInFetchPosition = true;
      if (node.type === "Url") {
        values.push(node.value);
        return;
      }
      if (node.type === "Raw") {
        raws.push({ text: node.value, position });
        return;
      }
      if (node.type !== "String") return;
      if (anyPositionFetches) {
        values.push(node.value);
        return;
      }
      const enclosing = position[position.length - 1];
      // A bare string is text: `content: "https://example.com"` is a caption.
      if (enclosing === undefined) return;
      if (TEXT_ARGUMENT_FUNCTIONS.has(enclosing)) return;
      values.push(node.value);
    },
    leave(node: csstree.CssNode) {
      if (node.type === "Function") functions.pop();
    },
  });

  // Ahead of the `Raw` re-parse: an unreadable value is refused either way, and
  // this reason names the actual cause rather than whatever the nested walk
  // happens to report first.
  if (attrInFetchPosition) return { values, unreadable: "attr" };

  for (const raw of raws) {
    if (raw.text.trim() === "") continue;
    if (depth >= MAX_VALUE_NESTING) return { values, unreadable: "depth" };
    let reparsed: csstree.CssNode;
    try {
      reparsed = csstree.parse(raw.text, { context: "value" });
    } catch {
      return { values, unreadable: "syntax" };
    }
    const nested = fetchableValues(
      reparsed,
      depth + 1,
      raw.position,
      anyPositionFetches
    );
    values.push(...nested.values);
    if (nested.unreadable !== undefined) {
      return { values, unreadable: nested.unreadable };
    }
  }
  return { values };
}

/**
 * The remote-host policy now lives in `@nextlyhq/blocks-engine`, where the
 * renderer can reach it too, and is re-exported here so every caller in this
 * package keeps the import it already had.
 *
 * The CSS-AST scanning above stays: it answers "which strings in this value are
 * fetched", which is a css-tree question this package owns. What moved is
 * "may this URL be fetched", which both packages ask.
 */
export {
  isAllowedRemoteUrl,
  isFetchableUrl,
  isRemoteUrl,
  normalizeUrl,
  type RemotePattern,
  type RemotePatternInput,
} from "@nextlyhq/blocks-engine";
