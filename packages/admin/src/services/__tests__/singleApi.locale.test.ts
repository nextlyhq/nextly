// i18n: the Single document read/write API forwards the content locale so the editor can request
// a single language and, with `fallback-locale=none`, render untranslated fields empty instead of
// leaking the default locale. The server (single-dispatcher) reads the hyphenated `fallback-locale`
// + `translation-status`; sending camelCase would be silently dropped (mirrors the collection
// entryApi bug). These tests pin the exact query-param names.

import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("../../lib/api/protectedApi", () => ({
  protectedApi: {
    get: vi.fn(async () => ({ id: "s1" })),
    patch: vi.fn(async () => ({ message: "ok", item: { id: "s1" } })),
  },
}));

import { protectedApi } from "../../lib/api/protectedApi";
import { singleApi } from "../singleApi";

const get = protectedApi.get as unknown as ReturnType<typeof vi.fn>;
const patch = protectedApi.patch as unknown as ReturnType<typeof vi.fn>;

describe("singleApi.getDocument — locale params", () => {
  beforeEach(() => get.mockClear());

  it("forwards ?locale=, hyphenated ?fallback-locale=, and ?translation-status=1", async () => {
    await singleApi.getDocument("site-settings", {
      locale: "ar",
      fallbackLocale: "none",
      translationStatus: true,
    });
    const url = get.mock.calls[0][0] as string;
    expect(url).toContain("locale=ar");
    // Must be hyphenated to match the server contract — camelCase is silently dropped.
    expect(url).toContain("fallback-locale=none");
    expect(url).not.toContain("fallbackLocale=");
    expect(url).toContain("translation-status=1");
  });

  it("omits locale params when none are given (non-localized path unchanged)", async () => {
    await singleApi.getDocument("site-settings");
    const url = get.mock.calls[0][0] as string;
    expect(url).not.toContain("locale=");
    expect(url).not.toContain("fallback-locale");
    expect(url).not.toContain("translation-status");
  });
});

describe("singleApi.updateDocument — write locale", () => {
  beforeEach(() => patch.mockClear());

  it("appends ?locale= so the save targets the active language", async () => {
    await singleApi.updateDocument("site-settings", { tagline: "T" }, { locale: "ar" });
    const url = patch.mock.calls[0][0] as string;
    expect(url).toContain("/singles/site-settings?locale=ar");
  });

  it("omits the query string when no locale is given", async () => {
    await singleApi.updateDocument("site-settings", { tagline: "T" });
    const url = patch.mock.calls[0][0] as string;
    expect(url).toBe("/singles/site-settings");
  });
});
