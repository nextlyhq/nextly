/**
 * What each crawler received, beside what Nextly holds for the page, with
 * every difference numbered once and explained in plain words.
 */
import { describe, expect, it } from "vitest";

import { compareReceived, type StoredHead } from "../compare";
import type { CrawlerKey } from "../contract";
import type { Fetched } from "../fetch";

const ADDRESS = "https://rext.ai/blog/surfer-seo-vs-rext-ai";

const STORED: StoredHead = {
  title: "Surfer SEO vs Rext AI: Which Fits? | Rext AI",
  description: "Surfer scores a draft. Rext AI writes it.",
  cardTitle: "Surfer SEO vs Rext AI: Which Fits?",
  cardDescription: "Surfer scores a draft. Rext AI writes it.",
  image: { url: "https://rext.ai/media/share.jpg", width: 1200, height: 630 },
  canonical: ADDRESS,
  listed: true,
  locale: "en_US",
  siteName: "Rext AI",
};

/** The page as Nextly would serve it, with `change` made to its head. */
function page(
  change: (head: Record<string, string>) => void = () => {}
): string {
  const head: Record<string, string> = {
    title: STORED.title ?? "",
    description: STORED.description ?? "",
    canonical: "/blog/surfer-seo-vs-rext-ai",
    "og:title": STORED.cardTitle ?? "",
    "og:description": STORED.cardDescription ?? "",
    "og:image": "https://rext.ai/media/share.jpg",
    "twitter:title": STORED.cardTitle ?? "",
    "twitter:image": "https://rext.ai/media/share.jpg",
    "og:locale": "en_US",
    "og:site_name": "Rext AI",
  };
  change(head);
  const meta = (name: string) =>
    head[name] === undefined
      ? ""
      : `<meta ${name.startsWith("og:") ? "property" : "name"}="${name}" content="${head[name]}">`;
  return [
    head.title === undefined ? "" : `<title>${head.title}</title>`,
    meta("description"),
    meta("robots"),
    head.canonical === undefined
      ? ""
      : `<link rel="canonical" href="${head.canonical}">`,
    meta("og:title"),
    meta("og:description"),
    meta("og:image"),
    meta("twitter:title"),
    meta("twitter:image"),
    meta("og:locale"),
    meta("og:site_name"),
  ].join("");
}

function received(
  html: string,
  extra: { status?: number; headers?: Record<string, string> } = {}
): Fetched {
  return {
    kind: "received",
    status: extra.status ?? 200,
    url: ADDRESS,
    redirects: [],
    headers: extra.headers ?? {},
    html,
    ms: 400,
  };
}

/** Every crawler received `html`, except where `by` says otherwise. */
function everyone(
  html: string,
  by: Partial<Record<CrawlerKey, Fetched>> = {}
): Record<CrawlerKey, Fetched> {
  return {
    googlebot: by.googlebot ?? received(html),
    bingbot: by.bingbot ?? received(html),
    facebook: by.facebook ?? received(html),
    x: by.x ?? received(html),
    linkedin: by.linkedin ?? received(html),
    ai: by.ai ?? received(html),
  };
}

