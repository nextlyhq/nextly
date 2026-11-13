/**
 * A Single's SEO written as a step of its own: where reading it back to
 * check the write fails, or shows a value kept out, the group is put back
 * as it was, at the version the write left, and the refusal is passed on.
 */
import { describe, expect, it, vi } from "vitest";

import { saveSingleSeo } from "../route";
import { readSingle, restoreSingleSeo, writeSingleSeo } from "../singles";

vi.mock("../singles", async original => ({
  ...(await original<typeof import("../singles")>()),
  writeSingleSeo: vi.fn(() => Promise.resolve("rev-2")),
  readSingle: vi.fn(),
  restoreSingleSeo: vi.fn(() => Promise.resolve()),
}));

const PAGE = { type: "single:home", id: "s1", label: "Home", rev: "rev-1" };
const STORED = { seo: { metaDescription: "Before" } };

describe("saving a Single's SEO", () => {
  it("answers the version the write left where it reads back as sent", async () => {
    vi.mocked(readSingle).mockResolvedValueOnce({
      seo: { metaDescription: "Before", metaTitle: "Home" },
    });
    vi.mocked(restoreSingleSeo).mockClear();
    expect(
      await saveSingleSeo(
        { overrideAccess: true },
        PAGE,
        STORED,
        { metaTitle: "Home" },
        undefined
      )
    ).toBe("rev-2");
    expect(writeSingleSeo).toHaveBeenCalled();
    expect(restoreSingleSeo).not.toHaveBeenCalled();
  });

  it("puts the group back where reading it back fails", async () => {
    vi.mocked(readSingle).mockRejectedValueOnce(new Error("read failed"));
    vi.mocked(restoreSingleSeo).mockClear();
    await expect(
      saveSingleSeo(
        { overrideAccess: true },
        PAGE,
        STORED,
        { metaTitle: "Home" },
        undefined
      )
    ).rejects.toThrow("read failed");
    expect(restoreSingleSeo).toHaveBeenCalledWith(
      "home",
      undefined,
      STORED.seo,
      "rev-2"
    );
  });
});
