/**
 * What a submission of the entry form tells its caller.
 *
 * The toasts and field messages tell the author; these pin what the CALLER
 * hears, which is what lets a save be followed by something that depends on
 * it. Each case is one a silently resolving submission would also pass for the
 * author and fail for the caller: a refused save looks exactly like a stored one
 * when both resolve to nothing.
 */
import { renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { act } from "@admin/__tests__/utils";

const { create, update } = vi.hoisted(() => ({
  create: vi.fn(),
  update: vi.fn(),
}));

vi.mock("@admin/hooks/queries/useCreateEntry", () => ({
  useCreateEntry: () => ({ mutateAsync: create, isPending: false }),
}));
vi.mock("@admin/hooks/queries/useUpdateEntry", () => ({
  useUpdateEntry: () => ({ mutateAsync: update, isPending: false }),
}));
// Whether the read asks translation state, which the save keys its cache on.
vi.mock("@admin/hooks/useCanRequest", () => ({
  useAsksTranslationStatus: () => false,
}));
vi.mock("@admin/hooks/queries/useDeleteEntry", () => ({
  useDeleteEntry: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));
vi.mock("@admin/hooks/queries/useDiscardWorkingDraft", () => ({
  useDiscardWorkingDraft: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

import { useEntryForm } from "../useEntryForm";

const collection = {
  name: "pages",
  label: "Pages",
  fields: [{ name: "title", type: "text", label: "Title", required: true }],
} as never;
const entry = { id: "e1", title: "Hello" };

afterEach(() => {
  create.mockReset();
  update.mockReset();
});

describe("useEntryForm handleSubmit outcome", () => {
  it("resolves to the saved row when the update lands", async () => {
    update.mockResolvedValue({ item: { id: "e1", title: "Hello" } });
    const { result } = renderHook(() =>
      useEntryForm({ collection, entry, mode: "edit" })
    );

    let outcome: unknown;
    await act(async () => {
      outcome = await result.current.handleSubmit();
    });

    expect(update).toHaveBeenCalledTimes(1);
    expect(outcome).toEqual({ ok: true, item: { id: "e1", title: "Hello" } });
  });

  it("resolves to the created row, whose id the caller has no other way to learn", async () => {
    create.mockResolvedValue({ item: { id: "new-1", title: "Fresh" } });
    const { result } = renderHook(() =>
      useEntryForm({ collection, mode: "create" })
    );
    act(() => {
      result.current.form.setValue("title", "Fresh");
    });

    let outcome: unknown;
    await act(async () => {
      outcome = await result.current.handleSubmit();
    });

    expect(outcome).toEqual({
      ok: true,
      item: { id: "new-1", title: "Fresh" },
    });
  });

  it("names a refused request as failed, with the server's own words", async () => {
    update.mockRejectedValue(new Error("The slug is taken."));
    const onError = vi.fn();
    const { result } = renderHook(() =>
      useEntryForm({ collection, entry, mode: "edit", onError })
    );

    let outcome: unknown;
    await act(async () => {
      outcome = await result.current.handleSubmit();
    });

    // The author is still told as before; the caller now is too.
    expect(onError).toHaveBeenCalledTimes(1);
    expect(outcome).toEqual({
      ok: false,
      reason: "failed",
      message: "The slug is taken.",
    });
  });

  it("names a form validation refused as invalid, and sends nothing", async () => {
    const { result } = renderHook(() =>
      useEntryForm({ collection, mode: "create" })
    );

    let outcome: unknown;
    await act(async () => {
      outcome = await result.current.handleSubmit();
    });

    expect(create).not.toHaveBeenCalled();
    expect(outcome).toMatchObject({ ok: false, reason: "invalid" });
  });

  it("names a second submission in the same turn as busy, and writes once", async () => {
    let land: (value: unknown) => void = () => {};
    update.mockReturnValue(
      new Promise(resolve => {
        land = resolve;
      })
    );
    const { result } = renderHook(() =>
      useEntryForm({ collection, entry, mode: "edit" })
    );

    let first: Promise<unknown> = Promise.resolve();
    let second: unknown;
    await act(async () => {
      first = result.current.handleSubmit();
      second = await result.current.handleSubmit();
      land({ item: { id: "e1", title: "Hello" } });
      await first;
    });

    expect(update).toHaveBeenCalledTimes(1);
    expect(second).toMatchObject({ ok: false, reason: "busy" });
    await expect(first).resolves.toMatchObject({ ok: true });
  });
});
