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
import { EntryTable, type EntryTableProps } from "../EntryTable";
import type { CollectionForColumns } from "../EntryTableColumns";
import type { OfferedListFilter } from "../plugin-filters";

const STATE: OfferedListFilter = {
  name: "acme-support.state",
  label: "Ticket state",
  options: [
    { value: "open", label: "Open", where: { state: { equals: "open" } } },
    {
      value: "closed",
      label: "Closed",
      where: { state: { equals: "closed" } },
    },
  ],
};

/** A read the stubbed `useEntries` answers with. */
interface EntriesRead {
  data: unknown;
  isLoading: boolean;
}

const LOADING: EntriesRead = { data: undefined, isLoading: true };

const { useEntries, tableProps, plugins, table, branding } = vi.hoisted(() => ({
  useEntries: vi.fn(
    (_options: {
      params: Record<string, unknown>;
      enabled?: boolean;
    }): EntriesRead => ({ data: undefined, isLoading: true })
  ),
  tableProps: vi.fn((_props: Record<string, unknown>) => undefined),
  plugins: { list: [] as unknown[] },
  // Whether the stubbed table draws the real one: the toolbar's own test
  // needs it, the list's tests only what the list hands it.
  table: { real: false },
  // Whether the signed-in meta, which declares the filters, is still on its way.
  branding: { pending: false, unavailable: false },
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
  ...(await importOriginal<
    typeof import("@admin/context/providers/BrandingProvider")
  >()),
  useBranding: () => ({ plugins: plugins.list }),
  useBrandingStatus: () => ({
    isPending: branding.pending,
    isUnavailable: branding.unavailable,
    isBrandingUnavailable: false,
  }),
}));

/** The params of the list's latest read. */
const lastRead = (): Record<string, unknown> =>
  useEntries.mock.calls.at(-1)?.[0].params ?? {};

