/**
 * What Inspect shows from what the check answered: each crawler's line,
 * the notice for an address that isn't fetched or a fetch that stopped, in
 * its own words, and the Head table's values and where they come from.
 */
import { describe, expect, it } from "vitest";

import type {
  CrawlerKey,
  CrawlerResult,
  FetchStop,
  ReceivedAnswer,
  ReceivedCell,
  RowKey,
  StoredValues,
} from "../../received/contract";
import {
  crawlerLine,
  fetchNotice,
  heldText,
  originText,
  type Checked,
} from "../inspect-view";

const KEYS: CrawlerKey[] = [
  "googlebot",
  "bingbot",
  "facebook",
  "x",
  "linkedin",
  "ai",
];

const STORED: StoredValues = {
  title: "Introducing Nextly | Nextly Blog",
  image: {
    url: "https://nextlyhq.com/media/cover.svg",
    width: 1200,
    height: 630,
  },
  listed: true,
  followed: true,
  locale: "en_US",
  from: { title: { level: "pattern", pattern: "{Title} | {Site name} Blog" } },
};

/** Every cell of every row `cell`, except `key`'s title, which is `title`. */
function rowsWith(
  title: Partial<Record<CrawlerKey, ReceivedCell>>
): Checked["rows"] {
  const row = (): Record<CrawlerKey, ReceivedCell> =>
    Object.fromEntries(KEYS.map(key => [key, { kind: "same" }])) as Record<
      CrawlerKey,
      ReceivedCell
    >;
  const rows = Object.fromEntries(
    (
      [
        "title",
        "description",
        "canonical",
        "robots",
        "image",
        "locale",
        "siteName",
      ] as RowKey[]
    ).map(key => [key, row()])
  ) as Checked["rows"];
  rows.title = { ...rows.title, ...title };
  return rows;
}

const crawler = (key: CrawlerKey, extra: Partial<CrawlerResult> = {}) => ({
  key,
  name: key,
  status: 200,
  ms: 300,
  redirected: false,
  ...extra,
});

const checked = (extra: Partial<Checked> = {}): Checked => ({
  kind: "checked",
  address: "https://nextlyhq.com/blog/introducing-nextly",
  fetchedAt: "2026-11-12T18:00:00Z",
  aiCrawlers: "all",
  stored: STORED,
  crawlers: KEYS.map(key => crawler(key)),
  rows: rowsWith({}),
  differences: [],
  ...extra,
});

describe("each crawler's line", () => {
  it("matches, counts its differences, and says what robots.txt asks of AI crawlers", () => {
    const answer = checked({
      rows: rowsWith({
        x: { kind: "different", difference: 1 },
        googlebot: { kind: "different", difference: 2 },
      }),
      differences: [
        { number: 1, title: "X differs.", text: "" },
        // Expected: nothing to fix, so it isn't counted.
        { number: 2, title: "Google differs.", text: "", expected: true },
      ],
    });
    const line = (key: CrawlerKey) => crawlerLine(answer, crawler(key)).text;
    expect(line("x")).toBe("1 difference");
    expect(line("googlebot")).toBe("Matches");
    expect(line("ai")).toBe("Matches · allowed");
    expect(
      crawlerLine({ ...answer, aiCrawlers: "block" }, crawler("ai")).text
    ).toBe("Matches · blocked");
  });

  it("says a fetch that failed or was turned away", () => {
    expect(
      crawlerLine(
        checked(),
        crawler("bingbot", { failure: "x", reason: "too-slow" })
      )
    ).toEqual({ text: "Couldn't fetch", tone: "danger" });
    expect(
      crawlerLine(checked(), crawler("facebook", { status: 403 })).text
    ).toBe("Answered 403");
  });
});

describe("the notice for a page that wasn't fetched", () => {
  const refused = (reason: FetchStop): ReceivedAnswer => ({
    kind: "refused",
    address: "https://example.com/about",
    reason,
    message: "server words",
    site: "nextlyhq.com",
  });

  it("says an address outside the site isn't fetched, as the board words it", () => {
    expect(fetchNotice(refused("other-site"), "admin.local")).toEqual({
      kind: "not-fetched",
      text: "It points outside nextlyhq.com, so Inspect only shows what Nextly holds for it.",
    });
  });

  it("gives each other refusal its own words", () => {
    expect(fetchNotice(refused("port"), "")).toMatchObject({
      lead: "Uses an unusual port.",
      text: "Only the standard web ports (80 and 443) are fetched.",
    });
    expect(fetchNotice(refused("credentials"), "")).toMatchObject({
      lead: "Contains a username or password.",
      text: "Addresses with login details in them are never fetched.",
    });
    const stopped = (reason: FetchStop, redirected: boolean) =>
      checked({
        crawlers: KEYS.map(key =>
          crawler(key, { failure: "words", reason, redirected })
        ),
      });
    expect(fetchNotice(stopped("private", false), "")).toMatchObject({
      lead: "Leads to a private network address.",
      text: "For safety, Inspect never fetches addresses inside a private network.",
    });
    expect(fetchNotice(stopped("other-site", true), "")).toMatchObject({
      lead: "Redirects to another site.",
      text: "The page sent us to a different domain, so we stopped there.",
    });
  });

  it("says a fetch every crawler stopped at a limit couldn't fetch, naming the limits", () => {
    const answer = checked({
      crawlers: KEYS.map(key =>
        crawler(key, { failure: "words", reason: "too-slow" })
      ),
    });
    expect(fetchNotice(answer, "")).toEqual({
      kind: "failed",
      text: "It took longer than 10 seconds to answer. Nextly stops a fetch at 10 seconds, 5 MB or 5 redirects. What Nextly holds is still shown below.",
    });
  });

  it("leaves a fetch some crawlers received to its differences", () => {
    const answer = checked({
      crawlers: KEYS.map(key =>
        key === "x"
          ? crawler(key, { failure: "words", reason: "too-slow" })
          : crawler(key)
      ),
    });
    expect(fetchNotice(answer, "")).toBeUndefined();
  });
});

describe("the Head table", () => {
  it("writes what Nextly holds as the head serves it", () => {
    expect(heldText(STORED, "robots")).toBe("index, follow");
    expect(heldText({ ...STORED, listed: false }, "robots")).toBe(
      "noindex, follow"
    );
    expect(heldText(STORED, "image")).toBe("cover.svg · 1200 × 630");
    expect(heldText(STORED, "description")).toBe("None");
  });

  it("says where each value comes from", () => {
    expect(originText("title", STORED.from.title)).toBe(
      "Pattern: {Title} | {Site name} Blog"
    );
    expect(
      originText("description", { level: "content", field: "metaExcerpt" })
    ).toBe("The page’s meta excerpt");
    expect(originText("locale", undefined)).toBe("Site language");
    expect(originText("siteName", undefined)).toBe("Settings");
  });
});
