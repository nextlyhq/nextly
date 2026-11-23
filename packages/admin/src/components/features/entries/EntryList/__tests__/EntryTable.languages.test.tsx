/**
 * The entry table on a site with several languages: each row's languages as chips with their key
 * above the table, and titles in the language the reader chose.
 *
 * A title is shown in the chosen language only where the read in that language returned one,
 * marked with that language's `lang` and `dir`; every other row keeps its default-language title,
 * marked as such, and a read that failed is said so above the table.
 */
import { describe, expect, it, vi } from "vitest";

import { render, screen, within } from "@admin/__tests__/utils";

import { EntryTable, type EntryTableProps } from "../EntryTable";
import type { CollectionForColumns } from "../EntryTableColumns";
import type { TitleLanguageChoice } from "../TitleLanguageSelect";

vi.mock("@admin/hooks/useCan", () => ({ useCan: () => true }));

const { LANGUAGES } = vi.hoisted(() => ({
  LANGUAGES: [
    { code: "en", label: "English", rtl: false, fallbackLocale: [] },
    { code: "es", label: "Spanish", rtl: false, fallbackLocale: [] },
    { code: "ar", label: "Arabic", rtl: true, fallbackLocale: [] },
  ],
}));

vi.mock("@admin/hooks/useLocalization", () => ({
  useLocalization: () => ({
    enabled: true,
    locales: LANGUAGES,
    defaultLocale: "en",
    fallback: true,
    getLocale: () => undefined,
  }),
}));

const posts: CollectionForColumns = {
  slug: "posts",
  label: "Posts",
  localized: true,
  fields: [{ type: "text", name: "title", label: "Title" } as never],
};

const ROWS = [
  {
    id: "p1",
    title: "One",
    _translations: {
      en: { translated: true, status: "published" },
      es: { translated: true, status: "published", stale: true },
    },
  },
  { id: "p2", title: "Two" },
  { id: "p3", title: "Three" },
];

function renderTable(props: Partial<EntryTableProps> = {}) {
  return render(
    <EntryTable
      collection={posts}
      entries={ROWS}
      pagination={{ page: 0, limit: 10, total: 3, totalPages: 1 }}
      onPageChange={vi.fn()}
      onLimitChange={vi.fn()}
      onSortChange={vi.fn()}
      onSearchChange={vi.fn()}
      onEdit={vi.fn()}
      entryHref={id => `/admin/collections/posts/${id}`}
      onDelete={vi.fn()}
      onBulkDelete={vi.fn()}
      {...props}
    />
  );
}

function choice(overrides: Partial<TitleLanguageChoice>): TitleLanguageChoice {
  return {
    languages: LANGUAGES,
    defaultLocale: "en",
    value: "en",
    onChange: vi.fn(),
    titles: undefined,
    failed: false,
    ...overrides,
  };
}

const entriesTable = () =>
  within(screen.getByRole("table", { name: "Entries table" }));

/** The language a row's title is marked as written in. */
const titleLanguageOf = (text: string): Element | null =>
  entriesTable().getByText(text).closest("[data-title-language]");

describe("EntryTable — language chips", () => {
  it("shows each row's languages as chips, and the key above the table", () => {
    renderTable();
    expect(
      entriesTable().getByRole("button", {
        name: "Open in Spanish (ES), out of date, live",
      })
    ).toBeInTheDocument();
    // Arabic is missing on every row: one chip each.
    expect(
      entriesTable().getAllByRole("button", {
        name: "Open in Arabic (AR), missing",
      })
    ).toHaveLength(3);
    expect(
      screen.getByRole("list", { name: "Language key" })
    ).toBeInTheDocument();
  });

  it("leaves the key out while the Languages column is hidden", () => {
    renderTable({
      columnsControl: {
        columns: [],
        isColumnVisible: name => name !== "translations",
        onToggleColumn: vi.fn(),
      },
    });
    expect(screen.queryByRole("list", { name: "Language key" })).toBeNull();
  });

  it("offers no chips or key for a collection whose content is not per language", () => {
    renderTable({ collection: { ...posts, localized: false } });
    expect(
      entriesTable().queryByRole("button", { name: /^Open in/ })
    ).toBeNull();
    expect(screen.queryByRole("list", { name: "Language key" })).toBeNull();
  });
});

describe("EntryTable — titles in a chosen language", () => {
  it("offers the control where the list hands it one", () => {
    renderTable({ titleLanguage: choice({}) });
    expect(
      screen.getByRole("combobox", { name: /Titles in/ })
    ).toBeInTheDocument();
  });

  it("shows a title in the chosen language only where that language's read returned one", () => {
    renderTable({
      titleLanguage: choice({
        value: "es",
        // p2 has no Spanish title; p3 the read did not return.
        titles: new Map<string, unknown>([
          ["p1", "Uno"],
          ["p2", ""],
        ]),
      }),
    });
    expect(titleLanguageOf("Uno")).toHaveAttribute("lang", "es");
    expect(titleLanguageOf("Uno")).toHaveAttribute("dir", "ltr");
    expect(entriesTable().queryByText("One")).toBeNull();
    // The others keep their own title, marked as the default language's.
    for (const title of ["Two", "Three"]) {
      expect(titleLanguageOf(title)).toHaveAttribute("lang", "en");
    }
    expect(entriesTable().getAllByText("(English)")).toHaveLength(2);
  });

  it("writes a right-to-left language's titles right to left", () => {
    renderTable({
      titleLanguage: choice({
        value: "ar",
        titles: new Map<string, unknown>([["p1", "واحد"]]),
      }),
    });
    expect(titleLanguageOf("واحد")).toHaveAttribute("lang", "ar");
    expect(titleLanguageOf("واحد")).toHaveAttribute("dir", "rtl");
  });

  it("keeps the list's own titles, unmarked, until the read answers", () => {
    renderTable({ titleLanguage: choice({ value: "es", titles: undefined }) });
    expect(entriesTable().getByText("One")).toBeInTheDocument();
    expect(entriesTable().queryByText("(English)")).toBeNull();
  });

  it("says so above the table when the titles in that language could not be read", () => {
    renderTable({
      titleLanguage: choice({ value: "es", titles: undefined, failed: true }),
    });
    expect(
      screen.getByText(
        "Titles in Spanish couldn't be read, so each title is shown in English."
      )
    ).toHaveAttribute("role", "status");
    expect(entriesTable().getByText("One")).toBeInTheDocument();
  });

  it("changes nothing while the default language is chosen", () => {
    renderTable({ titleLanguage: choice({ value: "en", failed: true }) });
    expect(titleLanguageOf("One")).toBeNull();
    expect(screen.queryByText(/couldn't be read/)).toBeNull();
  });
});
