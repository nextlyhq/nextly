import { getPathMatch } from "next/dist/shared/lib/router/utils/path-match.js";
import { describe, expect, it } from "vitest";

import { withNextly } from "../next";

type Rewrite = { source: string; destination: string };
type Rewrites = {
  beforeFiles: Rewrite[];
  afterFiles: Rewrite[];
  fallback: Rewrite[];
};

/** The rewrites `withNextly` gives a config, resolved as Next resolves them. */
async function rewritesOf(config: Record<string, unknown>): Promise<Rewrites> {
  const rewrites = config.rewrites as (() => Promise<unknown>) | undefined;
  if (rewrites === undefined) throw new Error("no rewrites");
  // As Next calls it: as a method of the config.
  return (await rewrites.call(config)) as Rewrites;
}

const sources = (rules: Rewrite[]) => rules.map(rule => rule.source);

/** The source of the IndexNow key file's rewrite. */
const KEY_FILE = "/:key([0-9a-f]{32}).txt";

/** The sources of the feed files' rewrites. */
const FEED_FILES = ["/feed.xml", "/:section/feed.xml"];

/** The sources of a folder's own llms files' rewrites. */
const FOLDER_LLMS_FILES = ["/:section/llms.txt", "/:section/llms-full.txt"];

describe("withNextly serves the site's root files from plugins", () => {
  it("rewrites robots.txt, sitemap.xml, llms.txt and llms-full.txt to the API handler, after the site's own files", async () => {
    const { afterFiles, beforeFiles, fallback } = await rewritesOf(
      withNextly({})
    );

    expect(afterFiles).toEqual([
      { source: "/robots.txt", destination: "/admin/api/robots.txt" },
      { source: "/sitemap.xml", destination: "/admin/api/sitemap.xml" },
      { source: "/llms.txt", destination: "/admin/api/llms.txt" },
      { source: "/llms-full.txt", destination: "/admin/api/llms-full.txt" },
      {
        source: "/:key([0-9a-f]{32}).txt",
        destination: "/admin/api/indexnow-key/:key",
      },
      { source: "/feed.xml", destination: "/admin/api/feed-files/feed.xml" },
      {
        source: "/:section/feed.xml",
        destination: "/admin/api/feed-files/:section/feed.xml",
      },
      {
        source: "/:section/llms.txt",
        destination: "/admin/api/llms-files/:section/llms.txt",
      },
      {
        source: "/:section/llms-full.txt",
        destination: "/admin/api/llms-files/:section/llms-full.txt",
      },
    ]);
    expect(beforeFiles).toEqual([]);
    expect(fallback).toEqual([]);
  });

  it("serves them from the handler the app mounts, and more files when named", async () => {
    const { afterFiles } = await rewritesOf(
      withNextly({}, { apiRoute: "/cms/api", rootFiles: ["/humans.txt"] })
    );

    expect(afterFiles).toContainEqual({
      source: "/humans.txt",
      destination: "/cms/api/humans.txt",
    });
    expect(afterFiles).toContainEqual({
      source: "/robots.txt",
      destination: "/cms/api/robots.txt",
    });
  });

  it("keeps the site's own rewrites first, in either shape", async () => {
    const own = { source: "/old", destination: "/new" };

    const fromList = await rewritesOf(
      withNextly({ rewrites: async () => [own] })
    );
    expect(fromList.afterFiles[0]).toEqual(own);

    const fromPhases = await rewritesOf(
      withNextly({
        rewrites: async () => ({
          beforeFiles: [own],
          afterFiles: [own],
          fallback: [own],
        }),
      })
    );
    expect(fromPhases.beforeFiles).toEqual([own]);
    expect(fromPhases.afterFiles[0]).toEqual(own);
    expect(fromPhases.afterFiles).toHaveLength(10);
    expect(fromPhases.fallback).toEqual([own]);
  });

  it("leaves a root file the site rewrites itself, in any phase, to the site", async () => {
    const theirs = { source: "/robots.txt", destination: "/api/robots" };

    const { afterFiles, fallback } = await rewritesOf(
      withNextly({ rewrites: async () => ({ fallback: [theirs] }) })
    );

    // Next asks afterFiles before fallback: an entry of ours would win.
    expect(sources(afterFiles)).not.toContain("/robots.txt");
    expect(sources(afterFiles)).toEqual([
      "/sitemap.xml",
      "/llms.txt",
      "/llms-full.txt",
      KEY_FILE,
      ...FEED_FILES,
      ...FOLDER_LLMS_FILES,
    ]);
    expect(fallback).toEqual([theirs]);
  });

  it("leaves to the site every root file a pattern of its own matches", async () => {
    // A site passing everything it does not serve on to an older one.
    const legacy = {
      source: "/:path*",
      destination: "https://legacy.example.com/:path*",
    };
    const blog = { source: "/blog/:slug", destination: "/posts/:slug" };

    const { afterFiles } = await rewritesOf(
      withNextly({ rewrites: async () => ({ fallback: [blog, legacy] }) })
    );
    expect(sources(afterFiles)).toEqual([]);

    // A pattern that cannot match a root file leaves them to the plugins,
    // one starting with a parameter included: Next's own matcher decides.
    const feeds = { source: "/:slug/feed.xml", destination: "/feeds/:slug" };
    const onlyBlog = await rewritesOf(
      withNextly({ rewrites: async () => ({ fallback: [blog, feeds] }) })
    );
    expect(sources(onlyBlog.afterFiles)).toEqual([
      "/robots.txt",
      "/sitemap.xml",
      "/llms.txt",
      "/llms-full.txt",
      KEY_FILE,
      // The site's own feed pattern keeps a folder's feed.xml; the root's is
      // not one it matches.
      "/feed.xml",
      // Its blog rule keeps the blog folder's llms files; every other
      // folder's reaches the plugins.
      "/:section((?:(?!(?:blog)/)[^/]+))/llms.txt",
      "/:section((?:(?!(?:blog)/)[^/]+))/llms-full.txt",
    ]);
  });

  it("calls the site's own rewrites as a method of its config", async () => {
    const config = {
      basePath: "/docs",
      async rewrites(this: { basePath: string }) {
        return [{ source: "/old", destination: `${this.basePath}/new` }];
      },
    };

    const { afterFiles } = await rewritesOf(withNextly(config));

    expect(afterFiles[0]).toEqual({ source: "/old", destination: "/docs/new" });
  });
});

