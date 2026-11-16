/**
 * The route's Layouts provider reads the site's default through the one shared
 * reader of the settings Single, and names that Single so a change of default
 * revalidates the pages that depend on it.
 */
import { describe, expect, it, vi } from "vitest";

/**
 * The SDK's accessor, standing in for the booted instance a route reads
 * through when it names none. Plugin code reaches the Direct API through the
 * SDK, so this is the one place the default may come from.
 */
const sdkInstance = vi.hoisted(() => ({
  findSingle: vi.fn(async () => ({ defaultLayout: "from-sdk" })),
}));
vi.mock("@nextlyhq/plugin-sdk", async importActual => ({
  ...(await importActual<typeof import("@nextlyhq/plugin-sdk")>()),
  getCachedNextly: vi.fn(async () => sdkInstance),
}));

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
    // Both identity channels stated and empty: an omitted one is filled from
    // the instance's defaults, and the answer is cached for every visitor.
    const asked = site.asked[0] ?? {};
    expect("user" in asked && asked.user === undefined).toBe(true);
    expect("req" in asked && asked.req === undefined).toBe(true);
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

  it("reads through the SDK's instance when the route names none", async () => {
    expect(await pageBuilderLayouts().readDefault()).toBe("from-sdk");
    expect(sdkInstance.findSingle).toHaveBeenCalledWith(
      expect.objectContaining({ slug: PAGE_BUILDER_SETTINGS_SLUG })
    );
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
