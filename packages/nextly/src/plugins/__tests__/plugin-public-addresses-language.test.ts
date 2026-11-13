/**
 * The language an address read with none named is held in, as a plugin asks
 * for it through `ctx.publicAddresses`: the site's languages as they are
 * now, so a default language chosen in Settings counts as one in code does.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import * as locales from "../../domains/i18n/configured-locales";
import {
  addressLanguages,
  defaultAddressLanguage,
} from "../../domains/public-addresses/held-addresses";
import { pluginPublicAddresses } from "../plugin-public-addresses";

afterEach(() => {
  vi.restoreAllMocks();
});

/** The site's languages, as the language registry answers them. */
function languages(defaultLocale: string | undefined, codes: string[]) {
  vi.spyOn(locales, "appLocalization").mockReturnValue(
    defaultLocale === undefined
      ? undefined
      : ({
          defaultLocale,
          locales: codes.map(code => ({ code, label: code })),
        } as unknown as ReturnType<typeof locales.appLocalization>)
  );
}

const surface = () =>
  pluginPublicAddresses({
    bindTo: async () => {
      throw new Error("not used");
    },
    owner: { kind: "plugin", name: "test" } as never,
    onTeardown: () => {},
    dialect: () => "sqlite",
  });

describe("the default address language", () => {
  it("is the default language the site has now", async () => {
    // German made the default in Settings, with no localization in code.
    languages("de", ["de", "en"]);
    expect(defaultAddressLanguage()).toBe("de");
    expect(await surface().defaultLanguage()).toBe("de");
  });

  it("is English on a site with no languages", async () => {
    languages(undefined, []);
    expect(defaultAddressLanguage()).toBe("en");
    expect(await surface().defaultLanguage()).toBe("en");
    // The one language such a site holds its addresses in.
    expect(addressLanguages()).toEqual(["en"]);
  });
});
