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
 * there. And a web destination is admitted only where the browser's URL
 * parser sends a click where the written form says it goes, so a backslash
 * -- which the parser reads as a slash -- cannot turn a path on this site
 * into another site that opens in this tab.
 *
 * 🔴 A numeric character reference no code point can hold is decoded before
 * the library sees it, however it is escaped. The library decodes `&#N;` with
 * `String.fromCodePoint` in every text node, a link's title and its
 * destination alike, and past `0x10FFFF` that throws inside the conversion
 * of the whole card -- an editor whose initial state threw commits nothing,
 * so one such reference blanked every other line. It becomes U+FFFD here,
 * which is what a browser shows for the same reference, and the card draws
 * whole. A conversion that throws anyway draws the card's text as written.
 *
 * Raw HTML needs no guard: no transformer parses it, so a `<script>` in the
 * markdown is a text node whose text is `<script>`.
 *
 * @module components/features/widgets/archetypes/text-markdown
 */

import { $isLinkNode, formatUrl, LinkNode } from "@lexical/link";
import {
  $convertFromMarkdownString,
  LINK,
  TRANSFORMERS,
  type TextMatchTransformer,
  type Transformer,
} from "@lexical/markdown";
import {
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  $nodesOfType,
  type TextNode,
} from "lexical";

import { RICH_TEXT_THEME } from "@admin/components/features/entries/fields/special/rich-text-kit";

const SAFE_SCHEMES: ReadonlySet<string> = new Set([
  "http",
  "https",
  "mailto",
  "tel",
]);

/** The most a decimal entity may name: past it, `String.fromCodePoint` throws. */
const LAST_CODE_POINT = 0x10ffff;

/** What a browser shows for a numeric character reference outside Unicode. */
const REPLACEMENT_CHARACTER = "\uFFFD";

/**
 * A numeric reference as the library's DECODER will see it, or a markdown
 * escape pair, whichever starts here.
 *
 * The library drops a backslash before ASCII punctuation BEFORE it decodes
 * references, and `&`, `#` and `;` are all punctuation -- so `&\#1114112;`
 * and `&#1114112\;` reach its decoder as `&#1114112;`. The reference
 * alternative takes those optional backslashes into the match; the escape
 * alternative consumes every other pair whole, in the same left-to-right
 * scan, so a backslash that is itself escaped (`\\&#N;`) is read the way the
 * library reads it and never mistaken for the start of an escaped reference.
 */
