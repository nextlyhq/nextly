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

  it("shows n/total translated and lists the missing languages", () => {
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
    const badge = screen.getByText("2/3");
    expect(badge).toBeInTheDocument();
    expect(badge).toHaveAttribute("title", expect.stringContaining("Arabic"));
  });

  it("marks all-translated as complete", () => {
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
    const badge = screen.getByText("3/3");
    expect(badge).toHaveAttribute("title", "All languages translated");
  });
});
