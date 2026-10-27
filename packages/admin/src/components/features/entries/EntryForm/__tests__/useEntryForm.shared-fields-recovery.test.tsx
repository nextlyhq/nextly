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
import { useEffect } from "react";
import { flushSync } from "react-dom";
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

function render(options: { writesHeld?: () => boolean } = {}) {
  return renderHook(
    ({ entry, locale }: { entry: Record<string, unknown>; locale?: string }) =>
      useEntryForm({
        collection,
        entry: entry as never,
        mode: "edit",
        ...(locale === undefined ? {} : { locale }),
        ...options,
      }),
    {
      initialProps: { entry: stored } as {
        entry: Record<string, unknown>;
        locale?: string;
      },
    }
  );
}

/**
 * Hands the editor a reloaded entry the way React Query does once a refetch
 * settles: on a zero-delay timeout queued at that moment. Answers once the
 * editor has it, for an assertion to wait on.
 */
function reloadBrings(
  rerender: (props: { entry: Record<string, unknown> }) => void,
  entry: Record<string, unknown>
): Promise<void> {
  return new Promise(resolve => {
    setTimeout(() => {
      rerender({ entry });
      resolve();
    }, 0);
  });
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

  it("starts the form afresh from the reloaded entry, so it shows the live value and publishes it next", async () => {
    const { result, rerender } = render();
    // The refused publish carried a stale nickname; the bio is the author's
    // own edit. Both are in the pending change the recovery saves.
    act(() => {
      result.current.form.setValue("nickname", "Stale", { shouldDirty: true });
      result.current.form.setValue("bio", "Mine", { shouldDirty: true });
    });

    let reloaded: Promise<void> | undefined;
    await updateOptions.current?.refusedForm?.run(async () => {
      // The reloaded entry: the saved change with the live nickname taken
      // into it, at the same version, which an arriving entry alone would
      // treat as unsaved work to keep over.
      reloaded = reloadBrings(rerender, {
        ...stored,
        nickname: "Live",
        bio: "Mine",
      });
    });
    await reloaded;

    // The form is the reloaded entry, with nothing left unsaved.
    expect(result.current.form.getValues()).toMatchObject({
      nickname: "Live",
      bio: "Mine",
    });
    await vi.waitFor(() =>
      expect(result.current.form.formState.isDirty).toBe(false)
    );

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
  it("won't run the recovery while the host holds the document's writes", async () => {
    render({ writesHeld: () => true });
    const work = vi.fn(async () => undefined);

    await expect(
      updateOptions.current?.refusedForm?.run(work)
    ).rejects.toThrow();
    expect(work).not.toHaveBeenCalled();
  });

  it("won't run the recovery while a save is in flight", async () => {
    let finish: (value: unknown) => void = () => {};
    update.mockImplementation(
      () =>
        new Promise(resolve => {
          finish = resolve;
        })
    );
    const { result } = render();
    let saving: Promise<unknown> = Promise.resolve();
    act(() => {
      saving = result.current.handleSubmit(undefined, "save-working-draft");
    });
    await vi.waitFor(() => expect(update).toHaveBeenCalled());
    const work = vi.fn(async () => undefined);

    await expect(
      updateOptions.current?.refusedForm?.run(work)
    ).rejects.toThrow();
    expect(work).not.toHaveBeenCalled();

    await act(async () => {
      finish({ item: stored });
      await saving;
    });
  });

  it("holds the editor's saves and publishes while the recovery runs", async () => {
    const { result } = render();
    // Made before the recovery starts, which runs its work a task later.
    let done: () => void = () => {};
    const held = new Promise<void>(resolve => {
      done = resolve;
    });
    const running = updateOptions.current?.refusedForm?.run(() => held);

    let outcome: unknown;
    await act(async () => {
      outcome = await result.current.handleSubmit(undefined, "publish");
    });
    // A publish now would send the value the take is replacing.
    expect(outcome).toMatchObject({ ok: false, reason: "busy" });
    expect(update).not.toHaveBeenCalled();

    done();
    await running;
  });

  it("holds the form until the recovery's reloaded entry has reached it", async () => {
    const { result, rerender } = render();
    let heldWhenItArrived: boolean | undefined;
    let reloaded: Promise<void> | undefined;
    await updateOptions.current?.refusedForm?.run(async () => {
      // The reload settles, and the editor is handed the entry a task later,
      // as React Query does: the fields it takes must not be open to typing
      // until it is on screen.
      reloaded = reloadBrings(rerender, { ...stored, _isWorkingDraft: true });
      void reloaded.then(() => {
        heldWhenItArrived = result.current.recovering;
      });
    });
    await reloaded;

    expect(heldWhenItArrived).toBe(true);
    // And given back once it has.
    await vi.waitFor(() => expect(result.current.recovering).toBe(false));
  });

  it("reads the form once the hold is on screen, so what commits as it lands is saved", async () => {
    // A field that commits its work into the form as it goes read-only, as
    // an editor that commits on leaving does.
    const { result } = renderHook(() => {
      const editor = useEntryForm({
        collection,
        entry: stored as never,
        mode: "edit",
      });
      const { recovering, form } = editor;
      useEffect(() => {
        if (recovering) {
          form.setValue("bio", "Committed as the hold landed", {
            shouldDirty: true,
          });
        }
      }, [recovering, form]);
      return editor;
    });
    const refusedForm = updateOptions.current?.refusedForm;
    let read: Record<string, unknown> | undefined;
    let running: Promise<unknown> | undefined;
    // Rendered at once, as an action's state change is.
    flushSync(() => {
      running = refusedForm?.run(async () => {
        read = await refusedForm.pendingChangeNow();
      });
    });
    await running;

    expect(read).toMatchObject({ bio: "Committed as the hold landed" });
    await vi.waitFor(() => expect(result.current.recovering).toBe(false));
  });

  it("stays held when a document arrives other than through the recovery's own reload", async () => {
    // A take keeps the document's version, so nothing that merely arrives
    // proves the live values are in it: only the recovery's reload does.
    const { result, rerender } = render();
    let reloadDone: () => void = () => {};
    const reload = new Promise<void>(resolve => {
      reloadDone = resolve;
    });
    let running: Promise<unknown> | undefined;
    act(() => {
      running = updateOptions.current?.refusedForm?.run(() => reload);
    });
    act(() => {
      rerender({ entry: { ...stored, _isWorkingDraft: true } });
    });
    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 20));
    });
    expect(result.current.recovering).toBe(true);

    await act(async () => {
      reloadDone();
      await running;
    });
    expect(result.current.recovering).toBe(false);
  });

  it("resets for a later update after a recovery whose reload changed nothing on screen", async () => {
    const { result, rerender } = render();
    // The take changed only fields this author can't view, so the reload is
    // the entry already on screen and the editor is handed nothing new.
    await act(async () => {
      await updateOptions.current?.refusedForm?.run(async () => {});
    });
    act(() => {
      result.current.form.setValue("bio", "Typed after the recovery", {
        shouldDirty: true,
      });
    });
    // Someone else restores an earlier version: a new version that is no
    // write of this editor's, so the form starts again from it.
    act(() => {
      rerender({
        entry: {
          ...stored,
          bio: "Restored",
          updatedAt: "2026-10-22T10:00:00.000Z",
        },
      });
    });

    expect(result.current.form.getValues("bio")).toBe("Restored");
  });
});