/** The handler the list hands its table for a plugin filter choice. */
const chooseInTable = (name: string, value: string | null): void => {
  const props = tableProps.mock.calls.at(-1)?.[0] as {
    onPluginFilterChange?: (name: string, value: string | null) => void;
  };
  act(() => {
    props.onPluginFilterChange?.(name, value);
    // The admin shell's router patches history so a replaceState announces
    // itself; no router is mounted here, so the announcement is made by hand.
    window.dispatchEvent(new Event("locationchange"));
  });
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
    const closed = within(menu).getByRole("menuitemcheckbox", {
      name: "Closed",
    });
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
    useEntries.mockImplementation(() => LOADING);
    tableProps.mockClear();
    plugins.list = [{ name: "@acme/support", listFilters: [STATE] }];
    branding.pending = false;
    branding.unavailable = false;
  });

  /** Every read answers with no rows. */
  const answerEmpty = (): void => {
    useEntries.mockImplementation(() => ({
      data: {
        items: [],
        meta: { page: 1, limit: 10, total: 0, totalPages: 0 },
      },
      isLoading: false,
    }));
  };

  it("keeps its table, and with it the filters, when a chosen option matches nothing", () => {
    answerEmpty();
    at("?pf=acme-support.state:open");
    render(<EntryList collectionSlug="tickets" />);

    expect(screen.queryByText("No tickets yet")).toBeNull();
    expect(
      (tableProps.mock.calls.at(-1)?.[0] as { pluginFilters?: unknown })
        .pluginFilters
    ).toEqual([STATE]);
  });

  it("calls a list with no filter and no rows empty", () => {
    answerEmpty();
    at("");
    render(<EntryList collectionSlug="tickets" />);

    expect(screen.getByText("No tickets yet")).toBeTruthy();
    expect(tableProps).not.toHaveBeenCalled();
  });

  it("waits for the plugins' filters before reading a filtered link", () => {
    // Before the signed-in meta arrives, no filter is declared, so the `pf`
    // resolves to nothing; a read now would be the unfiltered list.
    branding.pending = true;
    plugins.list = [];
    useEntries.mockImplementation(() => ({
      data: undefined,
      isLoading: false,
    }));
    at("?pf=acme-support.state:open");
    const { rerender } = render(<EntryList collectionSlug="tickets" />);

    expect(useEntries.mock.calls.every(([o]) => o.enabled === false)).toBe(
      true
    );
    // Held, the list reads as loading, not as an empty collection.
    expect(screen.queryByText("No tickets yet")).toBeNull();
    expect(
      (tableProps.mock.calls.at(-1)?.[0] as { isLoading?: boolean }).isLoading
    ).toBe(true);

    branding.pending = false;
    plugins.list = [{ name: "@acme/support", listFilters: [STATE] }];
    rerender(<EntryList collectionSlug="tickets" />);
    expect(useEntries.mock.calls.at(-1)?.[0].enabled).toBe(true);
    expect(lastRead().where).toEqual({ state: { equals: "open" } });
  });

  it("reads nothing, and says why, when the filters a link chooses never arrive", () => {
    // The workspace meta failed with nothing cached: no filter is declared,
    // and the list without the link's filter is not the one it asks for.
    branding.unavailable = true;
    plugins.list = [];
    useEntries.mockImplementation(() => ({
      data: undefined,
      isLoading: false,
    }));
    at("?pf=acme-support.state:open");
    render(<EntryList collectionSlug="tickets" />);

    expect(useEntries.mock.calls.every(([o]) => o.enabled === false)).toBe(
      true
    );
    expect(screen.getByText(/filters\s+couldn.t be loaded/)).toBeTruthy();
    expect(tableProps).not.toHaveBeenCalled();
  });

  it("reads a list whose URL chooses no plugin filter when the filters never arrive", () => {
    branding.unavailable = true;
    at("");
    render(<EntryList collectionSlug="tickets" />);
    expect(useEntries.mock.calls.at(-1)?.[0].enabled).toBe(true);
  });

  it("does not hold a list whose URL chooses no plugin filter", () => {
    branding.pending = true;
    at("");
    render(<EntryList collectionSlug="tickets" />);
    expect(useEntries.mock.calls.at(-1)?.[0].enabled).toBe(true);
  });

  it("requests the chosen option's where, read from the URL", () => {
    at("?pf=acme-support.state:open");
    render(<EntryList collectionSlug="tickets" />);

    expect(lastRead().where).toEqual({ state: { equals: "open" } });
    expect(
      (tableProps.mock.calls.at(-1)?.[0] as { pluginFilters?: unknown })
        .pluginFilters
    ).toEqual([STATE]);
  });

  it("adds the option's where to the list's own filters rather than replacing them", () => {
    at(
      `?where=${encodeURIComponent(JSON.stringify({ priority: { equals: "high" } }))}&pf=acme-support.state:open`
    );
    render(<EntryList collectionSlug="tickets" />);

    expect(lastRead().where).toEqual({
      and: [{ priority: { equals: "high" } }, { state: { equals: "open" } }],
    });
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
    expect(new URLSearchParams(window.location.search).getAll("pf")).toEqual(
      []
    );
    expect(lastRead().where).toBeUndefined();
  });

  it("returns to the first page when a filter is chosen", () => {
    at("");
    render(<EntryList collectionSlug="tickets" />);
    const props = tableProps.mock.calls.at(-1)?.[0] as {
      onPageChange: (page: number) => void;
    };
    act(() => props.onPageChange(1));
    expect(lastRead().page).toBe(2);

    chooseInTable("acme-support.state", "open");
    expect(lastRead().page).toBe(1);
  });

  it("returns to the first page when the back button restores another choice", () => {
    at("?pf=acme-support.state:open");
    render(<EntryList collectionSlug="tickets" />);
    const props = tableProps.mock.calls.at(-1)?.[0] as {
      onPageChange: (page: number) => void;
    };
    act(() => props.onPageChange(2));
    expect(lastRead().page).toBe(3);

    act(() => {
      at("?pf=acme-support.state:closed");
      window.dispatchEvent(new Event("locationchange"));
    });
    expect(lastRead().where).toEqual({ state: { equals: "closed" } });
    expect(lastRead().page).toBe(1);
  });

  it("keeps its page while the choice stands", () => {
    at("?pf=acme-support.state:open");
    render(<EntryList collectionSlug="tickets" />);
    const props = tableProps.mock.calls.at(-1)?.[0] as {
      onPageChange: (page: number) => void;
    };
    act(() => props.onPageChange(2));
    act(() => {
      at("?pf=acme-support.state:open&other=1");
      window.dispatchEvent(new Event("locationchange"));
    });
    expect(lastRead().page).toBe(3);
  });

  it("ignores a pf that names no declared filter or option", () => {
    at("?pf=acme-support.state:everything&pf=other.filter:open&pf=nonsense");
    render(<EntryList collectionSlug="tickets" />);

    expect(lastRead().where).toBeUndefined();
    // Nor is it counted as a choice: no filter shows as active.
    expect(
      (
        tableProps.mock.calls.at(-1)?.[0] as {
          chosenPluginFilters?: ReadonlyMap<string, string>;
        }
      ).chosenPluginFilters?.size
    ).toBe(0);
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
      (tableProps.mock.calls.at(-1)?.[0] as { pluginFilters?: unknown })
        .pluginFilters
    ).toEqual([]);
  });
});
