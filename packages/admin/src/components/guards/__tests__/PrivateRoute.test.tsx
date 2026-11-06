/**
 * The guard's subtlety is that "not authenticated" and "no answer yet" both
 * read as falsy, and acting on the second is what sends someone to LOGIN on a
 * result that never arrived — which then loops against PublicRoute. So the
 * unsettled cases are asserted as explicitly as the decided ones.
 *
 * The destination and the message it shows come from ONE derivation, so a test
 * that pins the message is also pinning where the browser is being sent.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  OFFER_RETRY_AFTER_MS,
  SLOW_START_AFTER_MS,
} from "@admin/components/guards/AdminPending";

import { ROUTES } from "@admin/constants/routes";

const mockUseAuthSession = vi.fn();
const mockRestart = vi.fn();
vi.mock("@admin/hooks/queries/useAuthSession", () => ({
  useAuthSession: () => mockUseAuthSession(),
  restartSessionCheck: (...args: unknown[]) => mockRestart(...args),
  authSessionKey: ["auth", "session"],
}));

const mockNavigateTo = vi.fn();
vi.mock("@admin/lib/navigation", () => ({
  navigateTo: (path: string) => mockNavigateTo(path),
}));

import { PrivateRoute } from "../PrivateRoute";

function renderGuard() {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <PrivateRoute>
        <span>protected</span>
      </PrivateRoute>
    </QueryClientProvider>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.useRealTimers();
});

/** The query's shape while its request is still out. */
function pendingSession() {
  return {
    status: "pending",
    fetchStatus: "fetching",
    data: undefined,
  };
}

describe("PrivateRoute", () => {
  it("renders the protected content for a valid session", () => {
    mockUseAuthSession.mockReturnValue({
      status: "success",
      data: { isSetup: true, isAuthenticated: true },
    });

    renderGuard();

    expect(screen.getByText("protected")).toBeInTheDocument();
    expect(mockNavigateTo).not.toHaveBeenCalled();
  });

  it("sends an unauthenticated visitor to login", () => {
    mockUseAuthSession.mockReturnValue({
      status: "success",
      data: { isSetup: true, isAuthenticated: false },
    });

    renderGuard();

    expect(mockNavigateTo).toHaveBeenCalledWith(ROUTES.LOGIN);
    expect(screen.getByText(/Redirecting to login/)).toBeInTheDocument();
    expect(screen.queryByText("protected")).not.toBeInTheDocument();
  });

  it("sends an unconfigured installation to setup, not to login", () => {
    // Setup is checked FIRST: an installation with no admin account yet has no
    // session either, so deciding on authentication would send the very first
    // visitor to a login screen no one can pass.
    mockUseAuthSession.mockReturnValue({
      status: "success",
      data: { isSetup: false, isAuthenticated: false },
    });

    renderGuard();

    expect(mockNavigateTo).toHaveBeenCalledWith(ROUTES.SETUP);
    expect(screen.getByText(/Redirecting to setup/)).toBeInTheDocument();
  });

  it("waits while the session is still pending, and navigates nowhere", () => {
    mockUseAuthSession.mockReturnValue({ status: "pending", data: undefined });

    renderGuard();

    expect(mockNavigateTo).not.toHaveBeenCalled();
    expect(screen.queryByText("protected")).not.toBeInTheDocument();
  });

  it("navigates nowhere when the session query ERRORED", () => {
    // The case that loops: an error leaves `data` undefined, and treating that
    // as "not authenticated" redirects to LOGIN, whose own guard sends the
    // visitor back here.
    mockUseAuthSession.mockReturnValue({ status: "error", data: undefined });

    renderGuard();

    expect(mockNavigateTo).not.toHaveBeenCalled();
    expect(screen.queryByText("protected")).not.toBeInTheDocument();
  });

  it("does not render children on a success whose data has not arrived", () => {
    // React Query can report success with data still undefined during a
    // transition; rendering the protected tree there shows it to nobody in
    // particular.
    mockUseAuthSession.mockReturnValue({ status: "success", data: undefined });

    renderGuard();

    expect(screen.queryByText("protected")).not.toBeInTheDocument();
    expect(mockNavigateTo).not.toHaveBeenCalled();
  });
  it("shows that the admin is loading while the session is pending, never an empty page", () => {
    mockUseAuthSession.mockReturnValue(pendingSession());

    renderGuard();

    expect(screen.getByRole("status")).toHaveTextContent("Loading the admin");
  });

  it("names a slow start, then offers Try again, which asks the server again", () => {
    vi.useFakeTimers();
    mockUseAuthSession.mockReturnValue(pendingSession());

    renderGuard();
    expect(
      screen.queryByRole("button", { name: "Try again" })
    ).not.toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(SLOW_START_AFTER_MS);
    });
    expect(screen.getByRole("status")).toHaveTextContent(
      "The server is starting"
    );
    expect(
      screen.queryByRole("button", { name: "Try again" })
    ).not.toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(OFFER_RETRY_AFTER_MS - SLOW_START_AFTER_MS);
    });
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));

    expect(mockRestart).toHaveBeenCalledTimes(1);
    // The new request starts a new wait.
    expect(screen.getByRole("status")).toHaveTextContent("Loading the admin");
  });

  it("says the server could not be reached when the query errors, with Try again", () => {
    mockUseAuthSession.mockReturnValue({
      status: "error",
      fetchStatus: "idle",
      data: undefined,
    });

    renderGuard();

    expect(screen.getByRole("alert")).toHaveTextContent(
      "can't reach the server"
    );
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(mockRestart).toHaveBeenCalledTimes(1);
    expect(mockNavigateTo).not.toHaveBeenCalled();
  });

  it("shows a retry after an error as a wait, not as the error", () => {
    // React Query keeps `status: "error"` while a refetch from an error runs.
    mockUseAuthSession.mockReturnValue({
      status: "error",
      fetchStatus: "fetching",
      data: undefined,
    });

    renderGuard();

    expect(screen.getByRole("status")).toHaveTextContent("Loading the admin");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
