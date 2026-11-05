import { afterEach, describe, expect, it, vi } from "vitest";

import {
  resolveInterfaceLanguage,
  translate,
  type Catalogs,
} from "./translate";

const catalogs: Catalogs = {
  en: {
    greeting: "Hello",
    farewell: "Goodbye",
    welcome: "Welcome, {name}. {name} has {count} drafts.",
    partial: "{name} edited {title}",
  },
  fr: { greeting: "Bonjour" },
};

/** A key no other test names, since an unknown key is warned about once per process. */
let counter = 0;
const unknownKey = () => `nowhere.key${++counter}`;

describe("translate", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("returns the language's own string", () => {
    expect(translate(catalogs, "fr", "greeting")).toBe("Bonjour");
    expect(translate(catalogs, "en", "greeting")).toBe("Hello");
  });

  it("falls back to English for a missing key", () => {
    expect(translate(catalogs, "fr", "farewell")).toBe("Goodbye");
  });

  it("falls back to English for a language it has no catalog for", () => {
    expect(translate(catalogs, "de", "greeting")).toBe("Hello");
  });

  it("interpolates each parameter, every time it appears", () => {
    expect(
      translate(catalogs, "en", "welcome", { name: "Ana", count: 3 })
    ).toBe("Welcome, Ana. Ana has 3 drafts.");
  });

  it("leaves a placeholder with no parameter as written", () => {
    expect(translate(catalogs, "en", "partial", { name: "Ana" })).toBe(
      "Ana edited {title}"
    );
    expect(translate(catalogs, "en", "partial")).toBe("{name} edited {title}");
  });

  it("returns an unknown key as itself", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const key = unknownKey();

    expect(translate(catalogs, "fr", key)).toBe(key);
  });

  it("warns once per unknown key, in development", () => {
    vi.stubEnv("NODE_ENV", "development");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const first = unknownKey();
    const second = unknownKey();

    translate(catalogs, "en", first);
    translate(catalogs, "fr", first);
    translate(catalogs, "en", second);

    expect(warn.mock.calls.map(([message]) => String(message))).toEqual([
      expect.stringContaining(`"${first}"`),
      expect.stringContaining(`"${second}"`),
    ]);
  });

  it("says nothing in production", () => {
    vi.stubEnv("NODE_ENV", "production");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    translate(catalogs, "en", unknownKey());

    expect(warn).not.toHaveBeenCalled();
  });
});

describe("resolveInterfaceLanguage", () => {
  it("takes the first preferred language the admin has a catalog for", () => {
    expect(resolveInterfaceLanguage(["de", "fr", "en"], catalogs)).toBe("fr");
  });

  it("matches a regional language by its language alone", () => {
    expect(resolveInterfaceLanguage(["fr-CA"], catalogs)).toBe("fr");
  });

  it("falls back to English when it has a catalog for none of them", () => {
    expect(resolveInterfaceLanguage(["de", "ja"], catalogs)).toBe("en");
    expect(resolveInterfaceLanguage([], catalogs)).toBe("en");
  });
});
