import { describe, expect, it } from "vitest";

import { pageBuilderImageCopies, type ImageCopyRequest } from "./image-copies";

/** A site whose media keeps copies up to a 1500px original. */
function site(asked: ImageCopyRequest[]) {
  return {
    media: {
      copyOf: async (args: ImageCopyRequest) => {
        asked.push(args);
        if (args.id === undefined) return null;
        return args.width > 1500
          ? null
          : { url: `/m/${args.id}-${args.width}.webp`, width: args.width };
      },
    },
  };
}

describe("a page builder's image copies", () => {
  it("lists every copy up to the bound, narrowest first, through the site", async () => {
    const asked: ImageCopyRequest[] = [];
    const copies = await pageBuilderImageCopies(site(asked))({ id: "p" }, 1000);
    expect(copies.map(copy => copy.width)).toEqual([
      96, 160, 240, 320, 640, 960,
    ]);
    expect(copies[0]?.url).toBe("/m/p-96.webp");
    // Only the widths up to the bound are asked for, by the image's id.
    expect(asked).toEqual(
      [96, 160, 240, 320, 640, 960].map(width => ({ id: "p", width }))
    );
  });

  it("stops at the first width no copy can be had at", async () => {
    // The original is 1500px wide, so 1920 is never asked after 1280 is the
    // last there is, and an address on another host asks once.
    const asked: ImageCopyRequest[] = [];
    const copies = await pageBuilderImageCopies(site(asked))({ id: "p" }, 4000);
    expect(copies.at(-1)?.width).toBe(1280);
    expect(asked.at(-1)?.width).toBe(1920);
    asked.length = 0;
    expect(
      await pageBuilderImageCopies(site(asked))(
        { url: "https://x/y.jpg" },
        4000
      )
    ).toEqual([]);
    expect(asked).toEqual([{ url: "https://x/y.jpg", width: 96 }]);
  });

  it("offers none when the site's media fails", async () => {
    const failing = {
      media: {
        copyOf: async () => {
          throw new Error("storage down");
        },
      },
    };
    expect(await pageBuilderImageCopies(failing)({ id: "p" }, 1000)).toEqual(
      []
    );
  });
});
