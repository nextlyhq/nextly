/**
 * The Languages button and its menu: the name and count it is heard with, what each language's
 * row says and leads to, what the menu offers below them, and the whole of it by keyboard.
 *
 * Catches a button whose count is only seen, rows spoken as one run of words, a default language
 * sent to be translated, a row for the language on screen that the keyboard skips or that
 * navigates, and a publish handler handed the menu's event.
 */
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { render, screen, waitFor, within } from "@admin/__tests__/utils";
import { navigateTo } from "@admin/lib/navigation";

import {
  languagesMenuModel,
  type LanguageOverview,
  type MenuLanguage,
} from "../languages-menu-model";
import { LanguagesButton, type LanguagesButtonProps } from "../LanguagesButton";

vi.mock("@admin/lib/navigation", () => ({ navigateTo: vi.fn() }));
vi.mock("@admin/lib/route-preload", () => ({ preloadRoute: vi.fn() }));

type User = ReturnType<typeof userEvent.setup>;

const ENGLISH: MenuLanguage = { code: "en", label: "English", rtl: false };
const SPANISH: MenuLanguage = { code: "es", label: "Spanish", rtl: false };
const ARABIC: MenuLanguage = { code: "ar", label: "Arabic", rtl: true };

const LIVE: LanguageOverview = { translated: true, status: "published" };
const DRAFT: LanguageOverview = { translated: true, status: "draft" };
const PENDING: LanguageOverview = { ...LIVE, pendingChange: true };
const OUT_OF_DATE: LanguageOverview = {
  ...LIVE,
  stale: true,
  fields: { title: { outOfDate: true }, body: { outOfDate: false } },
};

const EDIT_HREF = "/admin/collections/posts/p1/edit";
const SPANISH_HREF = "/admin/collections/posts/p1/translate/es";
const ARABIC_HREF = "/admin/collections/posts/p1/translate/ar";

const PUBLISH = "Publish other languages…";
const MANAGE = "Manage languages…";

const translateHref = vi.fn(
  (code: string) => `/admin/collections/posts/p1/translate/${code}`
);

beforeEach(() => {
  vi.clearAllMocks();
});

/** The model of one document, English its default language. */
function modelOf(
  translations: Record<string, LanguageOverview>,
  languages: MenuLanguage[] = [ENGLISH, SPANISH, ARABIC]
) {
  return languagesMenuModel({
    languages,
    defaultLanguage: "en",
    translations,
    documentStatus: "published",
  });
}

/** English live, one field of Spanish out of date, Arabic not started. */
const modelWithWork = () => modelOf({ en: LIVE, es: OUT_OF_DATE });

function buttonWith(props: Partial<LanguagesButtonProps>) {
  return (
    <LanguagesButton
      model={modelWithWork()}
      translateHref={translateHref}
      editHref={EDIT_HREF}
      canManageLanguages={false}
      {...props}
    />
  );
}

/** Draws the button, with the person who uses it. */
function draw(props: Partial<LanguagesButtonProps> = {}) {
  const user = userEvent.setup();
  return { user, ...render(buttonWith(props)) };
}

const theButton = () => screen.getByRole("button");

/** The button while its menu is open, which hides everything else from assistive technology. */
const theButtonBehind = () => screen.getByRole("button", { hidden: true });

/** Draws the button and opens its menu with the pointer. */
async function open(props: Partial<LanguagesButtonProps> = {}) {
  const { user } = draw(props);
  await user.click(theButton());
  return { user, menu: await screen.findByRole("menu") };
}

/**
 * A row, by its whole spoken name. Only the space around each comma is evened out: how much of it
 * is left depends on who computes the name, while a comma that is missing still fails.
 */
const row = (words: string) =>
  screen.getByRole("menuitem", {
    name: name => name.replace(/\s*,\s*/g, ", ") === words,
  });

async function menuIsClosed() {
  await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());
}

