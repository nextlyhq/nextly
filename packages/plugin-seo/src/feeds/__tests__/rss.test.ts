// @vitest-environment jsdom
/**
 * A feed as RSS 2.0: written exactly as expected for a fixed set of items,
 * with text that must be escaped, text XML cannot hold and text that would
 * end a CDATA section; and valid by the W3C validator's rules, which are
 * shown to catch each kind of break they check for.
 */
import { describe, expect, it } from "vitest";

import { rfc822, rssFeed, type RssChannel } from "../rss";

import { rssProblems } from "./rss-rules";

const SELF = "https://acme.example/blog/feed.xml";

const channel: RssChannel = {
  title: "Acme & Co <blog>",
  link: "https://acme.example/blog",
  description: "Rockets, “fast” & far",
  self: SELF,
  language: "en",
  lastBuilt: new Date("2026-11-26T09:30:00Z"),
  items: [
    {
      title: "Ünïcödé 🚀 & <tags> ]]> too",
      link: "https://acme.example/blog/unicode?a=1&b=2",
      guid: "https://acme.example#posts:2",
      published: new Date("2026-11-26T09:00:00Z"),
      // A control character and a lone surrogate, which XML cannot hold.
      description: "Use <b>bold</b> & ]]> end\u0001 here \uD800now",
      author: "Zoë O'Brien",
      categories: ["News & notes", "Launch"],
    },
    {
      title: "Plain",
      link: "https://acme.example/blog/plain",
      guid: "https://acme.example#posts:1",
      published: new Date("2026-01-05T00:00:00Z"),
    },
  ],
};

const GOLDEN = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom" xmlns:dc="http://purl.org/dc/elements/1.1/">
  <channel>
    <title>Acme &amp; Co &lt;blog&gt;</title>
    <link>https://acme.example/blog</link>
    <description>Rockets, “fast” &amp; far</description>
    <atom:link href="https://acme.example/blog/feed.xml" rel="self" type="application/rss+xml"/>
    <language>en</language>
    <lastBuildDate>Thu, 26 Nov 2026 09:30:00 GMT</lastBuildDate>
    <item>
      <title>Ünïcödé 🚀 &amp; &lt;tags&gt; ]]&gt; too</title>
      <link>https://acme.example/blog/unicode?a=1&amp;b=2</link>
      <guid isPermaLink="false">https://acme.example#posts:2</guid>
      <pubDate>Thu, 26 Nov 2026 09:00:00 GMT</pubDate>
      <description><![CDATA[Use &lt;b&gt;bold&lt;/b&gt; &amp; ]]&gt; end here now]]></description>
      <dc:creator>Zoë O&apos;Brien</dc:creator>
      <category>News &amp; notes</category>
      <category>Launch</category>
    </item>
    <item>
      <title>Plain</title>
      <link>https://acme.example/blog/plain</link>
      <guid isPermaLink="false">https://acme.example#posts:1</guid>
      <pubDate>Mon, 05 Jan 2026 00:00:00 GMT</pubDate>
    </item>
  </channel>
</rss>
`;

/** The text of every element named `name` in `xml`, as a reader parses it. */
function texts(xml: string, name: string): string[] {
  const document = new DOMParser().parseFromString(xml, "application/xml");
  return [...document.getElementsByTagName(name)].map(
    element => element.textContent ?? ""
  );
}

describe("an RSS 2.0 feed", () => {
  it("is written exactly as expected for a fixed set of items", () => {
    expect(rssFeed(channel)).toBe(GOLDEN);
  });

  it("is valid by the W3C validator's rules", () => {
    expect(rssProblems(rssFeed(channel), SELF)).toEqual([]);
  });

  it("reads back as the text it was given, escaped once and nothing XML cannot hold", () => {
    const xml = rssFeed(channel);
    expect(texts(xml, "title")).toEqual([
      "Acme & Co <blog>",
      "Ünïcödé 🚀 & <tags> ]]> too",
      "Plain",
    ]);
    // A description is HTML to a reader: the text is shown as written,
    // never as markup.
    expect(texts(xml, "description")[1]).toBe(
      "Use &lt;b&gt;bold&lt;/b&gt; &amp; ]]&gt; end here now"
    );
    expect(texts(xml, "dc:creator")).toEqual(["Zoë O'Brien"]);
  });

  it("dates in RFC 822's form, in GMT", () => {
    expect(rfc822(new Date("2026-03-01T23:05:09+05:00"))).toBe(
      "Sun, 01 Mar 2026 18:05:09 GMT"
    );
  });

  it("gives an empty channel its title as the description RSS requires, and no build date", () => {
    const xml = rssFeed({
      ...channel,
      description: " ",
      items: [],
      lastBuilt: undefined,
    });
    expect(texts(xml, "description")).toEqual(["Acme & Co <blog>"]);
    expect(texts(xml, "lastBuildDate")).toEqual([]);
    expect(rssProblems(xml, SELF)).toEqual([]);
  });
});

describe("the validator's rules", () => {
  // Each break the rules check for, so an empty list from them means the
  // feed keeps them, not that they look at nothing.
  const valid = rssFeed(channel);

  it("catch a feed that is not well formed", () => {
    expect(rssProblems(valid.replace("&amp; Co", "& Co"), SELF)).toEqual([
      "NotWellFormed: the feed is not well-formed XML",
    ]);
  });

  it("catch a missing or wrong self link, an address that is not whole, a bad date and a repeated guid", () => {
    const broken = valid
      .replace(/ *<atom:link[^>]*\/>\n/, "")
      .replace(
        "<link>https://acme.example/blog/plain</link>",
        "<link>/blog/plain</link>"
      )
      .replace("Mon, 05 Jan 2026 00:00:00 GMT", "2026-01-05")
      .replace("#posts:1", "#posts:2");
    expect(rssProblems(broken, SELF)).toEqual([
      'MissingAtomSelfLink: channel has no atom:link rel="self"',
      'InvalidLink: item 1 "/blog/plain"',
      'DuplicateValue: item 1 guid "https://acme.example#posts:2"',
      'InvalidRFC2822Date: item 1 pubDate "2026-01-05"',
    ]);
    expect(rssProblems(valid, "https://acme.example/feed.xml")).toEqual([
      'SelfDoesntMatchLocation: "https://acme.example/blog/feed.xml" is not "https://acme.example/feed.xml"',
    ]);
  });

  it("catch a guid read as a permalink that is no address, and an element RSS does not define", () => {
    const broken = valid
      .replace(' isPermaLink="false">https://acme.example#posts:1', ">posts:1")
      .replace("<language>", "<lang>x</lang><language>");
    expect(rssProblems(broken, SELF)).toEqual([
      "UndefinedElement: channel <lang>",
      'InvalidPermalink: item 1 "posts:1"',
    ]);
  });
});
