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

import PluginSettingsPage from "./[slug]";

afterEach(() => {
  clearRegistry();
  vi.restoreAllMocks();
});

beforeEach(() => {
  mockBranding = undefined;
});

describe("PluginSettingsPage", () => {
  it("renders the plugin's settings component when declared", () => {
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

  it("falls back to the metadata table when no settings component", () => {
    mockBranding = {
      plugins: [{ name: "@acme/p", version: "1.0.0", collections: [] }],
    };

    renderWithProviders(<PluginSettingsPage params={{ slug: "acme-p" }} />);
    // The read-only overview still renders (the in-dev banner is shown).
    expect(screen.getByText(/in development/i)).toBeInTheDocument();
  });
});
