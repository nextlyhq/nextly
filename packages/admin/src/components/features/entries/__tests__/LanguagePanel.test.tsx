import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi, beforeEach } from "vitest";

import { render, screen, within } from "@admin/__tests__/utils";

import {
  EntryLocaleProvider,
  type EntryLocaleContextValue,
} from "../EntryLocaleContext";
import { LanguagePanel, type LanguagePanelProps } from "../LanguagePanel";

const useBranding = vi.fn();
vi.mock("@admin/context/providers/BrandingProvider", () => ({
  useBranding: () => useBranding(),
}));

// The panel is a composition surface: copy-from and publish-all have their own
// implementations and their own tests, so these pin what the PANEL decides —
// which rows it shows, what each row offers, and what it withholds — with the
// hooks replaced by their contracts.
const copyState = vi.fn();
vi.mock("../useCopyFromLanguage", () => ({
  useCopyFromLanguage: () => copyState(),
}));
const publishState = vi.fn();
vi.mock("../usePublishAllLanguages", () => ({
  usePublishAllLanguages: () => publishState(),
}));
vi.mock("../CopyFromLanguageDialog", () => ({
  CopyFromLanguageDialog: () => null,
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

/** English published, German drafted, Arabic never started. */
const TRANSLATIONS = {
  en: { translated: true, status: "published" },
  de: { translated: true, status: "draft" },
};

const requestCopy = vi.fn();
const publishAll = vi.fn();

const COPY_IDLE = {
  available: true,
  sources: [{ code: "en", label: "English", rtl: false }],
  activeLabel: "German",
  pendingLabel: "",
  pending: null,
  busy: false,
  requestCopy,
  cancel: vi.fn(),
  confirm: vi.fn(),
};
const PUBLISH_IDLE = { available: true, pending: false, publishAll };

/** A localized document: the app has languages AND this document uses them. */
const LOCALIZED_CTX: EntryLocaleContextValue = {
  rtl: false,
  collectionLocalized: true,
  isNonDefaultLocale: false,
};

/**
 * The panel reads the document's OWN localization switch from context, so every
 * render goes through a provider rather than the non-localized default.
 */
function renderPanel(
  props: LanguagePanelProps = {},
  ctx: EntryLocaleContextValue = LOCALIZED_CTX
) {
  return render(
    <EntryLocaleProvider value={ctx}>
      <LanguagePanel {...props} />
    </EntryLocaleProvider>
  );
}

/** The panel's rows, in render order. */
function rows() {
  return within(
    screen.getByRole("list", { name: "Languages in this document" })
  ).getAllByRole("listitem");
}

describe("LanguagePanel", () => {
  beforeEach(() => {
    useBranding.mockReset();
    requestCopy.mockReset();
    publishAll.mockReset();
    copyState.mockReturnValue(COPY_IDLE);
    publishState.mockReturnValue(PUBLISH_IDLE);
  });

  it("renders nothing when localization is not configured", () => {
    useBranding.mockReturnValue({ locales: undefined });
    const { container } = renderPanel();
    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing on a document that is not localized", () => {
    // The app having several languages is not the same question as this
    // document having translations. Rendering here would tell the author that
    // Spanish is "not translated" for content that has no language dimension
    // at all — work that does not exist rather than work outstanding.
    useBranding.mockReturnValue({ locales: LOCALES });
    const { container } = renderPanel(
      { translations: TRANSLATIONS },
      { ...LOCALIZED_CTX, collectionLocalized: false }
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing with a single language, which has no workflow to show", () => {
    useBranding.mockReturnValue({
      locales: { ...LOCALES, locales: [LOCALES.locales[0]] },
    });
    const { container } = renderPanel();
    expect(container).toBeEmptyDOMElement();
  });

  it("gives every configured language a row carrying its state as text", () => {
    useBranding.mockReturnValue({ locales: LOCALES });
    renderPanel({ translations: TRANSLATIONS, activeLocale: "de" });

    const [en, de, ar] = rows();
    // State is words, not only a coloured dot: the dot is aria-hidden and
    // these labels are what a reader (and a screen reader) actually gets.
    expect(en).toHaveTextContent("English");
    expect(en).toHaveTextContent("published");
    expect(en).toHaveTextContent("default");
    expect(de).toHaveTextContent("German");
    expect(de).toHaveTextContent("draft");
    expect(ar).toHaveTextContent("Arabic");
    expect(ar).toHaveTextContent("not translated");
    expect(ar).toHaveTextContent("rtl");
  });

  it("counts translations, not languages, so the default is not one of them", () => {
    // English is the default: the source these are translated FROM. Counting it
    // reported "2 of 3" for a document with one translation done, and disagreed
    // with the list's badge on the very same entry.
    useBranding.mockReturnValue({ locales: LOCALES });
    renderPanel({ translations: TRANSLATIONS });
    expect(screen.getByText("1 of 2 translated")).toBeInTheDocument();
  });

  it("marks the language being edited instead of offering to open it", () => {
    useBranding.mockReturnValue({ locales: LOCALES });
    renderPanel({ translations: TRANSLATIONS, activeLocale: "de" });

    const [, de] = rows();
    expect(de).toHaveTextContent("editing now");
    expect(
      within(de).queryByRole("button", { name: "Open German" })
    ).toBeNull();
  });

  it("offers to seed only the languages that have nothing in them", () => {
    useBranding.mockReturnValue({ locales: LOCALES });
    renderPanel({
      translations: TRANSLATIONS,
      activeLocale: "de",
      onSelect: vi.fn(),
    });

    const [en, , ar] = rows();
    // Arabic is empty, so seeding is the useful next step.
    expect(
      within(ar).getByRole("button", {
        name: "Start Arabic from another language",
      })
    ).toBeInTheDocument();
    // English already has content: seeding it is an overwrite, which stays in
    // the Languages menu behind its confirm step rather than sitting here.
    expect(
      within(en).queryByRole("button", {
        name: "Start English from another language",
      })
    ).toBeNull();
  });

  it("withholds seeding entirely when copy-from does not apply", () => {
    useBranding.mockReturnValue({ locales: LOCALES });
    copyState.mockReturnValue({ ...COPY_IDLE, available: false });
    renderPanel({
      translations: TRANSLATIONS,
      activeLocale: "de",
      onSelect: vi.fn(),
    });
    expect(
      screen.queryByRole("button", {
        name: "Start Arabic from another language",
      })
    ).toBeNull();
  });

  it("seeds by naming the target and the source in ONE switch", async () => {
    useBranding.mockReturnValue({ locales: LOCALES });
    const onSelect = vi.fn();
    renderPanel({
      translations: TRANSLATIONS,
      activeLocale: "de",
      onSelect: onSelect,
    });

    await userEvent.click(
      screen.getByRole("button", { name: "Start Arabic from another language" })
    );

    // ONE call carrying both halves. Asking for the switch and the source
    // separately loses the source: the switch refetches the document and
    // unmounts this panel, so a request made from here never survives to be
    // acted on.
    expect(onSelect).toHaveBeenCalledWith("ar", { seedFrom: "de" });
    expect(requestCopy).not.toHaveBeenCalled();
  });

  it("treats the app default as the source when no language has been picked", async () => {
    useBranding.mockReturnValue({ locales: LOCALES });
    const onSelect = vi.fn();
    renderPanel({ translations: TRANSLATIONS, onSelect });

    await userEvent.click(
      screen.getByRole("button", { name: "Start Arabic from another language" })
    );
    // `activeLocale` undefined means the implicit default, not "no source".
    expect(onSelect).toHaveBeenCalledWith("ar", { seedFrom: "en" });
  });

  it("withholds every action while a past version is on screen, and keeps the states readable", () => {
    useBranding.mockReturnValue({ locales: LOCALES });
    renderPanel({
      translations: TRANSLATIONS,
      activeLocale: "de",
      onSelect: vi.fn(),
      hasStatus: true,
      actionsDisabled: true,
    });

    expect(
      screen.getByRole("button", { name: "Start Arabic from another language" })
    ).toBeDisabled();
    expect(screen.getByRole("button", { name: "Publish all" })).toBeDisabled();
    // Switching too: changing the document under the history banner would show
    // one language's history labelled as another's.
    expect(screen.getByRole("button", { name: "Open English" })).toBeDisabled();

    // Reading is not withheld — the panel is how the author sees where the
    // document stands, and that stays true while looking at history.
    expect(screen.getByText("1 of 2 translated")).toBeInTheDocument();
    expect(rows()[2]).toHaveTextContent("not translated");
  });

  it("hides publish-all when the action does not apply", () => {
    useBranding.mockReturnValue({ locales: LOCALES });
    publishState.mockReturnValue({ ...PUBLISH_IDLE, available: false });
    renderPanel({ translations: TRANSLATIONS, hasStatus: true });
    expect(screen.queryByRole("button", { name: "Publish all" })).toBeNull();
  });

  it("states which language holds unpublished changes, without opening it", () => {
    // The failure this guards is invisibility: a document whose languages all
    // read "published" while work sits unpublished inside one of them. The
    // author must be able to see it from the list, because with several
    // languages there is no reason to open any particular one.
    useBranding.mockReturnValue({ locales: LOCALES });
    renderPanel({
      translations: {
        en: { translated: true, status: "published" },
        de: { translated: true, status: "published", pendingChange: true },
      },
    });

    expect(
      screen.getByTitle("published · unpublished changes")
    ).toBeInTheDocument();
    // And the language WITHOUT pending work still reads plainly — without this
    // the assertion above would pass against a panel that marked every row.
    expect(screen.getAllByTitle("published")).toHaveLength(1);
  });
});
