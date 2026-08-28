/**
 * When a recovery point is worth offering back, and when it is not.
 *
 * The rule decides between two unequal errors, so the tests are written around
 * that asymmetry rather than around the happy path: a spurious offer costs one
 * dismissal, while a suppressed offer loses work that was recorded specifically
 * so it could not be lost.
 *
 * Accepting an offer is tested here too, because it is the same rule: the hook
 * owns HOW a recovery point is applied, so the entry and Single editors cannot
 * answer that differently from each other.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor, act } from "@testing-library/react";
import type { ReactNode } from "react";
import { useForm } from "react-hook-form";
import { describe, it, expect, vi, beforeEach } from "vitest";

import type { VersionScope } from "@admin/services/versionApi";

const { getSpy } = vi.hoisted(() => ({ getSpy: vi.fn() }));

vi.mock("@admin/services/versionApi", () => ({
  versionApi: { getAutosave: getSpy },
}));

import { useAutosaveRecovery } from "../useAutosaveRecovery";

const SCOPE = { kind: "collection" as const, slug: "posts", entryId: "e1" };

/** What the server holds, so a restore can be told apart from the baseline. */
const STORED = { title: "stored" };

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

/**
 * The hook against a real form, because the restore path is only meaningful
 * through one: a stubbed `reset` would let a test pass while the values never
 * reached the form, and `isDirty` is exactly the thing being asserted.
 */
function useRecoveryHarness(scope: VersionScope | null) {
  const form = useForm<Record<string, unknown>>({ defaultValues: STORED });
  const recovery = useAutosaveRecovery({ scope, form });
  /*
   * `isDirty` is READ DURING RENDER and returned, deliberately.
   *
   * react-hook-form tracks formState by which keys a render reads, so a test
   * that reaches for `form.formState.isDirty` after the fact can observe an
   * unsubscribed proxy and read false however dirty the form is — which would
   * let a restore that cleared the flag pass this suite. The same trap is
   * documented in `useDocumentAutosave.test.tsx`.
   */
  return { form, recovery, isDirty: form.formState.isDirty };
}

function renderRecovery(scope: VersionScope | null) {
  return renderHook(() => useRecoveryHarness(scope), { wrapper });
}

beforeEach(() => {
  vi.clearAllMocks();
});

/**
 * The tests that pinned a comparison against the document's own timestamp are
 * deliberately GONE rather than adapted. A real save now deletes the author's
 * recovery point, so a row existing at all means there is unsaved work and the
 * comparison no longer exists to test. Keeping them would have asserted a rule
 * the code does not have.
 */
describe("useAutosaveRecovery", () => {
  it("offers a recovery point newer than the saved document", async () => {
    getSpy.mockResolvedValue({
      snapshot: { title: "recovered" },
      updatedAt: "2026-08-17T10:00:00.000Z",
      locale: null,
    });

    const { result } = renderRecovery(SCOPE);

    await waitFor(() => expect(result.current.recovery.offer).not.toBeNull());
    expect(result.current.recovery.offer?.snapshot).toEqual({
      title: "recovered",
    });
    expect(result.current.recovery.offer?.savedAt).toEqual(
      new Date("2026-08-17T10:00:00.000Z")
    );
  });

  it("stays silent when the author has no recovery point", async () => {
    getSpy.mockResolvedValue(null);

    const { result } = renderRecovery(SCOPE);

    // Waits for the ANSWER, not merely for the request. Asserting on
    // `offer === null` before the read returns is satisfied by the result not
    // having arrived, which passes whether or not the rule under test exists.
    await waitFor(() => expect(result.current.recovery.isResolved).toBe(true));
    expect(result.current.recovery.offer).toBeNull();
  });

  /**
   * A document with no address cannot be asked about. Reading anyway would put
   * a request on the wire for a route that cannot resolve, on every new-entry
   * editor open.
   */
  it("asks nothing while the document has no address", async () => {
    const { result } = renderRecovery(null);

    expect(result.current.recovery.offer).toBeNull();
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

    const { result } = renderRecovery(SCOPE);
    await waitFor(() => expect(result.current.recovery.offer).not.toBeNull());

    act(() => result.current.recovery.dismiss());

    await waitFor(() => expect(result.current.recovery.offer).toBeNull());
    // No delete call exists on the mocked surface, so a dismissal that tried to
    // discard would fail loudly rather than silently destroying the row.
    expect(getSpy).toHaveBeenCalledTimes(1);
  });

  /**
   * Accepting writes the recovered values in AND leaves the form dirty.
   *
   * The dirty flag is the point rather than a detail: the recovered values are
   * not what the server holds, so a restore that reset the baseline would let
   * the unsaved-changes guard stay quiet and the author navigate away believing
   * the work was stored. Asserted on `isDirty` rather than on a spy, because a
   * spy records that `reset` was called and not what it did.
   */
  it("restores the offered values and leaves the form dirty", async () => {
    getSpy.mockResolvedValue({
      snapshot: { title: "recovered" },
      updatedAt: "2026-08-17T10:00:00.000Z",
      locale: null,
    });

    const { result } = renderRecovery(SCOPE);
    await waitFor(() => expect(result.current.recovery.offer).not.toBeNull());
    expect(result.current.form.getValues()).toEqual(STORED);

    act(() => result.current.recovery.restore());

    await waitFor(() =>
      expect(result.current.form.getValues()).toEqual({ title: "recovered" })
    );
    expect(result.current.isDirty).toBe(true);
    // Accepting also closes the offer: the banner has done its job and must not
    // keep asking about work the author has already taken back.
    expect(result.current.recovery.offer).toBeNull();
  });

  /**
   * Callers wire `restore` to a control they may render before the read has
   * come back, so it has to be safe to call with nothing on offer.
   */
  it("does nothing when restore is called with no offer", async () => {
    getSpy.mockResolvedValue(null);

    const { result } = renderRecovery(SCOPE);
    await waitFor(() => expect(result.current.recovery.isResolved).toBe(true));

    act(() => result.current.recovery.restore());

    expect(result.current.form.getValues()).toEqual(STORED);
    expect(result.current.isDirty).toBe(false);
  });
});
