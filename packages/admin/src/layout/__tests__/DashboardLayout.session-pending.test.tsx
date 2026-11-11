/**
 * The admin's frame paints while the session is still being checked, in a
 * browser that has signed in here before: the rail with its logo, the top bar
 * and the main column, with the screen's outline in the column. Nothing that
 * reads the reader's data is mounted until the server confirms the session.
 *
 * Mounted as the admin mounts it: the guard around the layout, the layout told
 * whether the session is confirmed. The sidebar that reads the reader's menu
 * and the screen are stand-ins that record being mounted, so "not mounted
 * before the answer" is observed rather than inferred from what is drawn.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const menuReaderMounted = vi.fn();
vi.mock("@admin/components/layout/sidebar/DualSidebar", () => ({
  DualSidebar: () => {
    menuReaderMounted();
    return <nav aria-label="The reader's menu" />;
  },
}));
vi.mock("@admin/components/layout/sidebar", () => ({
  SidebarProvider: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
}));
vi.mock("@admin/context/providers/BrandingProvider", () => ({
  useBranding: () => ({}),
}));
vi.mock("@admin/components/shared/ThemeAwareLogo", () => ({
  ThemeAwareLogo: () => <svg data-testid="logo" />,
}));
vi.mock("@admin/hooks/useRouter", () => ({
  useRouter: () => ({ pathname: "/admin/collections/posts" }),
}));

const mockUseAuthSession = vi.fn();
vi.mock("@admin/hooks/queries/useAuthSession", () => ({
  useAuthSession: () => mockUseAuthSession(),
  restartSessionCheck: vi.fn(),
  authSessionKey: ["auth", "session"],
}));
vi.mock("@admin/lib/navigation", () => ({ navigateTo: vi.fn() }));

const { PrivateRoute } = await import("@admin/components/guards/PrivateRoute");
const { ScreenOutlineFor } = await import(
  "@admin/components/shared/loading-frame/screen-outline-for"
);
const { RoutedPathnameContext } = await import(
  "@admin/context/RoutedPathnameContext"
);
const { SIGNED_IN_HERE_KEY } = await import("@admin/lib/auth/signed-in-here");
const { DashboardLayout } = await import("../DashboardLayout");

const screenMounted = vi.fn();
function TheScreen() {
  screenMounted();
  return <p>the reader's posts</p>;
}

const PATHNAME = "/admin/collections/posts";

/** The admin as RootLayout mounts it, on one query client across renders. */
const client = new QueryClient();
function admin() {
  return (
    <QueryClientProvider client={client}>
      <RoutedPathnameContext.Provider value={PATHNAME}>
        <PrivateRoute signIn={<p>sign-in form</p>}>
          {confirmed => (
            <DashboardLayout sessionConfirmed={confirmed}>
              {confirmed ? (
                <TheScreen />
              ) : (
                <ScreenOutlineFor pathname={PATHNAME} />
              )}
            </DashboardLayout>
          )}
        </PrivateRoute>
      </RoutedPathnameContext.Provider>
    </QueryClientProvider>
  );
}

const drawAdmin = () => render(admin());

beforeEach(() => {
  vi.clearAllMocks();
  window.localStorage.clear();
  window.localStorage.setItem(SIGNED_IN_HERE_KEY, "1");
});

afterEach(cleanup);

describe("the admin's frame while the session is checked", () => {
  it("paints the rail with its logo, the bar and the main column before the server answers", () => {
    mockUseAuthSession.mockReturnValue({
      status: "pending",
      fetchStatus: "fetching",
      data: undefined,
    });

    drawAdmin();

    const rail = document.querySelector("aside");
    expect(rail).not.toBeNull();
    expect(rail).toContainElement(screen.getByTestId("logo"));
    // The rail's entries are not known: neutral shapes hold their places.
    expect(screen.getAllByTestId("rail-ghost-item").length).toBeGreaterThan(0);
    expect(screen.getByRole("banner")).toBeInTheDocument();
    expect(screen.getByRole("main")).toContainElement(
      screen.getByTestId("screen-outline")
    );
    // A collection's address opens the Content panel's track from the route.
    expect(screen.getByTestId("sub-sidebar")).not.toHaveAttribute(
      "aria-hidden"
    );

    // Nothing that reads the reader's data is mounted yet.
    expect(menuReaderMounted).not.toHaveBeenCalled();
    expect(screenMounted).not.toHaveBeenCalled();
    expect(screen.queryByText("sign-in form")).not.toBeInTheDocument();
  });

  it("mounts the menu and the screen in the same frame once the server confirms the session", () => {
    mockUseAuthSession.mockReturnValue({
      status: "pending",
      fetchStatus: "fetching",
      data: undefined,
    });
    const view = drawAdmin();
    const main = screen.getByRole("main");

    mockUseAuthSession.mockReturnValue({
      status: "success",
      fetchStatus: "idle",
      data: { isSetup: true, isAuthenticated: true },
    });
    view.rerender(admin());

    expect(menuReaderMounted).toHaveBeenCalled();
    expect(screen.getByText("the reader's posts")).toBeInTheDocument();
    expect(screen.queryByTestId("screen-outline")).not.toBeInTheDocument();
    // The same main column: the frame was not drawn again around the screen.
    expect(screen.getByRole("main")).toBe(main);
  });
});
