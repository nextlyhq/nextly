import { describe, expect, it, vi } from "vitest";

import type { StoredLanguage } from "./config/stored-languages";
import type { SanitizedLocalizationConfig } from "./config/types";
import {
  LanguageRegistry,
  type StoredLanguageReader,
} from "./language-registry";

const english: StoredLanguage = {
  code: "en",
  label: "English",
  direction: "ltr",
  fallback: "[]",
  position: 0,
  isDefault: true,
  active: true,
};
const french: StoredLanguage = {
  ...english,
  code: "fr",
  label: "French",
  position: 1,
  isDefault: false,
};

/** A reader over rows the test changes, counting what the registry asks of it. */
function storedRows(initial: StoredLanguage[]) {
  let rows = initial;
  let revision = 1;
  const reader = {
    fingerprint: vi.fn(async () => `${rows.length}:${revision}`),
    rows: vi.fn(async () => rows),
  } satisfies StoredLanguageReader;
  return {
    reader,
    set(next: StoredLanguage[]) {
      rows = next;
      revision += 1;
    },
  };
}

const codes = (l: SanitizedLocalizationConfig | undefined) =>
  l?.locales.map(locale => locale.code);

describe("the language registry", () => {
  it("serves the configuration's languages when the configuration declares them, and reads nothing", async () => {
    const stored = storedRows([french]);
    const configured: SanitizedLocalizationConfig = {
      locales: [
        { code: "de", label: "German", rtl: false, fallbackLocale: [] },
      ],
      defaultLocale: "de",
      fallback: true,
    };
    const registry = new LanguageRegistry({
      configured,
      reader: stored.reader,
    });

    await registry.refresh();

    expect(registry.lockedByConfig).toBe(true);
    expect(registry.current()).toBe(configured);
    expect(stored.reader.fingerprint).not.toHaveBeenCalled();
  });

  it("is no localization while nothing is stored", async () => {
    const stored = storedRows([]);
    const registry = new LanguageRegistry({ reader: stored.reader });

    await registry.refresh();

    expect(registry.current()).toBeUndefined();
  });

  it("asks for the fingerprint at most once per interval, and reads the rows only when it changes", async () => {
    let now = 0;
    const stored = storedRows([english]);
    const registry = new LanguageRegistry({
      reader: stored.reader,
      ttlMs: 1000,
      now: () => now,
    });

    await registry.refresh();
    await registry.refresh();
    expect(stored.reader.fingerprint).toHaveBeenCalledTimes(1);
    expect(stored.reader.rows).toHaveBeenCalledTimes(1);

    now = 1500;
    await registry.refresh();
    expect(stored.reader.fingerprint).toHaveBeenCalledTimes(2);
    expect(stored.reader.rows).toHaveBeenCalledTimes(1);

    stored.set([english, french]);
    now = 3000;
    await registry.refresh();
    expect(stored.reader.rows).toHaveBeenCalledTimes(2);
    expect(codes(registry.current())).toEqual(["en", "fr"]);
  });

  it("shares one read between refreshes made at the same time", async () => {
    const stored = storedRows([english]);
    const registry = new LanguageRegistry({ reader: stored.reader });

    await Promise.all([
      registry.refresh(),
      registry.refresh(),
      registry.refresh(),
    ]);

    expect(stored.reader.fingerprint).toHaveBeenCalledTimes(1);
  });

  it("keeps one list for the whole of a request, while a change made meanwhile reaches the next", async () => {
    let now = 0;
    const stored = storedRows([english]);
    const registry = new LanguageRegistry({
      reader: stored.reader,
      ttlMs: 1000,
      now: () => now,
    });
    await registry.refresh();

    const seen = await registry.runWithSnapshot(async () => {
      const before = codes(registry.current());
      stored.set([english, french]);
      now = 5000;
      await registry.refresh();
      return { before, during: codes(registry.current()) };
    });

    expect(seen).toEqual({ before: ["en"], during: ["en"] });
    expect(codes(registry.current())).toEqual(["en", "fr"]);
  });

  it("reads a forced refresh straight away, as the instance that changed the list does", async () => {
    const stored = storedRows([english]);
    const registry = new LanguageRegistry({
      reader: stored.reader,
      ttlMs: 60_000,
    });
    await registry.refresh();

    stored.set([english, french]);
    await registry.refresh({ force: true });

    expect(codes(registry.current())).toEqual(["en", "fr"]);
  });
});
