/**
 * C9-B / D22 — dashboard widgets render, permission-gated.
 */
import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  clearRegistry,
  registerComponents,
} from "@admin/lib/plugins/component-registry";
import type { AdminBranding } from "@admin/types/branding";

let mockBranding: AdminBranding | undefined;
vi.mock("@admin/context/providers/BrandingProvider", () => ({
  useBranding: () => mockBranding,
}));
vi.mock("@admin/hooks/useCurrentUserPermissions", () => ({
  useCurrentUserPermissions: () => ({
    hasPermission: (p: string) => p === "read-stats",
  }),
}));

import { PluginWidgetGrid } from "@admin/components/features/dashboard/PluginWidgetGrid";

afterEach(() => {
  clearRegistry();
  mockBranding = undefined;
  vi.restoreAllMocks();
});

describe("PluginWidgetGrid (C9-B/D22)", () => {
  it("renders permission-granted widgets and hides denied ones", () => {
    registerComponents({
      "@p/admin#Stats": () => <div>stats widget</div>,
      "@p/admin#Secret": () => <div>secret widget</div>,
    });
    mockBranding = {
      plugins: [
        {
          name: "@p",
          collections: [],
          widgets: [
            {
              id: "stats",
              component: "@p/admin#Stats",
              requiredPermission: "read-stats",
            },
            {
              id: "secret",
              component: "@p/admin#Secret",
              requiredPermission: "manage-secret",
            },
          ],
        },
      ],
    } as AdminBranding;

    render(<PluginWidgetGrid />);
    expect(screen.getByText("stats widget")).toBeInTheDocument();
    expect(screen.queryByText("secret widget")).not.toBeInTheDocument();
  });

  it("renders nothing when no plugin contributes a widget", () => {
    mockBranding = {
      plugins: [{ name: "@p", collections: [] }],
    } as AdminBranding;
    const { container } = render(<PluginWidgetGrid />);
    expect(container).toBeEmptyDOMElement();
  });
});
