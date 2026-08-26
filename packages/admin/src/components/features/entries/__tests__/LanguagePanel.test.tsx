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

  describe("what the dots mean", () => {
    /*
     * The legend moved here from the header's language menu, which this step
     * deletes. It is the ONE thing that menu carried which the panel did not
     * duplicate, and without it the dots are decodable only by hovering — no
     * help on a touch device and none at all to someone scanning.
     *
     * Asserted on the `<details>` element's OWN state rather than on
     * visibility, deliberately. jsdom does not model `<details>`: a closed one
     * keeps its content in the accessibility tree, so `queryByRole` finds the
     * legend either way and a visibility assertion would pass whether the
     * disclosure worked or not. The element's `open` property is the thing
     * jsdom can actually answer for, and it is what a browser derives the
     * hiding from.
     */
    function legend() {
      return screen.getByText("What do these mean?").closest("details");
    }

    it("starts closed, so a narrow rail is not four rows heavier", () => {
      useBranding.mockReturnValue({ locales: LOCALES });
      renderPanel({ translations: TRANSLATIONS });

      expect(legend()).not.toBeNull();
      expect(legend()?.open).toBe(false);
    });

    it("opens on the summary, and explains every state", async () => {
      const user = userEvent.setup();
      useBranding.mockReturnValue({ locales: LOCALES });
      renderPanel({ translations: TRANSLATIONS });

      await user.click(screen.getByText("What do these mean?"));

      expect(legend()?.open).toBe(true);
      const states = screen.getByRole("group", { name: /language states/i });
      // The CANONICAL spellings from `translation-meta`, not capitalised
      // copies: a legend with its own wording would be a second vocabulary for
      // the states, which is the defect this step exists to remove. Case is a
      // presentation concern and is handled in CSS.
      for (const label of [
        "published",
        "translated",
        "draft",
        "not translated",
      ]) {
        expect(within(states).getByText(label)).toBeInTheDocument();
      }
    });

    it("names every state the dots can encode, with none left undecodable", () => {
      /*
       * The separating property against a legend that drifts from the states in
       * use. It is derived from the same `LANGUAGE_STATE_LABEL` the rows read,
       * so a state added there without a legend entry would fail here rather
       * than shipping a dot nothing explains.
       */
      useBranding.mockReturnValue({ locales: LOCALES });
      renderPanel({ translations: TRANSLATIONS });

      const states = screen.getByRole("group", { name: /language states/i });
      expect(within(states).getAllByText(/\S/)).toHaveLength(4);
    });
  });

  /** A site with more languages than a person can scan at a glance. */
  const MANY = {
    defaultLocale: "en",
    fallback: true,
    locales: [
      ["en", "English"],
      ["de", "German"],
      ["ar", "Arabic"],
      ["es", "Spanish"],
      ["fr", "French"],
      ["it", "Italian"],
      ["pt", "Portuguese"],
      ["nl", "Dutch"],
      ["pl", "Polish"],
      ["sv", "Swedish"],
      ["ja", "Japanese"],
      ["ko", "Korean"],
    ].map(([code, label]) => ({
      code,
      label,
      rtl: code === "ar",
      fallbackLocale: [],
    })),
  };

  describe("finding one language among many", () => {
    /*
     * The panel is about to become the ONLY place a language is chosen, so it
     * has to stay usable at the locale counts a real multilingual site has.
     * Twelve identical rows is not a scrolling problem — it is a scanning one,
     * and scanning is linear where a filter is not.
     */
    it("offers no filter for a handful of languages", () => {
      // The common case must not pay for the uncommon one: three languages fit
      // in a glance, and a search box over them is chrome that asks a question
      // nobody had.
      useBranding.mockReturnValue({ locales: LOCALES });
      renderPanel({ translations: TRANSLATIONS });

      expect(screen.queryByRole("searchbox")).toBeNull();
      expect(rows()).toHaveLength(3);
    });

    it("offers a filter once the list is past scanning", () => {
      useBranding.mockReturnValue({ locales: MANY });
      renderPanel({ translations: TRANSLATIONS });

      expect(screen.getByRole("searchbox")).toBeInTheDocument();
      expect(rows()).toHaveLength(12);
    });

    it("narrows the rows to what was typed", async () => {
      const user = userEvent.setup();
      useBranding.mockReturnValue({ locales: MANY });
      renderPanel({ translations: TRANSLATIONS });

      await user.type(screen.getByRole("searchbox"), "ger");

      expect(rows()).toHaveLength(1);
      expect(rows()[0]).toHaveTextContent("German");
    });

    it("matches the language CODE as well as its name", async () => {
      /*
       * The separating property against a plain label search. A translator
       * working in Spanish types `es` far more readily than "Spanish", and on a
       * site whose admin language differs from the content languages the code
       * may be the only spelling they share.
       */
      const user = userEvent.setup();
      useBranding.mockReturnValue({ locales: MANY });
      renderPanel({ translations: TRANSLATIONS });

      await user.type(screen.getByRole("searchbox"), "pt");

      expect(rows()).toHaveLength(1);
      expect(rows()[0]).toHaveTextContent("Portuguese");
    });

    it("ignores case and surrounding space", async () => {
      const user = userEvent.setup();
      useBranding.mockReturnValue({ locales: MANY });
      renderPanel({ translations: TRANSLATIONS });

      await user.type(screen.getByRole("searchbox"), "  JAPAN ");

      expect(rows()).toHaveLength(1);
      expect(rows()[0]).toHaveTextContent("Japanese");
    });

    it("says so when nothing matches, rather than showing an empty list", async () => {
      // An empty list under a search box reads as "this document has no
      // languages", which is alarming and untrue. The panel says what happened.
      const user = userEvent.setup();
      useBranding.mockReturnValue({ locales: MANY });
      renderPanel({ translations: TRANSLATIONS });

      await user.type(screen.getByRole("searchbox"), "klingon");

      expect(
        screen.queryByRole("list", { name: "Languages in this document" })
      ).toBeNull();
      expect(screen.getByText(/no languages match/i)).toBeInTheDocument();
    });

    it("hides the language being edited too, rather than pinning it", async () => {
      /*
       * Deliberate, and the alternative was tried first. A row kept against a
       * query it does not match READS as a match — and on a search for
       * something absent it would leave one language on screen looking like the
       * answer, which is worse than an honest empty state.
       */
      const user = userEvent.setup();
      useBranding.mockReturnValue({ locales: MANY });
      renderPanel({ translations: TRANSLATIONS, activeLocale: "ko" });

      await user.type(screen.getByRole("searchbox"), "ger");

      expect(rows()).toHaveLength(1);
      expect(rows()[0]).toHaveTextContent("German");
    });

    it("brings every language back when the filter is cleared", async () => {
      // The property that makes hiding the active row safe: nothing is lost,
      // and the way back is the control the author is already holding.
      const user = userEvent.setup();
      useBranding.mockReturnValue({ locales: MANY });
      renderPanel({ translations: TRANSLATIONS, activeLocale: "ko" });

      const box = screen.getByRole("searchbox");
      await user.type(box, "ger");
      expect(rows()).toHaveLength(1);

      await user.clear(box);
      expect(rows()).toHaveLength(12);
    });
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

    // The chip, not the state text: the phrase truncates in a 277px rail and
    // this is the fact that must survive.
    expect(screen.getByText("changes")).toBeInTheDocument();
    // And the language WITHOUT pending work carries no chip — without this the
    // assertion above would pass against a panel that marked every row.
    expect(screen.getAllByText("changes")).toHaveLength(1);
  });
});
