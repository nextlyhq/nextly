/**
 * The settings page's place: plugins' blocks around the page's own form and
 * their tabs beside it, in the order the server sent, and nothing changed on
 * the page when nothing is contributed.
 */
import { render, screen, within } from "@testing-library/react";
import type { AdminContributionsMeta } from "nextly/config";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { registerComponent } from "@admin/lib/plugins/component-registry";

const SIGNED_IN = "11111111-1111-4111-8111-111111111111";

const { meta, settings } = vi.hoisted(() => ({
  // What the admin metadata delivers to the page's place, set per case.
  meta: { contributions: undefined as AdminContributionsMeta | undefined },
  // Stable across renders, as a query cache returns it: a fresh object on
  // every render re-runs the page's form reset on every render.
  settings: {
    timezone: "UTC",
    dateFormat: "MM/DD/YYYY",
    timeFormat: "12h",
  },
}));

vi.mock("@admin/context/providers/BrandingProvider", async importOriginal => ({
  ...(await importOriginal<
    typeof import("@admin/context/providers/BrandingProvider")
  >()),
  useBranding: () => ({ contributions: meta.contributions }),
}));
vi.mock("@admin/hooks/queries/useGeneralSettings", () => ({
  useGeneralSettings: () => ({ data: settings, isLoading: false }),
  useUpdateGeneralSettings: () => ({ mutate: vi.fn(), isPending: false }),
}));
vi.mock("@admin/hooks/useCurrentUserPermissions", () => ({
  useCurrentUserPermissions: () => ({ hasPermission: () => true }),
}));
vi.mock("@admin/hooks/useDashboardUser", () => ({
  useDashboardUser: () => ({ user: { id: SIGNED_IN } }),
}));
vi.mock("@admin/components/ui", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

import SettingsGeneralPage from ".";

const BLOCK = "@acme/a/admin#SettingsBlock";
const TAB = "@acme/a/admin#SettingsTab";
registerComponent(BLOCK, ((props: { context?: unknown }) => (
  <pre data-testid="settings-block">{JSON.stringify(props.context)}</pre>
)) as never);
registerComponent(TAB, () => <p>plugin tab body</p>);

beforeEach(() => {
  meta.contributions = undefined;
});

/** The page's own form. */
function pageForm(container: HTMLElement): HTMLFormElement {
  return container.querySelector("form")!;
}

describe("SettingsGeneralPage's place", () => {
  it("with no contributions the page draws as before", () => {
    const { container } = render(<SettingsGeneralPage />);

    // No strip, and the form sits straight in the page container, as it did
    // before the place: nothing wraps it.
    expect(screen.queryByRole("tablist")).toBeNull();
    const form = pageForm(container);
    expect(form.parentElement).toBe(screen.getByTestId("page-container"));
    expect(
      within(form).getByRole("heading", { name: "General Settings" })
    ).toBeTruthy();
  });

  it("draws a block before the form, told who is looking", () => {
    meta.contributions = {
      settings: {
        block: [
          {
            plugin: "@acme/a",
            id: "acme-a.settings-block",
            kind: "block",
            component: BLOCK,
          },
          { builtIn: "content" },
        ],
      },
    };
    const { container } = render(<SettingsGeneralPage />);

    const block = screen.getByTestId("settings-block");
    // The block stands in the wrapper that keeps its own form's submit its own.
    expect(block.parentElement?.nextElementSibling).toBe(pageForm(container));
    expect(JSON.parse(block.textContent ?? "")).toEqual({ userId: SIGNED_IN });
  });

  it("a delivered tab follows the page's own content", () => {
    meta.contributions = {
      settings: {
        tab: [
          {
            plugin: "@acme/a",
            id: "acme-a.settings-tab",
            kind: "tab",
            label: "Billing",
            component: TAB,
          },
        ],
      },
    };
    const { container } = render(<SettingsGeneralPage />);

    const tabs = within(screen.getByRole("tablist"))
      .getAllByRole("tab")
      .map(tab => tab.textContent);
    expect(tabs).toEqual(["General", "Billing"]);
    expect(pageForm(container)).toBeTruthy();
  });
});
