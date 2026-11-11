/**
 * The SEO tab's route looks a page's images up only for a caller who may
 * read the media library: for anyone else every id finds nothing, so an id
 * sent in a document never answers with a file's address.
 */
import { NextlyError, type PluginContext } from "@nextlyhq/plugin-sdk";
import { describe, expect, it } from "vitest";

import { mediaReadFor } from "../route";

class Library {
  findById(id: string): Promise<{ url: string }> {
    return Promise.resolve({ url: `/media/${id}.jpg` });
  }
  count(): Promise<number> {
    return Promise.resolve(1);
  }
}

const ctx = { services: { media: new Library() } } as unknown as PluginContext;

describe("the images the route looks up", () => {
  it("are read for a caller who may read the media library", async () => {
    await expect(
      mediaReadFor(ctx, true).services.media.findById("m1", {})
    ).resolves.toEqual({ url: "/media/m1.jpg" });
  });

  it("are found nowhere for anyone else, the library's other reads kept", async () => {
    const reading = mediaReadFor(ctx, false);
    const refusal = await reading.services.media
      .findById("m1", {})
      .catch((error: unknown) => error);
    expect(NextlyError.isCode(refusal, "NOT_FOUND")).toBe(true);
    expect(await (reading.services.media as unknown as Library).count()).toBe(
      1
    );
  });
});
