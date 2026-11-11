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
  return (await rewrites()) as Rewrites;
}

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
});
