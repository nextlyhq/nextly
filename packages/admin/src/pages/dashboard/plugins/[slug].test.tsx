import { screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  clearRegistry,
  registerComponent,
} from "@admin/lib/plugins/component-registry";
import type { AdminBranding } from "@admin/types/branding";

import { renderWithProviders } from "../../../__tests__/utils";

let mockBranding: AdminBranding | undefined;
vi.mock("@admin/context/providers/BrandingProvider", () => ({
  useBranding: () => mockBranding,
}));

import PluginDetailPage from "./[slug]";
import PluginSettingsPage from "./[slug]/settings";

afterEach(() => {
  clearRegistry();
  vi.restoreAllMocks();
});

beforeEach(() => {
  mockBranding = undefined;
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
