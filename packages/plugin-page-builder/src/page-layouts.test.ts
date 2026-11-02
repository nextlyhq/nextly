/**
 * The route's Layouts provider reads the site's default through the one shared
 * reader of the settings Single, and names that Single so a change of default
 * revalidates the pages that depend on it.
 */
import { describe, expect, it } from "vitest";

import { LAYOUTS_SLUG } from "./collections/layouts";
import { PAGE_BUILDER_SETTINGS_SLUG } from "./default-layout/settings-single";
import { pageBuilderLayouts } from "./page-layouts";

/** A settings Single holding `doc`, recording what it was asked. */
function settingsReading(doc: Record<string, unknown> | null) {
  const asked: Record<string, unknown>[] = [];
  return {
    asked,
    nextly: {
      findSingle: async (args: Record<string, unknown>) => {
        asked.push(args);
        return doc;
      },
    } as never,
  };
}

describe("pageBuilderLayouts", () => {
  it("reads the default the Single names, as the system", async () => {
    // `seededLayout` differs from `defaultLayout`, so a provider answering
    // the wrong reference cannot pass.
    const site = settingsReading({
      defaultLayout: "main",
      seededLayout: "seeded",
    });
    const provider = pageBuilderLayouts({ nextly: site.nextly });

    expect(await provider.readDefault()).toBe("main");
    // Matched rather than equal: the arguments are `readLayoutSettings`'s to
    // choose, and what this provider owes is one system read of its Single.
    expect(site.asked).toHaveLength(1);
    expect(site.asked[0]).toMatchObject({
      slug: PAGE_BUILDER_SETTINGS_SLUG,
      overrideAccess: true,
    });
  });

  it("reads a populated reference as its id", async () => {
    const site = settingsReading({ defaultLayout: { id: "main" } });
    expect(
      await pageBuilderLayouts({ nextly: site.nextly }).readDefault()
    ).toBe("main");
  });

  it("answers null for a site with no default", async () => {
    const site = settingsReading({ defaultLayout: null });
    expect(
      await pageBuilderLayouts({ nextly: site.nextly }).readDefault()
    ).toBeNull();
  });

  it("names the Single it read and the Layouts collection", () => {
    const provider = pageBuilderLayouts();
    expect(provider.singles).toEqual([PAGE_BUILDER_SETTINGS_SLUG]);
    expect(provider.collection).toBe(LAYOUTS_SLUG);
  });

  it("follows renamed slugs into both the read and the tags", async () => {
    const site = settingsReading({ defaultLayout: "main" });
    const provider = pageBuilderLayouts({
      nextly: site.nextly,
      settingsSingle: "site-settings",
      layoutsCollection: "frames",
    });

    await provider.readDefault();
    expect(site.asked[0]?.slug).toBe("site-settings");
    expect(provider.singles).toEqual(["site-settings"]);
    expect(provider.collection).toBe("frames");
  });
});
