import { describe, expect, it } from "vitest";

import type { SanitizedLocalizationConfig } from "../../domains/i18n/config/types";
import type { SanitizedNextlyConfig } from "../../shared/types/config";
import { resolveAuditRetentionConfig } from "../../domains/audit/retention-config";
import { NextlyError } from "../../errors/nextly-error";
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

/**
 * The preview mount is validated where a bad value can still be acted on.
 *
 * Deferring it to the minting endpoint puts the refusal in front of an editor
 * clicking "Copy shareable link", who cannot edit `nextly.config.ts` — and puts
 * it there only for an app that has an editor, a collection declaring a preview
 * URL, and someone who happened to click. A mount that cannot produce a link is
 * a property of the configuration, so it is settled when the configuration is
 * read.
 */
describe("buildServiceConfig — preview mount", () => {
  function boot(preview: unknown) {
    return buildServiceConfig({
      config: { preview } as unknown as SanitizedNextlyConfig,
    });
  }

  it("carries a valid mount through", () => {
    expect(boot({ route: "/next/preview" }).preview).toEqual({
      route: "/next/preview",
    });
  });

  // Normalised on the way through, so what the container holds is what a link
  // is built from. Two readings of one string is how a mount and its link come
  // to disagree.
  it("stores the normalized mount rather than the configured spelling", () => {
    expect(boot({ route: "/next/preview/" }).preview).toEqual({
      route: "/next/preview",
    });
  });

  it("materializes the default when a preview block declares no route", () => {
    expect(boot({}).preview).toEqual({ route: "/api/preview" });
  });

  // Nothing to validate and nothing to state: an app that configures no preview
  // block reaches the endpoint's own default, and inventing one here would make
  // "the host said nothing" indistinguishable from "the host said /api/preview".
  it("leaves preview undefined when the config declares none", () => {
    expect(
      buildServiceConfig({ config: {} as SanitizedNextlyConfig }).preview
    ).toBeUndefined();
  });

  it.each([
    ["another origin", "https://elsewhere.example/preview"],
    ["a protocol-relative URL", "//elsewhere.example"],
    ["a query", "/api/preview?tenant=a"],
  ])("refuses %s at boot", (_label, route) => {
    expect(() => boot({ route })).toThrow(NextlyError);
  });

  // A caller may hand the service config a preview block directly, bypassing
  // the nested one entirely. Validating only the nested branch would leave that
  // path unchecked while reading as covered.
  it("validates a caller-supplied block, not only the nested one", () => {
    expect(() =>
      buildServiceConfig({
        config: {} as SanitizedNextlyConfig,
        preview: { route: "//elsewhere.example" },
      })
    ).toThrow(NextlyError);
  });
});
