/**
 * What a stylesheet fetches, read as a browser reads it: each `@import`
 * (written as `url()` or as a plain string), each `url()` inside
 * `@font-face`, and every other `url()` or `image-set()` string, which loads
 * an image.
 *
 * Read once here for both the rules, which hold every fetch to the same URL
 * policy as an attribute, and the CSP check, which judges each by the
 * directive governing what it loads.
 *
 * Where the parser keeps text it does not model (an `@import` with
 * `supports()` or `layer()`, an unknown function, a custom property, which
 * `var()` can carry into a fetch), that text is read again as a value, and
 * every `url(` in it is taken as well, so a fetch is never missed for being
 * written in an unusual place: one the reading can't make sense of is still
 * reported, as written, and the URL rule refuses it.
 *
 * @module site-code/css-urls
 * @experimental
 */
// The parser and walker entries rather than the root, which loads css-tree's
// reference data and `node:module`: the custom CSS checker runs this in the
// browser too.
import type { CssNode, WalkContext } from "css-tree";
import parse from "css-tree/parser";
import walk from "css-tree/walker";

/** One fetch a stylesheet makes: what it loads, and from where as written. */
export interface CssFetch {
  readonly via: "import" | "font" | "image";
  readonly url: string;
}

/** A fetch, and the line of the text it is written on, from 1. */
export interface LocatedCssFetch extends CssFetch {
  readonly line: number;
}

/** The line an offset into text is on, counting from `first`. */
function lineOf(text: string, offset: number, first: number): number {
  let line = first;
  for (let i = 0; i < offset && i < text.length; i++) {
    if (text.charCodeAt(i) === 10) line += 1;
  }
  return line;
}

/** The functions whose plain strings are image URLs. */
const IMAGE_SET = new Set(["image-set", "-webkit-image-set"]);

/** Every `url(…)` in text, quoted or not, as written. */
const URL_TOKEN = /url\(\s*(?:"([^"]*)"|'([^']*)'|([^)\s]*))\s*\)/gi;

/** A quoted string opening text: an `@import` target written as one. */
const LEADING_STRING = /^\s*(?:"([^"]*)"|'([^']*)')/;

/**
 * What a fetch in `context` loads, by the at-rule it sits in. An `@import`
 * has no block, so whatever sits in one is in its prelude, parsed or kept
 * as text.
 */
function viaOf(context: WalkContext): CssFetch["via"] {
  const atrule = context.atrule?.name.toLowerCase();
  if (atrule === "import") return "import";
  return atrule === "font-face" ? "font" : "image";
}

/**
 * The fetches in text the parser kept unread: read as a value where it can
 * be (for `image-set()` strings and escaped URLs), and every `url(` in it
 * besides, each URL once. In an `@import` prelude a leading string is the
 * target too.
 */
function rawFetches(
  text: string,
  via: CssFetch["via"],
  firstLine = 1
): LocatedCssFetch[] {
  // Each URL once, at the first line it is read on.
  const urls = new Map<string, number>();
  const add = (url: string, line: number) => {
    if (!urls.has(url)) urls.set(url, line);
  };
  if (via === "import") {
    const leading = LEADING_STRING.exec(text);
    const target = leading?.[1] ?? leading?.[2];
    if (target !== undefined) add(target, firstLine);
  }
  try {
    walk(parse(text, { context: "value", positions: true }), {
      enter(this: WalkContext, node: CssNode) {
        const line = firstLine + (node.loc?.start.line ?? 1) - 1;
        if (node.type === "Url") add(node.value, line);
        if (node.type === "String" && inImageSet(this)) add(node.value, line);
      },
    });
  } catch {
    // Text that is no value at all: the scan below still reads it.
  }
  for (const match of text.matchAll(URL_TOKEN)) {
    add(
      match[1] ?? match[2] ?? match[3] ?? "",
      lineOf(text, match.index, firstLine)
    );
  }
  return [...urls].map(([url, line]) => ({ via, url, line }));
}

/** Whether a node sits in an `image-set()`, whose strings are images. */
function inImageSet(context: WalkContext): boolean {
  const fn = context.function;
  return fn !== null && IMAGE_SET.has(fn.name.toLowerCase());
}

/**
 * The fetch one parsed node makes, if any: a `url()`; a plain string that is
 * an `@import` target (only the first in its prelude, before any function;
 * later strings are its conditions) or an `image-set()` image; or the text
 * of a node the parser kept unread.
 */
function nodeFetches(
  node: CssNode,
  context: WalkContext,
  imported: Set<CssNode>
): LocatedCssFetch[] {
  const via = viaOf(context);
  const line = node.loc?.start.line ?? 1;
  if (node.type === "Url") return [{ via, url: node.value, line }];
  if (node.type === "Raw") return rawFetches(node.value, via, line);
  if (node.type !== "String") return [];
  if (inImageSet(context)) return [{ via: "image", url: node.value, line }];
  const atrule = context.atrule;
  return via === "import" &&
    context.function === null &&
    atrule !== null &&
    !imported.has(atrule)
    ? [{ via, url: node.value, line }]
    : [];
}

/**
 * Every fetch a stylesheet makes, in the order written: a whole sheet, or
 * the declarations of a `style` attribute.
 */
export function cssFetches(
  text: string,
  context: "stylesheet" | "declarationList" = "stylesheet"
): CssFetch[] {
  return cssFetchLocations(text, context).map(({ via, url }) => ({
    via,
    url,
  }));
}

/**
 * {@link cssFetches}, each with the line it is written on, so a refusal can
 * name the rule to change.
 */
export function cssFetchLocations(
  text: string,
  context: "stylesheet" | "declarationList" = "stylesheet"
): LocatedCssFetch[] {
  const fetches: LocatedCssFetch[] = [];
  let ast: CssNode;
  try {
    ast = parse(text, { context, positions: true });
  } catch {
    // Not CSS the parser can read at all: every `url(` in it is still read.
    return rawFetches(text, "image");
  }
  // The `@import` rules whose target was read, so a later string in the
  // same prelude is not taken for one.
  const imported = new Set<CssNode>();
  walk(ast, {
    // The walk's context names the at-rule and function a node sits in.
    enter(this: WalkContext, node: CssNode) {
      const found = nodeFetches(node, this, imported);
      if (found.length === 0) return;
      if (found[0]?.via === "import" && this.atrule !== null) {
        imported.add(this.atrule);
      }
      fetches.push(...found);
    },
  });
  return fetches;
}
