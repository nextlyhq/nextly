import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi, beforeEach } from "vitest";

import { render, screen } from "@admin/__tests__/utils";

import { LanguageStatusPills } from "../LanguageStatusPills";

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

const TRANSLATIONS = {
  en: { translated: true, status: "published" },
  de: { translated: true, status: "draft" },
  ar: { translated: false },
};

describe("LanguageStatusPills", () => {
  beforeEach(() => useBranding.mockReset());

  it("renders nothing when localization is not configured", () => {
    useBranding.mockReturnValue({ locales: undefined });
    const { container } = render(
      <LanguageStatusPills translations={TRANSLATIONS} />
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing when the translations map is absent", () => {
    useBranding.mockReturnValue({ locales: LOCALES });
    const { container } = render(<LanguageStatusPills />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders one pill per configured language", () => {
    useBranding.mockReturnValue({ locales: LOCALES });
    render(
      <LanguageStatusPills translations={TRANSLATIONS} activeLocale="en" />
    );
    expect(screen.getByRole("button", { name: /English/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /German/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Arabic/ })).toBeInTheDocument();
  });

  it("labels each pill with its translation state", () => {
    useBranding.mockReturnValue({ locales: LOCALES });
    render(
      <LanguageStatusPills translations={TRANSLATIONS} activeLocale="en" />
    );
    expect(
      screen.getByRole("button", { name: /English — published/ })
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /German — draft/ })
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Arabic — not translated/ })
    ).toBeInTheDocument();
  });

  it("marks the active locale as pressed", () => {
    useBranding.mockReturnValue({ locales: LOCALES });
    render(
      <LanguageStatusPills translations={TRANSLATIONS} activeLocale="de" />
    );
    expect(screen.getByRole("button", { name: /German/ })).toHaveAttribute(
      "aria-pressed",
      "true"
    );
    expect(screen.getByRole("button", { name: /English/ })).toHaveAttribute(
      "aria-pressed",
      "false"
    );
  });

  it("calls onSelect with the locale code when a pill is clicked", async () => {
    useBranding.mockReturnValue({ locales: LOCALES });
    const onSelect = vi.fn();
    render(
      <LanguageStatusPills
        translations={TRANSLATIONS}
        activeLocale="en"
        onSelect={onSelect}
      />
    );
    await userEvent.click(screen.getByRole("button", { name: /German/ }));
    expect(onSelect).toHaveBeenCalledWith("de");
  });
});
