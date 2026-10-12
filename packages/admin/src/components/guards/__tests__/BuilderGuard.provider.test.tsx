/**
 * The guard under the real branding provider, with only the network and the
 * session supplied.
 *
 * `BuilderGuard.test.tsx` hands the guard each state directly. These show that
 * the provider really produces those states: an answer that has not arrived
 * for each of its three reasons, and each of the two answers.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { AdminBranding } from "@admin/types/branding";

const get = vi.fn();
const protectedGet = vi.fn();
const session = vi.fn();
const navigateTo = vi.fn();

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

vi.mock("@admin/lib/navigation", () => ({
  navigateTo: (path: string) => navigateTo(path),
}));

import { BuilderGuard } from "@admin/components/guards/BuilderGuard";
import { BrandingProvider } from "@admin/context/providers/BrandingProvider";

/** Counts its renders, so a page shown for one frame and then replaced still counts. */
const builderRendered = vi.fn();
function Builder() {
  builderRendered();
  return <span>builder</span>;
}

function renderGuard() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <BrandingProvider>
        <BuilderGuard>
          <Builder />
        </BuilderGuard>
      </BrandingProvider>
    </QueryClientProvider>
  );
}

const SIGNED_IN = {
  data: { isSetup: true, isAuthenticated: true },
  isPending: false,
};

/** A workspace request the test answers when it chooses to. */
function heldWorkspace() {
  let answer: (value: AdminBranding) => void = () => {};
  protectedGet.mockReturnValue(
    new Promise<AdminBranding>(resolve => {
      answer = resolve;
    })
  );
  return (value: Partial<AdminBranding>) => answer(value as AdminBranding);
}

function pendingSlot(container: HTMLElement) {
  return container.querySelector('[data-slot="builder-guard-pending"]');
}

afterEach(() => {
  vi.clearAllMocks();
});

describe("BuilderGuard under the branding provider", () => {
  it("withholds the builder while the session is still resolving", () => {
    session.mockReturnValue({ data: undefined, isPending: true });
    get.mockResolvedValue({});

    const { container } = renderGuard();

    expect(pendingSlot(container)).not.toBeNull();
    expect(builderRendered).not.toHaveBeenCalled();
    // The request that carries the answer has not been allowed to start.
    expect(protectedGet).not.toHaveBeenCalled();
  });

  it("withholds the builder while the answer is in flight, then redirects on off", async () => {
    session.mockReturnValue(SIGNED_IN);
    get.mockResolvedValue({});
    const answer = heldWorkspace();

    const { container } = renderGuard();
    await waitFor(() => expect(protectedGet).toHaveBeenCalled());
    expect(pendingSlot(container)).not.toBeNull();
    expect(builderRendered).not.toHaveBeenCalled();

    answer({ showBuilder: false });

    await waitFor(() => expect(navigateTo).toHaveBeenCalledWith("/admin"));
    expect(builderRendered).not.toHaveBeenCalled();
  });

  it("shows the builder once the server answers that it is on", async () => {
    session.mockReturnValue(SIGNED_IN);
    get.mockResolvedValue({});
    const answer = heldWorkspace();

    renderGuard();
    await waitFor(() => expect(protectedGet).toHaveBeenCalled());
    expect(builderRendered).not.toHaveBeenCalled();

    answer({ showBuilder: true });

    expect(await screen.findByText("builder")).toBeInTheDocument();
    expect(navigateTo).not.toHaveBeenCalled();
  });

  it("says the builder could not be loaded when the request fails", async () => {
    session.mockReturnValue(SIGNED_IN);
    get.mockResolvedValue({});
    protectedGet.mockRejectedValue(new Error("network"));

    renderGuard();

    expect(
      await screen.findByRole("heading", {
        name: "The schema builder could not be loaded",
      })
    ).toBeInTheDocument();
    expect(builderRendered).not.toHaveBeenCalled();
    expect(navigateTo).not.toHaveBeenCalled();
  });
});
