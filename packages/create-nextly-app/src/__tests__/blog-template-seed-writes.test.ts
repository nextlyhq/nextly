/**
 * The blog template's demo seed says, with each update, which version of a
 * document it changes, or that it sets the content whatever is stored, and
 * it reports a write it could not make rather than dropping it.
 *
 * A post that already exists is patched from the lookup that found it, so its
 * version goes with the patch. The Singles take the demo copy whatever they
 * hold. A write the server refuses lands in the seed's warnings, with its
 * reason, so a seed that left a Single unwritten never reads as clean.
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
    const warnings: string[] = [];
    await seedSingles({ updateSingle } as never, seedData, warnings);

    expect(
      updateSingle.mock.calls.map(([args]) => (args as { slug: string }).slug)
    ).toEqual(["site-settings", "navigation", "homepage"]);
    for (const [args] of updateSingle.mock.calls) {
      expect((args as { data: unknown }).data).toMatchObject({
        _overwrite: true,
      });
    }
    expect(warnings).toEqual([]);
  });

  it("reports a Single it could not write as a warning, with the reason", async () => {
    const updateSingle = vi.fn(async ({ slug }: { slug: string }) => {
      if (slug === "navigation") {
        throw new Error("This update must say which version it changes.");
      }
      return {};
    });
    const warnings: string[] = [];
    await seedSingles({ updateSingle } as never, seedData, warnings);

    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("navigation");
    expect(warnings[0]).toContain(
      "This update must say which version it changes."
    );
    // The others are still written.
    expect(updateSingle).toHaveBeenCalledTimes(3);
  });
});
