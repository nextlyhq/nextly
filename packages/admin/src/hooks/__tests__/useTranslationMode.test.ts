// Which `?translate=` values put the editor into translation mode, and which
// resolve to "no source".
//
// Four inputs resolve to undefined and they are NOT interchangeable in the URL —
// absent, unconfigured, equal to the target, and equal to the target's implicit
// default. Each is a URL a user can arrive with, and each has to land on the
// ordinary editor rather than on a pane showing the document beside itself.

import { renderHook } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";

import { resolveConfiguredLocale } from "../useLocaleParam";
import { useTranslationMode } from "../useTranslationMode";

const { params, setSearchParam } = vi.hoisted(() => ({
  params: { current: {} as Record<string, string | undefined> },
  setSearchParam: vi.fn(),
}));

vi.mock("@admin/hooks/useSearchParams", () => ({
  useSearchParams: () => params.current,
}));
vi.mock("@admin/hooks/useLocalization", () => ({
  useLocalization: () => ({
    locales: [{ code: "en" }, { code: "es" }, { code: "ar" }],
  }),
}));
vi.mock("@admin/lib/navigation", () => ({
  setSearchParam: (...args: unknown[]) => setSearchParam(...args),
}));

function modeFor(
  translate: string | undefined,
  activeLocale: string | undefined,
  defaultLocale: string | undefined = "en"
) {
  params.current = translate === undefined ? {} : { translate };
  return renderHook(() => useTranslationMode({ activeLocale, defaultLocale }))
    .result.current;
}

describe("resolveConfiguredLocale", () => {
  const locales = [{ code: "en" }, { code: "es" }];

  it("honours a configured code", () => {
    expect(resolveConfiguredLocale("es", locales)).toBe("es");
  });

  it("rejects a code the app does not configure", () => {
    // A hand-edited or stale URL must not be sent to the API, which would
    // answer for a language the app does not have.
    expect(resolveConfiguredLocale("de", locales)).toBeUndefined();
  });

  it("treats an absent value as absent", () => {
    expect(resolveConfiguredLocale(null, locales)).toBeUndefined();
  });
});

describe("useTranslationMode", () => {
  beforeEach(() => setSearchParam.mockReset());

  it("is off when no source is named", () => {
    expect(modeFor(undefined, "es").translateFrom).toBeUndefined();
  });

  it("is on for a configured source that differs from the target", () => {
    expect(modeFor("en", "es").translateFrom).toBe("en");
  });

  it("is off for a source the app does not configure", () => {
    expect(modeFor("de", "es").translateFrom).toBeUndefined();
  });

  it("is off when the source IS the target", () => {
    // Reached by an ordinary action: enter the mode, then switch the target to
    // the language you were translating from.
    expect(modeFor("es", "es").translateFrom).toBeUndefined();
  });

  it("is off when the source is the target's IMPLICIT default", () => {
    // The same collision spelled differently: an absent `?locale=` means the
    // default, so `?translate=en` on an English-default app pairs English with
    // itself. Resolving only the explicit value would miss this.
    expect(modeFor("en", undefined, "en").translateFrom).toBeUndefined();
  });

  it("still resolves a real pair when the target is implicit", () => {
    // The negative control for the case above: it must not switch the mode off
    // for every implicit target, only for the one that collides.
    expect(modeFor("es", undefined, "en").translateFrom).toBe("es");
  });

  it("writes the source to the URL on enter, and clears it on exit", () => {
    const mode = modeFor(undefined, "es");
    mode.enterTranslationMode("en");
    expect(setSearchParam).toHaveBeenCalledWith("translate", "en");

    mode.exitTranslationMode();
    expect(setSearchParam).toHaveBeenLastCalledWith("translate", null);
  });
});
