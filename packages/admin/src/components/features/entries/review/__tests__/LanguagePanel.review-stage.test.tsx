/**
 * The Languages panel under a workflow: each language's stage beside its
 * status, and nothing more where no workflow holds the document.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { render, screen, within } from "@admin/__tests__/utils";

import { CopyFromLanguageScope } from "../../CopyFromLanguageScope";
import { EntryLocaleProvider } from "../../EntryLocaleContext";
import { LanguagePanel, type LanguagePanelProps } from "../../LanguagePanel";

const useBranding = vi.fn();
vi.mock("@admin/context/providers/BrandingProvider", () => ({
  useBranding: () => useBranding(),
}));
vi.mock("../../useCopyFromLanguage", () => ({
  useCopyFromLanguage: () => ({
    available: false,
    sources: [],
    activeLabel: "English",
    pendingLabel: "",
    pending: null,
    busy: false,
    requestCopy: vi.fn(),
    cancel: vi.fn(),
    confirm: vi.fn(),
  }),
}));
vi.mock("../../usePublishAllLanguages", () => ({
  usePublishAllLanguages: () => ({
    available: false,
    pending: false,
    publishAll: vi.fn(),
    preview: { fetch: vi.fn(), key: ["publish-all-preview", "test"] },
  }),
}));
vi.mock("../../CopyFromLanguageDialog", () => ({
  CopyFromLanguageDialog: () => null,
}));

const LOCALES = {
  defaultLocale: "en",
  fallback: true,
  locales: [
    { code: "en", label: "English", rtl: false, fallbackLocale: [] },
    { code: "de", label: "German", rtl: false, fallbackLocale: [] },
  ],
};

const TRANSLATIONS = {
  en: { translated: true, status: "published" },
  de: { translated: true, status: "draft" },
};

function renderPanel(props: LanguagePanelProps) {
  return render(
    <EntryLocaleProvider
      value={{
        rtl: false,
        collectionLocalized: true,
        isNonDefaultLocale: false,
      }}
    >
      <CopyFromLanguageScope>
        <LanguagePanel {...props} />
      </CopyFromLanguageScope>
    </EntryLocaleProvider>
  );
}

function row(label: string): HTMLElement {
  const rows = within(
    screen.getByRole("list", { name: "Languages in this document" })
  ).getAllByRole("listitem");
  const found = rows.find(each => each.textContent?.includes(label));
  if (found === undefined) throw new Error(`No row for ${label}`);
  return found;
}

describe("LanguagePanel review stages", () => {
  beforeEach(() => useBranding.mockReturnValue({ locales: LOCALES }));

  it("names each language's stage beside its status, with its shape", () => {
    renderPanel({
      translations: TRANSLATIONS,
      reviewStages: {
        de: { label: "In review", shape: "in-review" },
        en: { label: "Approved", shape: "approved" },
      },
    });
    const german = row("German").querySelector("[data-review-stage]");
    expect(german).toHaveAttribute("data-review-stage", "In review");
    expect(german).toHaveTextContent("In review");
    expect(german?.querySelector("[data-stage-shape]")).toHaveAttribute(
      "data-stage-shape",
      "in-review"
    );
    expect(row("English")).toHaveTextContent("Approved");
    expect(
      row("English").querySelector('[data-stage-shape="approved"] svg')
    ).toHaveAttribute("aria-hidden", "true");
  });

  it("draws the rows as before where no workflow holds the document", () => {
    const list = () =>
      screen.getByRole("list", { name: "Languages in this document" });
    const first = renderPanel({ translations: TRANSLATIONS });
    const before = list().innerHTML;
    first.unmount();
    renderPanel({ translations: TRANSLATIONS, reviewStages: {} });
    expect(list().innerHTML).toBe(before);
    expect(list().querySelector("[data-review-stage]")).toBeNull();
  });
});
