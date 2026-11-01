import { render, screen, waitFor, within } from "@testing-library/react";
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

/** Eleven types, past the ten after which the menu offers a search. */
const ELEVEN = Array.from({ length: 11 }, (_, i) =>
  collection(`t${i}`, `Type ${String.fromCharCode(65 + i)}`)
);

/** Opens the menu from the caret by keyboard, as a keyboard reader does. */
async function openByKeyboard(user: ReturnType<typeof userEvent.setup>) {
  screen.getByRole("button", { name: "Choose what to create" }).focus();
  await user.keyboard("{Enter}");
  return screen.findByRole("dialog");
}

/** The option the list's `aria-activedescendant` names, the one the keys have reached. */
function activeOption(list: HTMLElement): HTMLElement | null {
  const id = list.getAttribute("aria-activedescendant");
  return id === null ? null : document.getElementById(id);
}

describe("NewSplitButtonView, as assistive technology meets it", () => {
  beforeEach(() => vi.mocked(navigateTo).mockClear());

  it("names the main part by what it creates, the caret by what it opens, and the menu's list and groups", async () => {
    const user = userEvent.setup();
    const menu = newMenu({
      creatable: [
        posts,
        { ...authors, admin: { isPlugin: true, group: "Commerce" } },
      ],
      recentSlugs: ["posts"],
      ...sidebar,
    });
    render(<NewSplitButtonView menu={menu} />);
    expect(screen.getByRole("link", { name: "New Post" })).toBeVisible();
    const caret = screen.getByRole("button", { name: "Choose what to create" });
    expect(caret).toHaveAttribute("aria-expanded", "false");
    const dialog = await openByKeyboard(user);
    expect(dialog).toHaveAccessibleName("Choose what to create");
    expect(caret).toHaveAttribute("aria-expanded", "true");
    const list = within(dialog).getByRole("listbox", {
      name: "Types to create",
    });
    // Each group named by its heading: Recent, the sidebar's Collections, a plugin's group.
    for (const [name, options] of [
      ["Recent", ["Post"]],
      ["Collections", ["Post"]],
      ["Commerce", ["Author"]],
    ] as const) {
      const group = within(list).getByRole("group", { name });
      expect(
        within(group)
          .getAllByRole("option")
          .map(option => option.textContent)
      ).toEqual(options);
    }
  });

  it("puts focus on the list itself with ten types or fewer, so each option the keys reach is announced", async () => {
    const user = userEvent.setup();
    draw([posts, pages, authors]);
    const dialog = await openByKeyboard(user);
    // Found by its role alone: its name is the first test's to judge.
    const list = within(dialog).getByRole("listbox");
    // Focus is on the element that names the option the keys reach, not on a role-less box
    // around it, where the selection moves with nothing said.
    await waitFor(() => expect(list).toHaveFocus());
    // The list names, on the focused element, each option the keys reach; the box around it,
    // with no role, would not be what a screen reader reads from.
    await user.keyboard("{ArrowDown}");
    await waitFor(() => expect(activeOption(list)).toHaveTextContent("Page"));
    expect(activeOption(list)).toHaveAttribute("aria-selected", "true");
    expect(list).toHaveFocus();
    await user.keyboard("{ArrowDown}");
    await waitFor(() => expect(activeOption(list)).toHaveTextContent("Author"));
  });

  it("labels the search past ten types, and puts focus in it", async () => {
    const user = userEvent.setup();
    draw(ELEVEN);
    const dialog = await openByKeyboard(user);
    const search = within(dialog).getByRole("combobox", {
      name: "Search types to create",
    });
    await waitFor(() => expect(search).toHaveFocus());
  });

  it("hands focus back to the caret when Escape closes the menu", async () => {
    const user = userEvent.setup();
    draw([posts, pages, authors]);
    await openByKeyboard(user);
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(
      screen.getByRole("button", { name: "Choose what to create" })
    ).toHaveFocus();
  });

  it("opens the chosen type's form from a search, focus back on the caret while the page is still drawn", async () => {
    const user = userEvent.setup();
    draw(ELEVEN);
    await openByKeyboard(user);
    await user.keyboard("type k{Enter}");
    expect(navigateTo).toHaveBeenCalledWith("/admin/collections/t10/create");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(
      screen.getByRole("button", { name: "Choose what to create" })
    ).toHaveFocus();
  });

  it("says the main part's new type when it changes, and nothing for the type it is first drawn with", () => {
    const menuFor = (recentSlugs: string[]) =>
      newMenu({
        creatable: [posts, pages],
        recentSlugs,
        ...sidebar,
      });
    const view = render(<NewSplitButtonView menu={menuFor(["posts"])} />);
    const said = screen.getByTestId("dashboard-new-said");
    expect(said).toHaveAttribute("aria-live", "polite");
    expect(said.textContent).toBe("");

    view.rerender(<NewSplitButtonView menu={menuFor(["pages"])} />);
    expect(screen.getByRole("link", { name: "New Page" })).toBeVisible();
    // The same region, so the change is said rather than arriving in a region of its own.
    expect(screen.getByTestId("dashboard-new-said")).toBe(said);
    expect(said.textContent).toBe("New button changed to New Page.");
  });
});