describe("withNextly serves the IndexNow key file without the Proxy", () => {
  // A file name as IndexNow keys take: 32 hex characters.
  const name = "0123456789abcdef".repeat(2);

  it("rewrites a key's address at the root to the handler's key route, as Next matches it", async () => {
    const { afterFiles } = await rewritesOf(
      withNextly({}, { apiRoute: "/cms/api" })
    );
    const rule = afterFiles.find(each => each.source === KEY_FILE);
    expect(rule?.destination).toBe("/cms/api/indexnow-key/:key");

    // Next's own matcher, so the source matches exactly where Next applies
    // it: a 32-character hex name ending in .txt at the root, and nothing
    // else. Next matches without regard to case; the route answers only the
    // stored key, as it is spelled.
    const match = getPathMatch(KEY_FILE);
    expect(match(`/${name}.txt`)).toEqual({ key: name });
    expect(match("/robots.txt")).toBe(false);
    expect(match(`/${name}0.txt`)).toBe(false);
    expect(match(`/blog/${name}.txt`)).toBe(false);
  });

  it("leaves the key file to a site that rewrites such an address itself", async () => {
    const theirs = { source: "/:file.txt", destination: "/api/text/:file" };

    const { afterFiles } = await rewritesOf(
      withNextly({ rewrites: async () => ({ fallback: [theirs] }) })
    );

    expect(sources(afterFiles)).not.toContain(KEY_FILE);
  });
});

