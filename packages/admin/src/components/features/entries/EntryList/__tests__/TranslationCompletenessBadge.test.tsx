import { describe, it, expect, vi, beforeEach } from "vitest";

import { render, screen } from "@admin/__tests__/utils";

import { TranslationCompletenessBadge } from "../TranslationCompletenessBadge";

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
    { code: "ar", label: "Arabic", rtl: true, fallbackLocale: [] },
  ],
};

describe("TranslationCompletenessBadge", () => {
  beforeEach(() => useBranding.mockReset());

  it("renders a dash when localization is not configured", () => {
    useBranding.mockReturnValue({ locales: undefined });
    render(
      <TranslationCompletenessBadge
        translations={{ en: { translated: true } }}
      />
    );
    expect(screen.getByText("-")).toBeInTheDocument();
  });

  it("renders a dash when the translations map is absent", () => {
    useBranding.mockReturnValue({ locales: LOCALES });
    render(<TranslationCompletenessBadge />);
    expect(screen.getByText("-")).toBeInTheDocument();
  });

  // L14: the denominator counts only the translatable (non-default) locales — the
  // default (en) is the source and is excluded, matching the list language filter.
  it("shows n/total translated (excluding the default) and lists the missing languages", () => {
    useBranding.mockReturnValue({ locales: LOCALES });
    render(
      <TranslationCompletenessBadge
        translations={{
          en: { translated: true },
          de: { translated: true },
          ar: { translated: false },
        }}
      />
    );
    // de + ar are translatable; de done, ar missing → 1/2.
    const badge = screen.getByText("1/2");
    expect(badge).toBeInTheDocument();
    expect(badge).toHaveAttribute("title", expect.stringContaining("Arabic"));
  });

  it("marks all translatable languages done as complete", () => {
    useBranding.mockReturnValue({ locales: LOCALES });
    render(
      <TranslationCompletenessBadge
        translations={{
          en: { translated: true },
          de: { translated: true },
          ar: { translated: true },
        }}
      />
    );
    // Two non-default locales, both translated → 2/2, complete.
    const badge = screen.getByText("2/2");
    expect(badge).toHaveAttribute("title", "All languages translated");
  });
});
