/**
 * The header's New button while what it leads with is still on its way: its
 * place is held at the size it is drawn at, unseen and out of reach, so it
 * appears where it stays and moves nothing beside it. And once drawn, its
 * Collections section holds every creatable type the sidebar would place
 * there, not only those on the sidebar's one page.
 */
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { ApiCollection } from "@admin/types/entities";

const posts: ApiCollection = {
  id: "posts",
  name: "posts",
  label: "Posts",
  labels: { singular: "Post", plural: "Posts" },
  tableName: "posts",
  schemaDefinition: { fields: [] },
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

// The answers New waits for, as each case sets them.
const reads = vi.hoisted(() => ({
  creatable: {
    collections: [] as ApiCollection[],
    isReady: false,
    failed: false,
  },
  recent: { data: undefined as string[] | undefined, isPending: true },
}));

vi.mock("@admin/hooks/useCreatableCollections", () => ({
  useCreatableCollections: () => reads.creatable,
}));
vi.mock("@admin/hooks/queries/useDashboardNewTypes", () => ({
  useDashboardNewTypes: () => reads.recent,
}));
// The sidebar's own list is one page of 100 collections, so New must not read
// it: it is mocked as that page, and only the pins are New's to read.
vi.mock("@admin/hooks/useSidebarContentLists", () => ({
  useSidebarCollectionList: () => ({
    items: reads.creatable.collections.slice(0, 100),
  }),
  useSidebarCollectionPins: () => ({ pinned: new Set<string>() }),
}));
vi.mock("@admin/hooks/useCurrentUserPermissions", async importOriginal => {
  const actual =
    await importOriginal<
      typeof import("@admin/hooks/useCurrentUserPermissions")
    >();
  const capabilities = actual.buildCapabilities([], true, {
    isSuperAdmin: true,
    validUntil: null,
    entities: {},
  });
  return { ...actual, useCurrentUserPermissions: () => ({ capabilities }) };
});
vi.mock("@admin/context/providers/BrandingProvider", () => ({
  useBranding: () => undefined,
}));

import { NewSplitButton } from "./NewSplitButton";

afterEach(() => {
  reads.creatable = { collections: [], isReady: false, failed: false };
  reads.recent = { data: undefined, isPending: true };
});

/** The main part's width class, which the held place must share. */
function widthOf(element: Element): string | undefined {
  return [...element.classList].find(name => /^w-/.test(name));
}

describe("the header's New button before its answers arrive", () => {
  it("holds its place, unseen and unreachable, at the width it is drawn at", () => {
    const { unmount } = render(<NewSplitButton />);
    const held = screen.getByTestId("dashboard-new-reserve");
    expect(held).toHaveClass("invisible");
    expect(held).toHaveAttribute("aria-hidden", "true");
    expect(held).toHaveAttribute("inert");
    expect(screen.queryByRole("link")).toBeNull();
    const heldWidth = widthOf(held.firstElementChild!);
    unmount();

    // Answered: the button itself, its main part as wide as the held place.
    reads.creatable = { collections: [posts], isReady: true, failed: false };
    reads.recent = { data: [], isPending: false };
    render(<NewSplitButton />);
    expect(screen.queryByTestId("dashboard-new-reserve")).toBeNull();
    const main = screen.getByRole("link", { name: "New Post" });
    expect(heldWidth).toBeDefined();
    expect(widthOf(main)).toBe(heldWidth);
  });

  it("keeps holding its place while the recent types are still on their way", () => {
    // What it leads with may still change, and with it the label: held.
    reads.creatable = { collections: [posts], isReady: true, failed: false };
    render(<NewSplitButton />);
    expect(screen.getByTestId("dashboard-new-reserve")).toBeInTheDocument();
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("stops holding it once the answers are in, even a failed one", () => {
    // A failed read of what the reader may create draws no button, rather
    // than holding an empty place for ever.
    reads.creatable = { collections: [], isReady: false, failed: true };
    reads.recent = { data: undefined, isPending: false };
    render(<NewSplitButton />);
    expect(screen.queryByTestId("dashboard-new-reserve")).toBeNull();
    expect(screen.queryByTestId("dashboard-new")).toBeNull();
  });
});

describe("the header's New button once drawn", () => {
  it("lists a creatable type past the sidebar's one page under Collections", async () => {
    // 101 ordinary types: the sidebar's page holds the first 100 by name, and
    // the last one only arrives with every page, as `useCreatableCollections`
    // reads them.
    const many = Array.from({ length: 101 }, (_, i): ApiCollection => {
      const name = `type${String(i).padStart(3, "0")}`;
      return { ...posts, id: name, name, label: name, labels: undefined };
    });
    reads.creatable = { collections: many, isReady: true, failed: false };
    reads.recent = { data: [], isPending: false };
    render(<NewSplitButton />);
    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: "Choose what to create" }));
    const collections = screen.getByRole("group", { name: "Collections" });
    expect(
      within(collections).getByTestId("dashboard-new-type-type100")
    ).toBeInTheDocument();
    expect(screen.queryByRole("group", { name: "Other" })).toBeNull();
  });
});
