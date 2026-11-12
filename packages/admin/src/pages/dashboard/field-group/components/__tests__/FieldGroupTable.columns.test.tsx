// @vitest-environment jsdom
/**
 * The property under test: a column the reader's stored choice hides is gone
 * from the rendered table — header and cells both — while the columns kept
 * visible still render. Header queries are scoped to the table because the
 * toolbar's column menu lists every toggleable column by design.
 */
import { TooltipProvider } from "@nextlyhq/ui";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { render, screen, within } from "@admin/__tests__/utils";

import FieldGroupTable from "../FieldGroupTable";

/** The list inside the tooltip provider the admin's shell supplies. */
function renderTable(): void {
  render(
    <TooltipProvider>
      <FieldGroupTable />
    </TooltipProvider>
  );
}

const {
  useFieldGroups,
  usePluginFieldGroups,
  useDeleteFieldGroup,
  useBulkDeleteFieldGroups,
  branding,
} = vi.hoisted(() => ({
  useFieldGroups: vi.fn(),
  usePluginFieldGroups: vi.fn(),
  useDeleteFieldGroup: vi.fn(),
  useBulkDeleteFieldGroups: vi.fn(),
  branding: { current: {} as Record<string, unknown> },
}));

vi.mock("@admin/hooks/queries", () => ({
  fieldGroupKeys: { lists: () => ["field-groups", "list"] },
  useDeleteFieldGroup: () => useDeleteFieldGroup(),
  useBulkDeleteFieldGroups: () => useBulkDeleteFieldGroups(),
}));

// The site's page and every plugin field group, as the list asks for them apart.
vi.mock(
  "../../../collection/components/entity-list/use-entity-lists-by-owner",
  () => ({
    useSiteEntityPage: (_key: unknown, params: unknown) =>
      useFieldGroups(params),
    usePluginEntities: () => usePluginFieldGroups(),
  })
);

vi.mock("@admin/context/providers/BrandingProvider", async importOriginal => ({
  ...(await importOriginal<
    typeof import("@admin/context/providers/BrandingProvider")
  >()),
  useBranding: () => branding.current,
}));

/** The field-groups list's toggleable columns, in declaration order. */
const TOGGLEABLE = ["admin", "source", "migrationStatus", "placedBy", "fields"];

/** A field group row as the list's server answers it. */
const fieldGroup = (
  slug: string,
  label: string,
  extra: Record<string, unknown> = {}
) => ({
  id: `fg_${slug}`,
  label,
  slug,
  source: "ui",
  migrationStatus: "synced",
  admin: {},
  locked: false,
  ...extra,
});

/** The site's page holding these rows. */
const pageOf = (items: unknown[]) => ({
  data: {
    items,
    meta: { page: 1, pageSize: 10, totalItems: items.length, totalPages: 1 },
  },
  isLoading: false,
  isFetching: false,
  isError: false,
  error: null,
});

function seedStoredChoice(visible: string[]): void {
  localStorage.setItem(
    "nextly-column-visibility-field-groups",
    JSON.stringify({
      columns: visible,
      defaultsHash: [...TOGGLEABLE].sort().join(","),
    })
  );
}

beforeEach(() => {
  localStorage.clear();
  branding.current = {};
  usePluginFieldGroups.mockReturnValue({ data: [] });
  useDeleteFieldGroup.mockReturnValue({ mutate: vi.fn(), isPending: false });
  useBulkDeleteFieldGroups.mockReturnValue({
    mutate: vi.fn(),
    isPending: false,
  });
  useFieldGroups.mockReturnValue({
    data: {
      items: [
        {
          id: "fg_1",
          label: "Hero Section",
          slug: "hero-section",
          source: "ui",
          migrationStatus: "synced",
          admin: { category: "Layout" },
          locked: false,
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

describe("FieldGroupTable columns", () => {
  it("omits the header and cells of a column the stored choice hides", () => {
    seedStoredChoice(TOGGLEABLE.filter(name => name !== "admin"));
    renderTable();
    const table = screen.getByRole("table");
    // The SOURCE header is the positive control: a header this query CAN find
    // inside the table, so the CATEGORY absence below is the hidden column
    // and not a string that never renders at all.
    expect(within(table).getAllByText("SOURCE").length).toBeGreaterThan(0);
    expect(within(table).queryByText("CATEGORY")).toBeNull();
    expect(screen.queryByText("Layout")).toBeNull();
    expect(screen.getAllByText("Hero Section").length).toBeGreaterThan(0);
  });

  it("still renders the pinned columns after every toggleable column is hidden", () => {
    seedStoredChoice([]);
    renderTable();
    const table = screen.getByRole("table");
    expect(within(table).getByText("FIELD GROUP")).toBeDefined();
    expect(within(table).getByText("CREATED")).toBeDefined();
    expect(screen.getAllByText("Hero Section").length).toBeGreaterThan(0);
    expect(within(table).queryByText("CATEGORY")).toBeNull();
  });

  it("uses per field group", () => {
    // How many fields place each group, said as fields; none counted is
    // "Not used"; a count the server could not read is a dash, never 0.
    useFieldGroups.mockReturnValue(
      pageOf([
        fieldGroup("address", "Address", { placedBy: 3 }),
        fieldGroup("seo", "SEO", { placedBy: 1 }),
        fieldGroup("hero", "Hero", { placedBy: 0 }),
        fieldGroup("cta", "Call to action", { placedBy: null }),
      ])
    );
    renderTable();
    const table = screen.getByRole("table", { name: /field groups/i });
    expect(within(table).getAllByText("USED BY").length).toBeGreaterThan(0);

    const usedBy = (label: string): string => {
      const row = within(table).getAllByText(label)[0].closest("tr")!;
      const header = within(table).getAllByText("USED BY")[0].closest("th")!;
      const column = [...header.parentElement!.children].indexOf(header);
      return row.children[column].textContent ?? "";
    };
    expect(usedBy("Address")).toBe("3 fields");
    expect(usedBy("SEO")).toBe("1 field");
    expect(usedBy("Hero")).toBe("Not used");
    expect(usedBy("Call to action")).toBe("—");
  });

  it("plugin entries grouped under the plugin, with no delete", async () => {
    const user = userEvent.setup();
    branding.current = {
      plugins: [
        {
          name: "@acme/plugin-forms",
          appearance: { label: "Forms" },
          collections: [],
          fieldGroups: ["postal-address"],
        },
      ],
    };
    usePluginFieldGroups.mockReturnValue({
      data: [
        fieldGroup("postal-address", "Postal address", {
          source: "code",
          locked: true,
          placedBy: 2,
        }),
      ],
    });
    renderTable();

    const siteTable = screen.getByRole("table", { name: /field groups/i });
    expect(within(siteTable).queryByText("Postal address")).toBeNull();

    const toggle = screen.getByRole("button", {
      name: /Forms\s*1 field group/,
    });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    await user.click(toggle);

    const section = screen.getByRole("table", { name: "Forms field groups" });
    expect(
      within(section).getAllByText("Postal address").length
    ).toBeGreaterThan(0);
    expect(within(section).getAllByText("Forms").length).toBeGreaterThan(0);
    expect(screen.queryByText("Unknown")).toBeNull();
    expect(within(section).queryAllByRole("checkbox")).toEqual([]);
    const row = within(section)
      .getAllByText("Postal address")[0]
      .closest("tr")!;
    await user.click(within(row).getByRole("button", { name: "Row actions" }));
    const offered = (await screen.findAllByRole("menuitem")).map(
      item => item.textContent
    );
    expect(offered).toEqual(["View"]);
  });
});
