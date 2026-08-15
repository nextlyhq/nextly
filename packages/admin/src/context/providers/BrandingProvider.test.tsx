/**
 * Readers that conclude something from a plugin being MISSING from branding
 * need to know the list arrived. `useBranding` alone cannot tell them: it
 * returns `{}` both before the request answers and when the project genuinely
 * has nothing, so these cover the distinction `useBrandingStatus` adds.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { AdminBranding } from "@admin/types/branding";

const get = vi.fn();
const protectedGet = vi.fn();

vi.mock("@admin/lib/api/publicApi", () => ({
  publicApi: { get: (...args: unknown[]) => get(...args) },
}));

vi.mock("@admin/lib/api/protectedApi", () => ({
  protectedApi: { get: (...args: unknown[]) => protectedGet(...args) },
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

function renderProbe(client: QueryClient) {
  return render(
    <QueryClientProvider client={client}>
      <BrandingProvider>
        <Probe />
      </BrandingProvider>
    </QueryClientProvider>
  );
}

function status() {
  return screen.getByTestId("status").textContent;
}

afterEach(() => {
  get.mockReset();
  protectedGet.mockReset();
  vi.restoreAllMocks();
});

describe("useBrandingStatus", () => {
  it("reports pending until both requests answer", async () => {
    get.mockReturnValue(new Promise(() => {}));
    protectedGet.mockReturnValue(new Promise(() => {}));

    renderProbe(
      new QueryClient({ defaultOptions: { queries: { retry: false } } })
    );

    expect(status()).toBe("pending");
  });

  it("reports answered once both halves arrive", async () => {
    get.mockResolvedValue({ logoText: "Acme" } as AdminBranding);
    protectedGet.mockResolvedValue({ plugins: [] } as AdminBranding);

    renderProbe(
      new QueryClient({ defaultOptions: { queries: { retry: false } } })
    );

    await waitFor(() => expect(status()).toBe("answered"));
  });

  it("stays unavailable when only the branding half arrives", async () => {
    // The property this hook exists for, and the one the split could have
    // broken silently. Its reader concludes something from a plugin being
    // ABSENT, and the plugin list lives in the session-gated half — so
    // branding having answered says nothing about whether that conclusion is
    // safe. Reporting the public query's state here would call it `answered`
    // while the list had never been fetched.
    get.mockResolvedValue({ logoText: "Acme" } as AdminBranding);
    protectedGet.mockRejectedValue(new Error("unauthenticated"));

    renderProbe(
      new QueryClient({ defaultOptions: { queries: { retry: false } } })
    );

    await waitFor(() => expect(status()).toBe("unavailable"));
  });

  it("reports unavailable when the workspace request fails", async () => {
    get.mockRejectedValue(new Error("boom"));
    protectedGet.mockRejectedValue(new Error("boom"));

    renderProbe(
      new QueryClient({ defaultOptions: { queries: { retry: false } } })
    );

    await waitFor(() => expect(status()).toBe("unavailable"));
  });
});

/**
 * NOT COVERED, stated rather than left to look covered: a background refetch
 * failing while a previous response is cached must leave the status
 * `answered`, since the cached response is still a complete answer.
 *
 * `isUnavailable` is wired to the query's `isLoadingError`, which query-core
 * defines as `isError && !hasData` (`isRefetchError` is the `&& hasData`
 * half), so the distinction is the library's own and holds by construction.
 * A test was written for it and removed: driving a failed refetch through
 * `refetchQueries` errors the cache entry without the probe observing a
 * re-render, so the assertion passed against BOTH `isLoadingError` and a
 * deliberately broken `isError` — coverage in appearance only.
 */
