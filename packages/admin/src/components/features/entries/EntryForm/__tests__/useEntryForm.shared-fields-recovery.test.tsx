/**
 * What the entry form gives the recovery from a publish refused over shared
 * values someone else published since.
 *
 * The recovery saves the pending change and then takes the live values into
 * it. What it saves has to be the form as it is when the action is taken,
 * since the author may have kept editing. And once the live values are taken
 * the form has to show them: the reloaded entry has the same identity as the
 * one on screen, so an ordinary reset keeps the author's unsaved value for the
 * field, the stale one, and the next Publish would send it and put the old
 * value back live.
 */
import { renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { act } from "@admin/__tests__/utils";
import type { RefusedForm } from "@admin/hooks/useSharedFieldsRecovery";

const { update, updateOptions } = vi.hoisted(() => ({
  update: vi.fn(),
  updateOptions: {
    current: undefined as { refusedForm?: RefusedForm } | undefined,
  },
}));

vi.mock("@admin/hooks/queries/useCreateEntry", () => ({
  useCreateEntry: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));
vi.mock("@admin/hooks/queries/useUpdateEntry", () => ({
  useUpdateEntry: (options: { refusedForm?: RefusedForm }) => {
    updateOptions.current = options;
    return { mutateAsync: update, isPending: false };
  },
}));
vi.mock("@admin/hooks/queries/useDeleteEntry", () => ({
  useDeleteEntry: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));
vi.mock("@admin/hooks/queries/useDiscardWorkingDraft", () => ({
  useDiscardWorkingDraft: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

import { useEntryForm } from "../useEntryForm";

const collection = {
  name: "authors",
  label: "Authors",
  fields: [
    { name: "nickname", type: "text", label: "Nickname" },
    { name: "bio", type: "text", label: "Bio" },
  ],
} as never;
const stored = {
  id: "e1",
  nickname: "Ada",
  bio: "Wrote things",
  updatedAt: "2026-10-22T09:00:00.000Z",
};

afterEach(() => {
  update.mockReset();
  updateOptions.current = undefined;
});

function render() {
  return renderHook(
    ({ entry }: { entry: Record<string, unknown> }) =>
      useEntryForm({ collection, entry: entry as never, mode: "edit" }),
    { initialProps: { entry: stored } }
  );
}

describe("the entry form, for a publish refused over shared values", () => {
  it("gives the recovery its values as they are when the action is taken", async () => {
    const { result } = render();
    act(() => {
      result.current.form.setValue("nickname", "Ada L", { shouldDirty: true });
    });
    // Edited after the refusal, before the action is taken.
    act(() => {
      result.current.form.setValue("bio", "Typed after the refusal", {
        shouldDirty: true,
      });
    });

    const values = await updateOptions.current?.refusedForm?.pendingChangeNow();

    // A save of the pending change: no status, so nothing is published.
    expect(values).toEqual({
      nickname: "Ada L",
      bio: "Typed after the refusal",
    });
  });

  it("shows the live value of a taken field, keeps every other edit, and publishes the live value next", async () => {
    const { result, rerender } = render();
    // The refused publish carried a stale nickname; the bio is the author's own
    // unsaved edit, which the take leaves alone.
    act(() => {
      result.current.form.setValue("nickname", "Stale", { shouldDirty: true });
      result.current.form.setValue("bio", "Mine", { shouldDirty: true });
    });

    act(() => {
      updateOptions.current?.refusedForm?.adoptTaken(["nickname"]);
    });
    // The reloaded entry: the live nickname taken into the change, the same
    // entry identity as the one on screen.
    act(() => {
      rerender({ entry: { ...stored, nickname: "Live" } });
    });

    expect(result.current.form.getValues("nickname")).toBe("Live");
    expect(result.current.form.getValues("bio")).toBe("Mine");

    update.mockResolvedValue({ item: { ...stored, nickname: "Live" } });
    await act(async () => {
      await result.current.handleSubmit(undefined, "publish");
    });
    expect(update).toHaveBeenCalledWith({
      nickname: "Live",
      bio: "Mine",
      status: "published",
    });
  });
});
