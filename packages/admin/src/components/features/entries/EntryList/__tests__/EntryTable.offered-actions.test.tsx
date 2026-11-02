/**
 * The entry table offers row selection and a row's Delete only where the
 * caller may use them: checkboxes when some bulk action is allowed, and
 * Delete with the delete permission. A caller who may only read gets neither,
 * the server refusing what they would have sent.
 *
 * Each case renders the real table and bulk bar; only `useCan`, the source of
 * the permission answers, is stubbed.
 */
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { render, screen, within } from "@admin/__tests__/utils";

import { EntryTable } from "../EntryTable";
import type { CollectionForColumns } from "../EntryTableColumns";

const { canFor } = vi.hoisted(() => ({
  canFor: vi.fn((_slug: string) => false),
}));
vi.mock("@admin/hooks/useCan", () => ({
  useCan: (slug: string) => canFor(slug),
}));
vi.mock("@admin/hooks/useLocalization", () => ({
  useLocalization: () => ({
    enabled: false,
    locales: [],
    defaultLocale: "en",
    fallback: true,
    getLocale: () => undefined,
  }),
}));

/** A caller holding exactly these permission slugs. */
const holding = (...slugs: string[]): void => {
  canFor.mockImplementation(slug => slugs.includes(slug));
};

const posts: CollectionForColumns = {
  slug: "posts",
  label: "Posts",
  status: true,
  fields: [{ type: "text", name: "title", label: "Title" } as never],
};

function renderTable(handlers: { onDelete?: (id: string) => void } = {}): void {
  render(
    <EntryTable
      collection={posts}
      entries={[
        { id: "p1", title: "First" },
        { id: "p2", title: "Second" },
      ]}
      pagination={{ page: 0, limit: 10, total: 2, totalPages: 1 }}
      onPageChange={vi.fn()}
      onLimitChange={vi.fn()}
      onSortChange={vi.fn()}
      onSearchChange={vi.fn()}
      onEdit={vi.fn()}
      onDelete={handlers.onDelete ?? vi.fn()}
      onBulkDelete={vi.fn()}
      onBulkPublish={vi.fn()}
      onBulkUnpublish={vi.fn()}
    />
  );
}

const table = () =>
  within(screen.getByRole("table", { name: "Entries table" }));

/** The labels of the first row's action menu, once opened. */
async function firstRowActions(): Promise<string[]> {
  const user = userEvent.setup();
  await user.click(table().getAllByRole("button", { name: "Row actions" })[0]);
  const menu = await screen.findByRole("menu");
  return within(menu)
    .getAllByRole("menuitem")
    .map(item => item.textContent?.trim() ?? "");
}

beforeEach(() => {
  canFor.mockReset();
  holding();
});

describe("EntryTable — actions a caller may use", () => {
  it("offers no checkboxes and no row Delete to a caller who may only read", async () => {
    holding("read-posts");
    renderTable();

    expect(table().queryAllByRole("checkbox")).toHaveLength(0);
    expect(await firstRowActions()).not.toContain("Delete");
  });

  it("offers checkboxes and a row Delete with the delete permission", async () => {
    holding("read-posts", "delete-posts");
    const onDelete = vi.fn();
    renderTable({ onDelete });

    expect(
      table().getByRole("checkbox", { name: "Select all" })
    ).toBeInTheDocument();
    expect(await firstRowActions()).toContain("Delete");
  });

  it("offers checkboxes for a bulk publish, without a row Delete", async () => {
    holding("read-posts", "update-posts", "publish-posts");
    renderTable();

    expect(
      table().getByRole("checkbox", { name: "Select all" })
    ).toBeInTheDocument();
    expect(await firstRowActions()).not.toContain("Delete");
  });

  it("offers bulk Delete in the bar only with the delete permission", async () => {
    holding("read-posts", "publish-posts");
    const user = userEvent.setup();
    renderTable();

    await user.click(table().getByRole("checkbox", { name: "Select all" }));
    expect(
      screen.getByRole("button", { name: /^publish selected$/i })
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /delete selected/i })
    ).not.toBeInTheDocument();
  });
});
