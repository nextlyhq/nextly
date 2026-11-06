/**
 * A list the server refuses says so, in the server's words, where the entries
 * would be.
 *
 * A failed list read left the page with no rows and not loading, which drew
 * the empty state: "No posts yet", and an offer to create the first one. That
 * tells someone the collection is empty when the server only refused to show
 * it. The list's other branches are drawn by the components they name, so the
 * data hooks are replaced and the page itself is real.
 */

import { screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { parseApiError } from "@admin/lib/api/parseApiError";

import { renderWithProviders } from "../../../../../__tests__/utils";

type EntriesQuery = {
  data: unknown;
  isLoading: boolean;
  error: Error | null;
};

let entriesQuery: EntriesQuery;

vi.mock("@admin/hooks/queries", () => ({
  useEntries: () => entriesQuery,
  useBulkDeleteEntries: () => ({ mutate: vi.fn(), isPending: false }),
  useBulkUpdateEntries: () => ({ mutate: vi.fn(), isPending: false }),
}));
vi.mock("@admin/hooks/queries/useCollections", () => ({
  useCollection: () => ({
    data: { name: "posts", label: "Posts", fields: [] },
    isLoading: false,
  }),
}));
vi.mock("@admin/hooks/useCan", () => ({ useCan: () => true }));
vi.mock("@admin/hooks/useLocalization", () => ({
  useLocalization: () => ({ enabled: false }),
}));
vi.mock("@admin/hooks/usePluginAutoRegistration", () => ({
  usePluginAutoRegistration: () => undefined,
}));
vi.mock("@admin/hooks/useSearchParams", () => ({
  // The hook answers a plain record, as `parseSearchParams` builds it: an
  // address with no query string.
  useSearchParams: () => ({}),
}));

import { EntryList } from "../EntryList";

const REFUSAL = "You can't see posts.";

beforeEach(() => {
  entriesQuery = { data: undefined, isLoading: false, error: null };
});

describe("EntryList", () => {
  it("shows a refused list's message, not the empty state", () => {
    entriesQuery = {
      data: undefined,
      isLoading: false,
      error: parseApiError(
        { error: { code: "FORBIDDEN", message: REFUSAL, requestId: "r1" } },
        403
      ),
    };

    renderWithProviders(<EntryList collectionSlug="posts" />);

    expect(screen.getByRole("alert")).toHaveTextContent(
      new RegExp(`^${REFUSAL}$`)
    );
    expect(screen.queryByText(/no posts yet/i)).toBeNull();
  });

  it("still shows the empty state for a list that answered with nothing", () => {
    // The control: without it, a page that never drew the empty state would
    // pass the absence above.
    entriesQuery = {
      data: {
        items: [],
        meta: {
          total: 0,
          page: 1,
          limit: 25,
          totalPages: 0,
          hasNext: false,
          hasPrev: false,
        },
      },
      isLoading: false,
      error: null,
    };

    renderWithProviders(<EntryList collectionSlug="posts" />);

    expect(screen.getByText(/no posts yet/i)).toBeInTheDocument();
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
