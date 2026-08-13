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

vi.mock("@admin/lib/api/publicApi", () => ({
  publicApi: { get: (...args: unknown[]) => get(...args) },
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
  vi.restoreAllMocks();
});

describe("useBrandingStatus", () => {
  it("reports pending until the request answers", async () => {
    get.mockReturnValue(new Promise(() => {}));

    renderProbe(
      new QueryClient({ defaultOptions: { queries: { retry: false } } })
    );

    expect(status()).toBe("pending");
  });

  it("reports answered once branding arrives", async () => {
    get.mockResolvedValue({ plugins: [] } as AdminBranding);

    renderProbe(
      new QueryClient({ defaultOptions: { queries: { retry: false } } })
    );

    await waitFor(() => expect(status()).toBe("answered"));
  });

  it("reports unavailable when the first request fails", async () => {
    get.mockRejectedValue(new Error("boom"));

    renderProbe(
      new QueryClient({ defaultOptions: { queries: { retry: false } } })
    );

    await waitFor(() => expect(status()).toBe("unavailable"));
  });

  /**
   * The separating case, and the one a plain `isError` gets wrong.
   *
   * A background refetch can fail long after a response is cached, and that
   * cached response is still a complete answer. Reporting it as unavailable
   * would replace a correct page with an error for as long as the server stays
   * unreachable — for a reader looking at a plugin the cached list already
   * proved absent, that is an error screen instead of the install page.
   */
  it("stays answered when a refetch fails after a response is cached", async () => {
    get.mockResolvedValueOnce({ plugins: [] } as AdminBranding);
    get.mockRejectedValue(new Error("boom"));

    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    renderProbe(client);
    await waitFor(() => expect(status()).toBe("answered"));

    await client.refetchQueries({ queryKey: ["admin-meta"] });

    // The refetch really did fail — without this the assertion below is
    // satisfied by a refetch that never ran, which is the same green.
    expect(get).toHaveBeenCalledTimes(2);
    expect(status()).toBe("answered");
  });
});
