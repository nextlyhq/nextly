/**
 * The entry list's languages: the chips column, its key, the "Missing in" / "Out of date in"
 * filter and the "Titles in" control, and who is offered them.
 *
 * Offered on a site with two languages or more, for a collection whose content is per language,
 * and (the column and the filter) only to a reader the server lets read every language's
 * translation state: the server refuses a list read carrying that state, or filtered by it, to
 * anyone else. A one-language site shows none of it. The list's read hooks are replaced; the
 * reader's access is decided by the real `useCanRequest` from a stubbed capabilities answer, and
 * the one-language and three-language cases draw the real table.
 */
import { act, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { render, screen, within } from "@admin/__tests__/utils";

import { EntryList } from "../EntryList";
import type { EntryTableProps } from "../EntryTable";
import { LANGUAGE_FILTER } from "../language-list-filters";
import type { ListFilter } from "../plugin-filters";
import type { TitleLanguageChoice } from "../TitleLanguageSelect";

const { useEntries, tableProps, table, site, access, title, find, LANGUAGES } =
  vi.hoisted(() => ({
    useEntries: vi.fn(
      (_options: {
        params: Record<string, unknown>;
        enabled?: boolean;
      }): { data: unknown; isLoading: boolean } => ({
        data: undefined,
        isLoading: true,
      })
    ),
    tableProps: vi.fn((_props: Record<string, unknown>) => undefined),
    // Whether the stubbed table draws the real one.
    table: { real: false },
    // The site's languages: three, or one.
    site: { languages: 3 },
    // The reader's access as the capabilities answer gives it, and whether that answer is in.
    // `failed`: the answer's request failed, and no answer is in hand.
    access: { readTranslations: true, loading: false, failed: false },
    // Whether the title field is kept once for every language (`localized: false`).
    title: { shared: false, virtual: false },
    // The read of titles in a chosen language.
    find: vi.fn(),
    LANGUAGES: [
      { code: "en", label: "English", rtl: false, fallbackLocale: [] },
      { code: "es", label: "Spanish", rtl: false, fallbackLocale: [] },
      { code: "ar", label: "Arabic", rtl: true, fallbackLocale: [] },
    ],
  }));

vi.mock("../EntryTable", async importOriginal => {
  const actual = await importOriginal<typeof import("../EntryTable")>();
  return {
    ...actual,
    EntryTable: (props: Record<string, unknown>) => {
      tableProps(props);
      return table.real ? (
        <actual.EntryTable {...(props as unknown as EntryTableProps)} />
      ) : null;
    },
  };
});
vi.mock("@admin/hooks/queries", () => ({
  useEntries,
  useBulkDeleteEntries: () => ({ mutate: vi.fn(), isPending: false }),
  useBulkUpdateEntries: () => ({ mutate: vi.fn(), isPending: false }),
}));
vi.mock("@admin/hooks/queries/useCollections", () => ({
  useEveryNavCollection: () => ({ data: undefined }),
  useCollection: () => ({
    data: {
      name: "posts",
      label: "Posts",
      localized: true,
      fields: [
        {
          type: "text",
          name: "title",
          label: "Title",
          ...(title.shared ? { localized: false } : {}),
          ...(title.virtual ? { virtual: true } : {}),
        },
      ],
    },
    isLoading: false,
  }),
}));
vi.mock("@admin/hooks/useCan", () => ({ useCan: () => false }));
vi.mock("@admin/hooks/useLocalization", () => ({
  useLocalization: () => {
    const locales = LANGUAGES.slice(0, site.languages);
    return {
      // The admin's own rule: languages are configured once there are two.
      enabled: locales.length >= 2,
      locales,
      defaultLocale: "en",
      fallback: true,
      getLocale: (code: string | undefined) =>
        locales.find(l => l.code === code),
    };
  },
}));
vi.mock("@admin/hooks/useCurrentUserPermissions", async importOriginal => {
  const original = await importOriginal<{
    useCurrentUserPermissions: () => Record<string, unknown> & {
      content: Record<string, unknown>;
    };
  }>();
  return {
    ...original,
    useCurrentUserPermissions: () => {
      const answer = original.useCurrentUserPermissions();
      return {
        ...answer,
        canAccessCollection: (_slug: string, action: string) =>
          !access.loading &&
          !access.failed &&
          (action === "readTranslations" ? access.readTranslations : true),
        content: {
          ...answer.content,
          isLoading: access.loading,
          hasAnswer: !access.loading && !access.failed,
        },
      };
    },
  };
});
vi.mock("@admin/context/providers/BrandingProvider", async importOriginal => ({
  ...(await importOriginal<
    typeof import("@admin/context/providers/BrandingProvider")
  >()),
  useBranding: () => ({ plugins: [] }),
  useBrandingStatus: () => ({
    isPending: false,
    isUnavailable: false,
    isBrandingUnavailable: false,
  }),
}));
vi.mock("@admin/services/entryApi", async importOriginal => {
  const original =
    await importOriginal<typeof import("@admin/services/entryApi")>();
  return { ...original, entryApi: { ...original.entryApi, find } };
});

/** Three posts: one with an out-of-date Spanish translation, two in English only. */
const ROWS = [
  {
    id: "p1",
    title: "One",
    _translations: {
      en: { translated: true },
      es: { translated: true, stale: true },
      ar: { translated: false },
    },
  },
  { id: "p2", title: "Two" },
  { id: "p3", title: "Three" },
];

const answerRows = (): void => {
  useEntries.mockImplementation(() => ({
    data: {
      items: ROWS,
      meta: { page: 1, limit: 25, total: 3, totalPages: 1 },
    },
    isLoading: false,
  }));
};

/** The params of the list's latest read. */
const lastRead = (): Record<string, unknown> =>
  useEntries.mock.calls.at(-1)?.[0].params ?? {};

/** What the list last handed its table. */
const lastTable = () =>
  (tableProps.mock.calls.at(-1)?.[0] ?? {}) as {
    pluginFilters?: readonly ListFilter[];
    titleLanguage?: TitleLanguageChoice;
    collection?: { localized?: boolean };
  };

const languageFilterOf = (filters: readonly ListFilter[] = []) =>
  filters.find(filter => filter.name === LANGUAGE_FILTER);

function at(search: string): void {
  window.history.replaceState(null, "", `/admin/collections/posts${search}`);
}

beforeEach(() => {
  useEntries.mockReset();
  useEntries.mockImplementation(() => ({ data: undefined, isLoading: true }));
  tableProps.mockClear();
  find.mockReset();
  table.real = false;
  site.languages = 3;
  title.shared = false;
  title.virtual = false;
  access.readTranslations = true;
  access.loading = false;
  access.failed = false;
  at("");
});
afterEach(() => at(""));

describe("the entry list on a site with several languages", () => {
  it("shows each row's languages, offers the language filter and the title language", () => {
    render(<EntryList collectionSlug="posts" />);

    expect(lastRead().translationStatus).toBe(true);
    expect(lastTable().collection?.localized).toBe(true);
    expect(
      languageFilterOf(lastTable().pluginFilters)?.options.map(o => o.label)
    ).toEqual([
      "Missing in Spanish",
      "Missing in Arabic",
      "Out of date in Spanish",
      "Out of date in Arabic",
    ]);
    expect(lastTable().titleLanguage?.value).toBe("en");
  });

  it("reads a link's choice of 'Out of date in Spanish' as the server's filter", () => {
    at(`?pf=${LANGUAGE_FILTER}:out-of-date.es`);
    render(<EntryList collectionSlug="posts" />);
    expect(lastRead().where).toEqual({
      _translated: { locale: "es", state: "stale" },
    });
  });

  it("reads the titles in the language chosen, and hands the table what that read returned", async () => {
    answerRows();
    find.mockResolvedValue({
      items: [{ id: "p1", title: "Uno" }],
      meta: {},
    });
    render(<EntryList collectionSlug="posts" />);
    expect(find).not.toHaveBeenCalled();

    act(() => lastTable().titleLanguage?.onChange("es"));

    await waitFor(() =>
      expect(lastTable().titleLanguage?.titles?.get("p1")).toBe("Uno")
    );
    expect(find).toHaveBeenCalledWith(
      "posts",
      expect.objectContaining({
        locale: "es",
        fallbackLocale: "none",
        where: { id: { in: ["p1", "p2", "p3"] } },
      })
    );
    expect(lastTable().titleLanguage?.value).toBe("es");
    // The rows a read in Spanish did not return are not handed over as Spanish titles.
    expect(lastTable().titleLanguage?.titles?.has("p2")).toBe(false);
  });
});

describe("the title language", () => {
  it("is not offered where the title is kept once for every language", () => {
    // A shared title reads the same in every language: shown "in Spanish", it would be marked
    // as Spanish text that it is not.
    title.shared = true;
    render(<EntryList collectionSlug="posts" />);
    expect(lastTable().titleLanguage).toBeUndefined();
    // The languages column and filter still are: the content is per language.
    expect(lastTable().collection?.localized).toBe(true);
  });

  it("is not offered where the title is virtual, stored in no language", () => {
    // Text-like, in a collection whose content is per language, and still not translated: a
    // virtual field is stored nowhere, in any language.
    title.virtual = true;
    render(<EntryList collectionSlug="posts" />);
    expect(lastTable().titleLanguage).toBeUndefined();
  });
});

describe("the entry list for a reader who may not read every language's state", () => {
  beforeEach(() => {
    access.readTranslations = false;
  });

  it("shows no languages column and offers no language filter", () => {
    render(<EntryList collectionSlug="posts" />);
    expect(lastRead().translationStatus).toBeUndefined();
    expect(lastTable().collection?.localized).toBe(false);
    expect(languageFilterOf(lastTable().pluginFilters)).toBeUndefined();
  });

  it("sends no language filter a link chooses, in either spelling", () => {
    at(`?pf=${LANGUAGE_FILTER}:missing.es`);
    const { unmount } = render(<EntryList collectionSlug="posts" />);
    expect(lastRead().where).toBeUndefined();
    unmount();

    at(
      `?where=${encodeURIComponent(
        JSON.stringify({ _translated: { locale: "es", state: "stale" } })
      )}`
    );
    render(<EntryList collectionSlug="posts" />);
    expect(lastRead().where).toBeUndefined();
  });

  it("still offers titles in a chosen language, which a read of its own answers for", () => {
    // Reading one language's titles is judged in that language alone, so it is not withheld
    // with the every-language state; the server answers it for this reader and each row.
    render(<EntryList collectionSlug="posts" />);
    expect(lastTable().titleLanguage).toBeDefined();
  });
});

describe("a link choosing the language filter, while the reader's access is not yet known", () => {
  it("waits for it rather than reading the list the link did not ask for", () => {
    access.loading = true;
    at(`?pf=${LANGUAGE_FILTER}:missing.ar`);
    const { rerender } = render(<EntryList collectionSlug="posts" />);
    expect(useEntries.mock.calls.every(([o]) => o.enabled === false)).toBe(
      true
    );

    access.loading = false;
    rerender(<EntryList collectionSlug="posts" />);
    expect(useEntries.mock.calls.at(-1)?.[0].enabled).toBe(true);
    expect(lastRead().where).toEqual({
      _translated: { locale: "ar", state: "missing" },
    });
  });

  it("reads nothing, and says why, when that answer fails", () => {
    // With no answer in hand the reader's access is unknown, not refused: reading now would show
    // the rows the link asked to leave out.
    access.failed = true;
    at(`?pf=${LANGUAGE_FILTER}:missing.ar`);
    render(<EntryList collectionSlug="posts" />);
    expect(useEntries.mock.calls.every(([o]) => o.enabled === false)).toBe(
      true
    );
    expect(
      screen.getByText(
        /language filter, and your access to it couldn.t be checked/
      )
    ).toBeInTheDocument();
  });

  it("still reads a link choosing no language filter when that answer fails", () => {
    access.failed = true;
    at("");
    render(<EntryList collectionSlug="posts" />);
    expect(useEntries.mock.calls.at(-1)?.[0].enabled).toBe(true);
  });

  it("reads the list without the filter once the answer refuses it", () => {
    // A refusal is an answer: the filter is not offered, and the link's choice of it is ignored,
    // as any choice naming no offered filter is.
    access.readTranslations = false;
    at(`?pf=${LANGUAGE_FILTER}:missing.ar`);
    render(<EntryList collectionSlug="posts" />);
    expect(useEntries.mock.calls.at(-1)?.[0].enabled).toBe(true);
    expect(lastRead().where).toBeUndefined();
  });
});

describe("the entry list's languages, drawn", () => {
  beforeEach(() => {
    table.real = true;
    answerRows();
  });

  /** Opens the toolbar's filter menu and returns it. */
  async function openFilterMenu() {
    await userEvent.click(screen.getByRole("button", { name: /Filter/ }));
    return screen.findByRole("menu");
  }

  it("shows chips, their key, the language filter and the title language with three languages", async () => {
    // The control for the one-language case below: the same list, drawn with every one of them.
    render(<EntryList collectionSlug="posts" />);
    expect(
      screen.getByRole("columnheader", { name: /Languages/ })
    ).toBeInTheDocument();
    // In the table: the narrow-screen cards draw the same chips again.
    expect(
      within(screen.getByRole("table", { name: "Entries table" })).getByRole(
        "button",
        { name: /^Open in Spanish, ES, out of date/ }
      )
    ).toBeInTheDocument();
    expect(
      screen.getByRole("list", { name: "Language key" })
    ).toBeInTheDocument();
    expect(
      screen.getByRole("combobox", { name: /Titles in/ })
    ).toBeInTheDocument();
    const menu = await openFilterMenu();
    expect(
      within(menu).getByRole("menuitemcheckbox", {
        name: "Out of date in Spanish",
      })
    ).toBeInTheDocument();
  });

  it("shows no chip, key, language filter or title language on a one-language site", async () => {
    site.languages = 1;
    render(<EntryList collectionSlug="posts" />);

    expect(lastRead().translationStatus).toBeUndefined();
    expect(
      screen.queryByRole("columnheader", { name: /Languages/ })
    ).toBeNull();
    expect(screen.queryByRole("button", { name: /^Open in/ })).toBeNull();
    expect(screen.queryByRole("list", { name: "Language key" })).toBeNull();
    expect(screen.queryByRole("combobox", { name: /Titles in/ })).toBeNull();
    const menu = await openFilterMenu();
    expect(within(menu).queryByText(/Missing in|Out of date in/)).toBeNull();
    expect(within(menu).queryByText("Language")).toBeNull();
  });
});
