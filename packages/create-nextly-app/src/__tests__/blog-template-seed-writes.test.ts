/**
 * The blog template's demo seed says, with each update, which version of a
 * document it changes, or that it sets the content whatever is stored, and
 * it reports a write it could not make rather than dropping it.
 *
 * A post that already exists is patched from the lookup that found it, so its
 * version goes with the patch. The Singles take the demo copy whatever they
 * hold. A Single write the server refuses fails the seed, naming the Single,
 * so a seed that left one unwritten is recorded as failed, never as done.
 */
import { describe, expect, it, vi } from "vitest";

import {
  patchPostTaxonomy,
  seedSingles,
  type SeedData,
} from "../../../../templates/blog/src/endpoints/seed/index";

const seedData: Pick<SeedData, "siteSettings" | "navigation" | "homepage"> = {
  siteSettings: {
    siteName: "Demo",
    tagline: "A blog",
    siteDescription: "Demo blog",
    logo: "logo.svg",
    social: {},
  },
  navigation: { showSearchIcon: true },
  homepage: { heroTitle: "Hello" },
};

describe("the blog seed's updates", () => {
  it("patches an existing post with the version its lookup read", async () => {
    const update = vi.fn(async () => ({}));
    await patchPostTaxonomy(
      { update } as never,
      { id: "post-1", _rev: "3" },
      { categories: ["c1"], tags: [] }
    );
    expect(update).toHaveBeenCalledWith({
      collection: "posts",
      id: "post-1",
      data: { categories: ["c1"], tags: undefined, _rev: "3" },
    });
  });

  it("writes each Single's demo copy whatever it holds", async () => {
    const updateSingle = vi.fn(async () => ({}));
    await seedSingles({ updateSingle } as never, seedData);

    expect(
      updateSingle.mock.calls.map(([args]) => (args as { slug: string }).slug)
    ).toEqual(["site-settings", "navigation", "homepage"]);
    for (const [args] of updateSingle.mock.calls) {
      expect((args as { data: unknown }).data).toMatchObject({
        _overwrite: true,
      });
    }
  });

  it("fails the seed on a Single it could not write, naming it and the reason", async () => {
    const updateSingle = vi.fn(async ({ slug }: { slug: string }) => {
      if (slug === "navigation") {
        throw new Error("This update must say which version it changes.");
      }
      return {};
    });

    await expect(
      seedSingles({ updateSingle } as never, seedData)
    ).rejects.toThrow(
      "The seed could not write the navigation Single: This update must say which version it changes."
    );
  });
});
