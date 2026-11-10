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
import { useLayoutEffect, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { useForm } from "react-hook-form";
import { describe, it, expect, vi, beforeEach } from "vitest";

import type { VersionScope } from "@admin/services/versionApi";

const { getSpy } = vi.hoisted(() => ({ getSpy: vi.fn() }));

vi.mock("@admin/services/versionApi", () => ({
  versionApi: { getAutosave: getSpy },
}));

/** The account signed in to this tab, which a test may change. */
const signedIn = vi.hoisted(() => ({ id: "author-1" as string | null }));
// The site's default language, which the editor spells as no language on
// its canonical address and as "en" under `?locale=en`.
vi.mock("@admin/hooks/useLocalization", () => ({
  useLocalization: () => ({ defaultLocale: "en", locales: [], enabled: true }),
}));
vi.mock("@admin/hooks/useCurrentUserId", () => ({
  useCurrentUserId: () => signedIn.id,
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
function useRecoveryHarness(
  scope: VersionScope | null,
  stored: Record<string, unknown> = STORED,
  locale: string | null = null
) {
  const form = useForm<Record<string, unknown>>({ defaultValues: stored });
  const recovery = useAutosaveRecovery({ scope, form, locale });
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

function renderRecovery(
  scope: VersionScope | null,
  stored?: Record<string, unknown>,
  locale?: string | null
) {
  return renderHook(() => useRecoveryHarness(scope, stored, locale), {
    wrapper,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  // "Not now" is remembered for the tab; each test starts a fresh tab.
  window.sessionStorage.clear();
  signedIn.id = "author-1";
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
  it("offers nothing for a recovery point that holds what the document stores", async () => {
    // An author who undid back to the saved document left this behind; the
    // test above, with a different title, is the offer this one withholds.
    getSpy.mockResolvedValue({
      snapshot: { ...STORED },
      updatedAt: "2026-08-17T10:00:00.000Z",
      locale: null,
    });

    const { result } = renderRecovery(SCOPE);

    await waitFor(() => expect(result.current.recovery.isResolved).toBe(true));
    expect(result.current.recovery.offer).toBeNull();
  });

  it("keeps a put-off recovery point put off across a reload in this tab, and offers a newer one", async () => {
    const point = (updatedAt: string) => ({
      snapshot: { title: "recovered" },
      updatedAt,
      locale: null,
    });
    getSpy.mockResolvedValue(point("2026-08-17T10:00:00.000Z"));
    const first = renderRecovery(SCOPE);
    await waitFor(() =>
      expect(first.result.current.recovery.offer).not.toBeNull()
    );
    act(() => first.result.current.recovery.dismiss());
    first.unmount();

    // The editor loaded again: the same recovery point stays put off.
    const again = renderRecovery(SCOPE);
    await waitFor(() =>
      expect(again.result.current.recovery.isResolved).toBe(true)
    );
    expect(again.result.current.recovery.offer).toBeNull();
    again.unmount();

    // Edits made since recorded a newer one, which is offered.
    getSpy.mockResolvedValue(point("2026-08-17T11:00:00.000Z"));
    const newer = renderRecovery(SCOPE);
    await waitFor(() =>
      expect(newer.result.current.recovery.offer).not.toBeNull()
    );
  });

  it("offers a point rewritten in the same second with newer work, after the earlier one was put off", async () => {
    // SQLite stores the time to the second: the time alone cannot tell the
    // two points apart, and the newer work must not be hidden.
    const at = "2026-08-17T10:00:00.000Z";
    getSpy.mockResolvedValue({
      snapshot: { title: "first" },
      updatedAt: at,
      locale: null,
    });
    const first = renderRecovery(SCOPE);
    await waitFor(() =>
      expect(first.result.current.recovery.offer).not.toBeNull()
    );
    act(() => first.result.current.recovery.dismiss());
    first.unmount();

    getSpy.mockResolvedValue({
      snapshot: { title: "second" },
      updatedAt: at,
      locale: null,
    });
    const again = renderRecovery(SCOPE);
    await waitFor(() =>
      expect(again.result.current.recovery.offer).not.toBeNull()
    );
  });

  it("offers a point lacking a field, whether withheld or deleted, rather than risk hiding work", async () => {
    // A point the server stripped of a password is still offered: passing over
    // a missing key would also pass over a JSON property an edit deleted.
    getSpy.mockResolvedValue({
      snapshot: { ...STORED, meta: { a: 1 } },
      updatedAt: "2026-08-17T10:00:00.000Z",
      locale: null,
    });
    const deleted = renderRecovery(SCOPE, { ...STORED, meta: { a: 1, b: 2 } });
    await waitFor(() =>
      expect(deleted.result.current.recovery.offer).not.toBeNull()
    );
    deleted.unmount();

    getSpy.mockResolvedValue({
      snapshot: { ...STORED },
      updatedAt: "2026-08-17T10:00:00.000Z",
      locale: null,
    });
    const withheld = renderRecovery(SCOPE, { ...STORED, secret: "" });
    await waitFor(() =>
      expect(withheld.result.current.recovery.offer).not.toBeNull()
    );
  });

  // A recovery point belongs to the language it was recorded in: restored
  // into another language's form, it would put one language's text in
  // another's fields. The plausible broken implementation offers the one
  // point the author has wherever the editor stands.
  it("offers a point only in the language it was recorded in", async () => {
    getSpy.mockResolvedValue({
      snapshot: { ...STORED, title: "French work" },
      updatedAt: "2026-08-17T10:00:00.000Z",
      locale: "fr",
    });
    const other = renderRecovery(SCOPE, STORED, "en");
    await waitFor(() =>
      expect(other.result.current.recovery.isResolved).toBe(true)
    );
    expect(other.result.current.recovery.offer).toBeNull();
    other.unmount();

    const same = renderRecovery(SCOPE, STORED, "fr");
    await waitFor(() =>
      expect(same.result.current.recovery.offer).not.toBeNull()
    );
    expect(same.result.current.recovery.offer?.snapshot).toMatchObject({
      title: "French work",
    });
  });

  // The default language has two spellings, no language on the canonical
  // address and its code under `?locale=en`, and a point recorded under one
  // is offered under the other. The plausible broken implementation compares
  // the spellings and withholds the work.
  it("offers a point recorded in the default language under either spelling of it", async () => {
    getSpy.mockResolvedValue({
      snapshot: { ...STORED, title: "default work" },
      updatedAt: "2026-08-17T10:00:00.000Z",
      locale: "en",
    });
    const canonical = renderRecovery(SCOPE, STORED, null);
    await waitFor(() =>
      expect(canonical.result.current.recovery.offer).not.toBeNull()
    );
    canonical.unmount();

    getSpy.mockResolvedValue({
      snapshot: { ...STORED, title: "default work" },
      updatedAt: "2026-08-17T10:00:00.000Z",
      locale: null,
    });
    const named = renderRecovery(SCOPE, STORED, "en");
    await waitFor(() =>
      expect(named.result.current.recovery.offer).not.toBeNull()
    );
  });

  it("offers a point in another language stored in the same second with the same values, after one was put off", async () => {
    const at = "2026-08-17T10:00:00.000Z";
    getSpy.mockResolvedValue({
      snapshot: { title: "same" },
      updatedAt: at,
      locale: "en",
    });
    const first = renderRecovery(SCOPE, undefined, "en");
    await waitFor(() =>
      expect(first.result.current.recovery.offer).not.toBeNull()
    );
    act(() => first.result.current.recovery.dismiss());
    first.unmount();

    getSpy.mockResolvedValue({
      snapshot: { title: "same" },
      updatedAt: at,
      locale: "fr",
    });
    const other = renderRecovery(SCOPE, undefined, "fr");
    await waitFor(() =>
      expect(other.result.current.recovery.offer).not.toBeNull()
    );
  });

  it("offers another account signed in to the same tab its own point, despite one put off", async () => {
    // Recovery points are each author's own, and so is a "Not now".
    getSpy.mockResolvedValue({
      snapshot: { title: "recovered" },
      updatedAt: "2026-08-17T10:00:00.000Z",
      locale: null,
    });
    const first = renderRecovery(SCOPE);
    await waitFor(() =>
      expect(first.result.current.recovery.offer).not.toBeNull()
    );
    act(() => first.result.current.recovery.dismiss());
    first.unmount();

    signedIn.id = "author-2";
    const other = renderRecovery(SCOPE);
    await waitFor(() =>
      expect(other.result.current.recovery.offer).not.toBeNull()
    );
  });

  it("keeps a Not now pressed before the account is known, once it is", async () => {
    // The recovery read can answer before the signed-in account does: the
    // put-off waits for it rather than being stored under no one.
    getSpy.mockResolvedValue({
      snapshot: { title: "recovered" },
      updatedAt: "2026-08-17T10:00:00.000Z",
      locale: null,
    });
    signedIn.id = null;
    const first = renderRecovery(SCOPE);
    await waitFor(() =>
      expect(first.result.current.recovery.offer).not.toBeNull()
    );
    act(() => first.result.current.recovery.dismiss());
    signedIn.id = "author-1";
    first.rerender();
    first.unmount();

    // The editor loaded again, the account known from the start.
    const again = renderRecovery(SCOPE);
    await waitFor(() =>
      expect(again.result.current.recovery.isResolved).toBe(true)
    );
    expect(again.result.current.recovery.offer).toBeNull();
  });

  it("keeps a Not now held for the account with the document it was pressed on", async () => {
    // The editor can move to another document before the account is known:
    // the put-off belongs to the first, and must not land on the second.
    const OTHER = { ...SCOPE, entryId: "e2" };
    getSpy.mockResolvedValue({
      snapshot: { title: "recovered" },
      updatedAt: "2026-08-17T10:00:00.000Z",
      locale: null,
    });
    signedIn.id = null;
    const moving = renderHook(
      ({ scope }: { scope: VersionScope }) => useRecoveryHarness(scope),
      { wrapper, initialProps: { scope: SCOPE as VersionScope } }
    );
    await waitFor(() =>
      expect(moving.result.current.recovery.offer).not.toBeNull()
    );
    act(() => moving.result.current.recovery.dismiss());
    moving.rerender({ scope: OTHER });
    signedIn.id = "author-1";
    moving.rerender({ scope: OTHER });
    moving.unmount();

    const first = renderRecovery(SCOPE);
    await waitFor(() =>
      expect(first.result.current.recovery.isResolved).toBe(true)
    );
    expect(first.result.current.recovery.offer).toBeNull();
    first.unmount();

    const second = renderRecovery(OTHER);
    await waitFor(() =>
      expect(second.result.current.recovery.offer).not.toBeNull()
    );
  });

  it("keeps a held Not now while the account is still unknown, across a move and back", async () => {
    const OTHER = { ...SCOPE, entryId: "e2" };
    getSpy.mockResolvedValue({
      snapshot: { title: "recovered" },
      updatedAt: "2026-08-17T10:00:00.000Z",
      locale: null,
    });
    signedIn.id = null;
    const moving = renderHook(
      ({ scope }: { scope: VersionScope }) => useRecoveryHarness(scope),
      { wrapper, initialProps: { scope: SCOPE as VersionScope } }
    );
    await waitFor(() =>
      expect(moving.result.current.recovery.offer).not.toBeNull()
    );
    act(() => moving.result.current.recovery.dismiss());
    moving.rerender({ scope: OTHER });
    moving.rerender({ scope: SCOPE });

    await waitFor(() =>
      expect(moving.result.current.recovery.isResolved).toBe(true)
    );
    expect(moving.result.current.recovery.offer).toBeNull();
  });

  it("keeps a Not now pressed before the account is known across a reload", async () => {
    getSpy.mockResolvedValue({
      snapshot: { title: "recovered" },
      updatedAt: "2026-08-17T10:00:00.000Z",
      locale: null,
    });
    signedIn.id = null;
    const first = renderRecovery(SCOPE);
    await waitFor(() =>
      expect(first.result.current.recovery.offer).not.toBeNull()
    );
    act(() => first.result.current.recovery.dismiss());
    // Reloaded before the account answered.
    first.unmount();

    signedIn.id = "author-1";
    const again = renderRecovery(SCOPE);
    await waitFor(() =>
      expect(again.result.current.recovery.isResolved).toBe(true)
    );
    expect(again.result.current.recovery.offer).toBeNull();
  });

  it("keeps every Not now pressed before the account is known, not only the last", async () => {
    const OTHER = { ...SCOPE, entryId: "e2" };
    getSpy.mockResolvedValue({
      snapshot: { title: "recovered" },
      updatedAt: "2026-08-17T10:00:00.000Z",
      locale: null,
    });
    signedIn.id = null;
    for (const scope of [SCOPE, OTHER]) {
      const one = renderRecovery(scope);
      await waitFor(() =>
        expect(one.result.current.recovery.offer).not.toBeNull()
      );
      act(() => one.result.current.recovery.dismiss());
      one.unmount();
    }

    signedIn.id = "author-1";
    for (const scope of [SCOPE, OTHER]) {
      const back = renderRecovery(scope);
      await waitFor(() =>
        expect(back.result.current.recovery.isResolved).toBe(true)
      );
      expect(back.result.current.recovery.offer).toBeNull();
      back.unmount();
    }
  });

  it("offers every point from an older version as such, the author's own writes included", async () => {
    const point = (superseded?: "by-you" | "by-another" | "unknown") => ({
      snapshot: { title: "recovered" },
      updatedAt: "2026-08-17T10:00:00.000Z",
      locale: null,
      ...(superseded === undefined ? {} : { superseded }),
    });

    // The author's own, anyone else's, or no one the server can name: offered,
    // and said to be older. The author's own is not withheld: a write of
    // theirs that left the point in place, such as publishing every language,
    // did not store it, so it is the only copy of that work.
    for (const superseded of ["by-you", "by-another", "unknown"] as const) {
      getSpy.mockResolvedValue(point(superseded));
      const other = renderRecovery(SCOPE);
      await waitFor(() =>
        expect(other.result.current.recovery.offer).not.toBeNull()
      );
      expect(other.result.current.recovery.offer?.olderVersion).toBe(true);
      other.unmount();
    }

    // Current: offered as it always was.
    getSpy.mockResolvedValue(point());
    const current = renderRecovery(SCOPE);
    await waitFor(() =>
      expect(current.result.current.recovery.offer).not.toBeNull()
    );
    expect(current.result.current.recovery.offer?.olderVersion).toBe(false);
  });

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

describe("after a save", () => {
  it("offers no recovery point from before it", async () => {
    getSpy.mockResolvedValue({
      updatedAt: "2026-10-20T10:00:00.000Z",
      snapshot: { title: "recovered" },
    });
    const { result, rerender } = renderHook(
      ({ savedCount }: { savedCount: number }) => {
        const form = useForm<Record<string, unknown>>({
          defaultValues: STORED,
        });
        return useAutosaveRecovery({ scope: SCOPE, form, savedCount });
      },
      { wrapper, initialProps: { savedCount: 0 } }
    );
    await waitFor(() => expect(result.current.offer).not.toBeNull());

    // A save lands: the server has deleted the point this offer reads.
    rerender({ savedCount: 1 });

    expect(result.current.offer).toBeNull();
  });

  it("offers the next document's recovery point when the editor moves to it", async () => {
    getSpy.mockResolvedValue({
      updatedAt: "2026-10-20T10:00:00.000Z",
      snapshot: { title: "recovered" },
    });
    const { result, rerender } = renderHook(
      ({ entryId, savedCount }: { entryId: string; savedCount: number }) => {
        const form = useForm<Record<string, unknown>>({
          defaultValues: STORED,
        });
        return useAutosaveRecovery({
          scope: { ...SCOPE, entryId },
          form,
          savedCount,
        });
      },
      { wrapper, initialProps: { entryId: "e1", savedCount: 0 } }
    );
    await waitFor(() => expect(result.current.offer).not.toBeNull());
    rerender({ entryId: "e1", savedCount: 1 });
    expect(result.current.offer).toBeNull();

    // The same editor opens another entry, which has a point of its own.
    rerender({ entryId: "e2", savedCount: 1 });

    await waitFor(() => expect(result.current.offer).not.toBeNull());
  });

  describe("a current offer is asked about again before it is restored", () => {
    const CURRENT = {
      snapshot: { title: "recovered" },
      updatedAt: "2026-08-17T10:00:00.000Z",
      locale: null,
    };

    it("shows it as older instead, when the document was written since", async () => {
      // Read once when the editor opened; a write since then, here or in
      // another tab, made it an older version.
      getSpy
        .mockResolvedValueOnce(CURRENT)
        .mockResolvedValueOnce({ ...CURRENT, superseded: "by-another" });
      const { result } = renderRecovery(SCOPE);
      await waitFor(() =>
        expect(result.current.recovery.offer?.olderVersion).toBe(false)
      );

      act(() => result.current.recovery.restore());

      await waitFor(() =>
        expect(result.current.recovery.offer?.olderVersion).toBe(true)
      );
      expect(result.current.form.getValues()).toEqual(STORED);

      // Asked again with the warning in front of them: taken, unasked.
      act(() => result.current.recovery.restore());
      await waitFor(() =>
        expect(result.current.form.getValues()).toEqual({ title: "recovered" })
      );
      expect(getSpy).toHaveBeenCalledTimes(2);
    });

    it("withdraws it when the point is gone", async () => {
      getSpy.mockResolvedValueOnce(CURRENT).mockResolvedValueOnce(null);
      const { result } = renderRecovery(SCOPE);
      await waitFor(() => expect(result.current.recovery.offer).not.toBeNull());

      act(() => result.current.recovery.restore());

      await waitFor(() => expect(result.current.recovery.offer).toBeNull());
      expect(result.current.form.getValues()).toEqual(STORED);
    });

    it("runs a caller's own restore steps only once the offer is confirmed", async () => {
      // A view's steps change what it shows; run before the answer, they
      // would act on an offer that is then refused.
      getSpy
        .mockResolvedValueOnce(CURRENT)
        .mockResolvedValueOnce({ ...CURRENT, superseded: "by-another" });
      const { result } = renderRecovery(SCOPE);
      await waitFor(() => expect(result.current.recovery.offer).not.toBeNull());
      const apply = vi.fn();

      act(() => result.current.recovery.restore(apply));
      await waitFor(() =>
        expect(result.current.recovery.offer?.olderVersion).toBe(true)
      );
      expect(apply).not.toHaveBeenCalled();

      // Now shown as older: confirmed without asking, so the steps run.
      act(() => result.current.recovery.restore(apply));
      await waitFor(() => expect(apply).toHaveBeenCalledTimes(1));
      // In place of the take: the caller's steps write the form themselves.
      expect(result.current.form.getValues()).toEqual(STORED);
    });

    it("draws the offer again from a point rewritten since, rather than restoring the old one", async () => {
      // Another tab of the same author recorded newer work into the point.
      getSpy.mockResolvedValueOnce(CURRENT).mockResolvedValueOnce({
        ...CURRENT,
        snapshot: { title: "newer" },
        updatedAt: "2026-08-17T10:05:00.000Z",
      });
      const { result } = renderRecovery(SCOPE);
      await waitFor(() => expect(result.current.recovery.offer).not.toBeNull());

      act(() => result.current.recovery.restore());

      await waitFor(() =>
        expect(result.current.recovery.offer?.snapshot).toEqual({
          title: "newer",
        })
      );
      expect(result.current.form.getValues()).toEqual(STORED);
    });

    it("restores nothing when it cannot be asked about again", async () => {
      // Unchecked, it may be an older version shown without its warning.
      getSpy
        .mockResolvedValueOnce(CURRENT)
        .mockRejectedValueOnce(new Error("network"));
      const { result } = renderRecovery(SCOPE);
      await waitFor(() => expect(result.current.recovery.offer).not.toBeNull());

      act(() => result.current.recovery.restore());

      await waitFor(() => expect(getSpy).toHaveBeenCalledTimes(2));
      await act(async () => {
        await Promise.resolve();
      });
      expect(result.current.form.getValues()).toEqual(STORED);
      // Still on offer, to be chosen again.
      expect(result.current.recovery.offer?.snapshot).toEqual(CURRENT.snapshot);
    });

    // The re-read takes a round trip, and the author may switch language
    // meanwhile. The answer then belongs to the language the restore was asked
    // in, and written now it would put French work in the English fields.
    // The re-read takes a round trip, and the author may switch language
    // meanwhile. The answer then belongs to the language the restore was
    // asked in: written now, it would put French work in the English fields.
    //
    // The answer here arrives in the narrowest gap there is: after the switch
    // has committed and before its passive effects run. A layout effect on the
    // new language releases it, and the switch renders outside `act`, which
    // would otherwise flush passive effects before any promise settles. So a
    // guard that learns the language from a passive effect still holds the
    // old one when the answer is read, as it can in a browser.
    it("restores nothing when the editor switched language before the answer, even before its effects ran", async () => {
      const french = { ...CURRENT, locale: "fr" };
      let answer: (point: typeof french) => void = () => {};
      getSpy.mockResolvedValueOnce(french).mockReturnValueOnce(
        new Promise(resolve => {
          answer = resolve;
        })
      );
      const seen: { current?: ReturnType<typeof useRecoveryHarness> } = {};
      function Editor({ locale }: { locale: string }) {
        const harness = useRecoveryHarness(SCOPE, STORED, locale);
        seen.current = harness;
        useLayoutEffect(() => {
          if (locale === "en") answer(french);
        }, [locale]);
        return null;
      }
      // One client for both renders, so the switch keeps the read it made.
      const client = new QueryClient({
        defaultOptions: { queries: { retry: false } },
      });
      const editorIn = (locale: string) => (
        <QueryClientProvider client={client}>
          <Editor locale={locale} />
        </QueryClientProvider>
      );
      const root = createRoot(document.createElement("div"));
      act(() => root.render(editorIn("fr")));
      await waitFor(() => expect(seen.current?.recovery.offer).not.toBeNull());

      act(() => seen.current?.recovery.restore());
      await waitFor(() => expect(getSpy).toHaveBeenCalledTimes(2));

      const environment = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean };
      const wasActEnvironment = environment.IS_REACT_ACT_ENVIRONMENT;
      environment.IS_REACT_ACT_ENVIRONMENT = false;
      try {
        root.render(editorIn("en"));
        // Long enough for the render, its effects, and the answer to settle.
        await new Promise(resolve => setTimeout(resolve, 50));
      } finally {
        environment.IS_REACT_ACT_ENVIRONMENT = wasActEnvironment;
      }

      expect(seen.current?.form.getValues()).toEqual(STORED);
      act(() => root.unmount());
    });

    it("restores it when it is still current, which is the control", async () => {
      getSpy.mockResolvedValue(CURRENT);
      const { result } = renderRecovery(SCOPE);
      await waitFor(() => expect(result.current.recovery.offer).not.toBeNull());

      act(() => result.current.recovery.restore());

      await waitFor(() =>
        expect(result.current.form.getValues()).toEqual({ title: "recovered" })
      );
      expect(getSpy).toHaveBeenCalledTimes(2);
    });
  });
});
