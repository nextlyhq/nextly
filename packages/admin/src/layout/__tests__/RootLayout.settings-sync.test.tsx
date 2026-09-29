/**
 * The settings-sync provider exists to apply the admin timezone to date
 * rendering, and mounting it starts the ["generalSettings"] query — an
 * endpoint guarded by `read`/`manage` settings permissions. On the
 * signed-out screens that query can only ever fail (and retry once), so the
 * layout skips the provider for public routes. These tests pin which side of
 * that conditional each route type lands on.
 *
 * Heavy neighbors (branding, plugin registry, restart overlay, toaster,
 * route guards) are stubbed to passthroughs: what is under test is the
 * wiring of ONE provider, not anything they render.
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
  GeneralSettingsSyncProvider: ({
    children,
  }: {
    children: React.ReactNode;
  }) => {
    syncMounts.push(Date.now());
    return <>{children}</>;
  },
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

  return render(
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
  it("skips the settings-sync provider on a public (signed-out) route", () => {
    renderAt("public");

    expect(screen.getByText("route-screen")).toBeInTheDocument();
    expect(syncMounts).toHaveLength(0);
  });

  it("mounts the settings-sync provider on a private route", () => {
    renderAt("private");

    expect(screen.getByText("route-screen")).toBeInTheDocument();
    expect(syncMounts.length).toBeGreaterThan(0);
  });
});
