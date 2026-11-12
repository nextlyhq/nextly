/**
 * A field group's own editor says which collections, Singles and field groups
 * use it, each linked to its own editor, and that a change here reaches all
 * of them; and says so when it does not know, rather than showing nothing.
 */
import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";

import {
  act,
  createTestQueryClient,
  fireEvent,
  render,
  screen,
  within,
} from "@admin/__tests__/utils";

import { FieldGroupUsedBy } from "../FieldGroupUsedBy";

const get = vi.hoisted(() => vi.fn());
// Where a link would take the page, watched rather than followed.
const navigateTo = vi.hoisted(() => vi.fn());
vi.mock("@admin/lib/navigation", () => ({ navigateTo }));
vi.mock("@admin/lib/api/protectedApi", () => ({ protectedApi: { get } }));

describe("FieldGroupUsedBy", () => {
  it("a field group used by a collection, a Single and another field group", async () => {
    get.mockResolvedValue({
      items: [
        { entityType: "collection", entitySlug: "posts", fieldPath: "seo" },
        {
          entityType: "collection",
          entitySlug: "posts",
          fieldPath: "blocks.seo",
        },
        { entityType: "single", entitySlug: "home", fieldPath: "hero.seo" },
        { entityType: "fieldGroup", entitySlug: "card", fieldPath: "meta" },
      ],
      meta: { total: 4 },
    });
    render(<FieldGroupUsedBy slug="seo" unsavedCount={0} />);

    const section = await screen.findByRole("region", {
      name: "Where this field group is used",
    });
    expect(
      await within(section).findByText(
        "Used by 3 places you can read. A change here reaches each of them."
      )
    ).toBeInTheDocument();
    expect(get).toHaveBeenCalledWith("/field-groups/seo/used-by");
    expect(
      within(section).getByRole("link", { name: "posts" })
    ).toHaveAttribute("href", "/admin/builder/collections/posts");
    expect(within(section).getByRole("link", { name: "home" })).toHaveAttribute(
      "href",
      "/admin/builder/singles/home"
    );
    expect(within(section).getByRole("link", { name: "card" })).toHaveAttribute(
      "href",
      "/admin/builder/field-groups/card"
    );
    // Both of posts' fields are named under it, once.
    expect(within(section).getByText("blocks.seo")).toBeInTheDocument();
    expect(
      within(section).getAllByRole("link", { name: "posts" })
    ).toHaveLength(1);
  });

  it("says it is used in nothing the reader can read, and claims no more", async () => {
    get.mockResolvedValue({ items: [], meta: { total: 0 } });
    render(<FieldGroupUsedBy slug="seo" unsavedCount={0} />);
    expect(
      await screen.findByText(
        "Not used in any collection, Single or field group you can read."
      )
    ).toBeInTheDocument();
  });

  it("says it does not know, rather than that it is used nowhere", async () => {
    get.mockRejectedValue(new Error("down"));
    render(<FieldGroupUsedBy slug="seo" unsavedCount={0} />);
    expect(
      await screen.findByText(/could not be read, so it is not known/)
    ).toBeInTheDocument();
    expect(screen.queryByText(/Not used in any/)).toBeNull();
  });

  it("says it does not know after a failed refresh, not the answer it had", async () => {
    const queryClient = createTestQueryClient();
    get.mockResolvedValueOnce({ items: [], meta: { total: 0 } });
    render(<FieldGroupUsedBy slug="seo" unsavedCount={0} />, { queryClient });
    expect(
      await screen.findByText(
        "Not used in any collection, Single or field group you can read."
      )
    ).toBeInTheDocument();

    // A use is added elsewhere, and the refresh that would have shown it fails.
    get.mockRejectedValueOnce(new Error("down"));
    await act(() => queryClient.refetchQueries());
    expect(
      await screen.findByText(/could not be read, so it is not known/)
    ).toBeInTheDocument();
    expect(screen.queryByText(/Not used in any/)).toBeNull();
  });

  it("reads afresh on each visit, never showing the answer from an earlier one", async () => {
    // The admin's own defaults: an answer is fresh for minutes and kept longer.
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false, staleTime: 5 * 60_000, gcTime: 10 * 60_000 },
      },
    });
    get.mockResolvedValueOnce({ items: [], meta: { total: 0 } });
    const first = render(<FieldGroupUsedBy slug="seo" unsavedCount={0} />, {
      queryClient,
    });
    expect(
      await screen.findByText(
        "Not used in any collection, Single or field group you can read."
      )
    ).toBeInTheDocument();
    first.unmount();
    // Let a dropped answer go before the next visit.
    await act(() => new Promise(resolve => setTimeout(resolve, 0)));

    // A collection now places it; its save refreshed only its own keys.
    get.mockResolvedValueOnce({
      items: [
        { entityType: "collection", entitySlug: "posts", fieldPath: "seo" },
      ],
      meta: { total: 1 },
    });
    render(<FieldGroupUsedBy slug="seo" unsavedCount={0} />, { queryClient });
    expect(screen.queryByText(/Not used in any/)).toBeNull();
    expect(
      await screen.findByText(
        "Used by 1 place you can read. A change here reaches each of them."
      )
    ).toBeInTheDocument();
  });

  it("asks before a link leaves an editor with unsaved changes", async () => {
    get.mockResolvedValue({
      items: [
        { entityType: "collection", entitySlug: "posts", fieldPath: "seo" },
      ],
      meta: { total: 1 },
    });
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    try {
      render(<FieldGroupUsedBy slug="seo" unsavedCount={2} />);
      navigateTo.mockClear();
      const link = await screen.findByRole("link", { name: "posts" });
      // Declined: the editor and its changes stay.
      fireEvent.click(link);
      expect(confirm).toHaveBeenCalledTimes(1);
      expect(confirm.mock.calls[0]?.[0]).toContain("unsaved changes");
      expect(navigateTo).not.toHaveBeenCalled();
    } finally {
      confirm.mockRestore();
    }
  });

  it("leaves without asking when nothing is unsaved", async () => {
    get.mockResolvedValue({
      items: [
        { entityType: "collection", entitySlug: "posts", fieldPath: "seo" },
      ],
      meta: { total: 1 },
    });
    const confirm = vi.spyOn(window, "confirm");
    try {
      render(<FieldGroupUsedBy slug="seo" unsavedCount={0} />);
      navigateTo.mockClear();
      const link = await screen.findByRole("link", { name: "posts" });
      fireEvent.click(link);
      expect(confirm).not.toHaveBeenCalled();
      expect(navigateTo).toHaveBeenCalledWith(
        "/admin/builder/collections/posts"
      );
    } finally {
      confirm.mockRestore();
    }
  });
});