describe("the Languages button", () => {
  it("is not drawn without a model, nor for a site with one language", () => {
    const { rerender } = draw({ model: null });
    expect(screen.queryByRole("button")).toBeNull();

    rerender(buttonWith({ model: modelOf({ en: LIVE }, [ENGLISH]) }));
    expect(screen.queryByRole("button")).toBeNull();

    // A model that holds one language all the same.
    const full = modelWithWork();
    expect(full).not.toBeNull();
    rerender(
      buttonWith({ model: full && { ...full, rows: full.rows.slice(0, 1) } })
    );
    expect(screen.queryByRole("button")).toBeNull();

    // Two languages are what it takes.
    rerender(buttonWith({ model: modelOf({ en: LIVE }, [ENGLISH, SPANISH]) }));
    expect(theButton()).toBeInTheDocument();
  });

  it.each([
    { work: "none", es: LIVE, ar: LIVE, name: "Languages", digit: null },
    {
      work: "one language's",
      es: OUT_OF_DATE,
      ar: LIVE,
      name: "Languages, 1 needs attention",
      digit: "1",
    },
    {
      work: "two languages'",
      es: OUT_OF_DATE,
      ar: PENDING,
      name: "Languages, 2 need attention",
      digit: "2",
    },
  ])("says how much work there is: $work", ({ es, ar, name, digit }) => {
    draw({ model: modelOf({ en: LIVE, es, ar }) });

    const button = screen.getByRole("button", { name });
    if (digit === null) {
      expect(button.textContent).toBe("Languages");
    } else {
      // The digit is for the eye; the words already say it.
      expect(within(button).getByText(digit)).toHaveAttribute(
        "aria-hidden",
        "true"
      );
    }
  });

  it.each([
    { work: "no work", es: LIVE, name: "Languages" },
    { work: "work", es: OUT_OF_DATE, name: "Languages, 1 needs attention" },
  ])("keeps its name as an icon only, with $work", ({ es, name }) => {
    const model = modelOf({ en: LIVE, es });
    const { rerender } = draw({ model, iconOnly: true });

    const button = screen.getByRole("button", { name });
    expect(within(button).getByText("Languages")).toHaveClass("sr-only");
    expect(button).toHaveAttribute("title", "Languages");
    expect(button.querySelectorAll("svg")).toHaveLength(1);

    // With room, the word is shown, and an arrow after it.
    rerender(buttonWith({ model, iconOnly: false }));
    const wide = screen.getByRole("button", { name });
    expect(within(wide).getByText("Languages")).not.toHaveClass("sr-only");
    expect(wide.querySelectorAll("svg")).toHaveLength(2);
  });

  it("keeps its digit as an icon only", () => {
    draw({ iconOnly: true });
    expect(within(theButton()).getByText("1")).toBeInTheDocument();
  });
});

