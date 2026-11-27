/**
 * When the layout mounts the admin's command palette: only for a session the
 * server has confirmed. Beside the sign-in form, or while the session is still
 * being checked, there is nothing the palette could offer that the visitor may
 * open, and its reads would only be refused.
 *
 * Heavy neighbours are stubbed to passthroughs, as in the layout's other
 * tests; the private-route guard is stubbed to each of its three answers.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockRoute = vi.fn();
vi.mock("@admin/hooks/useRouter", () => ({
  useRouter: () => mockRoute(),
}));

vi.mock("@admin/context/providers/BrandingProvider", () => ({
  BrandingProvider: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
  useBranding: () => ({}),
}));

vi.mock("@admin/context/providers/DocumentTitleProvider", () => ({
  DocumentTitleProvider: ({ children }: { children: React.ReactNode }) => (
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

vi.mock("@admin/components/guards/PermissionGuard", () => ({
  PermissionGuard: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
}));

vi.mock("@admin/components/shared/loading-frame/screen-outline-for", () => ({
  ScreenOutlineFor: () => <span>screen-outline</span>,
}));

// The palette itself is under test elsewhere; here only whether it is there.
vi.mock("../../components/shared/command-palette", () => ({
  AdminCommandPalette: () => <span data-testid="admin-palette" />,
}));

/** What the private-route guard answers: no session, being checked, confirmed. */
let guardAnswer: "signed-out" | "checking" | "confirmed" = "confirmed";
vi.mock("@admin/components/guards/PrivateRoute", () => ({
  PrivateRoute: ({
    children,
    signIn,
  }: {
    children: (confirmed: boolean) => React.ReactNode;
    signIn: React.ReactNode;
  }) => {
    if (guardAnswer === "signed-out") return <>{signIn}</>;
    return <>{children(guardAnswer === "confirmed")}</>;
  },
}));

vi.mock("../../pages/(auth)/login", () => ({
  default: () => <span>sign-in-form</span>,
}));

import { RootLayout } from "../RootLayout";

function RouteScreen() {
  return <span>route-screen</span>;
}

function renderPrivateRoute() {
  mockRoute.mockReturnValue({
    route: {
      Component: RouteScreen,
      params: {},
      searchParams: {},
      requiresBuilder: false,
      routeType: "private",
    },
    isHydrated: true,
  });
  render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <RootLayout />
    </QueryClientProvider>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("RootLayout and the command palette", () => {
  it("mounts the palette once the server has confirmed the session", () => {
    guardAnswer = "confirmed";
    renderPrivateRoute();
    expect(screen.getByText("route-screen")).toBeTruthy();
    expect(screen.queryByTestId("admin-palette")).not.toBeNull();
  });

  it("mounts no palette beside the sign-in form", () => {
    guardAnswer = "signed-out";
    renderPrivateRoute();
    expect(screen.getByText("sign-in-form")).toBeTruthy();
    expect(screen.queryByTestId("admin-palette")).toBeNull();
  });

  it("mounts no palette while the session is still being checked", () => {
    guardAnswer = "checking";
    renderPrivateRoute();
    expect(screen.getByText("screen-outline")).toBeTruthy();
    expect(screen.queryByTestId("admin-palette")).toBeNull();
  });
});
