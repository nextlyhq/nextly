// The list's per-row language marks.
//
// This replaced a bare "n/total" badge, so the tests worth having are about
// what the dots add: WHICH languages are missing, that the dots and the count
// beside them cover the same languages, the default included, and that a long
// language list degrades instead of setting the table's width.
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi, beforeEach } from "vitest";

import { render, screen, within } from "@admin/__tests__/utils";

import { LanguageDots } from "../LanguageDots";

const useBranding = vi.fn();
vi.mock("@admin/context/providers/BrandingProvider", () => ({
  useBranding: () => useBranding(),
}));

const locale = (code: string, label: string) => ({
  code,
  label,
  rtl: false,
  fallbackLocale: [],
});

const LOCALES = {
  defaultLocale: "en",
  fallback: true,
  locales: [
    locale("en", "English"),
    locale("es", "Spanish"),
    locale("ar", "Arabic"),
  ],
};

/** English (default) written, Spanish published, Arabic never started. */
const TRANSLATIONS = {
  en: { translated: true, status: "published" },
  es: { translated: true, status: "published" },
};

describe("LanguageDots", () => {
  beforeEach(() => {
    useBranding.mockReset();
  });

  it("renders nothing when localization is not configured", () => {
    useBranding.mockReturnValue({ locales: undefined });
    const { container } = render(<LanguageDots translations={TRANSLATIONS} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("names which languages are missing, not just how many", () => {
    // The whole reason this replaced a count: "1/2" tells an author there is
    // work left and never which language it is in.
    useBranding.mockReturnValue({ locales: LOCALES });
    render(<LanguageDots translations={TRANSLATIONS} />);
    expect(
      screen.getByRole("group", {
        name: "2 of 3 languages translated; missing Arabic",
      })
    ).toBeInTheDocument();
  });

  it("says so plainly when nothing is left", () => {
    useBranding.mockReturnValue({ locales: LOCALES });
    render(
      <LanguageDots
        translations={{ ...TRANSLATIONS, ar: { translated: true } }}
      />
    );
    expect(
      screen.getByRole("group", { name: "All 3 languages translated" })
    ).toBeInTheDocument();
  });

  it("gives every language a dot, the default included, as the count does", () => {
    // The count beside the dots counts the default ("2/3"), so the dots count
    // it too: two dots beside "2/3" would say the row has a language the marks
    // do not show.
    useBranding.mockReturnValue({ locales: LOCALES });
    render(<LanguageDots translations={TRANSLATIONS} onOpenLocale={vi.fn()} />);
    const group = screen.getByRole("group", {
      name: "2 of 3 languages translated; missing Arabic",
    });
    expect(
      within(group).getByRole("button", { name: "Open in English — published" })
    ).toBeInTheDocument();
    expect(within(group).getAllByRole("button")).toHaveLength(3);
    expect(within(group).getByText("2/3")).toBeInTheDocument();
  });

  it("carries each language and its state in the dot's accessible name", () => {
    useBranding.mockReturnValue({ locales: LOCALES });
    render(<LanguageDots translations={TRANSLATIONS} onOpenLocale={vi.fn()} />);
    expect(
      screen.getByRole("button", { name: "Open in Spanish — published" })
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Open in Arabic — not translated" })
    ).toBeInTheDocument();
  });

  it("opens the row in the language whose dot was pressed", async () => {
    useBranding.mockReturnValue({ locales: LOCALES });
    const onOpenLocale = vi.fn();
    render(
      <LanguageDots translations={TRANSLATIONS} onOpenLocale={onOpenLocale} />
    );
    await userEvent.click(
      screen.getByRole("button", { name: "Open in Arabic — not translated" })
    );
    expect(onOpenLocale).toHaveBeenCalledWith("ar");
  });

  it("renders plain marks, not controls, when there is nowhere to open", () => {
    // The column is read-only until the editor can be addressed by language.
    // Buttons that do nothing are worse than marks that never claimed to.
    useBranding.mockReturnValue({ locales: LOCALES });
    render(<LanguageDots translations={TRANSLATIONS} />);
    expect(screen.queryAllByRole("button")).toHaveLength(0);
  });

  it("caps the dots and says how many it did not draw", () => {
    // A row is scanned, not read. Past a handful of marks the column stops
    // being glanceable and starts setting the table's width.
    const many = {
      ...LOCALES,
      locales: [
        locale("en", "English"),
        ...Array.from({ length: 9 }, (_, i) => locale(`l${i}`, `Lang ${i}`)),
      ],
    };
    useBranding.mockReturnValue({ locales: many });
    render(<LanguageDots translations={{}} onOpenLocale={vi.fn()} />);
    expect(screen.getAllByRole("button")).toHaveLength(6);
    // Nothing is lost: the group's name still accounts for every language.
    expect(
      screen.getByRole("group", { name: /0 of 10 languages translated/ })
    ).toBeInTheDocument();
  });
});
