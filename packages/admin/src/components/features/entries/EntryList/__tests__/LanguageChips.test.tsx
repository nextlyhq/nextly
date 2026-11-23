/**
 * The list's language chips and their key.
 *
 * Each of the five chips is drawn for the language in that state, named with its language and
 * state in words, and marked by a shape of its own, so the state never rests on colour. The key
 * lists every state a chip can be in. Below two languages neither renders.
 */
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { render, screen, within } from "@admin/__tests__/utils";

import { LANGUAGE_CHIP_STATES, LANGUAGE_CHIP_WORD } from "../language-chips";
import { LanguageChipKey, LanguageChips } from "../LanguageChips";

const useBranding = vi.fn();
vi.mock("@admin/context/providers/BrandingProvider", () => ({
  useBranding: () => useBranding(),
}));

const locale = (code: string, label: string, rtl = false) => ({
  code,
  label,
  rtl,
  fallbackLocale: [],
});

/** Five languages, one per chip state. */
const FIVE = {
  defaultLocale: "en",
  fallback: true,
  locales: [
    locale("en", "English"),
    locale("es", "Spanish"),
    locale("fr", "French"),
    locale("de", "German"),
    locale("ar", "Arabic", true),
  ],
};

/** English live, Spanish live with a change, French out of date, German a draft, Arabic missing. */
const EVERY_STATE = {
  en: { translated: true, status: "published" },
  es: { translated: true, status: "published", pendingChange: true },
  fr: { translated: true, status: "published", stale: true },
  de: { translated: true, status: "draft" },
};

const ONE_LANGUAGE = {
  defaultLocale: "en",
  fallback: true,
  locales: [locale("en", "English")],
};

/** The chip a language is drawn as: the state its face carries. */
function chipState(control: HTMLElement): string | null {
  return (
    control
      .querySelector("[data-chip-state]")
      ?.getAttribute("data-chip-state") ?? null
  );
}

describe("LanguageChips", () => {
  beforeEach(() => {
    useBranding.mockReset();
    useBranding.mockReturnValue({ locales: FIVE });
  });

  it.each([
    ["English", "live", "Open in English, live"],
    ["Spanish", "changes", "Open in Spanish, live, with unpublished changes"],
    ["French", "outOfDate", "Open in French, out of date, live"],
    ["German", "draft", "Open in German, draft"],
    ["Arabic", "missing", "Open in Arabic, missing"],
  ])("draws %s as the %s chip, named in words", (_language, state, name) => {
    render(<LanguageChips translations={EVERY_STATE} onOpenLocale={vi.fn()} />);
    const chip = screen.getByRole("button", { name });
    expect(chipState(chip)).toBe(state);
  });

  it("gives each state a mark of its own shape, so colour is never the only sign", () => {
    render(<LanguageChips translations={EVERY_STATE} onOpenLocale={vi.fn()} />);
    const marks = screen
      .getAllByRole("button")
      .map(chip =>
        chip.querySelector("[data-chip-state] > [aria-hidden='true']")
      )
      .map(mark => mark?.className ?? "");
    // Five chips, five different marks.
    expect(new Set(marks).size).toBe(5);
  });

  it("labels each chip with its language's code", () => {
    render(<LanguageChips translations={EVERY_STATE} onOpenLocale={vi.fn()} />);
    const chip = screen.getByRole("button", { name: /^Open in Arabic/ });
    expect(chip).toHaveTextContent("ar");
  });

  it("follows the document's status for a language that carries none", () => {
    render(
      <LanguageChips
        translations={{ en: { translated: true }, es: { translated: true } }}
        documentStatus="draft"
        onOpenLocale={vi.fn()}
      />
    );
    expect(
      chipState(screen.getByRole("button", { name: "Open in Spanish, draft" }))
    ).toBe("draft");
  });

  it("opens the row in the language whose chip was pressed", async () => {
    const onOpenLocale = vi.fn();
    render(
      <LanguageChips translations={EVERY_STATE} onOpenLocale={onOpenLocale} />
    );
    await userEvent.click(
      screen.getByRole("button", { name: /^Open in French/ })
    );
    expect(onOpenLocale).toHaveBeenCalledWith("fr");
  });

  it("draws plain chips, named, where there is nowhere to open", () => {
    render(<LanguageChips translations={EVERY_STATE} />);
    expect(screen.queryAllByRole("button")).toHaveLength(0);
    expect(screen.getByText("Arabic, missing")).toBeInTheDocument();
  });

  it("names the row's languages as a whole, the missing ones by name", () => {
    render(<LanguageChips translations={EVERY_STATE} onOpenLocale={vi.fn()} />);
    expect(
      screen.getByRole("group", {
        name: "4 of 5 languages translated; missing Arabic",
      })
    ).toBeInTheDocument();
  });

  it("caps the chips and accounts for the rest in the row's name", () => {
    useBranding.mockReturnValue({
      locales: {
        ...FIVE,
        locales: [
          locale("en", "English"),
          ...Array.from({ length: 9 }, (_, i) => locale(`l${i}`, `Lang ${i}`)),
        ],
      },
    });
    render(<LanguageChips translations={{}} onOpenLocale={vi.fn()} />);
    expect(screen.getAllByRole("button")).toHaveLength(6);
    expect(
      screen.getByRole("group", { name: /0 of 10 languages translated/ })
    ).toBeInTheDocument();
  });

  it("renders nothing on a site with one language", () => {
    useBranding.mockReturnValue({ locales: ONE_LANGUAGE });
    const { container } = render(
      <LanguageChips translations={EVERY_STATE} onOpenLocale={vi.fn()} />
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing where languages are not configured", () => {
    useBranding.mockReturnValue({ locales: undefined });
    const { container } = render(
      <LanguageChips translations={EVERY_STATE} onOpenLocale={vi.fn()} />
    );
    expect(container).toBeEmptyDOMElement();
  });
});

describe("LanguageChipKey", () => {
  beforeEach(() => {
    useBranding.mockReset();
    useBranding.mockReturnValue({ locales: FIVE });
  });

  it("lists every state a chip can be in, by its word and its mark", () => {
    render(<LanguageChipKey />);
    const key = screen.getByRole("list", { name: "Language key" });
    const items = within(key).getAllByRole("listitem");
    expect(items).toHaveLength(LANGUAGE_CHIP_STATES.length);
    LANGUAGE_CHIP_STATES.forEach((state, index) => {
      expect(items[index]).toHaveTextContent(LANGUAGE_CHIP_WORD[state]);
      expect(chipState(items[index])).toBe(state);
    });
  });

  it("says what each state means for a reader who cannot hover", () => {
    render(<LanguageChipKey />);
    const key = screen.getByRole("list", { name: "Language key" });
    expect(key).toHaveTextContent(
      "Out of date: the default language changed after this one was written"
    );
  });

  it("renders nothing on a site with one language", () => {
    useBranding.mockReturnValue({ locales: ONE_LANGUAGE });
    const { container } = render(<LanguageChipKey />);
    expect(container).toBeEmptyDOMElement();
  });
});
