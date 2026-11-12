/**
 * Which engine source a file read for each tool is, and the one notice a
 * file that can't be used gets: a WordPress export says whose values it
 * holds by its meta keys, and a file that is not the tool's export is
 * refused before it is sent.
 */
import { describe, expect, it } from "vitest";

import {
  isTooLarge,
  parsedIn,
  SENDABLE_LIMIT,
  tooMuchToSend,
  nothingIn,
  readSummary,
  sourceOfFile,
  tooLarge,
  wrongFile,
} from "../import-files";

/** A WordPress export holding `meta`, shaped as WordPress writes one. */
const wxr = (meta: string) =>
  `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:wp="http://wordpress.org/export/1.2/">
<channel><item><title>Pricing</title>
<wp:postmeta><wp:meta_key>${meta}</wp:meta_key><wp:meta_value>A title</wp:meta_value></wp:postmeta>
</item></channel></rss>`;

describe("a file read for a tool", () => {
  it("is Yoast's or Rank Math's WordPress export by the meta keys in it", () => {
    expect(sourceOfFile("wordpress", wxr("_yoast_wpseo_title"))).toBe("yoast");
    expect(sourceOfFile("wordpress", wxr("rank_math_title"))).toBe("rankMath");
  });

  it("is refused where it is not the tool's export", () => {
    expect(sourceOfFile("wordpress", "id,title\n1,Pricing")).toBeUndefined();
    expect(
      sourceOfFile("wordpress", "<html><body>not an export</body></html>")
    ).toBeUndefined();
    expect(sourceOfFile("rankMathCsv", wxr("rank_math_title"))).toBeUndefined();
    expect(sourceOfFile("rankMathCsv", "id,post_type\n1,page")).toBe(
      "rankMath"
    );
    expect(sourceOfFile("payload", "id,title")).toBeUndefined();
    expect(sourceOfFile("payload", '{"docs":[]}')).toBe("payload");
  });

  it("is too large past 50 MB", () => {
    expect(isTooLarge({ size: 50 * 1024 * 1024 })).toBe(false);
    expect(isTooLarge({ size: 50 * 1024 * 1024 + 1 })).toBe(true);
  });

  it("gets one notice, naming the file to choose instead", () => {
    expect(wrongFile("wordpress")).toEqual({
      title: "This isn't a WordPress export file",
      text: "Choose the .xml file WordPress made under Tools › Export.",
    });
    expect(tooLarge("payload").title).toBe("This file is larger than 50 MB");
    expect(nothingIn("rankMathCsv").title).toBe(
      "There are no SEO values in this file"
    );
  });

  it("says how much was read and how much holds values", () => {
    expect(
      readSummary("wordpress", {
        checked: 148,
        held: 96,
      } as Parameters<typeof readSummary>[1])
    ).toBe(
      "148 posts and pages read. 96 have Yoast or Rank Math values. Next, match them to your pages."
    );
  });
});

describe("a file read in the browser", () => {
  it("is read by the import's own readers, and refused in their words", () => {
    const read = parsedIn(
      "yoast",
      `<?xml version="1.0"?><rss xmlns:wp="http://wordpress.org/export/1.2/"><channel><item><title>Pricing</title><link>https://old.example/pricing/</link><wp:post_name>pricing</wp:post_name><wp:postmeta><wp:meta_key>_yoast_wpseo_metadesc</wp:meta_key><wp:meta_value>Plans and prices</wp:meta_value></wp:postmeta></item></channel></rss>`,
      "en"
    );
    expect("records" in read && read.records[0]?.values).toEqual({
      description: "Plans and prices",
    });
    expect(parsedIn("payload", "nope", "en")).toEqual({
      title: "This file can't be imported",
      text: "This isn't a Payload export: it isn't JSON.",
    });
  });

  it("is too much to send once its values pass what one request carries", () => {
    const record = (n: number) => ({
      label: `Page ${n}`,
      match: { slug: `page-${n}` },
      values: { description: "x".repeat(150) },
    });
    const parsed = (count: number) => ({
      records: Array.from({ length: count }, (_, n) => record(n)),
      from: {},
      left: [],
      warnings: [],
    });
    // About 210 bytes a record.
    const fits = Math.floor(SENDABLE_LIMIT / 260);
    expect(tooMuchToSend(parsed(fits))).toBe(false);
    expect(tooMuchToSend(parsed(fits * 2))).toBe(true);
  });
});

describe("whose values a WordPress export holds", () => {
  it("is read from its meta keys, not from page content naming another tool's", () => {
    const rankMath = `<?xml version="1.0"?><rss xmlns:wp="http://wordpress.org/export/1.2/"><channel><item>
<content:encoded><![CDATA[A tutorial on _yoast_wpseo_title and _yoast_wpseo_metadesc.]]></content:encoded>
<wp:postmeta><wp:meta_key><![CDATA[rank_math_title]]></wp:meta_key><wp:meta_value>T</wp:meta_value></wp:postmeta>
</item></channel></rss>`;
    expect(sourceOfFile("wordpress", rankMath)).toBe("rankMath");
  });
});
