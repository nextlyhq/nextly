/**
 * A feed as RSS 2.0 (https://www.rssboard.org/rss-specification), written as
 * the W3C Feed Validation Service checks it: the channel's title, link and
 * description; an `atom:link rel="self"` naming the feed's own address; every
 * address whole; every date in RFC 822's form; each item's guid not a
 * permalink, so readers know it by its id whatever its address becomes; and
 * every value escaped, with any character XML 1.0 cannot hold taken out.
 *
 * Pure: the route gathers the items, and this writes them as given.
 *
 * @module feeds/rss
 */

/** One item as the feed writes it. */
export interface RssItem {
  title: string;
  /** Its page, whole. */
  link: string;
  /** What readers know it by, for good: never its address. */
  guid: string;
  /** When it was published, as a date. */
  published?: Date;
  /** A summary, as plain text. */
  description?: string;
  /** Who wrote it, by name: `dc:creator`, since RSS's own `author` must be an email. */
  author?: string;
  categories?: readonly string[];
}

/** The feed as a whole. */
export interface RssChannel {
  title: string;
  /** The page that lists what the feed holds, whole. */
  link: string;
  description: string;
  /** The feed's own address, whole. */
  self: string;
  /** Its language, as a language tag (`en`, `en-US`). */
  language?: string;
  /** When what it holds last changed: its newest item's date, never the time it was asked for. */
  lastBuilt?: Date;
  items: readonly RssItem[];
}

/**
 * `text` with every character XML 1.0 cannot hold taken out: the control
 * characters other than tab, line feed and carriage return, a half of a
 * surrogate pair standing alone, and U+FFFE and U+FFFF. One left in makes the
 * whole feed one no reader parses.
 */
function xmlCharacters(text: string): string {
  let kept = "";
  // By code point, so a surrogate pair is one character and a half of one
  // standing alone is seen as such.
  for (const character of text) {
    const code = character.codePointAt(0) ?? 0;
    const allowed =
      code === 0x9 ||
      code === 0xa ||
      code === 0xd ||
      (code >= 0x20 && code <= 0xd7ff) ||
      (code >= 0xe000 && code <= 0xfffd) ||
      code >= 0x10000;
    if (allowed) kept += character;
  }
  return kept;
}

/** `text` as an XML element's text or an attribute's value. */
function escaped(text: string): string {
  return xmlCharacters(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/**
 * Plain text as an item's description holds it: RSS reads a description as
 * HTML, so the text is first written as HTML that shows it as it is (`<b>`
 * shown as written, not made bold), then held in a CDATA section. A `]]>` in
 * it, which would end the section, is split across two.
 */
function htmlText(text: string): string {
  const html = xmlCharacters(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  return `<![CDATA[${html.replace(/]]>/g, "]]]]><![CDATA[>")}]]>`;
}

/** `text` on one line, its line breaks and runs of space made one space. */
const oneLine = (text: string): string => text.replace(/\s+/g, " ").trim();

/** A date in RFC 822's form, as RSS asks: `Wed, 26 Nov 2026 09:00:00 GMT`. */
export function rfc822(date: Date): string {
  return date.toUTCString();
}

/** One element on its own line, its text escaped; none where there is no text. */
function element(
  name: string,
  text: string | undefined,
  indent: string
): string[] {
  if (text === undefined || oneLine(text) === "") return [];
  return [`${indent}<${name}>${escaped(oneLine(text))}</${name}>`];
}

/** One item's lines. */
function itemLines(item: RssItem): string[] {
  const at = "    ";
  const inner = `${at}  `;
  const description =
    item.description === undefined || oneLine(item.description) === ""
      ? []
      : [
          `${inner}<description>${htmlText(oneLine(item.description))}</description>`,
        ];
  return [
    `${at}<item>`,
    ...element("title", item.title, inner),
    ...element("link", item.link, inner),
    `${inner}<guid isPermaLink="false">${escaped(item.guid)}</guid>`,
    ...(item.published === undefined
      ? []
      : [`${inner}<pubDate>${rfc822(item.published)}</pubDate>`]),
    ...description,
    ...element("dc:creator", item.author, inner),
    ...(item.categories ?? []).flatMap(category =>
      element("category", category, inner)
    ),
    `${at}</item>`,
  ];
}

/** The feed as RSS 2.0, ending in a newline. */
export function rssFeed(channel: RssChannel): string {
  const at = "  ";
  const inner = `${at}  `;
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom" xmlns:dc="http://purl.org/dc/elements/1.1/">',
    `${at}<channel>`,
    ...element("title", channel.title, inner),
    ...element("link", channel.link, inner),
    // Required: a feed with none is not RSS 2.0, so its title stands in.
    ...element(
      "description",
      oneLine(channel.description) === "" ? channel.title : channel.description,
      inner
    ),
    `${inner}<atom:link href="${escaped(channel.self)}" rel="self" type="application/rss+xml"/>`,
    ...element("language", channel.language, inner),
    ...(channel.lastBuilt === undefined
      ? []
      : [
          `${inner}<lastBuildDate>${rfc822(channel.lastBuilt)}</lastBuildDate>`,
        ]),
    ...channel.items.flatMap(itemLines),
    `${at}</channel>`,
    "</rss>",
    "",
  ].join("\n");
}
