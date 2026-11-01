import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { buildCapabilities } from "@admin/hooks/useCurrentUserPermissions";
import { navigateTo } from "@admin/lib/navigation";
import type { ApiCollection } from "@admin/types/entities";

import { newMenu } from "./new-menu-model";
import { NewSplitButtonView } from "./NewSplitButtonView";

vi.mock("@admin/lib/navigation", () => ({ navigateTo: vi.fn() }));

function collection(name: string, singular: string): ApiCollection {
  return {
    id: name,
    name,
    label: `${singular}s`,
    labels: { singular, plural: `${singular}s` },
    tableName: name,
    schemaDefinition: { fields: [] },
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

const posts = collection("posts", "Post");
const pages = collection("pages", "Page");
const authors = collection("authors", "Author");

/** What the sidebar orders by: a reader who reads everything, no pins. */
const sidebar = {
  branding: undefined,
  capabilities: buildCapabilities([], true, {
    isSuperAdmin: true,
    validUntil: null,
    entities: {},
  }),
  pinnedCollections: new Set<string>(),
};

/** The types drawn in the order given, which the sidebar sorts by `order`. */
function draw(creatable: ApiCollection[], recentSlugs: string[] = []) {
  const menu = newMenu({
    creatable: creatable.map((c, order) => ({ ...c, admin: { order } })),
    recentSlugs,
    ...sidebar,
  });
  return render(<NewSplitButtonView menu={menu} />);
}

describe("NewSplitButtonView", () => {
  beforeEach(() => vi.mocked(navigateTo).mockClear());

  it("creates the recent type from its main part, as a link", () => {
    draw([posts, pages, authors], ["pages"]);
    const main = screen.getByRole("link", { name: "New Page" });
    expect(main).toHaveAttribute("href", "/admin/collections/pages/create");
  });

  it("creates the first type in sidebar order when none is recent", () => {
    draw([authors, posts, pages]);
    expect(screen.getByRole("link", { name: "New Author" })).toBeVisible();
  });

  it("lists recent types, then every type, and creates one by keyboard", async () => {
    const user = userEvent.setup();
    draw([posts, pages, authors], ["authors"]);
    screen.getByRole("button", { name: "Choose what to create" }).focus();
    await user.keyboard("{Enter}");
    // Three types offer no search box: the list itself takes the keys.
    expect(screen.queryByRole("combobox")).toBeNull();
    expect(
      screen.getAllByRole("option").map(option => option.textContent)
    ).toEqual(["Author", "Post", "Page", "Author"]);
    // The first option starts selected; one step down is the first of every type.
    await user.keyboard("{ArrowDown}{Enter}");
    expect(navigateTo).toHaveBeenCalledWith("/admin/collections/posts/create");
    expect(screen.queryByRole("option")).toBeNull();
  });

  it("offers a search past ten types and finds a type by name", async () => {
    const user = userEvent.setup();
    const eleven = Array.from({ length: 11 }, (_, i) =>
      collection(`t${i}`, `Type ${String.fromCharCode(65 + i)}`)
    );
    draw(eleven);
    await user.click(
      screen.getByRole("button", { name: "Choose what to create" })
    );
    await user.keyboard("type k");
    expect(
      screen.getAllByRole("option").map(option => option.textContent)
    ).toEqual(["Type K"]);
  });

  it("searches the names a reader knows, not the menu's own groups", async () => {
    const user = userEvent.setup();
    const eleven = Array.from({ length: 11 }, (_, i) =>
      collection(`t${i}`, `Type ${String.fromCharCode(65 + i)}`)
    );
    draw(eleven, ["t0"]);
    await user.click(
      screen.getByRole("button", { name: "Choose what to create" })
    );
    await user.keyboard("recent");
    expect(screen.queryAllByRole("option")).toEqual([]);
    expect(screen.getByText("No type matches.")).toBeVisible();
  });

  it("offers no search at ten types", async () => {
    const ten = Array.from({ length: 10 }, (_, i) =>
      collection(`t${i}`, `Type ${i}`)
    );
    draw(ten);
    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: "Choose what to create" }));
    expect(screen.getAllByRole("option")).toHaveLength(10);
    expect(screen.queryByRole("combobox")).toBeNull();
  });

  it("cuts a long type's label short on screen, never in its name", () => {
    const singular =
      "Quarterly regional partner enablement programme submission";
    draw([collection("enablement", singular)]);
    const main = screen.getByRole("link", { name: `New ${singular}` });
    // The whole label is the title a pointer shows, and the text is cut by
    // the label's own box, inside a main part held to a width.
    expect(main).toHaveAttribute("title", `New ${singular}`);
    expect(main).toHaveClass("min-w-0", "w-44");
    expect(screen.getByTestId("dashboard-new-primary-label")).toHaveClass(
      "truncate"
    );
  });

  it("draws two sections of one heading as two, each with its own types", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const menu = newMenu({
        creatable: [
          { ...collection("deals", "Deal"), admin: { sidebarGroup: "shop" } },
          {
            ...collection("orders", "Order"),
            admin: { isPlugin: true, group: "Commerce" },
          },
        ],
        recentSlugs: [],
        ...sidebar,
        branding: { customGroups: [{ slug: "shop", name: "Commerce" }] },
      });
      render(<NewSplitButtonView menu={menu} />);
      await userEvent
        .setup()
        .click(screen.getByRole("button", { name: "Choose what to create" }));
      expect(
        screen
          .getAllByRole("group", { name: "Commerce" })
          .map(group => group.textContent)
      ).toEqual(["Deal", "Order"]);
      // React names a key two siblings share; none may be shared here.
      const keyWarnings = errors.mock.calls.filter(call =>
        String(call[0]).includes("same key")
      );
      expect(keyWarnings).toEqual([]);
    } finally {
      errors.mockRestore();
    }
  });

  it("draws nothing when nothing is creatable", () => {
    const { container } = draw([]);
    expect(container).toBeEmptyDOMElement();
  });
});
