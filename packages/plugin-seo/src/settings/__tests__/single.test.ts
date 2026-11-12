import { pluginAdminSlug, pluginCacheTag } from "@nextlyhq/plugin-sdk";
import { describe, expect, it } from "vitest";

import { seoPlugin } from "../../plugin";
import {
  SEO_ADMIN_SLUG,
  SEO_PLUGIN_NAME,
  SEO_SETTINGS_SLUG,
  SETTINGS_PAGE,
  SETTINGS_PAGE_HREF,
} from "../contract";
import { seoSettingsCacheTags, seoSettingsSingle } from "../single";
import { patternsProblem, socialProfilesProblem } from "../stored-values";

describe("the SEO settings Single", () => {
  it("expires the settings' cache tag on every write, so outputs refresh without a redeploy", () => {
    const single = seoSettingsSingle();
    expect(seoSettingsCacheTags()).toEqual([
      pluginCacheTag(SEO_PLUGIN_NAME, "settings"),
    ]);
    expect(single.revalidate).toEqual({ tags: seoSettingsCacheTags() });
  });

  it("is contributed by the plugin and kept out of the generic Singles list", () => {
    const plugin = seoPlugin({ collections: ["posts"] });
    const [single] = plugin.contributes?.singles ?? [];
    expect(single?.slug).toBe(SEO_SETTINGS_SLUG);
    expect(single?.admin?.hidden).toBe(true);
  });
});

describe("where the settings screen is", () => {
  it("is under the slug core gives the plugin", () => {
    expect(SEO_ADMIN_SLUG).toBe(pluginAdminSlug(SEO_PLUGIN_NAME));
    expect(SETTINGS_PAGE_HREF).toBe(
      `/admin/plugins/${pluginAdminSlug(SEO_PLUGIN_NAME)}/settings`
    );
    expect(
      SETTINGS_PAGE.component.startsWith(`${SEO_PLUGIN_NAME}/admin#`)
    ).toBe(true);
  });
});

describe("stored title patterns", () => {
  it("accepts patterns kept by content type", () => {
    expect(patternsProblem(undefined)).toBeNull();
    expect(
      patternsProblem({
        posts: { title: "{Title} | {Site name}" },
        "single:home": { description: "{Site name}" },
      })
    ).toBeNull();
  });

  it.each([
    [["{Title}"], "kept by content type"],
    [{ posts: "{Title}" }, "a title and a description"],
    [{ posts: { heading: "{Title}" } }, "only a title and a description"],
    [{ posts: { title: 3 } }, "must be text"],
  ])("refuses %j", (value, said) => {
    expect(patternsProblem(value)).toContain(said);
  });
});

describe("stored social profiles", () => {
  it("accepts a list of networks and their addresses", () => {
    expect(
      socialProfilesProblem([
        {
          network: "LinkedIn",
          url: "https://www.linkedin.com/company/rext-ai",
        },
      ])
    ).toBeNull();
  });

  it.each([
    [{ network: "X" }, "must be a list"],
    [[{ network: "X" }], "a network and an address"],
    [[{ network: "X", url: "x.com/rextai" }], "starting with https://"],
    [[{ network: "X", url: "javascript:alert(1)" }], "starting with https://"],
  ])("refuses %j", (value, said) => {
    expect(socialProfilesProblem(value)).toContain(said);
  });
});
