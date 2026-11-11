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

describe("withNextly serves the site's root files from plugins", () => {
  it("rewrites robots.txt, sitemap.xml and llms.txt to the API handler, after the site's own files", async () => {
    const { afterFiles, beforeFiles, fallback } = await rewritesOf(
      withNextly({})
    );

    expect(afterFiles).toEqual([
      { source: "/robots.txt", destination: "/admin/api/robots.txt" },
      { source: "/sitemap.xml", destination: "/admin/api/sitemap.xml" },
      { source: "/llms.txt", destination: "/admin/api/llms.txt" },
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
    expect(fromPhases.afterFiles).toHaveLength(4);
    expect(fromPhases.fallback).toEqual([own]);
  });

  it("leaves a root file the site rewrites itself, in any phase, to the site", async () => {
    const theirs = { source: "/robots.txt", destination: "/api/robots" };

    const { afterFiles, fallback } = await rewritesOf(
      withNextly({ rewrites: async () => ({ fallback: [theirs] }) })
    );

    // Next asks afterFiles before fallback: an entry of ours would win.
    expect(sources(afterFiles)).not.toContain("/robots.txt");
    expect(sources(afterFiles)).toEqual(["/sitemap.xml", "/llms.txt"]);
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
