/**
 * A plugin's entry-list filters: the toolbar lists each one a plugin declares
 * for this collection, and choosing an option adds its `where` to the list's
 * request and keeps the choice in the page's URL (`?pf=<filter>:<value>`),
 * read back when the page loads. A `pf` that names no declared filter or
 * option is ignored, so the request is the one the list makes without it.
 */
import { act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { render, screen, within } from "@admin/__tests__/utils";

import { EntryList } from "../EntryList";
import { EntryTable } from "../EntryTable";
import type { CollectionForColumns } from "../EntryTableColumns";
import type { OfferedListFilter } from "../plugin-filters";

const STATE: OfferedListFilter = {
  name: "acme-support.state",
  label: "Ticket state",
  options: [
    { value: "open", label: "Open", where: { state: { equals: "open" } } },
    { value: "closed", label: "Closed", where: { state: { equals: "closed" } } },
  ],
};

const { useEntries, tableProps, plugins, table } = vi.hoisted(() => ({
  useEntries: vi.fn((_options: { params: Record<string, unknown> }) => ({
    data: undefined,
    isLoading: true,
  })),
  tableProps: vi.fn((_props: Record<string, unknown>) => undefined),
  plugins: { list: [] as unknown[] },
  // Whether the stubbed table draws the real one: the toolbar's own test
  // needs it, the list's tests only what the list hands it.
  table: { real: false },
}));

// Hoisted, so it applies to the whole file: the stub records what the list
// hands its table, and draws the real table where a case asks for it.
vi.mock("../EntryTable", async importOriginal => {
  const actual = await importOriginal<typeof import("../EntryTable")>();
  return {
    ...actual,
    EntryTable: (props: Record<string, unknown>) => {
      tableProps(props);
      return table.real ? (
        <actual.EntryTable {...(props as never)} />
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
  useCollection: () => ({
    data: { name: "tickets", label: "Tickets", fields: [] },
    isLoading: false,
  }),
}));
vi.mock("@admin/hooks/useCanRequest", () => ({
  useAsksTranslationStatus: () => false,
  useDefaultLanguageAsksTranslationStatus: () => false,
}));
vi.mock("@admin/hooks/useCan", () => ({ useCan: () => false }));
vi.mock("@admin/hooks/usePluginAutoRegistration", () => ({
  usePluginAutoRegistration: () => undefined,
}));
vi.mock("@admin/hooks/useLocalization", () => ({
  useLocalization: () => ({
    enabled: false,
    locales: [],
    defaultLocale: "en",
    fallback: true,
    getLocale: () => undefined,
  }),
}));
vi.mock("@admin/context/providers/BrandingProvider", async importOriginal => ({
  ...(await importOriginal<object>()),
  useBranding: () => ({ plugins: plugins.list }),
}));

/** The params of the list's latest read. */
const lastRead = (): Record<string, unknown> =>
  useEntries.mock.calls.at(-1)?.[0].params ?? {};

/** The handler the list hands its table for a plugin filter choice. */
const chooseInTable = (name: string, value: string | null): void => {
  const props = tableProps.mock.calls.at(-1)?.[0] as {
    onPluginFilterChange?: (name: string, value: string | null) => void;
  };
  act(() => props.onPluginFilterChange?.(name, value));
};

function at(search: string): void {
  window.history.replaceState(null, "", `/admin/collections/tickets${search}`);
}

afterEach(() => at(""));

describe("the toolbar", () => {
  const tickets: CollectionForColumns = {
    slug: "tickets",
    label: "Tickets",
    fields: [{ type: "text", name: "state", label: "State" } as never],
  };

  beforeEach(() => {
    table.real = true;
  });
  afterEach(() => {
    table.real = false;
  });

  it("lists each declared filter and its options, and reports a choice", async () => {
    const onPluginFilterChange = vi.fn();
    render(
      <EntryTable
        collection={tickets}
        entries={[]}
        pagination={{ page: 0, limit: 10, total: 0, totalPages: 0 }}
        onPageChange={vi.fn()}
        onLimitChange={vi.fn()}
        onSortChange={vi.fn()}
        onSearchChange={vi.fn()}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
        onBulkDelete={vi.fn()}
        onBulkPublish={vi.fn()}
        onBulkUnpublish={vi.fn()}
        pluginFilters={[STATE]}
        chosenPluginFilters={new Map([["acme-support.state", "open"]])}
        onPluginFilterChange={onPluginFilterChange}
      />
    );
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /Filter/ }));
    const menu = await screen.findByRole("menu");

    expect(within(menu).getByText("Ticket state")).toBeTruthy();
    const open = within(menu).getByRole("menuitemcheckbox", { name: "Open" });
    const closed = within(menu).getByRole("menuitemcheckbox", { name: "Closed" });
    expect(open.getAttribute("aria-checked")).toBe("true");
    expect(closed.getAttribute("aria-checked")).toBe("false");

    await user.click(closed);
    expect(onPluginFilterChange).toHaveBeenCalledWith(
      "acme-support.state",
      "closed"
    );
  });
});

describe("the entry list with a plugin's filter", () => {
  beforeEach(() => {
    useEntries.mockClear();
    tableProps.mockClear();
    plugins.list = [{ name: "@acme/support", listFilters: [STATE] }];
  });

  it("requests the chosen option's where, read from the URL", () => {
    at("?pf=acme-support.state:open");
    render(<EntryList collectionSlug="tickets" />);

    expect(lastRead().where).toEqual({ state: { equals: "open" } });
    expect(
      (tableProps.mock.calls.at(-1)?.[0] as { pluginFilters?: unknown }).pluginFilters
    ).toEqual([STATE]);
  });

  it("keeps a choice in the URL and requests it", () => {
    at("");
    render(<EntryList collectionSlug="tickets" />);
    expect(lastRead().where).toBeUndefined();

    chooseInTable("acme-support.state", "closed");
    expect(new URLSearchParams(window.location.search).getAll("pf")).toEqual([
      "acme-support.state:closed",
    ]);
    expect(lastRead().where).toEqual({ state: { equals: "closed" } });

    chooseInTable("acme-support.state", null);
    expect(new URLSearchParams(window.location.search).getAll("pf")).toEqual([]);
    expect(lastRead().where).toBeUndefined();
  });

  it("ignores a pf that names no declared filter or option", () => {
    at("?pf=acme-support.state:everything&pf=other.filter:open&pf=nonsense");
    render(<EntryList collectionSlug="tickets" />);

    expect(lastRead().where).toBeUndefined();
  });

  it("offers no filter declared for other collections", () => {
    plugins.list = [
      {
        name: "@acme/support",
        listFilters: [{ ...STATE, collections: ["orders"] }],
      },
    ];
    at("?pf=acme-support.state:open");
    render(<EntryList collectionSlug="tickets" />);

    expect(lastRead().where).toBeUndefined();
    expect(
      (tableProps.mock.calls.at(-1)?.[0] as { pluginFilters?: unknown }).pluginFilters
    ).toEqual([]);
  });
});
