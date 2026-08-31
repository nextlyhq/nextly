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

/**
 * The provider's THIRD input, and the one the two API mocks above cannot
 * reach. `BrandingProvider` gates the workspace query on `enabled:
 * !sessionPending`, so `useAuthSession` decides whether that query is ever
 * allowed to run — and its real implementation calls `getSession()`, which
 * issues a genuine `fetch` to `${location.origin}/admin/api/auth/session`
 * rather than going through `publicApi`. Left unmocked, whether these tests
 * pass depends on what answers port 3000 on the machine running them: nothing
 * listening refuses the connection at once and the session settles, while a
 * dev server that accepts and never answers leaves it pending forever, the
 * workspace query permanently disabled, and every status here stuck on
 * `pending`.
 *
 * A settled session is supplied so the assertions below are about the two
 * admin-meta halves, which is what this file covers. The session's own effect
 * on the status — resolving, signed out, signed in — is covered next door in
 * `BrandingProvider.session.test.tsx`, which drives it per test.
 */
const SETTLED_SESSION = {
  data: { isSetup: true, isAuthenticated: true },
  isPending: false,
};

vi.mock("@admin/hooks/queries/useAuthSession", () => ({
  useAuthSession: () => SETTLED_SESSION,
  authSessionKey: ["auth", "session"],
}));

import {
  BrandingProvider,
  useAppName,
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

  it("settles once the workspace half answers, even if branding is stalled", async () => {
    // The ASYMMETRIC case, and the only one that separates the two halves.
    // Every other case here moves both queries together, so a status
    // combining them passes all of them — measured: reverting to
    // `brandingPending || workspacePending` left the rest of this file green.
    //
    // Its reader draws a conclusion from a plugin being absent, so holding it
    // on a loading state while the plugin list has arrived hides a settled
    // answer behind a request that has nothing to do with the question.
    get.mockReturnValue(new Promise(() => {}));
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
 * The product's name is one decision, so it has one implementation. A screen
 * that spelled `branding.logoText ?? "Nextly"` for itself could disagree with
 * the component beside it — the signed-out card supplies the logo's label
 * while the screen supplies the sentence under it.
 */
describe("useAppName", () => {
  /**
   * Reports the arrival of the response beside the name it produced.
   *
   * Waiting on the NAME alone cannot test a fallback: "Nextly" is also what
   * renders before the request answers, so `waitFor` succeeds on the very
   * first check and the assertion never sees the response at all. Measured —
   * both fallback cases below passed with the guard removed until this probe
   * made arrival observable.
   */
  function NameProbe() {
    const { isPending } = useBrandingStatus();
    return (
      <>
        <span data-testid="name">{useAppName()}</span>
        <span data-testid="arrived">{isPending ? "no" : "yes"}</span>
      </>
    );
  }

  function renderName(client: QueryClient) {
    return render(
      <QueryClientProvider client={client}>
        <BrandingProvider>
          <NameProbe />
        </BrandingProvider>
      </QueryClientProvider>
    );
  }

  /** The response has landed, so what the name reads is about the response. */
  async function arrived() {
    await waitFor(() =>
      expect(screen.getByTestId("arrived").textContent).toBe("yes")
    );
  }

  it("uses the configured name", async () => {
    get.mockResolvedValue({ logoText: "Acme Docs" } as AdminBranding);
    protectedGet.mockResolvedValue({ plugins: [] } as AdminBranding);

    renderName(
      new QueryClient({ defaultOptions: { queries: { retry: false } } })
    );

    await arrived();
    expect(screen.getByTestId("name").textContent).toBe("Acme Docs");
  });

  // A project that clears the field in Settings sends "", which `??` would let
  // through — leaving the sign-in line reading "Sign in to your  account" and
  // the logo with an empty accessible name.
  it("treats a blank configured name as unset", async () => {
    get.mockResolvedValue({ logoText: "   " } as AdminBranding);
    protectedGet.mockResolvedValue({ plugins: [] } as AdminBranding);

    renderName(
      new QueryClient({ defaultOptions: { queries: { retry: false } } })
    );

    await arrived();
    expect(screen.getByTestId("name").textContent).toBe("Nextly");
  });

  it("falls back to Nextly when branding names nothing", async () => {
    get.mockResolvedValue({} as AdminBranding);
    protectedGet.mockResolvedValue({ plugins: [] } as AdminBranding);

    renderName(
      new QueryClient({ defaultOptions: { queries: { retry: false } } })
    );

    await arrived();
    expect(screen.getByTestId("name").textContent).toBe("Nextly");
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
