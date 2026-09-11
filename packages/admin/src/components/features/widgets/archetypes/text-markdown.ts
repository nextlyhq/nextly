/**
 * What a `text` widget's markdown may turn into, and what it may not.
 *
 * The parsing is Lexical's own: `$convertFromMarkdownString` with the editor's
 * transformers, so a heading, a list or an emphasis in a card is the same
 * node it is in the rich-text field. Two things are decided here rather than
 * left to the library.
 *
 * 🔴 A link's destination is judged before it becomes a link, and the link
 * is given the destination that was judged. `LINK.replace` creates a
 * `LinkNode` from the markdown's URL, so `[click](javascript:...)` would
 * arrive in the DOM as a link that runs code. The guarded transformer
 * declines the match instead, which leaves the markdown on screen as the
 * text it was written in -- a refusal the author can see, rather than a link
 * that quietly lost its destination. Scheme-bearing destinations are allowed
 * only for `http`, `https`, `mailto` and `tel`; a scheme-less one only when
 * the link node would render it as written, which is a path starting with
 * `/`, `.` or `#`. ASCII control characters and whitespace are stripped
 * before either is read, because browsers strip them when parsing, and
 * `java\nscript:` reads as no scheme here while reading as `javascript:`
 * there.
 *
 * Raw HTML needs no guard: no transformer parses it, so a `<script>` in the
 * markdown is a text node whose text is `<script>`.
 *
 * @module components/features/widgets/archetypes/text-markdown
 */

import { $isLinkNode, formatUrl, LinkNode } from "@lexical/link";
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

/** The most a decimal entity may name: past it, `String.fromCodePoint` throws. */
const LAST_CODE_POINT = 0x10ffff;

/**
 * The capture as `@lexical/markdown` unescapes it before creating the node,
 * or `undefined` where its unescaping would throw.
 *
 * Mirrors the library's own, which it does not export: a backslash before
 * ASCII punctuation is dropped, and a decimal entity is decoded. The one
 * difference is the entity no code point can hold -- `&#1114112;` and up --
 * which the library decodes by throwing. That throw happens inside the
 * conversion of the whole card, and an editor whose initial state threw
 * commits nothing, so one malformed link blanked every other line of prose.
 * Refused here, before the library is asked, the link stays text and the
 * card draws.
 */
function unescapedByMarkdown(raw: string): string | undefined {
  let representable = true;
  const unescaped = raw
    .replace(/\\([!-/:-@[-`{-~])/g, "$1")
    .replace(/&#(\d+);/g, (entity, codePoint: string) => {
      const value = Number(codePoint);
      if (value > LAST_CODE_POINT) {
        representable = false;
        return entity;
      }
      return String.fromCodePoint(value);
    });
  return representable ? unescaped : undefined;
}

/**
 * The destination a link written with `raw` will FOLLOW, or `undefined` when
 * it may not become a link.
 *
 * 🔴 Three transformations sit between the captured text and the `href` a
 * click follows, and a judgement made before any of them is a judgement of
 * a different string. The markdown transformer unescapes the capture, so
 * `javascript\:x` and `javascript&#58;x` both become `javascript:x`. The
 * browser discards ASCII whitespace and control characters while parsing,
 * so `java\nscript:` reads as `javascript:` there. And the link node
 * formats a scheme-less destination before rendering it: `posts?status=x`
 * becomes `https://posts?status=x`, `me@example.com` becomes a `mailto:`,
 * and only a path starting with `/`, `.` or `#` is left as written. Each is
 * applied here, in that order, and the scheme is read off the result.
 *
 * A destination the link node would REWRITE is refused rather than
 * admitted as what it becomes. `[posts](posts?status=draft)` reads as a
 * path on this site and would render as a link to a host called `posts`,
 * opening a new tab; leaving it as markdown is a refusal the author can
 * see, and `./posts?status=draft` says what they meant. Decided by asking
 * the node's own formatter whether it keeps the value, not by restating
 * which prefixes it keeps.
 *
 * Whitespace and the control category together cover more than a browser
 * strips, and the excess can only REFUSE a destination a browser would
 * have read as a harmless path -- never admit one it would have run.
 */
export function destinationOf(raw: string): string | undefined {
  const unescaped = unescapedByMarkdown(raw);
  if (unescaped === undefined) return undefined;
  const stripped = unescaped.replace(/[\s\p{Cc}]+/gu, "");
  if (stripped === "" || formatUrl(stripped) !== stripped) return undefined;
  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(stripped);
  if (scheme && !SAFE_SCHEMES.has(scheme[1].toLowerCase())) return undefined;
  return stripped;
}

/** Whether a link written with `raw` may become one. */
export function safeHref(raw: string): boolean {
  return destinationOf(raw) !== undefined;
}

/**
 * Whether a destination leaves this site, so its link opens a new tab and
 * says so.
 *
 * Asked of the destination a link was GIVEN -- what {@link destinationOf}
 * returned and the node carries -- so an allowed address written behind a
 * leading control character, admitted by the guard, is classified as
 * leaving and opens the way it was promised to.
 */
export function externalHref(destination: string): boolean {
  return /^(https?:)?\/\//i.test(destination);
}

/**
 * `LINK`, declining a match whose destination may not become a link, and
 * giving the link it makes the destination that was judged.
 *
 * Wrapped rather than rewritten: the bracket-balancing, the title parsing
 * and the node building are the library's. Two things are added -- whether
 * to call it at all, and the URL the node ends up with. The library builds
 * the node from the raw capture, so a control character the guard stripped
 * would otherwise reach the node and, being scheme-less to its formatter,
 * come out as `https://` prefixed to the whole address. The node the
 * library returns is the link's text; its parent is the link.
 */
const GUARDED_LINK: TextMatchTransformer = {
  ...LINK,
  replace: (textNode: TextNode, match: RegExpMatchArray) => {
    const [, , rawUrl] = match;
    const destination =
      rawUrl === undefined ? undefined : destinationOf(rawUrl);
    if (destination === undefined) return;
    // `replace` is optional on the type; the library's own transformer always
    // defines it, and a version that stopped would make no links at all,
    // which is the safe direction.
    const linkText = LINK.replace?.(textNode, match);
    const link = linkText?.getParent();
    if ($isLinkNode(link)) link.setURL(destination);
    return linkText;
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
