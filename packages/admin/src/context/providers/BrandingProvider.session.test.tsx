/**
 * The workspace half of admin-meta is session-gated and does not retry, so a
 * request made before a session existed answers 401 and stays failed. Signing in
 * has to produce a NEW request; nothing revives the dead one.
 *
 * These cover that transition, because every consumer that reads the plugin list
 * or the locale list reads it through this provider — and the failure they saw
 * was not an error but a plausible-looking "nothing is installed".
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { AdminBranding } from "@admin/types/branding";

const get = vi.fn();
const protectedGet = vi.fn();
const session = vi.fn();

vi.mock("@admin/lib/api/publicApi", () => ({
  publicApi: { get: (...args: unknown[]) => get(...args) },
}));

vi.mock("@admin/lib/api/protectedApi", () => ({
  protectedApi: { get: (...args: unknown[]) => protectedGet(...args) },
}));

vi.mock("@admin/hooks/queries/useAuthSession", () => ({
  useAuthSession: () => session(),
  authSessionKey: ["auth", "session"],
}));

import {
  BrandingProvider,
  useBrandingStatus,
} from "@admin/context/providers/BrandingProvider";

function Probe() {
  const { isPending, isUnavailable } = useBrandingStatus();
  return (
    <span data-testid="status">
      {isPending ? "pending" : isUnavailable ? "unavailable" : "answered"}
    </span>
  );
}

function renderProbe() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const utils = render(
    <QueryClientProvider client={client}>
      <BrandingProvider>
        <Probe />
      </BrandingProvider>
    </QueryClientProvider>
  );
  return {
    ...utils,
    rerender: () =>
      utils.rerender(
        <QueryClientProvider client={client}>
          <BrandingProvider>
            <Probe />
          </BrandingProvider>
        </QueryClientProvider>
      ),
  };
}

const WORKSPACE = { plugins: [] } as unknown as AdminBranding;

/** The session as this provider reads it. */
function signedOut() {
  return { data: { isSetup: true, isAuthenticated: false }, isPending: false };
}
function signedIn() {
  return { data: { isSetup: true, isAuthenticated: true }, isPending: false };
}
function resolving() {
  return { data: undefined, isPending: true };
}

afterEach(() => {
  get.mockReset();
  protectedGet.mockReset();
  session.mockReset();
  vi.restoreAllMocks();
});

describe("the session-gated half of admin-meta", () => {
  it("does not ask while the session is still resolving", async () => {
    session.mockReturnValue(resolving());
    get.mockResolvedValue({} as AdminBranding);

    renderProbe();

    // Asserted after a settle, so this is "never asked" rather than "not asked
    // yet on the first paint" — the two look identical at render time.
    await waitFor(() => expect(get).toHaveBeenCalled());
    expect(protectedGet).not.toHaveBeenCalled();
    expect(screen.getByTestId("status").textContent).toBe("pending");
  });

  it("asks again after sign-in, rather than reusing the failed anonymous answer", async () => {
    get.mockResolvedValue({} as AdminBranding);
    protectedGet.mockRejectedValueOnce(new Error("401"));
    session.mockReturnValue(signedOut());

    const { rerender } = renderProbe();

    // The anonymous attempt fails and, with no retry, is final for that key.
    await waitFor(() =>
      expect(screen.getByTestId("status").textContent).toBe("unavailable")
    );
    expect(protectedGet).toHaveBeenCalledTimes(1);

    // Signing in must produce a fresh request. Before this fix the failed query
    // was simply read again and every consumer stayed degraded until a reload.
    protectedGet.mockResolvedValueOnce(WORKSPACE);
    session.mockReturnValue(signedIn());
    rerender();

    await waitFor(() =>
      expect(screen.getByTestId("status").textContent).toBe("answered")
    );
    expect(protectedGet).toHaveBeenCalledTimes(2);
  });

  it("reports unavailable when the session itself could not be established", async () => {
    // A session query that failed still releases this one: the answer is that
    // the list is unavailable, which is true, rather than a skeleton forever.
    get.mockResolvedValue({} as AdminBranding);
    protectedGet.mockRejectedValue(new Error("401"));
    session.mockReturnValue({ data: undefined, isPending: false });

    renderProbe();

    await waitFor(() =>
      expect(screen.getByTestId("status").textContent).toBe("unavailable")
    );
  });
});
