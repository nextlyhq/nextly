import { afterEach, describe, expect, it, vi } from "vitest";

import { NextlyError } from "../../../errors/nextly-error";
import {
  assertPerLanguageStorageUnchanged,
  perLanguageStorageEnabled,
  publishesPerLanguage,
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

  it("adopts a config's choice in a process that has not chosen, and keeps a boot's choice", async () => {
    // A fresh instance of the module: this file's other cases have already chosen.
    vi.resetModules();
    const fresh = await import("../per-language-storage");
    fresh.adoptPerLanguageStorage(true);
    expect(fresh.perLanguageStorageEnabled()).toBe(true);
    // Once chosen, a later config read leaves it, as a running site's reload does.
    fresh.adoptPerLanguageStorage(false);
    expect(fresh.perLanguageStorageEnabled()).toBe(true);

    vi.resetModules();
    const booted = await import("../per-language-storage");
    booted.setPerLanguageStorage(false);
    booted.adoptPerLanguageStorage(true);
    expect(booted.perLanguageStorageEnabled()).toBe(false);
  });

  it("publishes each language on its own only for a translatable entity with Draft/Published", () => {
    expect(publishesPerLanguage({ localized: true, status: true })).toBe(true);
    expect(publishesPerLanguage({ localized: true, status: false })).toBe(
      false
    );
    // Stored per language without being translatable: it publishes as a document, whatever the setting.
    setPerLanguageStorage(true);
    expect(publishesPerLanguage({ localized: false, status: true })).toBe(
      false
    );
    expect(publishesPerLanguage({ status: true })).toBe(false);
    expect(publishesPerLanguage(undefined)).toBe(false);
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
