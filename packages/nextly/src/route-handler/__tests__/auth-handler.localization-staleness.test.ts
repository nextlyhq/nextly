// The dev-only staleness decision behind ensureServicesInitialized's
// re-registration: services capture `localization` at construction, so the
// registered block must be compared against the one the route module last
// stored — adding, removing, or editing the block all count as changes;
// anything else (or no registered config at all) does not.

import { afterEach, describe, expect, it } from "vitest";

import type { SanitizedNextlyConfig } from "../../collections/config/define-config";
import { container } from "../../di";
import { _localizationBlockChangedForTest } from "../auth-handler";

const LOCALIZATION = {
  locales: [{ code: "en", label: "English", rtl: false, fallbackLocale: [] }],
  defaultLocale: "en",
  fallback: true,
};

function registerConfig(localization: unknown): void {
  container.registerSingleton("config", () => ({ localization }));
}

function storedWith(localization: unknown): SanitizedNextlyConfig {
  return { localization } as SanitizedNextlyConfig;
}

afterEach(() => {
  container.clear();
});

describe("localization staleness decision", () => {
  it("is false when no config is registered (cold boot handles it)", () => {
    expect(_localizationBlockChangedForTest(storedWith(LOCALIZATION))).toBe(
      false
    );
  });

  it("is false when the stored block equals the registered one", () => {
    registerConfig(LOCALIZATION);
    expect(_localizationBlockChangedForTest(storedWith(LOCALIZATION))).toBe(
      false
    );
  });

  it("is true when localization was ADDED after registration", () => {
    registerConfig(undefined);
    expect(_localizationBlockChangedForTest(storedWith(LOCALIZATION))).toBe(
      true
    );
  });

  it("is true when localization was REMOVED after registration", () => {
    registerConfig(LOCALIZATION);
    expect(_localizationBlockChangedForTest(storedWith(undefined))).toBe(true);
  });

  it("is true when the locale set changed", () => {
    registerConfig(LOCALIZATION);
    expect(
      _localizationBlockChangedForTest(
        storedWith({
          ...LOCALIZATION,
          locales: [
            ...LOCALIZATION.locales,
            { code: "de", label: "German", rtl: false, fallbackLocale: [] },
          ],
        })
      )
    ).toBe(true);
  });

  it("is false when both sides have no localization", () => {
    registerConfig(undefined);
    expect(_localizationBlockChangedForTest(storedWith(undefined))).toBe(false);
  });
});
