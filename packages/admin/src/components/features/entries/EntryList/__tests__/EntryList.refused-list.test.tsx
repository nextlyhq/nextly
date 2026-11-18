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
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { parseApiError } from "@admin/lib/api/parseApiError";

import { renderWithProviders } from "../../../../../__tests__/utils";

type EntriesQuery = {
  data: unknown;
  isLoading: boolean;
  error: Error | null;
};

let entriesQuery: EntriesQuery;
/** The collection's description, drawn under its name. */
let description: string | undefined;

vi.mock("@admin/hooks/queries", () => ({
  useEntries: () => entriesQuery,
  useBulkDeleteEntries: () => ({ mutate: vi.fn(), isPending: false }),
  useBulkUpdateEntries: () => ({ mutate: vi.fn(), isPending: false }),
}));
vi.mock("@admin/hooks/queries/useCollections", () => ({
  // The list opens rows by its own copy of the collection.
  useEveryNavCollection: () => ({ data: undefined }),
  useCollection: () => ({
    data: { name: "posts", label: "Posts", fields: [], description },
    isLoading: false,
  }),
}));
vi.mock("@admin/hooks/useCan", () => ({ useCan: () => true }));
vi.mock("@admin/hooks/useLocalization", () => ({
  useLocalization: () => ({ enabled: false }),
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
  description = undefined;
});

// A description set in code, or saved before the builder's limit, can be any
// length; drawn whole it pushed the list off the screen. A long one is held to
// two lines with a control to read the rest, and the whole text stays in the
// page, so assistive technology reads all of it either way.
describe("EntryList — the collection's description", () => {
  it("shows a short description whole, with no control", () => {
    description = "Articles for the blog.";
    renderWithProviders(<EntryList collectionSlug="posts" />);
    expect(screen.getByText(description)).not.toHaveClass("line-clamp-2");
    expect(screen.queryByRole("button", { name: "Show more" })).toBeNull();
  });

  it("holds a long description to two lines, and shows and hides the rest", async () => {
    const user = userEvent.setup();
    description = "word ".repeat(80).trim();
    renderWithProviders(<EntryList collectionSlug="posts" />);

    const text = screen.getByText(description);
    expect(text).toHaveClass("line-clamp-2", "break-words");
    const more = screen.getByRole("button", { name: "Show more" });
    expect(more).toHaveAttribute("aria-expanded", "false");
    expect(more).toHaveAttribute("aria-controls", text.id);

    await user.click(more);
    expect(text).not.toHaveClass("line-clamp-2");
    const less = screen.getByRole("button", { name: "Show less" });
    expect(less).toHaveAttribute("aria-expanded", "true");

    await user.click(less);
    expect(text).toHaveClass("line-clamp-2");
  });
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
