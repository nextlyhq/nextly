/**
 * Each import source read on its own: the shapes of the files the other
 * tools write, the template variables of WordPress plugins, and where a
 * group's field names say their values go.
 */
import { describe, expect, it } from "vitest";

import { csvRows, readRankMathCsv } from "../csv";
import { suggestedTarget } from "../group";
import { readPayload } from "../payload";
import { fillTemplate, pathOfAddress } from "../records";
import { readYoast, wordPressItems } from "../wordpress";

const wxr = (items: string) =>
  `<?xml version="1.0"?><rss version="2.0" xmlns:wp="http://wordpress.org/export/1.2/"><channel>${items}</channel></rss>`;

describe("CSV rows", () => {
  it("reads quoted cells with commas, doubled quotes and line breaks", () => {
    expect(
      csvRows('a,b,c\r\n"x, y","say ""hi""","two\nlines"\r\n\r\n')
    ).toEqual([
      ["a", "b", "c"],
      ["x, y", 'say "hi"', "two\nlines"],
    ]);
  });

  it("drops a byte-order mark before the first header", () => {
    expect(csvRows("﻿seo_title\nA")[0]).toEqual(["seo_title"]);
  });
});

describe("Rank Math's CSV", () => {
  it("reads columns by name, robots words, and a redirect it can keep", () => {
    const parsed = readRankMathCsv(
      [
        "seo_score,slug,seo_title,robots,redirect_type,redirect_to,url",
        '70,old,"A, title","noindex,follow",302,/new,https://old.example/old/',
      ].join("\n")
    );
    expect(parsed.records).toEqual([
      {
        label: "old",
        match: { path: "/old", slug: "old" },
        values: { title: "A, title", hidden: true },
        variables: "rankMath",
        redirect: { target: "/new", permanent: false },
      },
    ]);
    expect(parsed.left).toEqual(["SEO score"]);
  });

  it("refuses a file with neither a title nor a description column", () => {
    expect(() => readRankMathCsv("id,slug\n1,a")).toThrow(
      /isn't a Rank Math CSV export/
    );
  });
});

describe("WordPress exports", () => {
  it("reads posts and pages, decoding text, and passes over what is not a page", () => {
    const items = wordPressItems(
      wxr(`
        <item><title>Fish &amp; chips</title><link>https://old.example/fish/</link>
          <wp:post_name><![CDATA[fish]]></wp:post_name><wp:post_type><![CDATA[post]]></wp:post_type>
          <wp:status><![CDATA[publish]]></wp:status></item>
        <item><title>Logo</title><wp:post_type><![CDATA[attachment]]></wp:post_type></item>
        <item><title>Binned</title><wp:status><![CDATA[trash]]></wp:status><wp:post_type><![CDATA[post]]></wp:post_type></item>
      `)
    );
    expect(items.map(item => item.title)).toEqual(["Fish & chips"]);
  });

  it("refuses a file that is not a WordPress export", () => {
    expect(() => wordPressItems("<html></html>")).toThrow(
      /isn't a WordPress export/
    );
  });

  it("matches a draft by its slug, since its link names only an id", () => {
    const parsed = readYoast(
      wxr(`<item><title>Draft</title><link>https://old.example/?p=12</link>
        <wp:post_name>draft</wp:post_name><wp:post_type>post</wp:post_type>
        <wp:postmeta><wp:meta_key>_yoast_wpseo_metadesc</wp:meta_key><wp:meta_value><![CDATA[Desc]]></wp:meta_value></wp:postmeta></item>`)
    );
    expect(parsed.records[0]?.match).toEqual({ slug: "draft" });
    expect(parsed.records[0]?.values).toEqual({ description: "Desc" });
  });

  it("reads Yoast's noindex as hidden, its explicit index as shown", () => {
    const meta = (value: string) =>
      `<wp:postmeta><wp:meta_key>_yoast_wpseo_meta-robots-noindex</wp:meta_key><wp:meta_value>${value}</wp:meta_value></wp:postmeta>`;
    const parsed = readYoast(
      wxr(
        `<item><title>A</title><wp:post_type>post</wp:post_type>${meta("1")}</item>` +
          `<item><title>B</title><wp:post_type>post</wp:post_type>${meta("2")}</item>` +
          `<item><title>C</title><wp:post_type>post</wp:post_type>${meta("0")}</item>`
      )
    );
    expect(parsed.records.map(record => record.values.hidden)).toEqual([
      true,
      false,
      undefined,
    ]);
  });
});

