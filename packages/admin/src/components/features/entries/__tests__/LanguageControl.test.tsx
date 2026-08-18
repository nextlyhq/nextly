import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi, beforeEach } from "vitest";

import { render, screen } from "@admin/__tests__/utils";

import { LanguageControl, languageState } from "../LanguageControl";

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

describe("languageState", () => {
  it("resolves each state from the translation meta", () => {
    expect(languageState(undefined)).toBe("missing");
    expect(languageState({ translated: false })).toBe("missing");
    expect(languageState({ translated: true, status: "draft" })).toBe("draft");
    expect(languageState({ translated: true, status: "published" })).toBe(
      "published"
    );
    expect(languageState({ translated: true })).toBe("translated");
  });
});

describe("LanguageControl", () => {
  beforeEach(() => useBranding.mockReset());

  it("renders nothing when localization is not configured", () => {
    useBranding.mockReturnValue({ locales: undefined });
    const { container } = render(
      <LanguageControl translations={TRANSLATIONS} onSelect={() => {}} />
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("renders one pressable segment per language, state in the accessible name", () => {
    useBranding.mockReturnValue({ locales: LOCALES });
    render(
      <LanguageControl
        translations={TRANSLATIONS}
        activeLocale="en"
        onSelect={() => {}}
      />
    );
    // The name carries language AND state, so neither is colour-only.
    expect(
      screen.getByRole("button", { name: "English — published (default)" })
    ).toHaveAttribute("aria-pressed", "true");
    expect(
      screen.getByRole("button", { name: "German — draft" })
    ).toHaveAttribute("aria-pressed", "false");
    expect(
      screen.getByRole("button", { name: "Arabic — not translated" })
    ).toBeInTheDocument();
  });

  it("treats an ABSENT translations map as every language missing, not as nothing to render", () => {
    // The map only arrives with `?translation-status=1`; before it does, the
    // switcher must still switch.
    useBranding.mockReturnValue({ locales: LOCALES });
    render(<LanguageControl onSelect={() => {}} />);
    expect(
      screen.getByRole("button", { name: "German — not translated" })
    ).toBeInTheDocument();
  });

  it("switches on press", async () => {
    useBranding.mockReturnValue({ locales: LOCALES });
    const onSelect = vi.fn();
    render(
      <LanguageControl
        translations={TRANSLATIONS}
        activeLocale="en"
        onSelect={onSelect}
      />
    );
    await userEvent.click(screen.getByRole("button", { name: /German/ }));
    expect(onSelect).toHaveBeenCalledWith("de");
  });

  it("withholds switching while disabled, keeping the states readable", async () => {
    useBranding.mockReturnValue({ locales: LOCALES });
    const onSelect = vi.fn();
    render(
      <LanguageControl
        translations={TRANSLATIONS}
        activeLocale="en"
        onSelect={onSelect}
        disabled
      />
    );
    const german = screen.getByRole("button", { name: /German/ });
    expect(german).toBeDisabled();
    await userEvent.click(german);
    expect(onSelect).not.toHaveBeenCalled();
  });
});
