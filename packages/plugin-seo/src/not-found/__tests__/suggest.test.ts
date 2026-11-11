import { describe, expect, it } from "vitest";

import { closestPage } from "../suggest";

// A parent listed after its children, so a tie is decided by the rule and
// not by the order the addresses are read in.
const live = [
  "/",
  "/blog/jasper-vs-rext-ai",
  "/blog",
  "/blog/writesonic-vs-rext-ai",
  "/features/keyword-research",
  "/features/article-writer",
  "/pricing",
];

describe("the suggested To address for an address not found", () => {
  it.each([
    [
      "/blog/jasper-vs-rext-ai-which-ai-writing-platform-is-worth-your-investment",
      "/blog/jasper-vs-rext-ai",
    ],
    ["/features/keyword-research-tool", "/features/keyword-research"],
    ["/blog/feed.xml", "/blog"],
    ["/pricing-plans", "/pricing"],
    ["/blog/writesonic-review", "/blog/writesonic-vs-rext-ai"],
  ])("suggests the closest live page for %s", (asked, suggested) => {
    expect(closestPage(asked, live)).toBe(suggested);
  });

  it("suggests nothing where no live page shares a folder or a word", () => {
    expect(closestPage("/zzz", live)).toBeNull();
  });
});
