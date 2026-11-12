// @vitest-environment jsdom
/**
 * The collections list: its columns, what each says, the actions each row
 * offers, and the plugins' collections listed apart from the site's.
 *
 * Driven through the list's own requests, with the service answering per
 * owner: the site's page for the table, every plugin collection for the
 * sections under it. The plugin metadata names each plugin and its slugs.
 */
import { TooltipProvider, badgeVariants } from "@nextlyhq/ui";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { render, screen, within } from "@admin/__tests__/utils";
import type { ApiCollection } from "@admin/types/entities";

import CollectionTable from "../CollectionTable";

/** The list inside the tooltip provider the admin's shell supplies. */
function renderTable(): void {
  render(
    <TooltipProvider>
      <CollectionTable />
    </TooltipProvider>
  );
}

const { fetchCollections, navigateTo, branding } = vi.hoisted(() => ({
  fetchCollections: vi.fn(),
  navigateTo: vi.fn(),
  branding: { current: {} as Record<string, unknown> },
}));

vi.mock("@admin/services/collectionApi", async importOriginal => {
  const actual =
    await importOriginal<typeof import("@admin/services/collectionApi")>();
  return {
    ...actual,
    collectionApi: { ...actual.collectionApi, fetchCollections },
  };
});

vi.mock("@admin/hooks/queries", () => ({
  collectionKeys: { lists: () => ["collections", "list"] },
  useDeleteCollection: () => ({ mutate: vi.fn(), isPending: false }),
  useBulkDeleteCollections: () => ({ mutate: vi.fn(), isPending: false }),
}));

vi.mock("@admin/lib/navigation", () => ({ navigateTo }));

vi.mock("@admin/context/providers/BrandingProvider", async importOriginal => ({
  ...(await importOriginal<
    typeof import("@admin/context/providers/BrandingProvider")
  >()),
  useBranding: () => branding.current,
}));

/** The collections list's toggleable columns, in declaration order. */
const TOGGLEABLE = [
  "source",
  "migrationStatus",
  "description",
  "schemaDefinition",
];

function seedStoredChoice(visible: string[]): void {
  localStorage.setItem(
    "nextly-column-visibility-collections",
    JSON.stringify({
      columns: visible,
      defaultsHash: [...TOGGLEABLE].sort().join(","),
    })
  );
}

function collection(overrides: Partial<ApiCollection>): ApiCollection {
  return {
    id: `col_${overrides.name ?? "posts"}`,
    name: "posts",
    label: "Posts",
    tableName: "dc_posts",
    source: "ui",
    migrationStatus: "synced",
    locked: false,
    schemaDefinition: { fields: [] },
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function listOf(items: ApiCollection[]) {
  return {
    items,
    meta: {
      total: items.length,
      page: 1,
      limit: 10,
      totalPages: items.length > 0 ? 1 : 0,
      hasNext: false,
      hasPrev: false,
    },
  };
}

/** Answers the site's list and the plugins' list with these rows. */
function serve(site: ApiCollection[], plugins: ApiCollection[] = []): void {
  fetchCollections.mockImplementation((_params: unknown, owner: unknown) =>
    Promise.resolve(listOf(owner === "plugins" ? plugins : site))
  );
}

/** The site's own table, once its rows have arrived. */
async function siteTable(): Promise<HTMLElement> {
  return screen.findByRole("table", { name: "Collections table" });
}

beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
  branding.current = {};
  serve([collection({ description: "Editorial posts" })]);
});

