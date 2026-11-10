import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { navigateTo } from "@admin/lib/navigation";
import type { ApiCollection } from "@admin/types/entities";

import { NewMenuView } from "./NewMenu";

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

/** `count` types named Type 1, Type 2, … in that (sidebar) order. */
function types(count: number): ApiCollection[] {
  return Array.from({ length: count }, (_, i) =>
    collection(`type-${i + 1}`, `Type ${i + 1}`)
  );
}

const posts = collection("posts", "Post");
const pages = collection("pages", "Page");
const forms = collection("forms", "Form");

const optionNames = () =>
  screen.getAllByRole("option").map(option => option.textContent);

describe("NewMenuView in the rail", () => {
  beforeEach(() => vi.mocked(navigateTo).mockClear());

  it.each([3, 10, 30])(
    "lists all %i types in the order given, with a search and no headings",
    async count => {
      const user = userEvent.setup();
      render(<NewMenuView variant="rail" types={types(count)} isReady />);
      await user.click(screen.getByRole("button", { name: "New" }));
      expect(optionNames()).toEqual(
        types(count).map((_, i) => `Type ${i + 1}`)
      );
      // The search is always there, and it has focus.
      expect(screen.getByRole("combobox")).toHaveFocus();
      // One flat list: no group headings, no Recent.
      expect(screen.queryByRole("group")).toBeNull();
      expect(screen.queryByText("Recent")).toBeNull();
    }
  );

  it("names no type on the button", () => {
    render(<NewMenuView variant="rail" types={[posts, pages]} isReady />);
    expect(screen.getByRole("button", { name: "New" })).not.toHaveTextContent(
      "Post"
    );
  });

  it("keeps only matching types as the reader types, and says when none match", async () => {
    const user = userEvent.setup();
    render(
      <NewMenuView variant="rail" types={[posts, pages, forms]} isReady />
    );
    await user.click(screen.getByRole("button", { name: "New" }));
    await user.keyboard("pa");
    expect(optionNames()).toEqual(["Page"]);
    await user.keyboard("zzz");
    expect(screen.queryByRole("option")).toBeNull();
    expect(screen.getByText("Nothing matches.")).toBeVisible();
  });

  it("opens a new entry of the reached type with the keyboard, and Escape returns focus", async () => {
    const user = userEvent.setup();
    render(
      <NewMenuView variant="rail" types={[posts, pages, forms]} isReady />
    );
    const button = screen.getByRole("button", { name: "New" });
    button.focus();
    await user.keyboard("{Enter}");
    await user.keyboard("{ArrowDown}{Enter}");
    expect(navigateTo).toHaveBeenCalledWith("/admin/collections/pages/create");

    await user.click(button);
    expect(screen.getByRole("combobox")).toHaveFocus();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("option")).toBeNull();
    expect(button).toHaveFocus();
  });

  it("highlights the reached option with the accent fill and a thin control-border ring", async () => {
    const user = userEvent.setup();
    render(<NewMenuView variant="rail" types={[posts, pages]} isReady />);
    await user.click(screen.getByRole("button", { name: "New" }));
    const first = screen.getAllByRole("option")[0];
    expect(first).toHaveAttribute("aria-selected", "true");
    expect(first.className).toContain("data-[selected=true]:bg-accent");
    expect(first.className).toContain(
      "data-[selected=true]:text-accent-foreground"
    );
    expect(first.className).toContain("data-[selected=true]:ring-1");
    expect(first.className).toContain(
      "data-[selected=true]:ring-control-border"
    );
    // Not the old full-strength outline in the foreground colour.
    expect(first.className).not.toMatch(/outline-(foreground|solid)/);
  });

  it("opens on click, not on hover", async () => {
    const user = userEvent.setup();
    render(<NewMenuView variant="rail" types={[posts]} isReady />);
    await user.hover(screen.getByRole("button", { name: "New" }));
    expect(screen.queryByRole("option")).toBeNull();
    await user.click(screen.getByRole("button", { name: "New" }));
    expect(optionNames()).toEqual(["Post"]);
  });

  it("says it is loading until the types are known", async () => {
    const user = userEvent.setup();
    render(<NewMenuView variant="rail" types={[]} isReady={false} />);
    await user.click(screen.getByRole("button", { name: "New" }));
    expect(screen.getByText("Loading…")).toBeVisible();
    expect(screen.queryByText("Nothing matches.")).toBeNull();
  });

  it("draws nothing once it is known that nothing can be created", () => {
    const { container } = render(
      <NewMenuView variant="rail" types={[]} isReady />
    );
    expect(container).toBeEmptyDOMElement();
  });
});

describe("NewMenuView in the phone menu drawer", () => {
  beforeEach(() => vi.mocked(navigateTo).mockClear());

  it("is a full-width New row whose list opens in place below it", async () => {
    const user = userEvent.setup();
    render(
      <NewMenuView variant="drawer" types={[posts, pages, forms]} isReady />
    );
    const row = screen.getByRole("button", { name: "New" });
    expect(row).toHaveAttribute("aria-expanded", "false");
    await user.click(row);
    expect(row).toHaveAttribute("aria-expanded", "true");
    // In place: no popover dialog, the list follows the row.
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(optionNames()).toEqual(["Post", "Page", "Form"]);
    await user.click(screen.getByRole("option", { name: "Form" }));
    expect(navigateTo).toHaveBeenCalledWith("/admin/collections/forms/create");
  });

  it("lists the same types as the rail", async () => {
    const user = userEvent.setup();
    const list = [posts, pages, forms];
    const { unmount } = render(
      <NewMenuView variant="rail" types={list} isReady />
    );
    await user.click(screen.getByRole("button", { name: "New" }));
    const rail = optionNames();
    unmount();
    render(<NewMenuView variant="drawer" types={list} isReady />);
    await user.click(screen.getByRole("button", { name: "New" }));
    expect(optionNames()).toEqual(rail);
  });

  it("closes with Escape and returns focus to the row", async () => {
    const user = userEvent.setup();
    render(<NewMenuView variant="drawer" types={[posts]} isReady />);
    const row = screen.getByRole("button", { name: "New" });
    await user.click(row);
    await user.click(screen.getByRole("combobox"));
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("option")).toBeNull();
    expect(row).toHaveFocus();
  });
});
