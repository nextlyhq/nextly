import { describe, expect, it } from "vitest";

import { holdSiteMedia, pageBuilderImageCopies } from "./image-copies";

/** A site's media that keeps copies up to a 1500px original. */
function siteMedia(asked: number[]) {
  return {
    copyOf: async (source: { id: string } | { url: string }, width: number) => {
      asked.push(width);
      if (!("id" in source)) return null;
      return width > 1500
        ? null
        : { url: `/m/${source.id}-${width}.webp`, width };
    },
  };
}

describe("a page builder's image copies", () => {
  it("lists every copy up to the bound, narrowest first, through the SDK", async () => {
    const plugin = {} as never;
    const asked: number[] = [];
    holdSiteMedia(plugin, siteMedia(asked) as never);
    const copies = await pageBuilderImageCopies(plugin)({ id: "p" }, 1000);
    expect(copies.map(copy => copy.width)).toEqual([
      96, 160, 240, 320, 640, 960,
    ]);
    expect(copies[0]?.url).toBe("/m/p-96.webp");
    // Only the widths up to the bound are asked for.
    expect(asked).toEqual([96, 160, 240, 320, 640, 960]);
  });

  it("stops at the first width no copy can be had at", async () => {
    // The original is 1500px wide, so 1920 is never asked after 1280 is the
    // last there is, and an address on another host asks once.
    const plugin = {} as never;
    const asked: number[] = [];
    holdSiteMedia(plugin, siteMedia(asked) as never);
    const copies = await pageBuilderImageCopies(plugin)({ id: "p" }, 4000);
    expect(copies.at(-1)?.width).toBe(1280);
    expect(asked.at(-1)).toBe(1920);
    asked.length = 0;
    expect(
      await pageBuilderImageCopies(plugin)({ url: "https://x/y.jpg" }, 4000)
    ).toEqual([]);
    expect(asked).toEqual([96]);
  });

  it("offers none before the site has started, or when media fails", async () => {
    expect(
      await pageBuilderImageCopies({} as never)({ id: "p" }, 1000)
    ).toEqual([]);
    const plugin = {} as never;
    holdSiteMedia(plugin, {
      copyOf: async () => {
        throw new Error("storage down");
      },
    } as never);
    expect(await pageBuilderImageCopies(plugin)({ id: "p" }, 1000)).toEqual([]);
  });
});