describe("withNextly serves feed files from plugins", () => {
  it("rewrites feed.xml at the root and in one folder to the handler's feed routes, as Next matches them", async () => {
    const { afterFiles } = await rewritesOf(
      withNextly({}, { apiRoute: "/cms/api" })
    );
    expect(afterFiles).toContainEqual({
      source: "/feed.xml",
      destination: "/cms/api/feed-files/feed.xml",
    });
    expect(afterFiles).toContainEqual({
      source: "/:section/feed.xml",
      destination: "/cms/api/feed-files/:section/feed.xml",
    });

    // Next's own matcher: one folder deep and no deeper, and only feed.xml.
    const inFolder = getPathMatch("/:section/feed.xml");
    expect(inFolder("/blog/feed.xml")).toEqual({ section: "blog" });
    expect(inFolder("/blog/2026/feed.xml")).toBe(false);
    expect(inFolder("/blog/rss.xml")).toBe(false);
    expect(getPathMatch("/feed.xml")("/feed.xml")).toEqual({});
  });

  it("leaves each feed address to a site that rewrites it itself, and all of them when turned off", async () => {
    const theirs = { source: "/:slug/feed.xml", destination: "/feeds/:slug" };
    const kept = await rewritesOf(
      withNextly({ rewrites: async () => ({ fallback: [theirs] }) })
    );
    expect(sources(kept.afterFiles)).toContain("/feed.xml");
    expect(sources(kept.afterFiles)).not.toContain("/:section/feed.xml");

    const off = await rewritesOf(withNextly({}, { feedFiles: false }));
    expect(sources(off.afterFiles)).not.toContain("/feed.xml");
    expect(sources(off.afterFiles)).not.toContain("/:section/feed.xml");
    expect(sources(off.afterFiles)).toContain("/sitemap.xml");
  });

  it("leaves a folder's feed to a site that rewrites that folder's address itself, in any phase, and serves every other folder's", async () => {
    const theirs = [
      { source: "/blog/feed.xml", destination: "/legacy/blog-feed" },
      { source: "/news.v2/:path*", destination: "https://old.example/:path*" },
    ];
    const { afterFiles } = await rewritesOf(
      withNextly({ rewrites: async () => ({ fallback: theirs }) })
    );
    const section = afterFiles.find(rule =>
      rule.destination.endsWith("/feed-files/:section/feed.xml")
    );
    expect(section?.destination).toBe(
      "/admin/api/feed-files/:section/feed.xml"
    );
    // As Next matches it: ours is asked before the site's fallback, so it
    // must not match the folders the site rewrites.
    const ours = getPathMatch(section?.source ?? "");
    expect(ours("/blog/feed.xml")).toBe(false);
    expect(ours("/news.v2/feed.xml")).toBe(false);
    expect(ours("/docs/feed.xml")).toEqual({ section: "docs" });
    expect(ours("/blogs/feed.xml")).toEqual({ section: "blogs" });
    expect(ours("/newsxv2/feed.xml")).toEqual({ section: "newsxv2" });
    expect(sources(afterFiles)).toContain("/feed.xml");
  });

  it("leaves every folder's feed to a site whose rule under a folder pattern reaches feed.xml, and keeps them where it cannot", async () => {
    const reaching = await rewritesOf(
      withNextly({
        rewrites: async () => ({
          fallback: [
            {
              source: "/:lang(en|fr)/:path*",
              destination: "/old/:lang/:path*",
            },
          ],
        }),
      })
    );
    expect(
      reaching.afterFiles.some(rule =>
        rule.destination.endsWith("/feed-files/:section/feed.xml")
      )
    ).toBe(false);

    const elsewhere = await rewritesOf(
      withNextly({
        rewrites: async () => ({
          fallback: [
            {
              source: "/:lang(en|fr)/docs/:path*",
              destination: "/old/:lang/docs/:path*",
            },
          ],
        }),
      })
    );
    expect(sources(elsewhere.afterFiles)).toContain("/:section/feed.xml");
  });

  it("leaves every folder's feed to a site whose own rule names feed.xml in a shape it cannot read folder by folder", async () => {
    const theirs = {
      source: "/:lang(en|fr)/feed.xml",
      destination: "/feeds/:lang",
    };
    const { afterFiles } = await rewritesOf(
      withNextly({ rewrites: async () => ({ fallback: [theirs] }) })
    );
    expect(
      afterFiles.some(rule =>
        rule.destination.endsWith("/feed-files/:section/feed.xml")
      )
    ).toBe(false);
    expect(sources(afterFiles)).toContain("/feed.xml");
  });
});

describe("withNextly serves a folder's own llms files from plugins", () => {
  it("rewrites llms.txt and llms-full.txt in one folder to the handler's routes for them, as Next matches them", async () => {
    const { afterFiles } = await rewritesOf(
      withNextly({}, { apiRoute: "/cms/api" })
    );
    expect(afterFiles).toContainEqual({
      source: "/:section/llms.txt",
      destination: "/cms/api/llms-files/:section/llms.txt",
    });
    expect(afterFiles).toContainEqual({
      source: "/:section/llms-full.txt",
      destination: "/cms/api/llms-files/:section/llms-full.txt",
    });

    // Next's own matcher: one folder deep and no deeper, and only the file.
    const list = getPathMatch("/:section/llms.txt");
    expect(list("/docs/llms.txt")).toEqual({ section: "docs" });
    expect(list("/docs/guides/llms.txt")).toBe(false);
    expect(list("/docs/llms-full.txt")).toBe(false);
    expect(list("/llms.txt")).toBe(false);
  });

  it("leaves a folder's files to a site that rewrites them itself, and all of them when turned off", async () => {
    const theirs = [
      { source: "/docs/llms.txt", destination: "/api/docs-llms" },
    ];
    const { afterFiles } = await rewritesOf(
      withNextly({ rewrites: async () => ({ fallback: theirs }) })
    );
    const list = afterFiles.find(rule =>
      rule.destination.endsWith("/llms-files/:section/llms.txt")
    );
    const ours = getPathMatch(list?.source ?? "");
    expect(ours("/docs/llms.txt")).toBe(false);
    expect(ours("/guides/llms.txt")).toEqual({ section: "guides" });
    // The folder's llms-full.txt is not one the site rewrites.
    expect(sources(afterFiles)).toContain("/:section/llms-full.txt");

    // A site rule for a folder named `section` is that folder's alone.
    const named = await rewritesOf(
      withNextly({
        rewrites: async () => ({
          fallback: [{ source: "/section/llms.txt", destination: "/api/x" }],
        }),
      })
    );
    const namedList = named.afterFiles.find(rule =>
      rule.destination.endsWith("/llms-files/:section/llms.txt")
    );
    const namedMatch = getPathMatch(namedList?.source ?? "");
    expect(namedMatch("/section/llms.txt")).toBe(false);
    expect(namedMatch("/docs/llms.txt")).toEqual({ section: "docs" });

    const off = await rewritesOf(withNextly({}, { folderLlmsFiles: false }));
    for (const source of FOLDER_LLMS_FILES) {
      expect(sources(off.afterFiles)).not.toContain(source);
    }
    expect(sources(off.afterFiles)).toContain("/llms.txt");
  });
});