const REFERENCE_OR_ESCAPE = /(\\?&\\?#(\d+)\\?;)|\\[!-/:-@[-`{-~]/g;

/**
 * `markdown` with every numeric character reference no code point can hold
 * replaced by U+FFFD, however it is escaped.
 *
 * HTML's own rule for the same reference: a character reference outside the
 * Unicode range is a parse error whose result is U+FFFD, so `&#1114112;` in a
 * card reads exactly as it would on a web page. The library decodes such a
 * reference by throwing instead, and it decodes every text node, a link's
 * title and a link's destination alike, inside the conversion of the whole
 * card; decoded here first, nothing it is handed can throw.
 */
export function representableMarkdown(markdown: string): string {
  return markdown.replace(
    REFERENCE_OR_ESCAPE,
    (match, reference: string | undefined, codePoint: string | undefined) =>
      reference !== undefined && Number(codePoint) > LAST_CODE_POINT
        ? REPLACEMENT_CHARACTER
        : match
  );
}

/**
 * The capture as `@lexical/markdown` unescapes it before creating the node.
 *
 * Mirrors the library's own, which it does not export: a backslash before
 * ASCII punctuation is dropped, and a decimal entity is decoded. Made
 * representable first, by the same rule the whole card is, so a destination
 * judged on its own decodes the way it will inside the conversion.
 */
function unescapedByMarkdown(raw: string): string {
  return representableMarkdown(raw)
    .replace(/\\([!-/:-@[-`{-~])/g, "$1")
    .replace(/&#(\d+);/g, (_, codePoint: string) =>
      String.fromCodePoint(Number(codePoint))
    );
}

/**
 * Two pages a destination is resolved against, as a browser resolves an
 * `href` against the page it is on: different schemes, hosts and paths, so a
 * reading that depends on the page comes out as two readings. `.invalid` is
 * reserved (RFC 2606), so no destination names either host.
 */
const PROBE_PAGES: readonly URL[] = [
  new URL("https://admin.nextly.invalid/admin/dashboard"),
  new URL("http://other.nextly.invalid/a/b/"),
];

/**
 * Whether the browser's URL parser takes a click on `destination` off the
 * site of the page it is on: one answer when every page agrees, `undefined`
 * when it depends on the page, or when the parser refuses the value.
 */
function browserLeavesSite(destination: string): boolean | undefined {
  const answers = PROBE_PAGES.map(page => {
    try {
      return new URL(destination, page).origin !== page.origin;
    } catch {
      return undefined;
    }
  });
  return answers.every(answer => answer === answers[0])
    ? answers[0]
    : undefined;
}

/**
 * The destination a link written with `raw` will FOLLOW, or `undefined` when
 * it may not become a link.
 *
 * 🔴 Four transformations sit between the captured text and the page a
 * click reaches, and a judgement made before any of them is a judgement of
 * a different string. The markdown transformer unescapes the capture, so
 * `javascript\:x` and `javascript&#58;x` both become `javascript:x`. The
 * browser discards ASCII whitespace and control characters while parsing,
 * so `java\nscript:` reads as `javascript:` there. The link node formats a
 * scheme-less destination before rendering it: `posts?status=x` becomes
 * `https://posts?status=x`, `me@example.com` becomes a `mailto:`, and only a
 * path starting with `/`, `.` or `#` is left as written. And the browser's
 * URL parser resolves what the node renders: for `http` and `https` it reads
 * a backslash as a slash, so `/\evil.example` -- a path, as written -- is
 * the host `evil.example`, and it reads `https:evil.example` as a path on an
 * `https` page and as a host on an `http` one.
 *
 * A destination any of them would REWRITE is refused rather than admitted as
 * what it becomes. `[posts](posts?status=draft)` reads as a path on this
 * site and would render as a link to a host called `posts`; leaving it as
 * markdown is a refusal the author can see, and `./posts?status=draft` says
 * what they meant. Decided by asking each transformation itself -- the node's
 * own formatter whether it keeps the value, the browser's parser where the
 * value goes -- not by restating which prefixes or characters they treat
 * specially. The last question is the one {@link externalHref} answers from
 * the written form, so a destination is admitted only where the two agree:
 * then the promise the written form makes -- a path stays on this site, an
 * address opens in a new tab -- is the one the click keeps.
 *
 * Whitespace and the control category together cover more than a browser
 * strips, and the excess can only REFUSE a destination a browser would
 * have read as a harmless path -- never admit one it would have run.
 */
export function destinationOf(raw: string): string | undefined {
  const stripped = unescapedByMarkdown(raw).replace(/[\s\p{Cc}]+/gu, "");
  if (stripped === "" || formatUrl(stripped) !== stripped) return undefined;
  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(stripped);
  if (scheme && !SAFE_SCHEMES.has(scheme[1].toLowerCase())) return undefined;
  // `mailto:` and `tel:` hand the address to another application; there is no
  // page they navigate to, so there is no site for them to leave.
  const navigates = !scheme || /^https?$/i.test(scheme[1]);
  if (navigates && browserLeavesSite(stripped) !== externalHref(stripped)) {
    return undefined;
  }
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
const TEXT_WIDGET_TRANSFORMERS: readonly Transformer[] = TRANSFORMERS.map(
  transformer => (transformer === LINK ? GUARDED_LINK : transformer)
);

/**
 * Open an external link in a new tab, and say so to the browser.
 *
 * Run once, after conversion, inside the same update that built the nodes.
 * `noopener` is what keeps a destination from reaching back into the admin
 * window; the `actions` archetype does the same for its external shortcuts,
 * and a link in prose is no less a link.
 */
function $openExternalLinksInNewTab(): void {
  for (const node of $nodesOfType(LinkNode)) {
    if ($isLinkNode(node) && externalHref(node.getURL())) {
      node.setTarget("_blank");
      node.setRel("noopener noreferrer");
    }
  }
}

/**
 * A card's markdown drawn as the text it was written in, one paragraph per
 * line.
 */
function $drawAsWritten(content: string): void {
  const root = $getRoot();
  root.clear();
  for (const line of content.split("\n")) {
    const paragraph = $createParagraphNode();
    if (line !== "") paragraph.append($createTextNode(line));
    root.append(paragraph);
  }
}

/**
 * Build a card's nodes from its markdown, inside an editor update.
 *
 * The ONE way a card's markdown becomes nodes, so no caller can hand the
 * library a card without the decoding the conversion depends on, or convert
 * without the link guard, or leave an external link opening in this tab.
 *
 * 🔴 And a conversion that throws draws the card's text as written rather
 * than nothing. An editor whose initial state threw commits an empty one, so
 * a single malformed construct the library cannot convert blanked every other
 * line of the card -- a numeric reference past Unicode did it three ways
 * before {@link representableMarkdown} closed each. That is decoding a known
 * input; this is the boundary for the next one nobody has met, and it says so
 * in the console where Lexical's own errors go.
 */
export function $importTextWidgetMarkdown(content: string): void {
  try {
    $convertFromMarkdownString(representableMarkdown(content), [
      ...TEXT_WIDGET_TRANSFORMERS,
    ]);
    $openExternalLinksInNewTab();
  } catch (error) {
    console.error(
      "[TextMarkdown] markdown conversion failed; drawing the text as written:",
      error
    );
    $drawAsWritten(content);
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
