/**
 * Whether a language is live, decided from the statuses each path reads.
 */
import { describe, expect, it } from "vitest";

import { languageIsLive } from "./language-lifecycle";

const base = {
  defaultLocale: "en",
  perLanguageStatus: true,
} as const;

describe("languageIsLive", () => {
  it("judges the part with no language by the main row", () => {
    expect(
      languageIsLive({
        ...base,
        mainStatus: "published",
        ownStatus: null,
        locale: null,
      })
    ).toBe(true);
    expect(
      languageIsLive({
        ...base,
        mainStatus: "draft",
        ownStatus: null,
        locale: null,
      })
    ).toBe(false);
  });

  it("judges every language by the main row without status per language", () => {
    const flat = { ...base, perLanguageStatus: false };
    expect(
      languageIsLive({
        ...flat,
        mainStatus: "published",
        ownStatus: null,
        locale: "de",
      })
    ).toBe(true);
    expect(
      languageIsLive({
        ...flat,
        mainStatus: "draft",
        ownStatus: "published",
        locale: "de",
      })
    ).toBe(false);
  });

  it("needs the main row and the default language's own status live", () => {
    expect(
      languageIsLive({
        ...base,
        mainStatus: "published",
        ownStatus: null,
        locale: "en",
      })
    ).toBe(true);
    expect(
      languageIsLive({
        ...base,
        mainStatus: "published",
        ownStatus: "draft",
        locale: "en",
      })
    ).toBe(false);
    expect(
      languageIsLive({
        ...base,
        mainStatus: "draft",
        ownStatus: "published",
        locale: "en",
      })
    ).toBe(false);
  });

  it("counts any state the workflow calls public as live", () => {
    const workflow = {
      name: "reviewed",
      states: [
        { name: "draft", isPublic: false },
        { name: "approved", isPublic: false },
        { name: "live", isPublic: true },
      ],
    };
    const statuses = { ...base, ownStatus: null, locale: null, workflow };
    expect(languageIsLive({ ...statuses, mainStatus: "live" })).toBe(true);
    expect(languageIsLive({ ...statuses, mainStatus: "approved" })).toBe(false);
    // A word the workflow does not declare is not public.
    expect(languageIsLive({ ...statuses, mainStatus: "published" })).toBe(
      false
    );
  });

  it("lets a due release make the main row live, but not a withdrawn translation", () => {
    const revealed = { ...base, mainStatus: "draft", mainRevealed: true };
    expect(languageIsLive({ ...revealed, ownStatus: null, locale: null })).toBe(
      true
    );
    expect(
      languageIsLive({ ...revealed, ownStatus: "draft", locale: "de" })
    ).toBe(false);
    expect(
      languageIsLive({ ...revealed, ownStatus: "published", locale: "de" })
    ).toBe(true);
  });

  it("judges another language by the main row and its own status", () => {
    expect(
      languageIsLive({
        ...base,
        mainStatus: "published",
        ownStatus: "draft",
        locale: "de",
      })
    ).toBe(false);
    expect(
      languageIsLive({
        ...base,
        mainStatus: "draft",
        ownStatus: "published",
        locale: "de",
      })
    ).toBe(false);
    expect(
      languageIsLive({
        ...base,
        mainStatus: "published",
        ownStatus: "published",
        locale: "de",
      })
    ).toBe(true);
    // No translation row: nothing of its own is live.
    expect(
      languageIsLive({
        ...base,
        mainStatus: "published",
        ownStatus: null,
        locale: "de",
      })
    ).toBe(false);
  });
});
