/**
 * The guard gates every signed-out screen, so its boot cost IS the login
 * page's boot cost. The behavior under test: setup-status and the session
 * probe are independent requests, and the probe must not wait for
 * setup-status to answer — awaited serially they cost two full API
 * round-trips during which this guard renders nothing but a blank div.
 *
 * Deferred promises stand in for the two requests so "still in flight" is a
 * state the test can hold open while it asserts what has already started.
 */
import { act, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ROUTES } from "@admin/constants/routes";

const mockCheckSetupStatus = vi.fn();
vi.mock("@admin/lib/auth/setup-status", () => ({
  checkSetupStatus: (...args: unknown[]) => mockCheckSetupStatus(...args),
}));

const mockIsAuthenticated = vi.fn();
vi.mock("@admin/lib/auth/session", () => ({
  isAuthenticated: (...args: unknown[]) => mockIsAuthenticated(...args),
}));

const mockNavigateTo = vi.fn();
vi.mock("@admin/lib/navigation", () => ({
  navigateTo: (path: string) => mockNavigateTo(path),
}));

import { PublicRoute } from "../PublicRoute";

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(res => {
    resolve = res;
  });
  return { promise, resolve };
}

function renderGuard() {
  return render(
    <PublicRoute>
      <span>public-content</span>
    </PublicRoute>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("PublicRoute", () => {
  it("starts the session probe while setup-status is still in flight", async () => {
    // The regression this pins: the probe used to be awaited AFTER
    // setup-status, so on a slow setup-status the blank div persisted for
    // both round-trips. Here setup-status never settles, and the probe must
    // nevertheless have been issued.
    const setup = deferred<boolean>();
    const session = deferred<boolean>();
    mockCheckSetupStatus.mockReturnValue(setup.promise);
    mockIsAuthenticated.mockReturnValue(session.promise);

    renderGuard();
    await act(async () => {
      await Promise.resolve();
    });

    expect(mockIsAuthenticated).toHaveBeenCalledTimes(1);

    // Settle both and confirm the guarded content renders.
    await act(async () => {
      setup.resolve(true);
      await Promise.resolve();
    });
    await act(async () => {
      session.resolve(false);
      await Promise.resolve();
    });

    expect(screen.getByText("public-content")).toBeInTheDocument();
    expect(mockNavigateTo).not.toHaveBeenCalled();
  });

  it("renders the signed-out content once both checks settle", async () => {
    mockCheckSetupStatus.mockResolvedValue(true);
    mockIsAuthenticated.mockResolvedValue(false);

    renderGuard();
    await act(async () => {
      await Promise.resolve();
    });

    expect(screen.getByText("public-content")).toBeInTheDocument();
    expect(mockNavigateTo).not.toHaveBeenCalled();
  });

  it("sends an authenticated visitor to the dashboard", async () => {
    mockCheckSetupStatus.mockResolvedValue(true);
    mockIsAuthenticated.mockResolvedValue(true);

    renderGuard();
    await act(async () => {
      await Promise.resolve();
    });

    expect(mockNavigateTo).toHaveBeenCalledWith(ROUTES.DASHBOARD);
    expect(screen.queryByText("public-content")).not.toBeInTheDocument();
  });

  it("sends an unconfigured installation to setup", async () => {
    mockCheckSetupStatus.mockResolvedValue(false);
    mockIsAuthenticated.mockResolvedValue(false);

    renderGuard();
    await act(async () => {
      await Promise.resolve();
    });

    expect(mockNavigateTo).toHaveBeenCalledWith(ROUTES.SETUP);
    expect(screen.queryByText("public-content")).not.toBeInTheDocument();
  });

  it("renders the setup page itself when setup is incomplete", async () => {
    mockCheckSetupStatus.mockResolvedValue(false);
    mockIsAuthenticated.mockResolvedValue(false);
    window.history.replaceState(null, "", ROUTES.SETUP);

    try {
      renderGuard();
      await act(async () => {
        await Promise.resolve();
      });

      expect(mockNavigateTo).not.toHaveBeenCalled();
      expect(screen.getByText("public-content")).toBeInTheDocument();
    } finally {
      window.history.replaceState(null, "", "/");
    }
  });
});
