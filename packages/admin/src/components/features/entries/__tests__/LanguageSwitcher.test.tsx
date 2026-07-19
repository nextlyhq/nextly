import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi, beforeEach } from "vitest";

import { render, screen } from "@admin/__tests__/utils";

import { LanguageSwitcher } from "../LanguageSwitcher";

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

describe("LanguageSwitcher", () => {
  beforeEach(() => useBranding.mockReset());

  it("renders nothing when localization is not configured", () => {
    useBranding.mockReturnValue({ locales: undefined });
    const { container } = render(
      <LanguageSwitcher value="en" onChange={() => {}} />
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing when only one locale is configured", () => {
    useBranding.mockReturnValue({
      locales: {
        defaultLocale: "en",
        fallback: true,
        locales: [
          { code: "en", label: "English", rtl: false, fallbackLocale: [] },
        ],
      },
    });
    const { container } = render(
      <LanguageSwitcher value="en" onChange={() => {}} />
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("shows the active locale's label on the trigger", () => {
    useBranding.mockReturnValue({ locales: LOCALES });
    render(<LanguageSwitcher value="de" onChange={() => {}} />);
    expect(
      screen.getByRole("button", { name: /content language/i })
    ).toHaveTextContent("German");
  });

  it("falls back to the default locale label when value is undefined", () => {
    useBranding.mockReturnValue({ locales: LOCALES });
    render(<LanguageSwitcher onChange={() => {}} />);
    expect(
      screen.getByRole("button", { name: /content language/i })
    ).toHaveTextContent("English");
  });

  it("calls onChange with the chosen locale code", async () => {
    useBranding.mockReturnValue({ locales: LOCALES });
    const onChange = vi.fn();
    render(<LanguageSwitcher value="en" onChange={onChange} />);
    await userEvent.click(
      screen.getByRole("button", { name: /content language/i })
    );
    await userEvent.click(await screen.findByText("German"));
    expect(onChange).toHaveBeenCalledWith("de");
  });
});
