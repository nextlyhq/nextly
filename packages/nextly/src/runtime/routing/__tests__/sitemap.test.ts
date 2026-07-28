import { describe, expect, it } from "vitest";

import { nextlySitemap } from "../sitemap";

describe("nextlySitemap", () => {
  it("maps the provider's entries to Next's sitemap shape", async () => {
    const sitemap = nextlySitemap({
      entries: () => [
        {
          url: "https://x.com/a",
          lastModified: "2026-01-02T00:00:00.000Z",
          changeFrequency: "daily",
          priority: 0.8,
          alternates: { languages: { en: "https://x.com/en/a" } },
        },
        { url: "https://x.com/b" },
      ],
    });

    expect(await sitemap()).toEqual([
      {
        url: "https://x.com/a",
        lastModified: "2026-01-02T00:00:00.000Z",
        changeFrequency: "daily",
        priority: 0.8,
        alternates: { languages: { en: "https://x.com/en/a" } },
      },
      { url: "https://x.com/b" },
    ]);
  });

  it("awaits an async provider and drops entries without a url", async () => {
    const sitemap = nextlySitemap({
      entries: async () => [
        { url: "https://x.com/a" },
        { url: "" },
        { url: "https://x.com/c" },
      ],
    });

    expect((await sitemap()).map(e => e.url)).toEqual([
      "https://x.com/a",
      "https://x.com/c",
    ]);
  });
});
