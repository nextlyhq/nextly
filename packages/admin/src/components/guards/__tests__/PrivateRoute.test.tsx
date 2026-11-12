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

import { ROUTES } from "@admin/constants/routes";
import { SIGNED_IN_HERE_KEY } from "@admin/lib/device-memory/device-memory";

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

/**
 * The guard as the admin mounts it: a frame told whether the session is
 * confirmed, and the sign-in form drawn in place. The frame's two states are
 * told apart by their text, so a test can say which one is on screen.
 */
function renderGuard() {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <PrivateRoute signIn={<span>sign-in form</span>}>
        {confirmed =>
          confirmed ? <span>protected</span> : <span>frame, no data</span>
        }
      </PrivateRoute>
    </QueryClientProvider>
  );
}

/** A browser that has signed in to this admin before. */
function signedInHereBefore() {
  window.localStorage.setItem(SIGNED_IN_HERE_KEY, "1");
}

beforeEach(() => {
  vi.clearAllMocks();
  window.localStorage.clear();
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

  it("sends a visitor signed in here before, whose session is gone, to login", () => {
    signedInHereBefore();
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
  it("draws the frame, with no data, while the session is pending in a browser signed in here", () => {
    signedInHereBefore();
    mockUseAuthSession.mockReturnValue(pendingSession());

    renderGuard();

    // The frame paints before the server answers; the screen does not.
    expect(screen.getByText("frame, no data")).toBeInTheDocument();
    expect(screen.queryByText("protected")).not.toBeInTheDocument();
    expect(screen.queryByText("sign-in form")).not.toBeInTheDocument();
    expect(mockNavigateTo).not.toHaveBeenCalled();
  });

  it("draws the sign-in form while the session is pending in a browser with no record", () => {
    mockUseAuthSession.mockReturnValue(pendingSession());

    renderGuard();

    expect(screen.getByText("sign-in form")).toBeInTheDocument();
    expect(screen.queryByText("frame, no data")).not.toBeInTheDocument();
    expect(screen.queryByText("protected")).not.toBeInTheDocument();
  });

  it("keeps the sign-in form in place when the server says there is no session", () => {
    // Moving to the sign-in address would draw the form afresh and drop what
    // the visitor typed while the server started.
    mockUseAuthSession.mockReturnValue({
      status: "success",
      data: { isSetup: true, isAuthenticated: false },
    });

    renderGuard();

    expect(screen.getByText("sign-in form")).toBeInTheDocument();
    expect(mockNavigateTo).not.toHaveBeenCalled();
  });

  it("records a confirmed session, and forgets it when the server says there is none", () => {
    mockUseAuthSession.mockReturnValue({
      status: "success",
      data: { isSetup: true, isAuthenticated: true },
    });
    const { unmount } = renderGuard();
    expect(window.localStorage.getItem(SIGNED_IN_HERE_KEY)).toBe("1");
    unmount();

    mockUseAuthSession.mockReturnValue({
      status: "success",
      data: { isSetup: true, isAuthenticated: false },
    });
    renderGuard();
    expect(window.localStorage.getItem(SIGNED_IN_HERE_KEY)).toBeNull();
  });

  it("records nothing while the session is still pending", () => {
    mockUseAuthSession.mockReturnValue(pendingSession());

    renderGuard();

    expect(window.localStorage.getItem(SIGNED_IN_HERE_KEY)).toBeNull();
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
    signedInHereBefore();
    mockUseAuthSession.mockReturnValue({
      status: "error",
      fetchStatus: "fetching",
      data: undefined,
    });

    renderGuard();

    expect(screen.getByText("frame, no data")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  // Asking again on the sign-in form drawn in place is the form's own offer,
  // made wherever the form is drawn: covered in
  // `features/auth-login/__tests__/sign-in-waits-for-server.test.tsx`.
});
