import { describe, expect, it } from "vitest";

import { pageBuilderImageCopies, type ImageCopyRequest } from "./image-copies";

/** A site whose media keeps copies up to a 1500px original. */
function site(asked: ImageCopyRequest[]) {
  return {
    media: {
      copiesOf: async (args: ImageCopyRequest) => {
        asked.push(args);
        if (args.id === undefined) return [];
        return [96, 160, 240, 320, 640, 960, 1280]
          .filter(width => width <= args.upTo)
          .map(width => ({ url: `/m/${args.id}-${width}.webp`, width }));
      },
    },
  };
}

describe("a page builder's image copies", () => {
  it("lists the site's copies up to the bound in one lookup", async () => {
    const asked: ImageCopyRequest[] = [];
    const copies = await pageBuilderImageCopies(site(asked))({ id: "p" }, 1000);
    expect(copies.map(copy => copy.width)).toEqual([
      96, 160, 240, 320, 640, 960,
    ]);
    expect(copies[0]?.url).toBe("/m/p-96.webp");
    expect(asked).toEqual([{ id: "p", upTo: 1000 }]);
    // An address is asked by its address.
    asked.length = 0;
    expect(
      await pageBuilderImageCopies(site(asked))(
        { url: "https://x/y.jpg" },
        4000
      )
    ).toEqual([]);
    expect(asked).toEqual([{ url: "https://x/y.jpg", upTo: 4000 }]);
  });

  it("claims one of the page's reads per image, and refuses once none is left", async () => {
    let left = 1;
    const reads = { take: () => left-- > 0 };
    const asked: ImageCopyRequest[] = [];
    const copies = pageBuilderImageCopies(site(asked));
    expect(await copies({ id: "a" }, 320, reads)).toHaveLength(4);
    await expect(copies({ id: "b" }, 320, reads)).rejects.toThrow(
      "spent its reads"
    );
    // The second image's lookup never ran.
    expect(asked).toEqual([{ id: "a", upTo: 320 }]);
  });

  it("refuses when the site's media fails, so no list is kept", async () => {
    const failing = {
      media: {
        copiesOf: async () => {
          throw new Error("storage down");
        },
      },
    };
    await expect(
      pageBuilderImageCopies(failing)({ id: "p" }, 1000)
    ).rejects.toThrow("storage down");
  });
});
