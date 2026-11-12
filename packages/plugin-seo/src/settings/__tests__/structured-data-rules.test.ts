import { describe, expect, it } from "vitest";

import type { StructuredDataRules } from "../../structured-data/rules";
import { structuredDataSettingsProblem } from "../structured-data-choices";
import { structuredDataRulesOf } from "../structured-data-rules";

/** What the plugin's options say, which the settings take over from. */
const fromOptions: StructuredDataRules = {
  origin: "https://old.example.com",
  brand: {
    name: "Old name",
    otherNames: ["Old"],
    logo: { url: "/old-logo.png" },
    profiles: [{ url: "https://x.com/old" }],
  },
  types: {
    posts: { type: "article", details: { article: { author: "writer" } } },
    events: { type: "event" },
  },
};

describe("structured data's rules, from the SEO settings", () => {
  it("takes each fact the settings hold over the plugin's options", () => {
    expect(
      structuredDataRulesOf(fromOptions, {
        origin: "https://rext.ai",
        siteName: "Rext AI",
        brand: {
          name: "Rext AI",
          otherNames: ["Rext"],
          logo: { url: "/logo.svg", width: 512, height: 512 },
          profiles: [
            {
              network: "LinkedIn",
              url: "https://www.linkedin.com/company/rext-ai",
            },
          ],
        },
        types: { posts: { type: "blogPosting" } },
      })
    ).toEqual({
      origin: "https://rext.ai",
      brand: {
        name: "Rext AI",
        otherNames: ["Rext"],
        logo: { url: "/logo.svg", width: 512, height: 512 },
        profiles: [{ url: "https://www.linkedin.com/company/rext-ai" }],
      },
      types: {
        posts: { type: "blogPosting" },
        events: { type: "event" },
      },
    });
  });

  it("keeps the plugin's options for every fact the settings leave empty", () => {
    expect(
      structuredDataRulesOf(fromOptions, {
        brand: { otherNames: [], profiles: [] },
        types: {},
      })
    ).toEqual(fromOptions);
  });

  it("names the brand by the site's name where no brand name is set", () => {
    const rules = structuredDataRulesOf(
      { brand: {}, types: {} },
      { siteName: "Acme", brand: { otherNames: [], profiles: [] }, types: {} }
    );
    expect(rules.brand.name).toBe("Acme");
  });
});

describe("structured data choices kept in the settings", () => {
  it("accepts a type and its mapping, and nothing", () => {
    expect(structuredDataSettingsProblem(undefined)).toBeNull();
    expect(
      structuredDataSettingsProblem({
        posts: { type: "article", details: { article: { author: "writer" } } },
      })
    ).toBeNull();
  });

  it("refuses a type that is not offered, and says which", () => {
    expect(
      structuredDataSettingsProblem({ posts: { type: "Recipe" } })
    ).toMatch(/posts\.type "Recipe" is not a type offered/);
  });
});
