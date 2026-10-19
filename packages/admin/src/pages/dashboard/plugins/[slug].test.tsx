import { screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  clearRegistry,
  registerComponent,
} from "@admin/lib/plugins/component-registry";
import type { AdminBranding } from "@admin/types/branding";

import { renderWithProviders } from "../../../__tests__/utils";

let mockBranding: AdminBranding | undefined;
// Settled with an answer unless a case says otherwise: most cases here are
// about a plugin the branding payload already carries.
let mockBrandingPending = false;
let mockBrandingUnavailable = false;
vi.mock("@admin/context/providers/BrandingProvider", () => ({
  useBranding: () => mockBranding,
  useBrandingStatus: () => ({
    isPending: mockBrandingPending,
    isUnavailable: mockBrandingUnavailable,
  }),
}));

// The permissions the signed-in caller holds, as the guard asks about them.
const held = new Set<string>();
vi.mock("@admin/hooks/useCurrentUserPermissions", () => ({
  useCurrentUserPermissions: () => ({
    hasPermission: (slug: string) => held.has(slug),
    isLoading: false,
  }),
}));

// Where a refused caller is sent; observed rather than followed.
const navigateTo = vi.hoisted(() => vi.fn());
vi.mock("@admin/lib/navigation", async importOriginal => ({
  ...(await importOriginal<typeof import("@admin/lib/navigation")>()),
  navigateTo,
}));

import PluginDetailPage from "./[slug]";
import PluginSettingsPage from "./[slug]/settings";

afterEach(() => {
  clearRegistry();
  vi.restoreAllMocks();
});

beforeEach(() => {
  mockBranding = undefined;
  mockBrandingPending = false;
  mockBrandingUnavailable = false;
  navigateTo.mockClear();
  // Core's settings permission, which every case below that is not about
  // who may open the page needs to open it.
  held.clear();
  held.add("manage-settings");
});

describe("PluginDetailPage", () => {
  it("links to the settings page instead of embedding the settings component", () => {
    registerComponent("@acme/p/admin#Settings", () => (
      <div>acme settings panel</div>
    ));
    mockBranding = {
      plugins: [
        {
          name: "@acme/p",
          version: "1.0.0",
          collections: [],
          settings: { component: "@acme/p/admin#Settings" },
        },
      ],
    };

    renderWithProviders(<PluginDetailPage params={{ slug: "acme-p" }} />);
    // Informational page: the settings UI itself does not render here.
    expect(screen.queryByText("acme settings panel")).not.toBeInTheDocument();

    // And the link stays in the header rather than the metadata rail. The rail
    // stacks to the BOTTOM of the page in the narrow layout, so a primary
    // action placed in it would be the last thing on the page there.
    //
    // `getByRole`, not `queryByRole` behind a conditional: a rail that stopped
    // rendering would skip the assertion entirely and leave the positive one
    // below still passing, so its absence would satisfy the test that exists
    // to pin the separation.
    const aside = screen.getByRole("complementary");
    expect(
      within(aside).queryByRole("link", { name: /open settings/i })
    ).toBeNull();
    expect(
      screen.getByRole("link", { name: /open settings/i })
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Open settings/ })).toHaveAttribute(
      "href",
      "/admin/plugins/acme-p/settings"
    );
  });

  it("renders the detail view without a settings link when none is declared", () => {
    mockBranding = {
      plugins: [{ name: "@acme/p", version: "1.0.0", collections: [] }],
    };

    renderWithProviders(<PluginDetailPage params={{ slug: "acme-p" }} />);
    expect(
      screen.getByRole("heading", { name: "@acme/p" })
    ).toBeInTheDocument();
    expect(screen.getByText("About")).toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: /Open settings/ })
    ).not.toBeInTheDocument();
  });

  it("offers no settings link for a disabled plugin", () => {
    mockBranding = {
      plugins: [
        {
          name: "@acme/p",
          version: "1.0.0",
          enabled: false,
          collections: [],
          settings: { component: "@acme/p/admin#Settings" },
        },
      ],
    };

    renderWithProviders(<PluginDetailPage params={{ slug: "acme-p" }} />);
    expect(
      screen.queryByRole("link", { name: /Open settings/ })
    ).not.toBeInTheDocument();
    expect(screen.getByText("Disabled")).toBeInTheDocument();
  });
});

