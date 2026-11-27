/**
 * An editor address naming a language moves on once, in place, and only where
 * there is a translation page to move to. Every case that stays put is paired
 * with the same address moving, so a hook that never moved anything fails here.
 */
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useLanguageAddressRedirect } from "../useLanguageAddressRedirect";

const useBranding = vi.fn();
vi.mock("@admin/context/providers/BrandingProvider", () => ({
  useBranding: () => useBranding(),
}));

const LANGUAGES = {
  defaultLocale: "en",
  fallback: true,
  locales: [
    { code: "en", label: "English", rtl: false, fallbackLocale: [] },
    { code: "es", label: "Spanish", rtl: false, fallbackLocale: [] },
    { code: "ar", label: "Arabic", rtl: true, fallbackLocale: [] },
  ],
};

const EDITOR = "/admin/collections/posts/p1";
const PAGE = "/admin/translations/collections/posts/p1";

type Options = Parameters<typeof useLanguageAddressRedirect>[0];
const POST: Options = {
  document: { kind: "collection", slug: "posts", id: "p1" },
  localized: true,
  view: undefined,
  copyingFrom: undefined,
};

const here = () => `${window.location.pathname}${window.location.search}`;
const go = (search: string, path = EDITOR) =>
  window.history.replaceState(null, "", `${path}${search}`);

function open(search: string, options: Partial<Options> = {}) {
  go(search);
  return renderHook((props: Options) => useLanguageAddressRedirect(props), {
    initialProps: { ...POST, ...options },
  });
}

beforeEach(() => {
  useBranding.mockReturnValue({ locales: LANGUAGES });
});

describe("useLanguageAddressRedirect", () => {
  it("takes both keys off an address in the default language", () => {
    open("?locale=en&translate=es&tab=content");
    // The rest of the address is the editor's own, and stays.
    expect(here()).toBe(`${EDITOR}?tab=content`);
  });

  it("moves a language with a source to its page, from that source", () => {
    open("?locale=es&translate=ar");
    expect(here()).toBe(`${PAGE}?locale=es&source=ar`);
  });

  it("moves a language alone to its page", () => {
    open("?locale=es");
    expect(here()).toBe(`${PAGE}?locale=es`);
  });

  it("moves a Single by its slug", () => {
    open("?locale=ar", { document: { kind: "single", slug: "banner" } });
    expect(here()).toBe("/admin/translations/singles/banner?locale=ar");
  });

  it("stands in for the old address, so Back does not land on it", () => {
    const before = window.history.length;
    open("?locale=es");
    expect(here()).toBe(`${PAGE}?locale=es`);
    expect(window.history.length).toBe(before);
  });

  it("leaves an address naming no language, or one the site lacks", () => {
    open("");
    expect(here()).toBe(EDITOR);
    open("?locale=xx");
    expect(here()).toBe(`${EDITOR}?locale=xx`);
  });

  it("leaves a document that keeps one text for every language", () => {
    open("?locale=es", { localized: false });
    expect(here()).toBe(`${EDITOR}?locale=es`);
  });

  it("moves once the document is known to keep text per language", () => {
    const { rerender } = open("?locale=es", { localized: false });
    expect(here()).toBe(`${EDITOR}?locale=es`);
    rerender(POST);
    expect(here()).toBe(`${PAGE}?locale=es`);
  });

  it("leaves a document view, which the editor's page also answers", () => {
    open("?locale=es", { view: "builder" });
    expect(here()).toBe(`${EDITOR}?locale=es`);
  });

  it("leaves everything on a site with one language", () => {
    useBranding.mockReturnValue({
      locales: { ...LANGUAGES, locales: LANGUAGES.locales.slice(0, 1) },
    });
    open("?locale=es");
    expect(here()).toBe(`${EDITOR}?locale=es`);
  });

  it("waits for the site's languages, then moves", () => {
    useBranding.mockReturnValue({});
    const { rerender } = open("?locale=es");
    expect(here()).toBe(`${EDITOR}?locale=es`);
    useBranding.mockReturnValue({ locales: LANGUAGES });
    rerender({ ...POST });
    expect(here()).toBe(`${PAGE}?locale=es`);
  });

  it("leaves an address opening history, which the editor alone shows", () => {
    open("?locale=es&history=1");
    expect(here()).toBe(`${EDITOR}?locale=es&history=1`);
    // Only an open panel: the key without it is an ordinary address.
    open("?locale=es&history=0");
    expect(here()).toBe(`${PAGE}?locale=es`);
  });

  describe("while a copy from another language is under way", () => {
    it("stays on the editor, where the copied values are", () => {
      const { rerender } = open("?locale=es", { copyingFrom: "en" });
      expect(here()).toBe(`${EDITOR}?locale=es`);
      // The editor forgets the request once it has offered the copy; the
      // values are still unsaved in its form.
      rerender(POST);
      expect(here()).toBe(`${EDITOR}?locale=es`);
    });

    it("moves a language opened after it", () => {
      const { rerender } = open("?locale=es", { copyingFrom: "en" });
      rerender(POST);
      act(() => {
        go("?locale=ar");
        window.dispatchEvent(new Event("locationchange"));
      });
      expect(here()).toBe(`${PAGE}?locale=ar`);
    });
  });
});
