/**
 * The Content panel drawn from what the device remembered, before the server
 * answers, is the same one list the real panel draws: Collections then
 * Singles under their headings with their counts, a collection's group under
 * its sub-heading, the remembered icons, and the person's folds from the
 * first paint, so nothing moves when the real panel replaces it.
 */
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  resetDeviceMemoryForTests,
  type RememberedMenu,
} from "@admin/lib/device-memory/device-memory";

vi.mock("../index", () => ({
  SidebarMenu: ({ children }: { children: React.ReactNode }) => (
    <ul>{children}</ul>
  ),
  SidebarMenuItem: ({ children }: { children: React.ReactNode }) => (
    <li>{children}</li>
  ),
  SidebarMenuButton: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
}));

import { RememberedContentBody } from "../RememberedMenu";

const MENU: RememberedMenu = {
  rail: [],
  parts: { collections: true, singles: true },
  collections: [
    { slug: "posts", label: "Posts" },
    {
      slug: "products",
      label: "Products",
      icon: "Archive",
      group: { slug: "shop", label: "Online shop" },
    },
  ],
  singles: [{ slug: "homepage", label: "Homepage" }],
};

function draw(menu: RememberedMenu = MENU) {
  return render(<RememberedContentBody menu={menu} pathname="/admin" />);
}

/** The headings, sub-headings and links drawn, in order. */
function outline(): string[] {
  const nav = screen.getByRole("navigation", { name: "Content" });
  return Array.from(nav.querySelectorAll<HTMLElement>("button, a")).flatMap(
    element => (element.closest("[hidden]") ? [] : [element.textContent ?? ""])
  );
}

beforeEach(() => {
  localStorage.clear();
  resetDeviceMemoryForTests();
});

describe("RememberedContentBody", () => {
  it("draws both headings with their counts, and the group under Collections", () => {
    draw();

    expect(outline()).toEqual([
      "Collections2",
      "Posts",
      "Online shop",
      "Products",
      "Singles1",
      "Homepage",
    ]);
    expect(
      screen.queryByRole("navigation", { name: "Content type" })
    ).not.toBeInTheDocument();
    const iconOf = (name: string) =>
      screen.getByRole("link", { name }).querySelector("svg");
    expect(iconOf("Posts")).toHaveClass("lucide-list");
    expect(iconOf("Products")).toHaveClass("lucide-archive");
    expect(iconOf("Homepage")).toHaveClass("lucide-panels-top-left");
  });

  it("draws the headings the person folded, folded", async () => {
    const user = userEvent.setup();
    const first = draw();
    await user.click(
      within(screen.getByRole("navigation", { name: "Content" })).getByRole(
        "button",
        { name: "Online shop" }
      )
    );
    first.unmount();

    resetDeviceMemoryForTests();
    draw();
    expect(screen.getByRole("button", { name: "Online shop" })).toHaveAttribute(
      "aria-expanded",
      "false"
    );
    expect(outline()).toEqual([
      "Collections2",
      "Posts",
      "Online shop",
      "Singles1",
      "Homepage",
    ]);
  });

  it("draws no heading for a kind the panel did not show", () => {
    draw({ ...MENU, parts: { collections: false, singles: true } });

    expect(outline()).toEqual(["Singles1", "Homepage"]);
  });
});
