/**
 * A declared language rule reaches the running site the way an app's own
 * configuration does: checked by `defineConfig`, kept by the sanitizer, and
 * carried into the service configuration a page's address is answered from.
 */
import { describe, expect, it } from "vitest";

import { defineConfig } from "../../collections/config/define-config";
import { buildServiceConfig } from "../../init/build-service-config";
import { sanitizeConfig } from "../../shared/types/config";

const rule = {
  by: "domain",
  domains: { en: "https://example.com", de: "https://example.de" },
} as const;

describe("the language rule in an app's configuration", () => {
  it("is checked when the configuration is defined", () => {
    expect(() =>
      defineConfig({
        collections: [],
        localization: { locales: ["en", "de"], defaultLocale: "en" },
        languageAddresses: {
          by: "domain",
          domains: { en: "https://example.com" },
        },
      })
    ).toThrow(/'de' has no domain/);
  });

  it("reaches the service configuration through the boot", () => {
    const sanitized = sanitizeConfig({
      collections: [],
      localization: { locales: ["en", "de"], defaultLocale: "en" },
      languageAddresses: rule,
    });
    expect(sanitized.languageAddresses).toEqual(rule);

    expect(buildServiceConfig({ config: sanitized }).languageAddresses).toEqual(
      rule
    );
  });
});
