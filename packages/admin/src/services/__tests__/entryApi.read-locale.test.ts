// i18n M4: the admin read paths (`find` list + `findByID` detail) forward `?locale=` and
// `?fallback-locale=` so the editor can request a single language and, with
// `fallback-locale=none`, render untranslated fields empty instead of leaking the default
// locale. Regression: these two calls previously emitted the camelCase `fallbackLocale`, which
// the server (collection-dispatcher reads `p["fallback-locale"]`) ignored — so `none` never
// took effect and every untranslated field fell back to the default language.

import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("../../lib/api/protectedApi", () => ({
  protectedApi: {
    get: vi.fn(async () => ({ id: "e1" })),
  },
}));

vi.mock("../../lib/api/fetcher", () => ({
  fetcher: vi.fn(async () => ({ data: [], meta: { total: 0 } })),
}));

import { protectedApi } from "../../lib/api/protectedApi";
import { fetcher } from "../../lib/api/fetcher";
import { entryApi } from "../entryApi";

const get = protectedApi.get as unknown as ReturnType<typeof vi.fn>;
const fetch = fetcher as unknown as ReturnType<typeof vi.fn>;

describe("entryApi read paths — locale + fallback-locale", () => {
  beforeEach(() => {
    get.mockClear();
    fetch.mockClear();
  });

  it("findByID forwards ?locale= and the hyphenated ?fallback-locale=", async () => {
    await entryApi.findByID("authors", "e1", {
      locale: "ar",
      fallbackLocale: "none",
    });
    const url = get.mock.calls[0][0] as string;
    expect(url).toContain("locale=ar");
    // Must be hyphenated to match the server contract — camelCase is silently dropped.
    expect(url).toContain("fallback-locale=none");
    expect(url).not.toContain("fallbackLocale=");
  });

  it("find (list) forwards the hyphenated ?fallback-locale=", async () => {
    await entryApi.find("authors", { locale: "ar", fallbackLocale: "none" });
    const url = fetch.mock.calls[0][0] as string;
    expect(url).toContain("locale=ar");
    expect(url).toContain("fallback-locale=none");
    expect(url).not.toContain("fallbackLocale=");
  });

  it("findByID omits fallback-locale when none is requested", async () => {
    await entryApi.findByID("authors", "e1", { locale: "ar" });
    const url = get.mock.calls[0][0] as string;
    expect(url).toContain("locale=ar");
    expect(url).not.toContain("fallback-locale");
  });
});
