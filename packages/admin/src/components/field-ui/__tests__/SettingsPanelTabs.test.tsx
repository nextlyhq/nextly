// Why: the settings panel opens in narrow places (a phone, a form's field
// card, a sheet), where its five tabs are wider than the panel. The tab row
// must scroll sideways there rather than cut the last tabs off with no way to
// reach them. jsdom has no layout, so this checks the structure that makes it
// scroll: the shared tab list's scroller around the row, the one the `ui`
// package names for this, rather than a width that jsdom cannot measure.
import { describe, expect, it, vi } from "vitest";

import { render, screen } from "@admin/__tests__/utils";
import { toSnakeName } from "@admin/lib/builder";

import { FieldSettingsPanel } from "../settings-panel";

vi.mock("@admin/context/providers/BrandingProvider", async importOriginal => ({
  ...(await importOriginal<
    typeof import("@admin/context/providers/BrandingProvider")
  >()),
  useBranding: () => ({}),
  useBrandingStatus: () => ({
    isPending: false,
    isUnavailable: false,
    retry: () => {},
    isBrandingUnavailable: false,
  }),
}));

describe("the settings panel's tab row", () => {
  it("scrolls sideways rather than cutting tabs off", () => {
    render(
      <FieldSettingsPanel
        surface={{
          surface: "entries",
          deriveName: toSnakeName,
          conditions: "sibling",
        }}
        field={{
          id: "f-1",
          name: "title",
          label: "Title",
          type: "text",
          validation: {},
        }}
        ancestors={[]}
        siblings={[]}
        saved={false}
        onChange={() => {}}
      />
    );
    const row = screen.getByRole("tablist");
    // Every tab is in the row, the last one too.
    expect(screen.getByRole("tab", { name: "Advanced" })).toBeInTheDocument();
    expect(row.parentElement).toHaveAttribute(
      "data-slot",
      "tabs-list-scroller"
    );
  });
});
