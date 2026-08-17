/**
 * When a recovery point is worth offering back, and when it is not.
 *
 * The rule decides between two unequal errors, so the tests are written around
 * that asymmetry rather than around the happy path: a spurious offer costs one
 * dismissal, while a suppressed offer loses work that was recorded specifically
 * so it could not be lost.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";

const { getSpy } = vi.hoisted(() => ({ getSpy: vi.fn() }));

vi.mock("@admin/services/versionApi", () => ({
  versionApi: { getAutosave: getSpy },
}));

import { useAutosaveRecovery } from "../useAutosaveRecovery";

const SCOPE = { kind: "collection" as const, slug: "posts", entryId: "e1" };

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("useAutosaveRecovery", () => {
  it("offers a recovery point newer than the saved document", async () => {
    getSpy.mockResolvedValue({
      snapshot: { title: "recovered" },
      updatedAt: "2026-08-17T10:00:00.000Z",
      locale: null,
    });

    const { result } = renderHook(
      () =>
        useAutosaveRecovery({
          scope: SCOPE,
          documentUpdatedAt: "2026-08-17T09:00:00.000Z",
        }),
      { wrapper }
    );

    await waitFor(() => expect(result.current.offer).not.toBeNull());
    expect(result.current.offer?.snapshot).toEqual({ title: "recovered" });
    expect(result.current.offer?.savedAt).toEqual(
      new Date("2026-08-17T10:00:00.000Z")
    );
  });

  /**
   * A save AFTER the recovery point means the author already committed that
   * work. Offering it back would invite them to restore what they are looking
   * at, and worse, it would present a real document as though it were at risk.
   */
  it("stays silent when the document was saved after the recovery point", async () => {
    getSpy.mockResolvedValue({
      snapshot: { title: "stale" },
      updatedAt: "2026-08-17T09:00:00.000Z",
      locale: null,
    });

    const { result } = renderHook(
      () =>
        useAutosaveRecovery({
          scope: SCOPE,
          documentUpdatedAt: "2026-08-17T10:00:00.000Z",
        }),
      { wrapper }
    );

    // Waits for the ANSWER, not merely for the request. Asserting on
    // `offer === null` before the read returns is satisfied by the result not
    // having arrived, which passes whether or not the rule under test exists.
    await waitFor(() => expect(result.current.isResolved).toBe(true));
    expect(result.current.offer).toBeNull();
  });

  /**
   * The asymmetry, made explicit. With no document timestamp the rule cannot
   * tell whether the recovery point is ahead, and it offers anyway: one
   * dismissal is a smaller cost than silently withholding recorded work.
   */
  it("offers anyway when the document's own timestamp is unknown", async () => {
    getSpy.mockResolvedValue({
      snapshot: { title: "maybe newer" },
      updatedAt: "2026-08-17T09:00:00.000Z",
      locale: null,
    });

    const { result } = renderHook(
      () => useAutosaveRecovery({ scope: SCOPE, documentUpdatedAt: null }),
      { wrapper }
    );

    await waitFor(() => expect(result.current.offer).not.toBeNull());
  });

  it("stays silent when the author has no recovery point", async () => {
    getSpy.mockResolvedValue(null);

    const { result } = renderHook(() => useAutosaveRecovery({ scope: SCOPE }), {
      wrapper,
    });

    // Waits for the ANSWER, not merely for the request. Asserting on
    // `offer === null` before the read returns is satisfied by the result not
    // having arrived, which passes whether or not the rule under test exists.
    await waitFor(() => expect(result.current.isResolved).toBe(true));
    expect(result.current.offer).toBeNull();
  });

  /**
   * A document with no address cannot be asked about. Reading anyway would put
   * a request on the wire for a route that cannot resolve, on every new-entry
   * editor open.
   */
  it("asks nothing while the document has no address", async () => {
    const { result } = renderHook(() => useAutosaveRecovery({ scope: null }), {
      wrapper,
    });

    expect(result.current.offer).toBeNull();
    expect(getSpy).not.toHaveBeenCalled();
  });

  /**
   * Dismissing is "not now", not "delete". A reader who dismisses and then
   * reloads must still be offered the work rather than finding it gone because
   * they closed a banner.
   */
  it("stops offering once dismissed, without discarding anything", async () => {
    getSpy.mockResolvedValue({
      snapshot: { title: "recovered" },
      updatedAt: "2026-08-17T10:00:00.000Z",
      locale: null,
    });

    const { result } = renderHook(() => useAutosaveRecovery({ scope: SCOPE }), {
      wrapper,
    });
    await waitFor(() => expect(result.current.offer).not.toBeNull());

    result.current.dismiss();

    await waitFor(() => expect(result.current.offer).toBeNull());
    // No delete call exists on the mocked surface, so a dismissal that tried to
    // discard would fail loudly rather than silently destroying the row.
    expect(getSpy).toHaveBeenCalledTimes(1);
  });
});
