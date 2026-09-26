import { describe, expect, it } from "vitest";

import type { SanitizedLocalizationConfig } from "../../domains/i18n/config/types";
import type { SanitizedNextlyConfig } from "../../shared/types/config";
import { resolveAuditRetentionConfig } from "../../domains/audit/retention-config";
import { buildServiceConfig } from "../build-service-config";

/**
 * `buildServiceConfig` assembles the DI service config from the loaded
 * `nextly.config.ts`. The localization block must survive this hop — if it is
 * dropped here, `ctx.config.localization` is undefined and every localized
 * read/write silently no-ops to the main table.
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
      locales: [
        { code: "fr", label: "French", rtl: false, fallbackLocale: [] },
      ],
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

/**
 * The retention policies must survive the same hop. Dropped here, every
 * `ctx.config.auditRetention` read is undefined, so no audit pass is ever
 * registered and neither trail is pruned however the windows are configured —
 * a feature that reads as present and does nothing.
 */
describe("buildServiceConfig — retention carry-through", () => {
  const auditRetention = resolveAuditRetentionConfig({
    activityMaxAgeMs: 7 * 24 * 60 * 60 * 1000,
  });

  it("forwards the resolved audit windows from config", () => {
    const result = buildServiceConfig({
      config: { auditRetention } as SanitizedNextlyConfig,
    });
    expect(result.auditRetention).toEqual(auditRetention);
  });

  it("prefers an explicitly provided policy over the config block", () => {
    const explicit = resolveAuditRetentionConfig({ authMaxAgeMs: false });
    const result = buildServiceConfig({
      config: { auditRetention } as SanitizedNextlyConfig,
      auditRetention: explicit,
    });
    expect(result.auditRetention).toEqual(explicit);
  });

  /**
   * The decision to migrate on boot is read in ONE place,
   * `runProdMigrationsIfEnabled`, from the nested `db` block — so that block
   * has to reach registration whole. A flag copied beside it would be a second
   * reading of the same decision, which is how a gate came to be opened that
   * nothing settled.
   */
  it("forwards the whole db block, run decision included", () => {
    const db = {
      runMigrationsOnBoot: true,
      migrationsDir: "./migrations",
      uiSchemaFile: "./ui-schema.json",
    };
    const result = buildServiceConfig({
      config: { db } as unknown as SanitizedNextlyConfig,
    } as Parameters<typeof buildServiceConfig>[0]);
    expect(result.db).toEqual(db);
    // Nothing reads a flag beside the block any more; none is set.
    expect(result).not.toHaveProperty("runMigrationsOnBoot");
  });
});
