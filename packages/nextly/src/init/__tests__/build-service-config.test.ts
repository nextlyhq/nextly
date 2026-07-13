import { describe, expect, it } from "vitest";

import type { SanitizedLocalizationConfig } from "../../domains/i18n/config/types";
import type { SanitizedNextlyConfig } from "../../shared/types/config";
import { buildServiceConfig } from "../build-service-config";

/**
 * `buildServiceConfig` assembles the DI service config from the loaded
 * `nextly.config.ts`. The localization block must survive this hop — if it is
 * dropped here, `ctx.config.localization` is undefined and every localized
 * read/write silently no-ops to the main table (findings H1).
 */
describe("buildServiceConfig — localization carry-through", () => {
  const localization: SanitizedLocalizationConfig = {
    locales: [
      { code: "en", label: "English", rtl: false, fallbackLocale: [] },
      { code: "ar", label: "Arabic", rtl: true, fallbackLocale: ["en"] },
    ],
    defaultLocale: "en",
    fallback: true,
  };

  function configWith(
    partial: Partial<SanitizedNextlyConfig>
  ): SanitizedNextlyConfig {
    return partial as SanitizedNextlyConfig;
  }

  it("forwards the normalized localization block from config", () => {
    const result = buildServiceConfig({ config: configWith({ localization }) });
    expect(result.localization).toEqual(localization);
  });

  it("leaves localization undefined for single-language apps", () => {
    const result = buildServiceConfig({ config: configWith({}) });
    expect(result.localization).toBeUndefined();
  });

  it("prefers an explicitly provided localization over the config block", () => {
    const explicit: SanitizedLocalizationConfig = {
      locales: [{ code: "fr", label: "French", rtl: false, fallbackLocale: [] }],
      defaultLocale: "fr",
      fallback: false,
    };
    const result = buildServiceConfig({
      config: configWith({ localization }),
      localization: explicit,
    });
    expect(result.localization).toBe(explicit);
  });
});
