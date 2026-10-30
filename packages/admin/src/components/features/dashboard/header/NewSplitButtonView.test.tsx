import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

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

function draw(creatable: ApiCollection[], recentSlugs: string[] = []) {
  const onCreate = vi.fn();
  const menu = newMenu({
    creatable,
    recentSlugs,
    sidebarCollections: creatable,
  });
  const view = render(<NewSplitButtonView menu={menu} onCreate={onCreate} />);
  return { onCreate, ...view };
}

describe("NewSplitButtonView", () => {
  beforeEach(() => vi.mocked(navigateTo).mockClear());

  it("creates the recent type from its main part, as a link", async () => {
    const { onCreate } = draw([posts, pages, authors], ["pages"]);
    const main = screen.getByRole("link", { name: "New Page" });
    expect(main).toHaveAttribute("href", "/admin/collections/pages/create");
    await userEvent.setup().click(main);
    expect(onCreate).toHaveBeenCalledWith("pages");
  });

  it("creates the first type in sidebar order when none is recent", () => {
    draw([authors, posts, pages]);
    expect(screen.getByRole("link", { name: "New Author" })).toBeVisible();
  });

  it("lists recent types, then every type, and creates one by keyboard", async () => {
    const user = userEvent.setup();
    const { onCreate } = draw([posts, pages, authors], ["authors"]);
    screen.getByRole("button", { name: "Choose what to create" }).focus();
    await user.keyboard("{Enter}");
    // Three types offer no search box: the list itself takes the keys.
    expect(screen.queryByRole("combobox")).toBeNull();
    expect(
      screen.getAllByRole("option").map(option => option.textContent)
    ).toEqual(["Author", "Post", "Page", "Author"]);
    // The first option starts selected; one step down is the first of every type.
    await user.keyboard("{ArrowDown}{Enter}");
    expect(onCreate).toHaveBeenCalledWith("posts");
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

  it("draws nothing when nothing is creatable", () => {
    const { container } = draw([]);
    expect(container).toBeEmptyDOMElement();
  });
});
