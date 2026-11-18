/**
 * A server that refuses the startup session read with a 429 is up and busy,
 * not down. The admin says so, waits as long as the server asked (its
 * `Retry-After`, or the body's `retryAfterSeconds`, or a default when it names
 * neither), then asks again by itself. A server that answers 5xx, or a request
 * that never reaches it, keeps the "can't reach the server" screen.
 *
 * Runs the real session read, session query and guard, with only the network
 * call faked, so the status and wait are followed from the response the
 * server sent to the screen the visitor sees.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SIGNED_IN_HERE_KEY } from "@admin/lib/device-memory/device-memory";

const mockAuthFetch = vi.fn();
vi.mock("@admin/lib/api/refreshInterceptor", async importOriginal => ({
  ...(await importOriginal<
    typeof import("@admin/lib/api/refreshInterceptor")
  >()),
  authFetch: (...args: unknown[]) => mockAuthFetch(...args),
}));

// Setup is answered and done, so the session read alone decides the screen.
vi.mock("@admin/lib/auth/setup-status", () => ({
  readSetupState: async () => ({
    answered: true,
    isSetup: true,
    requiresSetupToken: false,
    allowRegistration: false,
  }),
  resetSetupStatusCache: () => {},
}));

vi.mock("@admin/lib/device-memory/server-answer", () => ({
  confirmDeviceMemory: async () => {},
}));

const mockNavigateTo = vi.fn();
vi.mock("@admin/lib/navigation", () => ({
  navigateTo: (path: string) => mockNavigateTo(path),
}));

vi.mock("@admin/hooks/useLogout", () => ({
  useLogout: () => vi.fn(),
}));

import { invalidateSessionCache } from "@admin/lib/auth/session";

import { PrivateRoute } from "../PrivateRoute";

function jsonResponse(
  status: number,
  body: unknown,
  headers: Record<string, string> = {}
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });
}

/** The rate limit's refusal, as the server's error envelope writes it. */
function rateLimited(
  options: { header?: string; bodySeconds?: number } = {}
): Response {
  return jsonResponse(
    429,
    {
      error: {
        code: "RATE_LIMITED",
        message: "Too many requests.",
        requestId: "req-1",
        ...(options.bodySeconds === undefined
          ? {}
          : { data: { retryAfterSeconds: options.bodySeconds } }),
      },
    },
    options.header === undefined ? {} : { "Retry-After": options.header }
  );
}

const signedIn = () =>
  jsonResponse(200, {
    data: { user: { id: "u1", email: "staff@example.com", roleIds: ["r1"] } },
  });

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

/** Lets the clock run `ms`, and what it starts run with it. */
async function wait(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

/**
 * Lets a retry's request answer and the screen follow: the query hands its
 * new state to the guard on timers of its own, a moment after the request.
 */
async function settle() {
  await wait(50);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  invalidateSessionCache();
  window.localStorage.clear();
  // A browser that has signed in here before, so the wait is the frame.
  window.localStorage.setItem(SIGNED_IN_HERE_KEY, "1");
});

afterEach(() => {
  vi.useRealTimers();
});

