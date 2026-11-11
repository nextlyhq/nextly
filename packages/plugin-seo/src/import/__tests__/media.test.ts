/**
 * Finding an imported image in the media library by its file name: the
 * library's search also matches other text and answers the newest first, so
 * the file is looked for past the first page of matches.
 */
import type { PluginContext } from "@nextlyhq/plugin-sdk";
import { describe, expect, it } from "vitest";

import { mediaIdOf } from "../plan";

/** A media library holding `files`, newest first, searched by any text. */
function library(files: { id: string; filename: string }[]) {
  const asked: number[] = [];
  const ctx = {
    services: {
      media: {
        listMedia: async ({
          search,
          limit,
          page,
        }: {
          search: string;
          limit: number;
          page: number;
        }) => {
          asked.push(page);
          const matching = files.filter(file => file.filename.includes(search));
          return { data: matching.slice((page - 1) * limit, page * limit) };
        },
      },
    },
  } as unknown as PluginContext;
  return { ctx, asked };
}

describe("an imported image's place in the media library", () => {
  it("is found past the first page of other files the search matches", async () => {
    const newer = Array.from({ length: 150 }, (_, at) => ({
      id: `newer-${at}`,
      filename: `hero-banner-${at}.png`,
    }));
    const { ctx, asked } = library([
      ...newer,
      { id: "old", filename: "hero.png" },
    ]);
    expect(await mediaIdOf(ctx, "hero.png")).toBe("old");
    expect(asked).toEqual([1, 2]);
  });

  it("is none once every match has been read", async () => {
    const { ctx, asked } = library([{ id: "a", filename: "hero-banner.png" }]);
    expect(await mediaIdOf(ctx, "hero.png")).toBe(undefined);
    expect(asked).toEqual([1]);
  });
});