describe("CollectionTable columns", () => {
  it("omits the header and cells of a column the stored choice hides", async () => {
    seedStoredChoice(TOGGLEABLE.filter(name => name !== "description"));
    renderTable();
    const table = await siteTable();
    await within(table).findAllByText("Posts");
    // The SOURCE header is the positive control: a header this query CAN find
    // inside the table, so the DESCRIPTION absence below is the hidden column
    // and not a string that never renders at all.
    expect(within(table).getAllByText("SOURCE").length).toBeGreaterThan(0);
    expect(within(table).queryByText("DESCRIPTION")).toBeNull();
    expect(screen.queryByText("Editorial posts")).toBeNull();
  });

  it("still renders the pinned columns after every toggleable column is hidden", async () => {
    seedStoredChoice([]);
    renderTable();
    const table = await siteTable();
    await within(table).findAllByText("Posts");
    expect(within(table).getByText("COLLECTION")).toBeDefined();
    expect(within(table).getByText("CREATED")).toBeDefined();
    expect(within(table).queryByText("DESCRIPTION")).toBeNull();
  });

  it.each([
    ["code", "Defined in code"],
    ["ui", "Made in the Builder"],
    ["built-in", "Built in"],
  ] as const)("names a %s collection's source as %s", async (source, label) => {
    serve([collection({ source })]);
    renderTable();
    const table = await siteTable();
    expect((await within(table).findAllByText(label)).length).toBeGreaterThan(
      0
    );
    expect(within(table).queryByText("Unknown")).toBeNull();
  });

  it("says nothing it does not know about an unrecorded source", async () => {
    serve([collection({ source: undefined })]);
    renderTable();
    const table = await siteTable();
    await within(table).findAllByText("Posts");
    expect(within(table).queryByText("Unknown")).toBeNull();
  });

  it("the applied column", async () => {
    // Not called "Status", plain text while applied, a badge only when not.
    serve([
      collection({ name: "posts", label: "Posts", migrationStatus: "applied" }),
      collection({ name: "pages", label: "Pages", migrationStatus: "pending" }),
    ]);
    renderTable();
    const table = await siteTable();
    await within(table).findAllByText("Posts");
    expect(within(table).getAllByText("SCHEMA").length).toBeGreaterThan(0);
    expect(within(table).queryByText("STATUS")).toBeNull();

    // The attention is the warning badge's look, read from the badge itself
    // rather than restated: present on the state that is not applied, absent
    // from the one that is.
    const warningBadge = badgeVariants({ variant: "warning" }).split(" ");
    const applied = within(table).getAllByText("Applied")[0];
    expect(applied.className.split(" ")).not.toEqual(
      expect.arrayContaining(warningBadge)
    );
    const pending = within(table).getAllByText("Not applied")[0];
    expect(pending.className.split(" ")).toEqual(
      expect.arrayContaining(warningBadge)
    );
    expect(within(table).queryByText("Synced")).toBeNull();
  });

  it("row actions all work", async () => {
    const user = userEvent.setup();
    serve([
      collection({ name: "posts", label: "Posts" }),
      collection({
        name: "authors",
        label: "Authors",
        source: "code",
        locked: true,
      }),
    ]);
    renderTable();
    const table = await siteTable();
    await within(table).findAllByText("Posts");

    // A collection made in the Builder: edit, its entries, delete.
    const postsRow = within(table).getAllByText("Posts")[0].closest("tr")!;
    await user.click(
      within(postsRow).getByRole("button", { name: "Row actions" })
    );
    const offered = (await screen.findAllByRole("menuitem")).map(
      item => item.textContent
    );
    expect(offered).toEqual(["Edit", "View entries", "Delete"]);
    expect(screen.queryByText(/generate types/i)).toBeNull();
    await user.click(screen.getByRole("menuitem", { name: "View entries" }));
    expect(navigateTo).toHaveBeenCalledWith("/admin/collections/posts");

    // One defined in code: no delete at all, rather than a disabled one.
    const authorsRow = within(table).getAllByText("Authors")[0].closest("tr")!;
    await user.click(
      within(authorsRow).getByRole("button", { name: "Row actions" })
    );
    const lockedOffered = (await screen.findAllByRole("menuitem")).map(
      item => item.textContent
    );
    expect(lockedOffered).toEqual(["View", "View entries"]);
  });

  it("plugin entries grouped under the plugin, with no delete", async () => {
    const user = userEvent.setup();
    branding.current = {
      plugins: [
        {
          name: "@nextlyhq/plugin-page-builder",
          appearance: { label: "Page Builder" },
          collections: ["pages"],
        },
      ],
    };
    serve(
      [collection({ name: "posts", label: "Posts" })],
      [
        collection({
          name: "pages",
          label: "Site pages",
          source: "code",
          locked: true,
          admin: { isPlugin: true },
        }),
      ]
    );
    renderTable();
    const table = await siteTable();
    await within(table).findAllByText("Posts");

    // Asked for apart: the table is the site's, the section the plugins'.
    expect(fetchCollections.mock.calls.map(call => call[1]).sort()).toEqual([
      "plugins",
      "site",
    ]);
    expect(within(table).queryByText("Site pages")).toBeNull();

    // Named, and folded until opened.
    const toggle = await screen.findByRole("button", {
      name: /Page Builder\s*1 collection/,
    });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByText("Site pages")).toBeNull();

    await user.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    const section = screen.getByRole("table", {
      name: "Page Builder collections",
    });
    expect(within(section).getAllByText("Site pages").length).toBeGreaterThan(
      0
    );
    // Its source is the plugin, by name; never "Unknown".
    expect(within(section).getAllByText("Page Builder").length).toBeGreaterThan(
      0
    );
    expect(screen.queryByText("Unknown")).toBeNull();
    // Read-only: nothing to select, and no delete among its actions.
    expect(within(section).queryAllByRole("checkbox")).toEqual([]);
    const row = within(section).getAllByText("Site pages")[0].closest("tr")!;
    await user.click(within(row).getByRole("button", { name: "Row actions" }));
    const offered = (await screen.findAllByRole("menuitem")).map(
      item => item.textContent
    );
    expect(offered).toEqual(["View", "View entries"]);
  });

  it("says when the plugins' collections could not be read, rather than showing none", async () => {
    const user = userEvent.setup();
    fetchCollections.mockImplementation((_params: unknown, owner: unknown) =>
      owner === "plugins"
        ? Promise.reject(new Error("down"))
        : Promise.resolve(listOf([collection({})]))
    );
    renderTable();
    await within(await siteTable()).findAllByText("Posts");

    const notice = await screen.findByText(
      /plugins' collections could not be loaded/i
    );
    expect(notice).toBeDefined();

    // Asked again on request, and listed once the read succeeds.
    branding.current = {
      plugins: [
        {
          name: "@nextlyhq/plugin-page-builder",
          appearance: { label: "Page Builder" },
          collections: ["pages"],
        },
      ],
    };
    serve(
      [collection({})],
      [collection({ name: "pages", label: "Site pages", locked: true })]
    );
    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(
      await screen.findByRole("button", { name: /Page Builder\s*1 collection/ })
    ).toBeDefined();
  });

  it("says the site has none of its own, not none at all, beside plugin collections", async () => {
    branding.current = {
      plugins: [
        {
          name: "@nextlyhq/plugin-page-builder",
          appearance: { label: "Page Builder" },
          collections: ["pages"],
        },
      ],
    };
    serve([], [collection({ name: "pages", label: "Site pages" })]);
    renderTable();

    expect(
      await screen.findByText("No collections of your own yet")
    ).toBeDefined();
    expect(screen.queryByText("No collections yet")).toBeNull();
    expect(
      await screen.findByRole("button", { name: /Page Builder\s*1 collection/ })
    ).toBeDefined();
  });

  it("hides in each plugin section the columns the reader hid", async () => {
    const user = userEvent.setup();
    seedStoredChoice(TOGGLEABLE.filter(name => name !== "migrationStatus"));
    branding.current = {
      plugins: [
        {
          name: "@nextlyhq/plugin-page-builder",
          appearance: { label: "Page Builder" },
          collections: ["pages"],
        },
      ],
    };
    serve(
      [collection({})],
      [collection({ name: "pages", label: "Site pages" })]
    );
    renderTable();
    await user.click(
      await screen.findByRole("button", { name: /Page Builder\s*1 collection/ })
    );

    const section = screen.getByRole("table", {
      name: "Page Builder collections",
    });
    // SOURCE is the control: a header the section does draw.
    expect(within(section).getAllByText("SOURCE").length).toBeGreaterThan(0);
    expect(within(section).queryByText("SCHEMA")).toBeNull();
  });
});
