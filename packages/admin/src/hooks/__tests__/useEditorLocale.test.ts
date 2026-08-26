// The editor's language, and the seed a switch can carry with it.
//
// The language lives in the URL and the seed does not, and that split is the
// thing worth pinning: the language is where you are — linkable, reloadable,
// reachable with the back button, and visible to the unsaved-changes guard as a
// navigation. The seed is a one-shot intent consumed on arrival, which in a URL
// would survive a reload and be carried into any link the author shared.
import { renderHook, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";

import { useEditorLocale } from "../useEditorLocale";

const useBranding = vi.fn();
vi.mock("@admin/context/providers/BrandingProvider", () => ({
  useBranding: () => useBranding(),
}));

const LOCALES = {
  defaultLocale: "en",
  fallback: true,
  locales: [
    { code: "en", label: "English", rtl: false, fallbackLocale: [] },
    { code: "de", label: "German", rtl: false, fallbackLocale: [] },
    { code: "fr", label: "French", rtl: false, fallbackLocale: [] },
  ],
};

const AT = "/admin/collections/posts/1";
const go = (search = "") =>
  window.history.replaceState(null, "", `${AT}${search}`);

describe("useEditorLocale", () => {
  beforeEach(() => {
    useBranding.mockReturnValue({ locales: LOCALES });
    go();
  });

  it("starts on the app default, with nothing to seed", () => {
    const { result } = renderHook(() => useEditorLocale());
    expect(result.current.locale).toBeUndefined();
    expect(result.current.seedFromLocale).toBeUndefined();
  });

  it("reads the language out of the URL", () => {
    go("?locale=de");
    const { result } = renderHook(() => useEditorLocale());
    expect(result.current.locale).toBe("de");
  });

  it("ignores a language the app does not configure", () => {
    // A hand-edited or stale link would otherwise be sent to the API, which
    // answers for a language that does not exist. The default is a usable
    // answer; an error the reader cannot act on is not.
    go("?locale=zz");
    const { result } = renderHook(() => useEditorLocale());
    expect(result.current.locale).toBeUndefined();
  });

  it("withholds the seed until the switch actually lands", () => {
    // Asking for a language is not arriving in it. On a dirty form the
    // unsaved-changes guard holds the navigation until the author answers, and
    // through that whole wait the language being edited is still the SOURCE.
    // A seed offered then names the language already on screen, and every
    // consumer rightly reads that as "copy this onto itself" and throws it
    // away — so the copy the author was promised never happened once they
    // chose "Discard changes".
    go("?locale=en");
    const { result, rerender } = renderHook(() => useEditorLocale());

    act(() => result.current.changeLocale("de", { seedFrom: "en" }));

    // The guard has not let the navigation through yet: still on English.
    go("?locale=en");
    rerender();
    expect(result.current.locale).toBe("en");
    expect(result.current.seedFromLocale).toBeUndefined();

    // The author discards, the navigation completes, and the seed appears.
    go("?locale=de");
    rerender();
    expect(result.current.locale).toBe("de");
    expect(result.current.seedFromLocale).toBe("en");
  });

  it("never offers a seed for a switch that was abandoned", () => {
    // The other half of the same rule. If the author cancels instead of
    // discarding, the intent must not survive to fire against some later
    // language they did choose.
    go("?locale=en");
    const { result, rerender } = renderHook(() => useEditorLocale());

    act(() => result.current.changeLocale("de", { seedFrom: "en" }));
    go("?locale=fr");
    rerender();

    expect(result.current.locale).toBe("fr");
    expect(result.current.seedFromLocale).toBeUndefined();
  });

  it("puts the language in the URL when it changes", () => {
    const { result } = renderHook(() => useEditorLocale());
    act(() => result.current.changeLocale("de"));
    expect(window.location.search).toBe("?locale=de");
  });

  it("leaves the rest of the query alone", () => {
    // The list's filter lives in the same query string.
    go("?where=%7B%7D&page=2");
    const { result } = renderHook(() => useEditorLocale());
    act(() => result.current.changeLocale("fr"));
    const params = new URLSearchParams(window.location.search);
    expect(params.get("locale")).toBe("fr");
    expect(params.get("where")).toBe("{}");
    expect(params.get("page")).toBe("2");
  });

  it("returns to the default by removing the parameter, not by naming it", () => {
    // The default is the ABSENCE of a choice, so the URL says nothing rather
    // than saying "en" — otherwise two URLs mean the same document.
    go("?locale=de");
    const { result } = renderHook(() => useEditorLocale());
    act(() => result.current.resetLocale());
    expect(window.location.search).toBe("");
  });

  it("carries the seed alongside the language it was asked for", () => {
    const { result } = renderHook(() => useEditorLocale());
    act(() => result.current.changeLocale("de", { seedFrom: "en" }));
    expect(window.location.search).toBe("?locale=de");
    expect(result.current.seedFromLocale).toBe("en");
  });

  it("keeps the seed OUT of the URL", () => {
    const { result } = renderHook(() => useEditorLocale());
    act(() => result.current.changeLocale("de", { seedFrom: "en" }));
    expect(window.location.search).not.toContain("seed");
  });

  it("drops a previous seed on the next plain switch", () => {
    // Otherwise a copy the author asked for two languages ago is re-offered in
    // a language they never asked it for.
    const { result } = renderHook(() => useEditorLocale());
    act(() => result.current.changeLocale("de", { seedFrom: "en" }));
    act(() => result.current.changeLocale("fr"));
    expect(result.current.seedFromLocale).toBeUndefined();
  });

  it("clears the seed once the editor has offered it, keeping the language", () => {
    go("?locale=de");
    const { result } = renderHook(() => useEditorLocale());
    act(() => result.current.changeLocale("de", { seedFrom: "en" }));
    act(() => result.current.clearSeed());
    expect(result.current.seedFromLocale).toBeUndefined();
    expect(result.current.locale).toBe("de");
  });

  it("abandons a pending seed when returning to the default language", () => {
    const { result } = renderHook(() => useEditorLocale());
    act(() => result.current.changeLocale("de", { seedFrom: "en" }));
    act(() => result.current.resetLocale());
    expect(result.current.seedFromLocale).toBeUndefined();
    expect(result.current.locale).toBeUndefined();
  });
});
