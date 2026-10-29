/**
 * The list screen of a collection removed from code: the notice naming it and
 * its next step, its entries still listed, and no control that would write —
 * no New, no row selection, no bulk or row Delete — for a caller who holds
 * every permission.
 *
 * The data hooks are replaced and the page itself is real.
 */

import { screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { parseApiError } from "@admin/lib/api/parseApiError";
import type { RemovedFromCodeState } from "@admin/types/removed-from-code";

import { renderWithProviders } from "../../../../../__tests__/utils";

type EntriesQuery = {
  data: unknown;
  isLoading: boolean;
  error: Error | null;
};

let entriesQuery: EntriesQuery;
let collection: Record<string, unknown>;

vi.mock("@admin/hooks/queries", () => ({
  useEntries: () => entriesQuery,
  useBulkDeleteEntries: () => ({ mutate: vi.fn(), isPending: false }),
  useBulkUpdateEntries: () => ({ mutate: vi.fn(), isPending: false }),
}));
vi.mock("@admin/hooks/queries/useCollections", () => ({
  useCollection: () => ({ data: collection, isLoading: false }),
}));
// Every permission held: what is withheld below is withheld because the
// collection was removed from code, not for want of a grant.
vi.mock("@admin/hooks/useCan", () => ({ useCan: () => true }));
vi.mock("@admin/hooks/useLocalization", () => ({
  useLocalization: () => ({ enabled: false }),
}));
vi.mock("@admin/hooks/usePluginAutoRegistration", () => ({
  usePluginAutoRegistration: () => undefined,
}));
vi.mock("@admin/hooks/useSearchParams", () => ({
  useSearchParams: () => ({}),
}));

import { EntryList } from "../EntryList";

const ONE_ENTRY = {
  items: [{ id: "e1", title: "About us", status: "published" }],
  meta: {
    total: 1,
    page: 1,
    limit: 25,
    totalPages: 1,
    hasNext: false,
    hasPrev: false,
  },
};

function pages(state?: RemovedFromCodeState): Record<string, unknown> {
  return {
    name: "pages",
    label: "Page",
    labels: { singular: "Page", plural: "Pages" },
    status: true,
    fields: [{ name: "title", type: "text" }],
    ...(state === undefined
      ? {}
      : { removedFromCode: true, removedFromCodeState: state }),
  };
}

beforeEach(() => {
  entriesQuery = { data: ONE_ENTRY, isLoading: false, error: null };
});

describe("EntryList for a collection removed from code", () => {
  it("names it, gives its step, and offers nothing that writes", () => {
    collection = pages({ state: "not-dropped" });
    renderWithProviders(<EntryList collectionSlug="pages" />);

    const notice = screen.getByTestId("removed-from-code-notice");
    expect(notice).toHaveTextContent(
      "“Pages” is no longer in the configuration"
    );
    expect(notice).toHaveTextContent(
      "To retire it, run nextly migrate:create, then nextly migrate."
    );
    // The entry is still listed.
    expect(screen.getAllByText("About us").length).toBeGreaterThan(0);
    // Nothing that writes.
    expect(screen.queryByRole("button", { name: /new page/i })).toBeNull();
    expect(screen.queryAllByRole("checkbox")).toEqual([]);
    expect(screen.queryByRole("menuitem", { name: /delete/i })).toBeNull();
  });

  it("names the migration that retires it while that is pending", () => {
    collection = pages({
      state: "drop-pending",
      migration: "20261027_120000_drop_pages.sql",
    });
    renderWithProviders(<EntryList collectionSlug="pages" />);
    expect(screen.getByTestId("removed-from-code-notice")).toHaveTextContent(
      "Run nextly migrate to apply 20261027_120000_drop_pages.sql."
    );
  });

  it("says a half-retired one was left part-retired, in place of the failed read", () => {
    collection = pages({ state: "half-retired" });
    entriesQuery = {
      data: undefined,
      isLoading: false,
      error: parseApiError(
        {
          error: {
            code: "INTERNAL_ERROR",
            message: "Something went wrong.",
            requestId: "r1",
          },
        },
        500
      ),
    };
    renderWithProviders(<EntryList collectionSlug="pages" />);

    const notice = screen.getByTestId("removed-from-code-notice");
    expect(notice).toHaveTextContent("An earlier release left it part-retired");
    expect(notice).toHaveTextContent(
      "Run nextly prune, which lists what remains."
    );
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.queryByText(/no pages yet/i)).toBeNull();
  });

  it("is the same list as before for a declared collection", () => {
    // The control: the same page, unmarked, offers New and selection.
    collection = pages();
    renderWithProviders(<EntryList collectionSlug="pages" />);
    expect(screen.queryByTestId("removed-from-code-notice")).toBeNull();
    expect(
      screen.getByRole("button", { name: /new page/i })
    ).toBeInTheDocument();
    expect(screen.getAllByRole("checkbox").length).toBeGreaterThan(0);
    expect(
      within(screen.getByRole("table")).getByText("About us")
    ).toBeInTheDocument();
  });
});