describe("a language's row", () => {
  it("says its language, its status and what choosing it does, in the site's order", async () => {
    const { menu } = await open();
    const rows = within(menu).getAllByRole("menuitem");
    expect(rows).toHaveLength(3);
    expect(rows[0]).toBe(row("English, default, live, Edit"));
    expect(rows[1]).toBe(row("Spanish, live, 1 field out of date, Translate"));
    expect(rows[2]).toBe(row("Arabic, not started, Translate"));
  });

  it.each<{ es: LanguageOverview | undefined; name: string }>([
    { es: undefined, name: "Spanish, not started, Translate" },
    { es: LIVE, name: "Spanish, live, Translate" },
    {
      es: {
        ...LIVE,
        fields: { title: { outOfDate: true }, body: { outOfDate: true } },
      },
      name: "Spanish, live, 2 fields out of date, Translate",
    },
    {
      es: { ...LIVE, stale: true },
      name: "Spanish, live, out of date, Translate",
    },
    { es: PENDING, name: "Spanish, live, changes not published, Translate" },
    {
      es: { ...OUT_OF_DATE, pendingChange: true },
      name: "Spanish, live, 1 field out of date, Translate",
    },
    { es: DRAFT, name: "Spanish, draft, Translate" },
    {
      es: { ...OUT_OF_DATE, status: "draft" },
      name: "Spanish, draft, 1 field out of date, Translate",
    },
    {
      es: { translated: false, pendingChange: true },
      name: "Spanish, draft, changes not published, Translate",
    },
  ])("is heard as $name", async ({ es, name }) => {
    const { menu } = await open({
      model: modelOf(es === undefined ? { en: LIVE } : { en: LIVE, es }),
    });
    expect(within(menu).getAllByRole("menuitem")[1]).toBe(row(name));
  });

  it("says the default language's own changes, and still edits it", async () => {
    await open({ model: modelOf({ en: PENDING }) });
    expect(
      row("English, default, live, changes not published, Edit")
    ).toHaveAttribute("href", EDIT_HREF);
  });

  it("leads to where its language is written", async () => {
    await open();
    expect(row("English, default, live, Edit")).toHaveAttribute(
      "href",
      EDIT_HREF
    );
    expect(
      row("Spanish, live, 1 field out of date, Translate")
    ).toHaveAttribute("href", SPANISH_HREF);
    expect(row("Arabic, not started, Translate")).toHaveAttribute(
      "href",
      ARABIC_HREF
    );
    // Asked for each translation by its code, and never for the default language.
    expect(new Set(translateHref.mock.calls.map(([code]) => code))).toEqual(
      new Set(["es", "ar"])
    );
  });

  it("goes there when chosen, and closes the menu", async () => {
    const { user } = await open();
    expect(navigateTo).not.toHaveBeenCalled();
    await user.click(row("Arabic, not started, Translate"));
    expect(vi.mocked(navigateTo).mock.calls).toEqual([[ARABIC_HREF]]);
    await menuIsClosed();
  });

  it("draws each state's mark, for the eye only", async () => {
    const { menu } = await open({
      model: modelOf({ en: LIVE, es: PENDING, fr: OUT_OF_DATE, de: DRAFT }, [
        ENGLISH,
        SPANISH,
        { code: "fr", label: "French", rtl: false },
        { code: "de", label: "German", rtl: false },
        ARABIC,
      ]),
    });
    const marks = within(menu)
      .getAllByRole("menuitem")
      .map(item => {
        const mark = item.querySelector("[data-language-state]");
        const hidden = mark?.closest('[aria-hidden="true"]') ?? null;
        return {
          state: mark?.getAttribute("data-language-state"),
          // Hidden inside its row, rather than the row hidden with it.
          hiddenInRow:
            hidden !== null && hidden !== item && item.contains(hidden),
        };
      });
    expect(marks).toEqual([
      { state: "live", hiddenInRow: true },
      { state: "changes", hiddenInRow: true },
      { state: "outOfDate", hiddenInRow: true },
      { state: "draft", hiddenInRow: true },
      { state: "missing", hiddenInRow: true },
    ]);
  });
});

describe("without any language's state", () => {
  it("names each language and leads to it, and claims nothing of it", async () => {
    const { menu } = await open({
      model: languagesMenuModel({
        languages: [ENGLISH, SPANISH],
        defaultLanguage: "en",
        translations: undefined,
      }),
    });
    expect(theButtonBehind()).toHaveAccessibleName("Languages");
    expect(row("English, default, Edit")).toHaveAttribute("href", EDIT_HREF);
    expect(row("Spanish, Translate")).toHaveAttribute("href", SPANISH_HREF);
    expect(menu.querySelector("[data-language-state]")).toBeNull();
  });
});

describe("the row of the language on screen", () => {
  it("says it is being edited, and is not a link", async () => {
    await open({ currentLanguage: "es" });
    const current = row("Spanish, live, 1 field out of date, Editing");
    expect(current).toHaveAttribute("aria-current", "true");
    expect(current.tagName).not.toBe("A");
    expect(current).not.toHaveAttribute("href");

    // The others are links, and not marked.
    for (const other of [
      row("English, default, live, Edit"),
      row("Arabic, not started, Translate"),
    ]) {
      expect(other.tagName).toBe("A");
      expect(other).toHaveAttribute("href");
      expect(other).not.toHaveAttribute("aria-current");
    }
  });

  it("is the default language's as much as any other's", async () => {
    await open({ currentLanguage: "en" });
    const current = row("English, default, live, Editing");
    expect(current).toHaveAttribute("aria-current", "true");
    expect(current).not.toHaveAttribute("href");
    expect(
      row("Spanish, live, 1 field out of date, Translate")
    ).toHaveAttribute("href", SPANISH_HREF);
  });

  it("closes the menu when chosen, and goes nowhere", async () => {
    const { user } = await open({ currentLanguage: "es" });
    await user.click(row("Spanish, live, 1 field out of date, Editing"));
    await menuIsClosed();
    expect(navigateTo).not.toHaveBeenCalled();

    // The row beside it does go somewhere.
    await user.click(theButton());
    await screen.findByRole("menu");
    await user.click(row("Arabic, not started, Translate"));
    expect(vi.mocked(navigateTo).mock.calls).toEqual([[ARABIC_HREF]]);
  });
});

