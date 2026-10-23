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

  it("makes no read while the caller's transaction is open, forced or not", async () => {
    // A read there would take a second connection from the pool: outside the transaction, and
    // able to stall a small pool. The list already held serves until the transaction ends.
    let now = 0;
    let inTransaction = false;
    const stored = storedRows([english]);
    const registry = new LanguageRegistry({
      reader: { ...stored.reader, inOpenTransaction: () => inTransaction },
      ttlMs: 1000,
      now: () => now,
    });
    await registry.refresh();

    stored.set([english, french]);
    now = 5000;
    inTransaction = true;
    await registry.refresh();
    await registry.refresh({ force: true });

    expect(stored.reader.fingerprint).toHaveBeenCalledTimes(1);
    expect(codes(registry.current())).toEqual(["en"]);

    inTransaction = false;
    await registry.refresh();
    expect(codes(registry.current())).toEqual(["en", "fr"]);
  });

  it("brings the list up to date before pinning it for a call", async () => {
    let now = 0;
    const stored = storedRows([english]);
    const registry = new LanguageRegistry({
      reader: stored.reader,
      ttlMs: 1000,
      now: () => now,
    });
    await registry.refresh();

    stored.set([english, french]);
    now = 5000;
    const seen = await registry.runWithLatest(async () => {
      const before = codes(registry.current());
      stored.set([english]);
      await registry.refresh({ force: true });
      return { before, during: codes(registry.current()) };
    });

    expect(seen).toEqual({ before: ["en", "fr"], during: ["en", "fr"] });
  });

  it("keeps the enclosing call's list for a call made inside it, and reads nothing", async () => {
    // A hook's own call, say: it belongs to the call that set it going, which already chose a list.
    let now = 0;
    const stored = storedRows([english]);
    const registry = new LanguageRegistry({
      reader: stored.reader,
      ttlMs: 1000,
      now: () => now,
    });
    await registry.refresh();

    const inner = await registry.runWithSnapshot(async () => {
      stored.set([english, french]);
      now = 5000;
      return registry.runWithLatest(async () => codes(registry.current()));
    });

    expect(inner).toEqual(["en"]);
    expect(stored.reader.fingerprint).toHaveBeenCalledTimes(1);
  });

  it("keeps a forced refresh's list when an older read started before it finishes after it", async () => {
    // The older read gets as far as the rows and is held there, still holding the list as it was.
    let releaseOlderRows: (rows: StoredLanguage[]) => void = () => {};
    let revision = 1;
    let rowsNow = [english];
    const reader: StoredLanguageReader = {
      fingerprint: async () => `${rowsNow.length}:${revision}`,
      rows: vi
        .fn<() => Promise<StoredLanguage[]>>()
        .mockImplementationOnce(
          () =>
            new Promise(resolve => {
              releaseOlderRows = resolve;
            })
        )
        .mockImplementation(async () => rowsNow),
    };
    const registry = new LanguageRegistry({ reader, ttlMs: 60_000 });

    const older = registry.refresh();
    await vi.waitFor(() => expect(reader.rows).toHaveBeenCalledTimes(1));

    rowsNow = [english, french];
    revision = 2;
    await registry.refresh({ force: true });
    releaseOlderRows([english]);
    await older;

    expect(codes(registry.current())).toEqual(["en", "fr"]);
  });
});
