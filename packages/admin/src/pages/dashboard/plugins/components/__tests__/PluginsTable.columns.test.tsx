// @vitest-environment jsdom
/**
 * The property under test: a column the reader's stored choice hides is gone
 * from the rendered table — header and cells both — while the columns kept
 * visible still render. Header queries are scoped to the table because the
 * toolbar's column menu lists every toggleable column by design.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { render, screen, within } from "@admin/__tests__/utils";

import PluginsTable from "../PluginsTable";

const { useBranding, useBrandingStatus } = vi.hoisted(() => ({
  useBranding: vi.fn(),
  useBrandingStatus: vi.fn(),
}));

vi.mock("@admin/context/providers/BrandingProvider", () => ({
  useBranding: () => useBranding(),
  useBrandingStatus: () => useBrandingStatus(),
}));

/** The plugins list's toggleable columns, in declaration order. */
const TOGGLEABLE = ["version", "category", "enabled"];

function seedStoredChoice(visible: string[]): void {
  localStorage.setItem(
    "nextly-column-visibility-plugins",
    JSON.stringify({
      columns: visible,
      defaultsHash: [...TOGGLEABLE].sort().join(","),
    })
  );
}

beforeEach(() => {
  localStorage.clear();
  useBranding.mockReturnValue({
    plugins: [
      {
        name: "Form Builder",
        version: "1.2.0",
        category: "content",
        enabled: true,
      },
    ],
  });
  useBrandingStatus.mockReturnValue({
    isPending: false,
    isUnavailable: false,
  });
});

describe("PluginsTable columns", () => {
  it("omits the header and cells of a column the stored choice hides", () => {
    seedStoredChoice(TOGGLEABLE.filter(name => name !== "category"));
    render(<PluginsTable />);
    const table = screen.getByRole("table");
    // The VERSION header is the positive control: a header this query CAN
    // find inside the table, so the CATEGORY absence below is the hidden
    // column and not a string that never renders at all.
    expect(within(table).getAllByText("VERSION").length).toBeGreaterThan(0);
    expect(within(table).queryByText("CATEGORY")).toBeNull();
    expect(screen.getAllByText("Form Builder").length).toBeGreaterThan(0);
  });
});