describe("PrivateRoute, a server that answers 429", () => {
  it("says the server is busy, waits its Retry-After, then asks again by itself", async () => {
    mockAuthFetch
      .mockResolvedValueOnce(rateLimited({ header: "30" }))
      .mockResolvedValue(signedIn());

    renderGuard();
    await wait(0);

    const status = screen.getByRole("status");
    expect(status).toHaveTextContent("The server is busy.");
    expect(status).toHaveTextContent("Trying again in 30 s.");
    expect(screen.queryByText(/can't reach the server/)).toBeNull();
    // Told to wait, the admin does not ask again on its own quick schedule.
    expect(mockAuthFetch).toHaveBeenCalledTimes(1);

    await wait(10_000);
    expect(screen.getByRole("status")).toHaveTextContent(
      "Trying again in 20 s."
    );
    await wait(19_000);
    expect(mockAuthFetch).toHaveBeenCalledTimes(1);

    await wait(1_000);
    expect(mockAuthFetch).toHaveBeenCalledTimes(2);
    await settle();
    expect(screen.getByText("protected")).toBeInTheDocument();
    expect(mockNavigateTo).not.toHaveBeenCalled();
  });

  it("waits the body's retryAfterSeconds when there is no Retry-After header", async () => {
    mockAuthFetch
      .mockResolvedValueOnce(rateLimited({ bodySeconds: 12 }))
      .mockResolvedValue(signedIn());

    renderGuard();
    await wait(0);

    expect(screen.getByRole("status")).toHaveTextContent(
      "Trying again in 12 s."
    );
    await wait(11_000);
    expect(mockAuthFetch).toHaveBeenCalledTimes(1);
    await wait(1_000);
    expect(mockAuthFetch).toHaveBeenCalledTimes(2);
    await settle();
    expect(screen.getByText("protected")).toBeInTheDocument();
  });

  it("waits a default of 10 s when the server names no wait", async () => {
    mockAuthFetch
      .mockResolvedValueOnce(rateLimited())
      .mockResolvedValue(signedIn());

    renderGuard();
    await wait(0);

    expect(screen.getByRole("status")).toHaveTextContent(
      "Trying again in 10 s."
    );
    await wait(9_000);
    expect(mockAuthFetch).toHaveBeenCalledTimes(1);
    await wait(1_000);
    expect(mockAuthFetch).toHaveBeenCalledTimes(2);
    await settle();
    expect(screen.getByText("protected")).toBeInTheDocument();
  });

  it("starts a new wait for a second 429, even one of the same length", async () => {
    mockAuthFetch
      .mockResolvedValueOnce(rateLimited())
      .mockResolvedValueOnce(rateLimited())
      .mockResolvedValue(signedIn());

    renderGuard();
    await wait(10_000);
    expect(mockAuthFetch).toHaveBeenCalledTimes(2);
    await settle();
    expect(screen.getByRole("status")).toHaveTextContent(
      "Trying again in 10 s."
    );

    await wait(9_000);
    expect(mockAuthFetch).toHaveBeenCalledTimes(2);
    await wait(1_000);
    expect(mockAuthFetch).toHaveBeenCalledTimes(3);
    await settle();
    expect(screen.getByText("protected")).toBeInTheDocument();
  });

  it("asks again at once on Try again now, and is busy again on a second 429", async () => {
    mockAuthFetch
      .mockResolvedValueOnce(rateLimited({ header: "30" }))
      .mockResolvedValueOnce(rateLimited({ header: "5" }))
      .mockResolvedValue(signedIn());

    renderGuard();
    await wait(0);

    fireEvent.click(screen.getByRole("button", { name: "Try again now" }));
    await settle();
    expect(mockAuthFetch).toHaveBeenCalledTimes(2);
    expect(screen.getByRole("status")).toHaveTextContent(
      "Trying again in 5 s."
    );

    await wait(4_900);
    expect(mockAuthFetch).toHaveBeenCalledTimes(2);
    await wait(100);
    expect(mockAuthFetch).toHaveBeenCalledTimes(3);
    await settle();
    expect(screen.getByText("protected")).toBeInTheDocument();
  });
});

describe("PrivateRoute, a server that cannot answer", () => {
  it.each([
    ["a 503", () => Promise.resolve(jsonResponse(503, {}))],
    ["a network failure", () => Promise.reject(new TypeError("Failed"))],
  ])("keeps the can't-reach-the-server screen for %s", async (_, answer) => {
    mockAuthFetch.mockImplementation(answer);

    renderGuard();
    // The session query's own retries, 1 s then 2 s apart.
    await wait(4_000);

    expect(screen.getByRole("alert")).toHaveTextContent(
      "can't reach the server"
    );
    expect(screen.queryByText(/The server is busy/)).toBeNull();
    expect(mockAuthFetch).toHaveBeenCalledTimes(3);
    // Nothing is asked again until the visitor chooses to.
    await wait(60_000);
    expect(mockAuthFetch).toHaveBeenCalledTimes(3);
  });
});