describe("while something holds the language on screen", () => {
  const HELD = "You are viewing a past version.";

  it("says why, and leads to no other language", async () => {
    const { user, menu } = await open({
      heldReason: HELD,
      currentLanguage: "en",
    });
    expect(within(menu).getByText(HELD)).toBeInTheDocument();
    // Heard with the languages, not only seen above them.
    expect(
      within(menu).getByRole("group", { name: "Languages" })
    ).toHaveAccessibleDescription(HELD);

    const spanish = row("Spanish, live, 1 field out of date");
    expect(spanish).toHaveAttribute("aria-disabled", "true");
    expect(spanish).not.toHaveAttribute("href");
    await user.click(spanish);
    expect(navigateTo).not.toHaveBeenCalled();
    // Still open: nothing was chosen.
    expect(screen.getByRole("menu")).toBeInTheDocument();
  });

  it("keeps each status within the keyboard's reach", async () => {
    const { user } = draw({ heldReason: HELD, currentLanguage: "en" });
    await user.tab();
    await user.keyboard("{Enter}");
    await screen.findByRole("menu");
    await waitFor(() =>
      expect(row("English, default, live, Editing")).toHaveFocus()
    );
    await user.keyboard("{ArrowDown}");
    await waitFor(() =>
      expect(row("Spanish, live, 1 field out of date")).toHaveFocus()
    );
    await user.keyboard("{Enter}");
    expect(navigateTo).not.toHaveBeenCalled();
  });

  it("gives the languages no description once it lets go", async () => {
    const { menu } = await open();
    expect(
      within(menu).getByRole("group", { name: "Languages" })
    ).not.toHaveAttribute("aria-describedby");
  });
});

describe("what the menu offers below the languages", () => {
  it("publishes other languages, handing nothing on", async () => {
    const onPublishOthers = vi.fn();
    const { user } = await open({ onPublishOthers });
    expect(onPublishOthers).not.toHaveBeenCalled();
    await user.click(row(PUBLISH));
    // Once, with no arguments.
    expect(onPublishOthers.mock.calls).toEqual([[]]);
    expect(navigateTo).not.toHaveBeenCalled();
    await menuIsClosed();
  });

  it("leads to the site's languages", async () => {
    const { user } = await open({ canManageLanguages: true });
    expect(row(MANAGE)).toHaveAttribute("href", "/admin/settings/languages");
    await user.click(row(MANAGE));
    expect(vi.mocked(navigateTo).mock.calls).toEqual([
      ["/admin/settings/languages"],
    ]);
  });

  it.each<{
    publish: boolean;
    manage: boolean;
    below: string[];
    separators: number;
  }>([
    { publish: false, manage: false, below: [], separators: 0 },
    { publish: true, manage: false, below: [PUBLISH], separators: 1 },
    { publish: false, manage: true, below: [MANAGE], separators: 1 },
    { publish: true, manage: true, below: [PUBLISH, MANAGE], separators: 1 },
  ])(
    "offers only what the person may do (publish: $publish, manage: $manage)",
    async ({ publish, manage, below, separators }) => {
      const { menu } = await open({
        ...(publish ? { onPublishOthers: vi.fn() } : {}),
        canManageLanguages: manage,
      });
      expect(
        within(menu)
          .getAllByRole("menuitem")
          .map(item => item.textContent)
      ).toEqual([
        "English, default, live, Edit",
        "Spanish, live, 1 field out of date, Translate",
        "Arabic, not started, Translate",
        ...below,
      ]);
      expect(within(menu).queryAllByRole("separator")).toHaveLength(separators);
    }
  );
});

