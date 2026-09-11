/**
 * What a `text` widget's markdown may turn into, and what it may not.
 *
 * The parsing is Lexical's own: `$convertFromMarkdownString` with the editor's
 * transformers, so a heading, a list or an emphasis in a card is the same
 * node it is in the rich-text field. Two things are decided here rather than
 * left to the library.
 *
 * 🔴 A link's destination is judged before it becomes a link. `LINK.replace`
 * creates a `LinkNode` from the markdown's URL verbatim, and a `LinkNode`
 * sets `href` verbatim, so `[click](javascript:...)` would arrive in the DOM
 * as exactly that. The guarded transformer declines the match instead, which
 * leaves the markdown on screen as the text it was written in -- a refusal
 * the author can see, rather than a link that quietly lost its destination.
 * Scheme-bearing hrefs are allowed only for `http`, `https`, `mailto` and
 * `tel`; anything without a scheme is a path on this site. ASCII control
 * characters and whitespace are stripped before the scheme is read, because
 * browsers strip them when parsing, and `java\nscript:` reads as no scheme
 * here while reading as `javascript:` there.
 *
 * Raw HTML needs no guard: no transformer parses it, so a `<script>` in the
 * markdown is a text node whose text is `<script>`.
 *
 * @module components/features/widgets/archetypes/text-markdown
 */

import { $isLinkNode, LinkNode } from "@lexical/link";
import {
  LINK,
  TRANSFORMERS,
  type TextMatchTransformer,
  type Transformer,
} from "@lexical/markdown";
import { $nodesOfType, type TextNode } from "lexical";

import { RICH_TEXT_THEME } from "@admin/components/features/entries/fields/special/rich-text-kit";

const SAFE_SCHEMES: ReadonlySet<string> = new Set([
  "http",
  "https",
  "mailto",
  "tel",
]);

/**
 * The destination as the BROWSER will read it, from the markdown as written.
 *
 * 🔴 Two transformations sit between the captured text and the `href` a
 * click follows, and a judgement made before either is a judgement of a
 * different string. `@lexical/markdown` unescapes the capture before it
 * creates the node -- a backslash before punctuation is dropped and a
 * decimal entity is decoded, so `javascript\:x` and `javascript&#58;x` both
 * become `javascript:x` in the DOM. Then the browser discards ASCII
 * whitespace and control characters while parsing, so `java\nscript:`
 * reads as `javascript:` there. Both are undone here, in that order, before
 * the scheme is read.
 *
 * The unescaping mirrors the library's own, which it does not export.
 * Whitespace and the control category together cover more than a browser
 * strips, and the excess can only REFUSE an href a browser would have read as
 * a harmless relative path -- never admit one it would have run.
 */
export function destinationOf(href: string): string {
  return href
    .replace(/\\([!-/:-@[-`{-~])/g, "$1")
    .replace(/&#(\d+);/g, (_, codePoint: string) =>
      String.fromCodePoint(Number(codePoint))
    )
    .replace(/[\s\p{Cc}]+/gu, "");
}

/** Whether an href may become a link: a safe scheme, or no scheme at all. */
export function safeHref(href: string): boolean {
  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(destinationOf(href));
  if (!scheme) return true;
  return SAFE_SCHEMES.has(scheme[1].toLowerCase());
}

/**
 * Whether an href leaves this site, so its link opens a new tab and says so.
 *
 * Judged on the same normalised destination as {@link safeHref}: an allowed
 * address behind a leading control character is admitted by the guard and
 * leaves the site when clicked, so it must be classified as leaving.
 */
export function externalHref(href: string): boolean {
  return /^(https?:)?\/\//i.test(destinationOf(href));
}

/**
 * `LINK`, declining a match whose destination may not become a link.
 *
 * Wrapped rather than rewritten: the bracket-balancing and title parsing are
 * the library's, and the one decision added is whether to call it at all.
 */
const GUARDED_LINK: TextMatchTransformer = {
  ...LINK,
  replace: (textNode: TextNode, match: RegExpMatchArray) => {
    const [, , rawUrl] = match;
    if (rawUrl === undefined || !safeHref(rawUrl)) return;
    // `replace` is optional on the type; the library's own transformer always
    // defines it, and a version that stopped would make no links at all,
    // which is the safe direction.
    LINK.replace?.(textNode, match);
  },
};

/** The editor's transformers, with the link one guarded. */
export const TEXT_WIDGET_TRANSFORMERS: readonly Transformer[] =
  TRANSFORMERS.map(transformer =>
    transformer === LINK ? GUARDED_LINK : transformer
  );

/**
 * Open an external link in a new tab, and say so to the browser.
 *
 * Run once, after conversion, inside the same update that built the nodes.
 * `noopener` is what keeps a destination from reaching back into the admin
 * window; the `actions` archetype does the same for its external shortcuts,
 * and a link in prose is no less a link.
 */
export function $openExternalLinksInNewTab(): void {
  for (const node of $nodesOfType(LinkNode)) {
    if ($isLinkNode(node) && externalHref(node.getURL())) {
      node.setTarget("_blank");
      node.setRel("noopener noreferrer");
    }
  }
}

/**
 * The editor's theme, with headings at card scale.
 *
 * Same tokens, same classes for everything a card has room for; only the
 * heading scale differs, because a widget is a panel among panels rather than
 * a page, and a page-scale `h1` inside one reads as a mistake.
 */
export const TEXT_WIDGET_THEME = {
  ...RICH_TEXT_THEME,
  heading: {
    h1: "text-lg font-semibold mt-4 mb-2 first:mt-0",
    h2: "text-base font-semibold mt-3 mb-1.5 first:mt-0",
    h3: "text-sm font-semibold mt-3 mb-1 first:mt-0",
    h4: "text-sm font-medium mt-2 mb-1 first:mt-0",
    h5: "text-sm font-medium mt-2 mb-1 first:mt-0",
    h6: "text-sm font-medium mt-2 mb-1 first:mt-0",
  },
} as const;