describe("comparing what crawlers received with what Nextly holds", () => {
  it("finds no difference where every crawler received what Nextly holds", () => {
    const compared = compareReceived({
      address: ADDRESS,
      stored: STORED,
      fetched: everyone(page()),
    });
    expect(compared.differences).toEqual([]);
    // Search engines and AI crawlers read the page's own title; the networks
    // read the card's.
    expect(compared.rows.title).toEqual({
      googlebot: { kind: "same" },
      bingbot: { kind: "same" },
      facebook: { kind: "same", note: "without “| Rext AI”" },
      x: { kind: "same", note: "X doesn't display it" },
      linkedin: { kind: "same", note: "without “| Rext AI”" },
      ai: { kind: "same" },
    });
    expect(compared.rows.description.x).toEqual({
      kind: "same",
      note: "X doesn't display it",
    });
    // A relative official address is read where the page was served.
    expect(compared.rows.canonical.googlebot).toEqual({ kind: "same" });
    expect(compared.rows.robots).toEqual({
      googlebot: { kind: "same" },
      bingbot: { kind: "not-used" },
      facebook: { kind: "not-used" },
      x: { kind: "not-used" },
      linkedin: { kind: "not-used" },
      ai: { kind: "not-used" },
    });
    // The card's language and site name are the networks' alone.
    expect(compared.rows.locale.googlebot).toEqual({ kind: "not-used" });
    expect(compared.rows.locale.facebook).toEqual({ kind: "same" });
    expect(compared.rows.siteName.linkedin).toEqual({ kind: "same" });
    expect(compared.crawlers.map(crawler => crawler.name)).toEqual([
      "Google",
      "Bing",
      "Facebook",
      "X",
      "LinkedIn",
      "AI crawlers",
    ]);
    expect(compared.crawlers[0]).toEqual({
      key: "googlebot",
      name: "Google",
      status: 200,
      ms: 400,
      redirected: false,
    });
  });

  it("numbers one difference every crawler shares once, and explains it", () => {
    const compared = compareReceived({
      address: ADDRESS,
      stored: STORED,
      fetched: everyone(
        page(head => {
          delete head.description;
          delete head["og:description"];
        })
      ),
    });
    expect(compared.differences).toHaveLength(1);
    expect(compared.differences[0]).toMatchObject({
      number: 1,
      title:
        "Google, Bing, Facebook, X, LinkedIn and AI crawlers received no description.",
      text: "Nextly holds “Surfer scores a draft. Rext AI writes it.”, but the page's head has none. The page's route may not build its head from Nextly. Once it's fixed, LinkedIn keeps its old card for about a week; its Post Inspector refreshes it.",
    });
    for (const key of [
      "googlebot",
      "bingbot",
      "facebook",
      "x",
      "linkedin",
      "ai",
    ] as const) {
      expect(compared.rows.description[key]).toEqual({
        kind: "different",
        difference: 1,
      });
    }
  });

  it("says a different title came from a copy the host saved before the change", () => {
    const compared = compareReceived({
      address: ADDRESS,
      stored: STORED,
      fetched: everyone(page(), {
        googlebot: received(
          page(head => (head.title = "Old title | Rext AI")),
          {
            headers: { age: "300" },
          }
        ),
      }),
    });
    expect(compared.rows.title.googlebot).toEqual({
      kind: "different",
      difference: 1,
      received: "Old title | Rext AI",
    });
    expect(compared.differences).toEqual([
      {
        number: 1,
        // A saved copy is replaced in its own time: nothing to fix.
        expected: true,
        title: "Google received a different title.",
        text: "Nextly holds “Surfer SEO vs Rext AI: Which Fits? | Rext AI”; the page served “Old title | Rext AI”. The host served a copy it saved 5 minutes ago, before the last change. It's replaced when that copy expires or the page is published again.",
      },
    ]);
  });

  it("names the route or the site's layout where nothing was cached", () => {
    const compared = compareReceived({
      address: ADDRESS,
      stored: STORED,
      fetched: everyone(page(), {
        googlebot: received(page(head => (head.title = "Changed"))),
      }),
    });
    expect(compared.differences[0]?.text).toBe(
      "Nextly holds “Surfer SEO vs Rext AI: Which Fits? | Rext AI”; the page served “Changed”. The page's route sets its own, or a title template in the site's layout changes it."
    );
  });

  it("explains a crawler turned away, and shows none of its values", () => {
    const compared = compareReceived({
      address: ADDRESS,
      stored: STORED,
      fetched: everyone(page(), {
        linkedin: received("<title>Blocked</title>", { status: 403 }),
      }),
    });
    expect(compared.crawlers[4]).toMatchObject({
      key: "linkedin",
      status: 403,
      difference: 1,
    });
    expect(compared.rows.title.linkedin).toEqual({ kind: "none" });
    expect(compared.differences).toEqual([
      {
        number: 1,
        title: "LinkedIn was answered 403.",
        text: "The site, or a firewall in front of it, turned the crawler away, so it saw none of the page's values. Let LinkedIn through in the firewall or bot protection.",
      },
    ]);
  });

  it("explains a fetch that was stopped or refused in its own words", () => {
    const failed: Fetched = {
      kind: "failed",
      reason: "other-site",
      message:
        "It redirected to https://evil.example/. That address is on another site, evil.example. Only rext.ai addresses can be checked.",
      redirects: ["https://evil.example/"],
      ms: 120,
    };
    const compared = compareReceived({
      address: ADDRESS,
      stored: STORED,
      fetched: everyone(page(), { x: failed }),
    });
    expect(compared.crawlers[3]).toMatchObject({
      key: "x",
      redirected: true,
      failure: failed.message,
      reason: "other-site",
      difference: 1,
    });
    expect(compared.differences[0]).toEqual({
      number: 1,
      title: "X received nothing.",
      text: failed.message,
    });
  });

  it("finds a noindex Googlebot was sent in a header", () => {
    const compared = compareReceived({
      address: ADDRESS,
      stored: STORED,
      fetched: everyone(page(), {
        googlebot: received(page(), {
          headers: { "x-robots-tag": "otherbot: index, googlebot: noindex" },
        }),
      }),
    });
    expect(compared.rows.robots.googlebot).toEqual({
      kind: "different",
      difference: 1,
      received: "noindex, follow",
    });
    expect(compared.differences[0]).toMatchObject({
      title: "Googlebot was told not to list this page.",
      text: "Nextly lists it, but the X-Robots-Tag header said noindex. The site's host or a proxy in front of it adds that header; remove it for this address.",
    });
  });

  it("reads a rule in a robots header of its own as one for every crawler", () => {
    const compared = compareReceived({
      address: ADDRESS,
      stored: STORED,
      fetched: everyone(page(), {
        googlebot: received(page(), {
          headers: { "x-robots-tag": "bingbot: noindex\nnoindex" },
        }),
      }),
    });
    expect(compared.rows.robots.googlebot).toMatchObject({
      kind: "different",
      received: "noindex, follow",
    });
  });

  it("says a value worked out automatically may be set by the page's design or route", () => {
    const compared = compareReceived({
      address: ADDRESS,
      stored: { ...STORED, automatic: { title: true } },
      fetched: everyone(page(), {
        googlebot: received(page(head => (head.title = "From the design"))),
      }),
    });
    expect(compared.differences[0]).toMatchObject({
      expected: true,
      title: "Google received a different title.",
      text: "Nextly's automatic title is “Surfer SEO vs Rext AI: Which Fits? | Rext AI”; the page served “From the design”. A Page Builder design or the page's route can set the title, and theirs wins over the automatic one, so this is expected where the page sets its own.",
    });
  });

  it("reads a noindex meant for another crawler as no noindex", () => {
    const compared = compareReceived({
      address: ADDRESS,
      stored: STORED,
      fetched: everyone(page(), {
        googlebot: received(page(), {
          headers: { "x-robots-tag": "bingbot: noindex" },
        }),
      }),
    });
    expect(compared.rows.robots.googlebot).toEqual({ kind: "same" });
  });

  it("finds a noindex in the page's tag, and a page Nextly hides that has none", () => {
    const tagged = compareReceived({
      address: ADDRESS,
      stored: STORED,
      fetched: everyone(page(head => (head.robots = "noindex, follow"))),
    });
    expect(tagged.differences[0]?.text).toBe(
      "Nextly lists it, but the page's robots tag said noindex. The page's route or the site's layout sets that tag."
    );
    const hidden = compareReceived({
      address: ADDRESS,
      stored: { ...STORED, listed: false },
      fetched: everyone(page()),
    });
    expect(hidden.differences[0]).toMatchObject({
      title: "Googlebot wasn't told to keep this page out of search.",
    });
  });

  it("offers LinkedIn's Post Inspector where LinkedIn received a different image", () => {
    const compared = compareReceived({
      address: ADDRESS,
      stored: STORED,
      fetched: everyone(page(), {
        linkedin: received(
          page(
            head => (head["og:image"] = "https://rext.ai/opengraph-image.png")
          )
        ),
      }),
    });
    expect(compared.rows.image.linkedin).toEqual({
      kind: "different",
      difference: 1,
      received: "opengraph-image.png",
    });
    expect(compared.differences[0]).toEqual({
      number: 1,
      title: "LinkedIn received a different share image.",
      text: "Nextly holds share.jpg; the page served opengraph-image.png. An image file named opengraph-image or twitter-image beside the page's route replaces the one Nextly holds. Once it's fixed, LinkedIn keeps its old card for about a week; its Post Inspector refreshes it.",
      action: {
        label: "Open LinkedIn Post Inspector",
        href: "https://www.linkedin.com/post-inspector/inspect/https%3A%2F%2Frext.ai%2Fblog%2Fsurfer-seo-vs-rext-ai",
      },
    });
  });

  it("shows what was received, and compares nothing, where Nextly holds no page", () => {
    const compared = compareReceived({
      address: ADDRESS,
      fetched: everyone(page()),
    });
    expect(compared.differences).toEqual([]);
    expect(compared.rows.title.googlebot).toEqual({
      kind: "received",
      received: "Surfer SEO vs Rext AI: Which Fits? | Rext AI",
    });
    expect(compared.rows.robots.googlebot).toEqual({
      kind: "received",
      received: "index, follow",
    });
    expect(compared.rows.robots.facebook).toEqual({ kind: "not-used" });
  });

  it("says the networks show no picture for a share image they don't display, served as Nextly holds it", () => {
    const svg = "https://rext.ai/media/cover.svg";
    const compared = compareReceived({
      address: ADDRESS,
      editHref: "/admin/collections/posts/7?tab=nextlyhq-plugin-seo.tab",
      stored: { ...STORED, image: { url: svg, width: 1200, height: 630 } },
      fetched: everyone(
        page(head => {
          head["og:image"] = svg;
          head["twitter:image"] = svg;
        })
      ),
    });
    // Search engines read the image as it is; every network's card shows none.
    expect(compared.rows.image.googlebot).toEqual({ kind: "same" });
    expect(compared.rows.image.linkedin).toEqual({
      kind: "different",
      difference: 1,
      received: "No picture shown: LinkedIn doesn't display SVG",
    });
    expect(compared.differences).toEqual([
      {
        number: 1,
        title: "Facebook, X and LinkedIn show no picture for this page.",
        text: "Its share image is an SVG, which they don't display, so the card appears with text only.",
        action: {
          label: "Make a share image",
          href: "/admin/collections/posts/7?tab=nextlyhq-plugin-seo.tab",
        },
      },
    ]);
  });

  it("finds a card stating another language than Nextly's", () => {
    const compared = compareReceived({
      address: ADDRESS,
      stored: STORED,
      fetched: everyone(page(head => (head["og:locale"] = "en_GB"))),
    });
    expect(compared.rows.locale.x).toEqual({
      kind: "different",
      difference: 1,
      received: "en_GB",
    });
    expect(compared.differences[0]).toMatchObject({
      title: "Facebook, X and LinkedIn received another language.",
      text: "Nextly holds en_US; the page stated en_GB. The page's route or the site's layout sets its own.",
    });
  });

  it("judges a card's title by where the card's own title comes from, not the page's", () => {
    const compared = compareReceived({
      address: ADDRESS,
      // The page's title is automatic; the card's was typed for it.
      stored: { ...STORED, automatic: { title: true, cardTitle: false } },
      fetched: everyone(page(), {
        x: received(page(head => (head["twitter:title"] = "Something else"))),
      }),
    });
    expect(compared.differences[0]).toMatchObject({
      title: "X received a different title.",
    });
    expect(compared.differences[0]?.expected).toBeUndefined();
  });

  it("says the networks show no picture for a share image the route swapped for one they don't display", () => {
    const svg = "https://rext.ai/opengraph-image.svg";
    const compared = compareReceived({
      address: ADDRESS,
      // Nextly's PNG is automatic; the route serves an SVG instead.
      stored: { ...STORED, automatic: { image: true } },
      fetched: everyone(
        page(head => {
          head["og:image"] = svg;
          head["twitter:image"] = svg;
        })
      ),
    });
    expect(compared.rows.image.facebook).toEqual({
      kind: "different",
      difference: expect.any(Number),
      received: "No picture shown: Facebook doesn't display SVG",
    });
    const missing = compared.differences.find(difference =>
      difference.title.includes("show no picture")
    );
    expect(missing?.expected).toBeUndefined();
  });

  it("finds links Google was told not to follow, though the page is listed", () => {
    const compared = compareReceived({
      address: ADDRESS,
      stored: STORED,
      fetched: everyone(page(head => (head.robots = "index, nofollow"))),
    });
    expect(compared.rows.robots.googlebot).toEqual({
      kind: "different",
      difference: 1,
      received: "index, nofollow",
    });
    expect(compared.differences[0]).toMatchObject({
      title: "Googlebot was told not to follow this page's links.",
    });
  });
});
