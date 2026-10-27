/**
 * The layout's part in what the admin offers for each collection and Single:
 * it asks the server's answer again when the schema changes elsewhere, and it
 * hands a content route's entity to the guard, which decides the route from
 * that answer rather than from a permission slug.
 *
 * Heavy neighbours (branding, plugin registry, restart overlay, toaster, the
 * private-route chrome) are stubbed to passthroughs: what is under test is
 * the layout's own wiring.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { CURRENT_USER_CAPABILITIES_KEY } from "@admin/hooks/current-user-access";

const mockRoute = vi.fn();
vi.mock("@admin/hooks/useRouter", () => ({
  useRouter: () => mockRoute(),
}));

vi.mock("@admin/context/providers/BrandingProvider", () => ({
  BrandingProvider: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
}));

vi.mock("../DashboardLayout", () => ({
  DashboardLayout: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
}));

vi.mock("@admin/context/providers/GeneralSettingsSync", () => ({
  GeneralSettingsSync: () => null,
}));

vi.mock("@admin/components/ui/toaster", () => ({
  Toaster: () => null,
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

const guardProps = vi.fn();
vi.mock("@admin/components/guards/PermissionGuard", () => ({
  PermissionGuard: (props: { children: React.ReactNode }) => {
    guardProps(props);
    return <>{props.children}</>;
  },
}));

import { RootLayout } from "../RootLayout";

function RouteScreen() {
  return <span>route-screen</span>;
}

function renderAt(route: Record<string, unknown>) {
  mockRoute.mockReturnValue({
    route: {
      Component: RouteScreen,
      params: {},
      searchParams: {},
      requiresBuilder: false,
      ...route,
    },
    isHydrated: true,
  });
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <RootLayout />
    </QueryClientProvider>
  );
  return client;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("RootLayout and what the user may do with content", () => {
  it("asks the server's answer again when the schema changes elsewhere", async () => {
    const client = renderAt({ routeType: "public" });
    const invalidate = vi.spyOn(client, "invalidateQueries");

    window.dispatchEvent(new Event("nextly:schema-updated"));

    // Once any request under way has been cancelled.
    await waitFor(() =>
      expect(invalidate).toHaveBeenCalledWith({
        queryKey: CURRENT_USER_CAPABILITIES_KEY,
      })
    );
  });

  it("hands a content route's entity to the guard", () => {
    const entityAccess = { slug: "posts", action: "read" };
    renderAt({
      routeType: "private",
      requiredPermission: "read-posts",
      accessSubject: "collection",
      entityAccess,
    });

    expect(guardProps).toHaveBeenCalledWith(
      expect.objectContaining({ entity: entityAccess })
    );
  });
});
