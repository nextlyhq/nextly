/**
 * A field group's own editor says which collections, Singles and field groups
 * use it, each linked to its own editor, and that a change here reaches all
 * of them; and says so when it does not know, rather than showing nothing.
 */
import { QueryClient } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  act,
  createTestQueryClient,
  fireEvent,
  render,
  screen,
  within,
} from "@admin/__tests__/utils";

import { UnsavedChangesGuard } from "@admin/components/features/entries/EntryForm/UnsavedChangesGuard";

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
    render(<FieldGroupUsedBy slug="seo" />);

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
    render(<FieldGroupUsedBy slug="seo" />);
    expect(
      await screen.findByText(
        "Not used in any collection, Single or field group you can read."
      )
    ).toBeInTheDocument();
  });

  it("says it does not know, rather than that it is used nowhere", async () => {
    get.mockRejectedValue(new Error("down"));
    render(<FieldGroupUsedBy slug="seo" />);
    expect(
      await screen.findByText(/could not be read, so it is not known/)
    ).toBeInTheDocument();
    expect(screen.queryByText(/Not used in any/)).toBeNull();
  });

  it("says it does not know after a failed refresh, not the answer it had", async () => {
    const queryClient = createTestQueryClient();
    get.mockResolvedValueOnce({ items: [], meta: { total: 0 } });
    render(<FieldGroupUsedBy slug="seo" />, { queryClient });
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
    const first = render(<FieldGroupUsedBy slug="seo" />, {
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
    render(<FieldGroupUsedBy slug="seo" />, { queryClient });
    expect(screen.queryByText(/Not used in any/)).toBeNull();
    expect(
      await screen.findByText(
        "Used by 1 place you can read. A change here reaches each of them."
      )
    ).toBeInTheDocument();
  });

  // Each link leaves for another editor, which discards unsaved changes, so
  // the editor's guard asks first, as it does for every other way out. The
  // links ask nothing themselves: one question, not two.
  describe("leaving through a link", () => {
    const start = window.location.pathname;
    const usedByPosts = () =>
      get.mockResolvedValue({
        items: [
          { entityType: "collection", entitySlug: "posts", fieldPath: "seo" },
        ],
        meta: { total: 1 },
      });
    // Followed as the admin's router follows it, so the guard can hold it.
    const follow = () =>
      navigateTo.mockImplementation((path: string) =>
        window.history.pushState(null, "", path)
      );
    afterEach(() => {
      navigateTo.mockReset();
      window.history.replaceState(null, "", start);
    });

    it("with unsaved changes: declined stays; agreed leaves", async () => {
      usedByPosts();
      follow();
      const confirm = vi.spyOn(window, "confirm");
      render(
        <UnsavedChangesGuard isDirty>
          <FieldGroupUsedBy slug="seo" />
        </UnsavedChangesGuard>
      );
      const link = await screen.findByRole("link", { name: "posts" });
      fireEvent.click(link);
      const prompt = await screen.findByRole("alertdialog");
      expect(window.location.pathname).toBe(start);
      fireEvent.click(
        within(prompt).getByRole("button", { name: /keep editing/i })
      );
      expect(window.location.pathname).toBe(start);

      fireEvent.click(link);
      fireEvent.click(
        within(await screen.findByRole("alertdialog")).getByRole("button", {
          name: /discard/i,
        })
      );
      expect(window.location.pathname).toBe("/admin/builder/collections/posts");
      expect(confirm).not.toHaveBeenCalled();
      confirm.mockRestore();
    });

    it("leaves without asking when nothing is unsaved", async () => {
      usedByPosts();
      follow();
      render(
        <UnsavedChangesGuard isDirty={false}>
          <FieldGroupUsedBy slug="seo" />
        </UnsavedChangesGuard>
      );
      fireEvent.click(await screen.findByRole("link", { name: "posts" }));
      expect(screen.queryByRole("alertdialog")).toBeNull();
      expect(window.location.pathname).toBe("/admin/builder/collections/posts");
    });
  });
});