describe("template variables", () => {
  const values = { title: "Fish", siteName: "Acme", separator: "|" };

  it("fills Yoast's and Rank Math's spellings in", () => {
    expect(
      fillTemplate("%%title%% %%page%% %%sep%% %%sitename%%", "yoast", values)
    ).toBe("Fish | Acme");
    expect(fillTemplate("%title% %sep% %sitename%", "rankMath", values)).toBe(
      "Fish | Acme"
    );
  });

  it("leaves out a value naming a variable it can't fill", () => {
    expect(fillTemplate("%%title%% in %%category%%", "yoast", values)).toBe(
      undefined
    );
    expect(
      fillTemplate("%%sitename%%", "yoast", { separator: "|", title: "x" })
    ).toBe(undefined);
  });

  it("leaves plain text as it is", () => {
    expect(fillTemplate("100% sure", undefined, values)).toBe("100% sure");
  });
});

describe("addresses", () => {
  it("reads the path an address names, without its trailing slash", () => {
    expect(pathOfAddress("https://old.example/blog/caf%C3%A9/")).toBe(
      "/blog/café"
    );
    expect(pathOfAddress("https://old.example/")).toBe("/");
    expect(pathOfAddress("/about")).toBe("/about");
    expect(pathOfAddress("")).toBe(undefined);
  });
});

describe("Payload exports", () => {
  it("reads the language being imported from an export of every language", () => {
    const parsed = readPayload(
      JSON.stringify([
        {
          slug: { en: "pricing", de: "preise" },
          meta: {
            title: { en: "Pricing", de: "Preise" },
            image: { url: "https://cdn.example/a.png" },
          },
        },
      ]),
      "de"
    );
    expect(parsed.records[0]).toMatchObject({
      match: { slug: "preise" },
      values: { title: "Preise", image: { url: "https://cdn.example/a.png" } },
    });
    expect(parsed.warnings.join(" ")).toContain("only de is imported");
  });

  it("refuses text that is not JSON, or holds no documents", () => {
    expect(() => readPayload("nope", undefined)).toThrow(/isn't JSON/);
    expect(() => readPayload("{}", undefined)).toThrow(/holds no documents/);
  });
});

describe("where a group's field names say values go", () => {
  it("places Rext's meta-data fields", () => {
    expect(
      Object.fromEntries(
        [
          "seoTitle",
          "seoDescription",
          "ogImage",
          "ogImageAlt",
          "ogTitle",
          "ogDescription",
          "twitterTitle",
          "twitterImage",
          "twitterCard",
          "ogType",
          "articlePublishedTime",
          "keywords",
          "robotsIndex",
          "robotsFollow",
        ].map(name => [name, suggestedTarget(name)])
      )
    ).toEqual({
      seoTitle: "title",
      seoDescription: "description",
      ogImage: "image",
      ogImageAlt: "skip",
      ogTitle: "socialTitle",
      ogDescription: "socialDescription",
      twitterTitle: "skip",
      twitterImage: "skip",
      twitterCard: "skip",
      ogType: "skip",
      articlePublishedTime: "skip",
      keywords: "skip",
      robotsIndex: "shown",
      robotsFollow: "skip",
    });
  });

  it("places nextlyhq.com's seo fields", () => {
    expect(
      [
        "metaTitle",
        "metaDescription",
        "ogImage",
        "canonicalUrl",
        "noIndex",
      ].map(suggestedTarget)
    ).toEqual(["title", "description", "image", "canonical", "hidden"]);
  });
});
