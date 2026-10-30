import { afterEach, describe, expect, it } from "vitest";

import { NextlyError } from "../../../errors/nextly-error";
import {
  assertPerLanguageStorageUnchanged,
  perLanguageStorageEnabled,
  setPerLanguageStorage,
  storesPerLanguage,
} from "../per-language-storage";

afterEach(() => setPerLanguageStorage(false));

describe("per-language storage", () => {
  it("is off until a boot publishes it", () => {
    expect(perLanguageStorageEnabled()).toBe(false);
    setPerLanguageStorage(true);
    expect(perLanguageStorageEnabled()).toBe(true);
  });

  it("stores an entity per language when it is translatable, or when the site stores every one so", () => {
    expect(storesPerLanguage({ localized: true })).toBe(true);
    expect(storesPerLanguage({ localized: false })).toBe(false);
    expect(storesPerLanguage({})).toBe(false);
    expect(storesPerLanguage(undefined)).toBe(false);
    // Only `true` marks an entity translatable, as its stored flag is read everywhere else.
    expect(storesPerLanguage({ localized: 1 })).toBe(false);

    setPerLanguageStorage(true);
    expect(storesPerLanguage({ localized: false })).toBe(true);
    expect(storesPerLanguage({})).toBe(true);
    expect(storesPerLanguage(undefined)).toBe(true);
  });

  it("refuses a reloaded config that turns it on or off, and accepts one that keeps it", () => {
    expect(() => assertPerLanguageStorageUnchanged(undefined)).not.toThrow();
    expect(() => assertPerLanguageStorageUnchanged(false)).not.toThrow();
    let caught: unknown;
    try {
      assertPerLanguageStorageUnchanged(true);
    } catch (error) {
      caught = error;
    }
    expect(
      NextlyError.isCode(caught, "NEXTLY_PER_LANGUAGE_STORAGE_CHANGED")
    ).toBe(true);
    expect((caught as Error).message).toMatch(/Restart the site to change it/);

    setPerLanguageStorage(true);
    expect(() => assertPerLanguageStorageUnchanged(true)).not.toThrow();
    expect(() => assertPerLanguageStorageUnchanged(false)).toThrow(
      /chosen when the site starts/
    );
    expect(() => assertPerLanguageStorageUnchanged(undefined)).toThrow(
      /chosen when the site starts/
    );
  });
});
