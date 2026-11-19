import { afterEach, describe, expect, it, vi } from "vitest";

import {
  _resetPerLanguageStorage,
  perLanguageStorageEnabled,
  publishesPerLanguage,
  setPerLanguageStorage,
  storesPerLanguage,
  warnPerLanguageStorageSetting,
} from "../per-language-storage";

afterEach(() => _resetPerLanguageStorage());

/** A process that has not chosen yet: nothing pinned on `globalThis`, and a fresh module. */
async function freshProcess() {
  delete (globalThis as { __nextly_perLanguageStorage?: unknown })
    .__nextly_perLanguageStorage;
  vi.resetModules();
  return import("../per-language-storage");
}

describe("per-language storage", () => {
  it("is on for every installation, and off only where a test stands in for an earlier release", () => {
    expect(perLanguageStorageEnabled()).toBe(true);
    setPerLanguageStorage(false);
    expect(perLanguageStorageEnabled()).toBe(false);
    _resetPerLanguageStorage();
    expect(perLanguageStorageEnabled()).toBe(true);
  });

  it("stores an entity per language when it is translatable, or when the site stores every one so", () => {
    // An earlier release's layout: only a translatable entity kept its values per language.
    setPerLanguageStorage(false);
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

  it("says the configuration's setting is deprecated whichever way it is set, and chooses nothing by it", () => {
    for (const setting of [true, false]) {
      const warnings: string[] = [];
      warnPerLanguageStorageSetting(setting, message => warnings.push(message));
      expect(warnings).toEqual([
        expect.stringMatching(/deprecated and has no effect/),
      ]);
      expect(perLanguageStorageEnabled()).toBe(true);
    }
    const unset: string[] = [];
    warnPerLanguageStorageSetting(undefined, message => unset.push(message));
    expect(unset).toEqual([]);
  });

  it("is one layout across every copy of the module a server loads", async () => {
    // Next.js can load a module in more than one server graph, as a module reloaded by HMR is. A
    // test standing in for an earlier release is seen by every copy, so the layout it set holds.
    const booted = await freshProcess();
    booted.setPerLanguageStorage(false);
    vi.resetModules();
    const another = await import("../per-language-storage");
    expect(another.perLanguageStorageEnabled()).toBe(false);
    expect(another.storesPerLanguage({ localized: false })).toBe(false);
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
});
