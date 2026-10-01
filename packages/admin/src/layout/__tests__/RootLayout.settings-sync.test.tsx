/**
 * The settings sync exists to apply the admin timezone to date
 * rendering, and mounting it starts the ["generalSettings"] query — an
 * endpoint guarded by `read`/`manage` settings permissions. On the
 * signed-out screens that query can only ever fail (and retry once), so the
 * layout skips the sync for public routes. These tests pin which side of
 * that conditional each route type lands on, and one more property the
 * conditional's SHAPE decides: the sync is a null sibling rather than a
 * wrapper, so a public/private flip re-renders in place and the stable parts
 * of the tree — Toaster, portal root — keep their DOM identity.
 *
 * Heavy neighbors (branding, plugin registry, restart overlay, toaster,
 * route guards) are stubbed to passthroughs: what is under test is the
 * wiring of ONE sync, not anything they render.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockRoute = vi.fn();
vi.mock("@admin/hooks/useRouter", () => ({
  useRouter: () => mockRoute(),
}));

vi.mock("@admin/context/providers/BrandingProvider", () => ({
  BrandingProvider: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
}));

// The private-route chrome; not under test, and the real one reads branding
// and router state through half a dozen hooks.
vi.mock("../DashboardLayout", () => ({
  DashboardLayout: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
}));

const syncMounts: number[] = [];
vi.mock("@admin/context/providers/GeneralSettingsSyncProvider", () => ({
  GeneralSettingsSync: () => {
    syncMounts.push(Date.now());
    return null;
  },
}));

// Identity probe for the remount regression test: the real Toaster renders
// fine here, but a stable test id lets the flip test assert DOM identity —
// a remount would produce a NEW node, and same-node is the whole claim.
vi.mock("@admin/components/ui/toaster", () => ({
  Toaster: () => <div data-testid="layout-toaster" />,
}));

vi.mock("@admin/components/shared/plugin-page-registrar", () => ({
  PluginPageRegistrar: () => null,
}));

vi.mock("@admin/components/features/schema-builder/RestartOverlay", () => ({
  RestartOverlay: () => null,
}));

vi.mock("@admin/components/guards/PublicRoute", () => ({
  PublicRoute: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock("@admin/components/guards/PrivateRoute", () => ({
  PrivateRoute: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
}));

vi.mock("@admin/components/guards/PermissionGuard", () => ({
  PermissionGuard: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
}));

import { RootLayout } from "../RootLayout";

function RouteScreen() {
  return <span>route-screen</span>;
}

function renderAt(routeType: "public" | "private") {
  mockRoute.mockReturnValue({
    route: {
      Component: RouteScreen,
      params: {},
      searchParams: {},
      routeType,
      requiredPermission: undefined,
      requiresBuilder: false,
    },
    isHydrated: true,
  });

  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });

  const view = render(
    <QueryClientProvider client={client}>
      <RootLayout />
    </QueryClientProvider>
  );

  return { view, client };
}

/** Point the router at a different route type and re-render in place. */
function flipTo(
  routeType: "public" | "private",
  rerender: (ui: React.ReactElement) => void,
  client: QueryClient
) {
  mockRoute.mockReturnValue({
    route: {
      Component: RouteScreen,
      params: {},
      searchParams: {},
      routeType,
      requiredPermission: undefined,
      requiresBuilder: false,
    },
    isHydrated: true,
  });
  rerender(
    <QueryClientProvider client={client}>
      <RootLayout />
    </QueryClientProvider>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  syncMounts.length = 0;
});

afterEach(() => {
  window.history.replaceState(null, "", "/");
});

describe("RootLayout settings-sync gating", () => {
  it("skips the settings sync on a public (signed-out) route", () => {
    renderAt("public");

    expect(screen.getByText("route-screen")).toBeInTheDocument();
    expect(syncMounts).toHaveLength(0);
  });

  it("mounts the settings sync on a private route", () => {
    renderAt("private");

    expect(screen.getByText("route-screen")).toBeInTheDocument();
    expect(syncMounts.length).toBeGreaterThan(0);
  });

  it("keeps the Toaster and portal root mounted across a private→public flip", () => {
    // The regression Aqib caught: the sync used to WRAP the subtree, so the
    // public/private flip swapped the element type at the top slot and
    // remounted everything below it — Toaster and portal root included.
    // Logout fires its success toast and THEN pushState-navigates to the
    // login page, so the flip dropped the toast mid-flight. The sync is a
    // null sibling now: the flip re-renders in place and these nodes keep
    // their identity — same DOM node, not a fresh lookalike.
    const { view, client } = renderAt("private");

    const toasterBefore = document.querySelector(
      "[data-testid='layout-toaster']"
    );
    const portalBefore = document.getElementById("nextly-admin-portal-root");
    expect(toasterBefore).not.toBeNull();
    expect(portalBefore).not.toBeNull();

    flipTo("public", view.rerender, client);

    expect(document.querySelector("[data-testid='layout-toaster']")).toBe(
      toasterBefore
    );
    expect(document.getElementById("nextly-admin-portal-root")).toBe(
      portalBefore
    );
    // The flip still does its own job: the sync unmounts with the session.
    expect(syncMounts.length).toBeGreaterThan(0);
  });
});
