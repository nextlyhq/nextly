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
   * `runMigrationsOnBoot` on the SERVICE config is internal wiring, not an
   * option — it tells `registerServices` whether to open the boot-migrations
   * gate, and that must match what `runProdMigrationsIfEnabled` will actually
   * do, which reads the nested `db` block. A caller-supplied value winning here
   * would open no gate while migrations ran anyway, which is precisely the
   * unguarded window the gate exists to close.
   *
   * The opposite direction is asserted too: a caller cannot manufacture a gate
   * that nothing will ever settle, which would hang every later consumer.
   */
  it("derives the gate flag from the nested config, ignoring a caller override", () => {
    const enabled = buildServiceConfig({
      config: {
        db: { runMigrationsOnBoot: true },
      } as unknown as SanitizedNextlyConfig,
      runMigrationsOnBoot: false,
    } as Parameters<typeof buildServiceConfig>[0]);
    expect(enabled.runMigrationsOnBoot).toBe(true);

    const disabled = buildServiceConfig({
      config: {
        db: { runMigrationsOnBoot: false },
      } as unknown as SanitizedNextlyConfig,
      runMigrationsOnBoot: true,
    } as Parameters<typeof buildServiceConfig>[0]);
    expect(disabled.runMigrationsOnBoot).toBe(false);
  });
});
