// @vitest-environment jsdom
/**
 * The properties under test: a hidden column's header and cells leave the
 * rendered table, and the pinned columns (the label that names the row, and
 * the created date) survive a stored choice that hides everything else; the
 * plugins' Singles are listed under their plugin, read-only.
 */
import { TooltipProvider } from "@nextlyhq/ui";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { render, screen, within } from "@admin/__tests__/utils";

import SinglesTable from "../SinglesTable";

/** The list inside the tooltip provider the admin's shell supplies. */
function renderTable(): void {
  render(
    <TooltipProvider>
      <SinglesTable />
    </TooltipProvider>
  );
}

const {
  useSingles,
  usePluginSingles,
  useDeleteSingle,
  useBulkDeleteSingles,
  branding,
} = vi.hoisted(() => ({
  useSingles: vi.fn(),
  usePluginSingles: vi.fn(),
  useDeleteSingle: vi.fn(),
  useBulkDeleteSingles: vi.fn(),
  branding: { current: {} as Record<string, unknown> },
}));

vi.mock("@admin/hooks/queries", () => ({
  singleKeys: { lists: () => ["singles", "list"] },
  useDeleteSingle: () => useDeleteSingle(),
  useBulkDeleteSingles: () => useBulkDeleteSingles(),
}));

// The site's page and every plugin Single, as the list asks for them apart.
vi.mock(
  "../../../collection/components/entity-list/use-entity-lists-by-owner",
  () => ({
    useSiteEntityPage: (_key: unknown, params: unknown) => useSingles(params),
    usePluginEntities: () => usePluginSingles(),
  })
);

vi.mock("@admin/context/providers/BrandingProvider", async importOriginal => ({
  ...(await importOriginal<
    typeof import("@admin/context/providers/BrandingProvider")
  >()),
  useBranding: () => branding.current,
}));

/** The singles list's toggleable columns, in declaration order. */
const TOGGLEABLE = ["source", "migrationStatus", "fields"];

function seedStoredChoice(visible: string[]): void {
  localStorage.setItem(
    "nextly-column-visibility-singles",
    JSON.stringify({
      columns: visible,
      defaultsHash: [...TOGGLEABLE].sort().join(","),
    })
  );
}

beforeEach(() => {
  localStorage.clear();
  branding.current = {};
  usePluginSingles.mockReturnValue({ data: [] });
  useDeleteSingle.mockReturnValue({ mutate: vi.fn(), isPending: false });
  useBulkDeleteSingles.mockReturnValue({ mutate: vi.fn(), isPending: false });
  useSingles.mockReturnValue({
    data: {
      items: [
        {
          id: "single_1",
          label: "Homepage",
          slug: "homepage",
          source: "ui",
          migrationStatus: "synced",
          locked: false,
          admin: {},
        },
      ],
      meta: { page: 1, pageSize: 10, totalItems: 1, totalPages: 1 },
    },
    isLoading: false,
    isFetching: false,
    isError: false,
    error: null,
  });
});

describe("SinglesTable columns", () => {
  it("omits the header and cells of a column the stored choice hides", () => {
    seedStoredChoice(TOGGLEABLE.filter(name => name !== "source"));
    renderTable();
    const table = screen.getByRole("table");
    // The SCHEMA header is the positive control: a header this query CAN find
    // inside the table, so the SOURCE absence below is the hidden column and
    // not a string that never renders at all.
    expect(within(table).getAllByText("SCHEMA").length).toBeGreaterThan(0);
    expect(within(table).queryByText("SOURCE")).toBeNull();
    expect(screen.getAllByText("Homepage").length).toBeGreaterThan(0);
  });

  it("still renders the pinned columns after every toggleable column is hidden", () => {
    seedStoredChoice([]);
    renderTable();
    const table = screen.getByRole("table");
    expect(within(table).getByText("SINGLE")).toBeDefined();
    expect(within(table).getByText("CREATED")).toBeDefined();
    expect(screen.getAllByText("Homepage").length).toBeGreaterThan(0);
    expect(within(table).queryByText("SOURCE")).toBeNull();
  });

  it("plugin entries grouped under the plugin, with no delete", async () => {
    const user = userEvent.setup();
    branding.current = {
      plugins: [
        {
          name: "@acme/plugin-forms",
          appearance: { label: "Forms" },
          collections: [],
          singles: ["form-settings"],
        },
      ],
    };
    usePluginSingles.mockReturnValue({
      data: [
        {
          id: "single_forms",
          label: "Form settings",
          slug: "form-settings",
          source: "code",
          migrationStatus: "applied",
          locked: true,
          admin: {},
        },
      ],
    });
    renderTable();

    // Not among the site's Singles.
    const siteTable = screen.getByRole("table", { name: "Singles table" });
    expect(within(siteTable).queryByText("Form settings")).toBeNull();

    // Named, folded until opened.
    const toggle = screen.getByRole("button", { name: /Forms\s*1 Single/ });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByText("Form settings")).toBeNull();
    await user.click(toggle);

    const section = screen.getByRole("table", { name: "Forms Singles" });
    expect(
      within(section).getAllByText("Form settings").length
    ).toBeGreaterThan(0);
    expect(within(section).getAllByText("Forms").length).toBeGreaterThan(0);
    expect(screen.queryByText("Unknown")).toBeNull();
    expect(within(section).queryAllByRole("checkbox")).toEqual([]);
    const row = within(section).getAllByText("Form settings")[0].closest("tr")!;
    await user.click(within(row).getByRole("button", { name: "Row actions" }));
    const offered = (await screen.findAllByRole("menuitem")).map(
      item => item.textContent
    );
    expect(offered).toEqual(["View", "View Document"]);
  });
});
