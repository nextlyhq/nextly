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

  it("names the brand by the options' brand name over the site's name", () => {
    const rules = structuredDataRulesOf(
      { brand: { name: "Acme Inc" }, types: {} },
      { siteName: "Acme", brand: { otherNames: [], profiles: [] }, types: {} }
    );
    expect(rules.brand.name).toBe("Acme Inc");
  });
});

/** Every brand fact the options can give, for the moves below. */
const FULL_BRAND: StructuredDataRules["brand"] = {
  name: "Example",
  otherNames: ["Example Co"],
  logo: { url: "/logo.png", width: 512, height: 512 },
  profiles: [{ url: "https://x.com/example" }],
  description: "What the company is.",
  email: "hello@example.com",
  telephone: "+1 555 0100",
  foundingDate: "2024",
  contactPoints: [
    { contactType: "customer support", email: "help@example.com" },
  ],
  parentOrganization: {
    name: "Example Holdings",
    url: "https://holdings.example",
    description: "Owns Example.",
    foundingDate: "2020",
  },
};

/** The same facts as the SEO settings hold them. */
const FULL_SETTINGS = {
  brand: {
    name: "Example",
    otherNames: ["Example Co"],
    logo: { url: "/logo.png", width: 512, height: 512 },
    profiles: [{ network: "X", url: "https://x.com/example" }],
    description: "What the company is.",
    email: "hello@example.com",
    telephone: "+1 555 0100",
    foundingDate: "2024",
    contactPoints: [
      { contactType: "customer support", email: "help@example.com" },
    ],
    parentOrganization: {
      name: "Example Holdings",
      url: "https://holdings.example",
      description: "Owns Example.",
      foundingDate: "2020",
    },
  },
  types: {},
};

describe("brand facts, moved from the site's code to the settings", () => {
  it("are the same facts whichever of the two holds them", () => {
    const fromCode = structuredDataRulesOf(
      { brand: FULL_BRAND, types: {} },
      { brand: { otherNames: [], profiles: [], contactPoints: [] }, types: {} }
    );
    const fromSettings = structuredDataRulesOf(
      { brand: {}, types: {} },
      FULL_SETTINGS
    );
    expect(fromSettings.brand).toEqual(fromCode.brand);
    expect(fromCode.brand).toEqual(FULL_BRAND);
  });

  it("are taken from the settings one fact at a time, the code's kept for the rest", () => {
    const rules = structuredDataRulesOf(
      { brand: FULL_BRAND, types: {} },
      {
        brand: {
          otherNames: [],
          profiles: [],
          email: "press@example.com",
          contactPoints: [],
          parentOrganization: { description: "The group behind Example." },
        },
        types: {},
      }
    );
    expect(rules.brand).toEqual({
      ...FULL_BRAND,
      email: "press@example.com",
      parentOrganization: {
        ...FULL_BRAND.parentOrganization,
        description: "The group behind Example.",
      },
    });
  });

  it("take a list from the settings whole, where they hold one", () => {
    const rules = structuredDataRulesOf(
      { brand: FULL_BRAND, types: {} },
      {
        brand: {
          otherNames: [],
          profiles: [],
          contactPoints: [{ contactType: "sales", telephone: "+1 555 0199" }],
        },
        types: {},
      }
    );
    expect(rules.brand.contactPoints).toEqual([
      { contactType: "sales", telephone: "+1 555 0199" },
    ]);
  });

  it("name a parent organisation only where some side names it", () => {
    const rules = structuredDataRulesOf(
      { brand: { name: "Example" }, types: {} },
      {
        brand: {
          otherNames: [],
          profiles: [],
          contactPoints: [],
          parentOrganization: { url: "https://holdings.example" },
        },
        types: {},
      }
    );
    expect(rules.brand.parentOrganization).toBeUndefined();
  });

  it("describe the brand by the site's default description only where neither side does", () => {
    const settings = {
      description: "The site's default description.",
      brand: { otherNames: [], profiles: [], contactPoints: [] },
      types: {},
    };
    expect(
      structuredDataRulesOf({ brand: {}, types: {} }, settings).brand
        .description
    ).toBe("The site's default description.");
    expect(
      structuredDataRulesOf(
        { brand: {}, types: {} },
        {
          ...settings,
          brand: { ...settings.brand, description: "What the company is." },
        }
      ).brand.description
    ).toBe("What the company is.");
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
