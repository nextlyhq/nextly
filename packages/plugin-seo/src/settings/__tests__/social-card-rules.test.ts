import { describe, expect, it } from "vitest";

import { socialCardRulesOf } from "../social-card-rules";

describe("the social card's rules, from the SEO settings", () => {
  it("takes the saved site name and production address over the plugin's options", () => {
    expect(
      socialCardRulesOf(
        {
          origin: "https://old.example.com",
          siteName: "Old",
          language: "en-GB",
        },
        { origin: "https://www.example.com", siteName: "Acme" }
      )
    ).toEqual({
      origin: "https://www.example.com",
      siteName: "Acme",
      language: "en-GB",
    });
  });

  it("keeps the plugin's options for what the settings leave empty", () => {
    const base = {
      origin: "https://old.example.com",
      siteName: "Old",
      language: "en",
    };
    expect(socialCardRulesOf(base, {})).toEqual(base);
  });

  it("keeps the X account the plugin's options name, which the settings do not hold", () => {
    expect(
      socialCardRulesOf(
        { language: "en", xAccount: "@example" },
        { siteName: "Acme" }
      )
    ).toEqual({ siteName: "Acme", language: "en", xAccount: "@example" });
  });

  it("names no site where neither the settings nor the options do", () => {
    expect(socialCardRulesOf({ language: "en" }, {})).toEqual({
      language: "en",
    });
  });
});