describe("PluginSettingsPage", () => {
  it("renders the plugin's settings component full-page through the real registry", () => {
    registerComponent("@acme/p/admin#Settings", () => (
      <div>acme settings panel</div>
    ));
    mockBranding = {
      plugins: [
        {
          name: "@acme/p",
          version: "1.0.0",
          collections: [],
          settings: { component: "@acme/p/admin#Settings" },
        },
      ],
    };

    renderWithProviders(<PluginSettingsPage params={{ slug: "acme-p" }} />);
    expect(screen.getByText("acme settings panel")).toBeInTheDocument();
  });

  it("explains when a plugin has no settings screen", () => {
    mockBranding = {
      plugins: [{ name: "@acme/p", version: "1.0.0", collections: [] }],
    };

    renderWithProviders(<PluginSettingsPage params={{ slug: "acme-p" }} />);
    expect(screen.getByText("No settings to show")).toBeInTheDocument();
  });

  it("refuses to load a disabled plugin's settings UI", () => {
    registerComponent("@acme/p/admin#Settings", () => (
      <div>acme settings panel</div>
    ));
    mockBranding = {
      plugins: [
        {
          name: "@acme/p",
          version: "1.0.0",
          enabled: false,
          collections: [],
          settings: { component: "@acme/p/admin#Settings" },
        },
      ],
    };

    renderWithProviders(<PluginSettingsPage params={{ slug: "acme-p" }} />);
    expect(screen.queryByText("acme settings panel")).not.toBeInTheDocument();
    expect(
      screen.getByText(/disabled, so its settings are unavailable/i)
    ).toBeInTheDocument();
  });
});

describe("who may open PluginSettingsPage", () => {
  const SETTINGS = "@acme/pay/admin#Settings";

  /** A plugin whose settings take its own permission, as the server says. */
  function payPlugin(): AdminBranding {
    return {
      plugins: [
        {
          name: "@acme/pay",
          version: "1.0.0",
          collections: [],
          settings: { component: SETTINGS, permission: "update-pay-settings" },
        },
      ],
    };
  }

  beforeEach(() => {
    registerComponent(SETTINGS, () => <div>pay settings panel</div>);
  });

  it("admits a caller holding only the plugin's own settings permission", () => {
    held.clear();
    held.add("update-pay-settings");
    mockBranding = payPlugin();

    renderWithProviders(<PluginSettingsPage params={{ slug: "acme-pay" }} />);
    expect(screen.getByText("pay settings panel")).toBeInTheDocument();
    expect(navigateTo).not.toHaveBeenCalled();
  });

  it("turns away a caller holding only manage-settings, whose saves the server refuses", () => {
    mockBranding = payPlugin();

    renderWithProviders(<PluginSettingsPage params={{ slug: "acme-pay" }} />);
    expect(screen.queryByText("pay settings panel")).not.toBeInTheDocument();
    // Refused where it was asked for, not by a silent trip to the dashboard.
    expect(
      screen.getByRole("heading", {
        name: "You don't have access to this page",
      })
    ).toBeInTheDocument();
    expect(navigateTo).not.toHaveBeenCalled();
  });

  it.each([
    ["the plugin's own permission", "update-pay-settings"],
    ["only manage-settings", "manage-settings"],
  ])(
    "says the plugin list could not load, to a caller holding %s, rather than gate on a guess",
    (_label, grant) => {
      // Gated on the default when the list never arrived, the page sent the
      // plugin's own role away and showed a manage-settings holder an editor
      // whose saves the server refuses.
      held.clear();
      held.add(grant);
      mockBrandingUnavailable = true;

      renderWithProviders(<PluginSettingsPage params={{ slug: "acme-pay" }} />);
      expect(
        screen.getByText("Could not load your installed plugins")
      ).toBeInTheDocument();
      expect(navigateTo).not.toHaveBeenCalled();
      expect(screen.queryByText("pay settings panel")).not.toBeInTheDocument();
    }
  );

  it("reads a settled answer that carries no plugin list as a project with none", () => {
    // The admin metadata omits the list for a project with no plugins. That
    // answer arrived, so it is no outage: the plugin is simply not there.
    mockBranding = {};

    renderWithProviders(<PluginSettingsPage params={{ slug: "acme-pay" }} />);
    expect(
      screen.queryByText("Could not load your installed plugins")
    ).not.toBeInTheDocument();
    expect(screen.getByText("Plugin not found")).toBeInTheDocument();
  });

  it("waits for the plugin list rather than turning the caller away on the default", () => {
    // Before the list arrives, the page cannot know the plugin keeps its
    // settings to another permission; gated on manage-settings meanwhile, this
    // caller would already have been sent to the dashboard.
    held.clear();
    held.add("update-pay-settings");
    mockBrandingPending = true;

    const view = renderWithProviders(
      <PluginSettingsPage params={{ slug: "acme-pay" }} />
    );
    expect(navigateTo).not.toHaveBeenCalled();

    mockBranding = payPlugin();
    mockBrandingPending = false;
    view.rerender(<PluginSettingsPage params={{ slug: "acme-pay" }} />);
    expect(screen.getByText("pay settings panel")).toBeInTheDocument();
    expect(navigateTo).not.toHaveBeenCalled();
  });
});
