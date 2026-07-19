// i18n M7: entryApi.update forwards the content locale as `?locale=` so an edit in the admin's
// active language updates only that language's translatable values.

import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("../../lib/api/protectedApi", () => ({
  protectedApi: {
    patch: vi.fn(async () => ({ message: "ok", item: { id: "e1" } })),
  },
}));

import { protectedApi } from "../../lib/api/protectedApi";
import { entryApi } from "../entryApi";

const patch = protectedApi.patch as unknown as ReturnType<typeof vi.fn>;

describe("entryApi.update — locale", () => {
  beforeEach(() => patch.mockClear());

  it("appends ?locale= when a locale is provided", async () => {
    await entryApi.update("posts", "e1", { title: "T" }, { locale: "de" });
    const url = patch.mock.calls[0][0] as string;
    expect(url).toBe("/collections/posts/entries/e1?locale=de");
  });

  it("appends fallback-locale too when provided", async () => {
    await entryApi.update(
      "posts",
      "e1",
      { title: "T" },
      { locale: "de", fallbackLocale: "en" }
    );
    const url = patch.mock.calls[0][0] as string;
    expect(url).toContain("locale=de");
    expect(url).toContain("fallback-locale=en");
  });

  it("omits the query string when no locale is given (non-localized path unchanged)", async () => {
    await entryApi.update("posts", "e1", { title: "T" });
    const url = patch.mock.calls[0][0] as string;
    expect(url).toBe("/collections/posts/entries/e1");
  });
});
