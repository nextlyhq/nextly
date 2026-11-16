/**
 * Which languages a publish of every language puts live, and which it asks
 * its rule about.
 */
import { describe, expect, it } from "vitest";

import { languagesGoingLiveFrom, languagesToAsk } from "./languages-going-live";

const configured = ["en", "fr", "de"];

describe("languagesGoingLiveFrom", () => {
  it("puts live each translation not yet published", () => {
    expect(
      languagesGoingLiveFrom({
        statuses: new Map([
          ["en", "published"],
          ["fr", "draft"],
          ["de", null],
        ]),
        configured,
        defaultLocale: "en",
        mainPublished: true,
      })
    ).toEqual(["fr", "de"]);
  });

  it("puts live a translation marked published while the main row is not, which a read hides until it is", () => {
    expect(
      languagesGoingLiveFrom({
        statuses: new Map([
          ["en", "draft"],
          ["fr", "published"],
        ]),
        configured,
        defaultLocale: "en",
        mainPublished: false,
      })
    ).toEqual(["en", "fr"]);
  });

  it("puts the default language live with a main row going live that stores no translation of it", () => {
    expect(
      languagesGoingLiveFrom({
        statuses: new Map([["fr", "draft"]]),
        configured,
        defaultLocale: "en",
        mainPublished: false,
      })
    ).toEqual(["fr", "en"]);
  });

  it("leaves out a language the site no longer configures", () => {
    expect(
      languagesGoingLiveFrom({
        statuses: new Map([
          ["en", "draft"],
          ["xx", "draft"],
        ]),
        configured,
        defaultLocale: "en",
        mainPublished: false,
      })
    ).toEqual(["en"]);
  });
});

describe("languagesToAsk", () => {
  it("asks the languages going live, and every configured language where the content reaches a localized field group", () => {
    expect(
      languagesToAsk(["fr"], { configured, reachesLocalizedFieldGroup: false })
    ).toEqual(["fr"]);
    expect(
      languagesToAsk(["fr"], { configured, reachesLocalizedFieldGroup: true })
    ).toEqual(["fr", "en", "de"]);
  });
});
