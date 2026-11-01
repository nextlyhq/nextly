/**
 * The header's New button while what it leads with is still on its way: its
 * place is held at the size it is drawn at, unseen and out of reach, so it
 * appears where it stays and moves nothing beside it.
 */
import { render, screen } from "@testing-library/react";
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
vi.mock("@admin/hooks/useSidebarContentLists", () => ({
  useSidebarCollectionList: () => ({ items: reads.creatable.collections }),
}));
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
