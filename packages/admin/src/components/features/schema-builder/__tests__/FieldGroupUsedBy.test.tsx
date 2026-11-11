/**
 * A field group's own editor says which collections, Singles and field groups
 * use it, each linked to its own editor, and that a change here reaches all
 * of them; and says so when it does not know, rather than showing nothing.
 */
import { describe, expect, it, vi } from "vitest";

import {
  act,
  createTestQueryClient,
  render,
  screen,
  within,
} from "@admin/__tests__/utils";

import { FieldGroupUsedBy } from "../FieldGroupUsedBy";

const get = vi.hoisted(() => vi.fn());
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
        "Used by 3 places. A change here reaches all of them."
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

  it("says it is not used anywhere, when it is not", async () => {
    get.mockResolvedValue({ items: [], meta: { total: 0 } });
    render(<FieldGroupUsedBy slug="seo" />);
    expect(
      await screen.findByText("This field group is not used anywhere yet.")
    ).toBeInTheDocument();
  });

  it("says it does not know, rather than that it is used nowhere", async () => {
    get.mockRejectedValue(new Error("down"));
    render(<FieldGroupUsedBy slug="seo" />);
    expect(
      await screen.findByText(/could not be read, so it is not known/)
    ).toBeInTheDocument();
    expect(screen.queryByText(/not used anywhere/)).toBeNull();
  });

  it("says it does not know after a failed refresh, not the answer it had", async () => {
    const queryClient = createTestQueryClient();
    get.mockResolvedValueOnce({ items: [], meta: { total: 0 } });
    render(<FieldGroupUsedBy slug="seo" />, { queryClient });
    expect(
      await screen.findByText("This field group is not used anywhere yet.")
    ).toBeInTheDocument();

    // A use is added elsewhere, and the refresh that would have shown it fails.
    get.mockRejectedValueOnce(new Error("down"));
    await act(() => queryClient.refetchQueries());
    expect(
      await screen.findByText(/could not be read, so it is not known/)
    ).toBeInTheDocument();
    expect(screen.queryByText(/not used anywhere/)).toBeNull();
  });
});