describe("by keyboard", () => {
  /** Reaches the button with Tab and opens its menu with Enter. */
  async function openByKeyboard(props: Partial<LanguagesButtonProps> = {}) {
    const { user } = draw(props);
    expect(theButton()).not.toHaveFocus();
    await user.tab();
    expect(theButton()).toHaveFocus();
    expect(screen.queryByRole("menu")).toBeNull();
    await user.keyboard("{Enter}");
    return { user, menu: await screen.findByRole("menu") };
  }

  /** Walks down from the first row, each arrow landing on the next row given. */
  async function walk(user: User, rows: HTMLElement[]) {
    for (const [index, item] of rows.entries()) {
      if (index > 0) await user.keyboard("{ArrowDown}");
      await waitFor(() => expect(item).toHaveFocus());
    }
  }

  it("moves through every row in order, the current one among them", async () => {
    const { user, menu } = await openByKeyboard({
      currentLanguage: "es",
      onPublishOthers: vi.fn(),
      canManageLanguages: true,
    });
    const rows = [
      row("English, default, live, Edit"),
      row("Spanish, live, 1 field out of date, Editing"),
      row("Arabic, not started, Translate"),
      row(PUBLISH),
      row(MANAGE),
    ];
    // All there are.
    expect(within(menu).getAllByRole("menuitem")).toHaveLength(rows.length);
    await walk(user, rows);

    await user.keyboard("{ArrowUp}");
    await waitFor(() => expect(row(PUBLISH)).toHaveFocus());
    expect(navigateTo).not.toHaveBeenCalled();
  });

  it("goes to a language with Enter", async () => {
    const { user } = await openByKeyboard();
    await walk(user, [
      row("English, default, live, Edit"),
      row("Spanish, live, 1 field out of date, Translate"),
    ]);
    expect(navigateTo).not.toHaveBeenCalled();
    await user.keyboard("{Enter}");
    expect(vi.mocked(navigateTo).mock.calls).toEqual([[SPANISH_HREF]]);
    await menuIsClosed();
  });

  it("closes on the current language with Enter, back on the button", async () => {
    const { user } = await openByKeyboard({ currentLanguage: "en" });
    await walk(user, [row("English, default, live, Editing")]);
    await user.keyboard("{Enter}");
    await menuIsClosed();
    await waitFor(() => expect(theButton()).toHaveFocus());
    expect(navigateTo).not.toHaveBeenCalled();
  });

  it("closes with Escape, back on the button", async () => {
    const onPublishOthers = vi.fn();
    const { user } = await openByKeyboard({ onPublishOthers });
    await walk(user, [row("English, default, live, Edit")]);
    expect(theButton()).not.toHaveFocus();
    await user.keyboard("{Escape}");
    await menuIsClosed();
    await waitFor(() => expect(theButton()).toHaveFocus());
    expect(navigateTo).not.toHaveBeenCalled();
    expect(onPublishOthers).not.toHaveBeenCalled();
  });

  it("publishes other languages with Enter", async () => {
    const onPublishOthers = vi.fn();
    const { user } = await openByKeyboard({ onPublishOthers });
    await walk(user, [
      row("English, default, live, Edit"),
      row("Spanish, live, 1 field out of date, Translate"),
      row("Arabic, not started, Translate"),
      row(PUBLISH),
    ]);
    expect(onPublishOthers).not.toHaveBeenCalled();
    await user.keyboard("{Enter}");
    expect(onPublishOthers.mock.calls).toEqual([[]]);
    expect(navigateTo).not.toHaveBeenCalled();
  });
});

describe("a language's name", () => {
  it("is marked up in its own language and direction where it is written in it", async () => {
    const { menu } = await open({
      model: modelOf({ en: LIVE }, [
        ENGLISH,
        { code: "es", label: "Español", rtl: false },
        { code: "ar", label: "العربية", rtl: true },
      ]),
    });
    const spanish = within(menu).getByText("Español");
    expect(spanish.tagName).toBe("BDI");
    expect(spanish).toHaveAttribute("lang", "es");
    expect(spanish).toHaveAttribute("dir", "ltr");

    const arabic = within(menu).getByText("العربية");
    expect(arabic.tagName).toBe("BDI");
    expect(arabic).toHaveAttribute("lang", "ar");
    expect(arabic).toHaveAttribute("dir", "rtl");
  });

  it("is not marked up as a language it is not written in", async () => {
    const { menu } = await open();
    for (const name of ["Spanish", "Arabic"]) {
      const written = within(menu).getByText(name);
      expect(written.tagName).toBe("BDI");
      expect(written).not.toHaveAttribute("lang");
      expect(written).toHaveAttribute("dir", "auto");
    }
    // English is written in English.
    expect(within(menu).getByText("English")).toHaveAttribute("lang", "en");
  });
});
