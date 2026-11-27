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
    expect(fromPhases.afterFiles).toHaveLength(6);
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
