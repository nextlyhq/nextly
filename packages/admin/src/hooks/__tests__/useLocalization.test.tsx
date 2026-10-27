import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useLocalization } from "../useLocalization";

let branding: { locales?: unknown } = {};

vi.mock("@admin/context/providers/BrandingProvider", () => ({
  useBranding: () => branding,
}));

const english = {
  code: "en",
  label: "English",
  rtl: false,
  fallbackLocale: [],
};
const french = { code: "fr", label: "French", rtl: false, fallbackLocale: [] };

describe("the admin's localization switch", () => {
  beforeEach(() => {
    branding = {};
  });

  it("is off for a site with no languages configured", () => {
    expect(renderHook(() => useLocalization()).result.current.enabled).toBe(
      false
    );
  });

  it("is off for a site with one language, so no language control appears", () => {
    branding = {
      locales: { defaultLocale: "en", fallback: true, locales: [english] },
    };

    expect(renderHook(() => useLocalization()).result.current.enabled).toBe(
      false
    );
  });

  it("is on once a site has a second language", () => {
    branding = {
      locales: {
        defaultLocale: "en",
        fallback: true,
        locales: [english, french],
      },
    };

    expect(renderHook(() => useLocalization()).result.current.enabled).toBe(
      true
    );
  });
});
