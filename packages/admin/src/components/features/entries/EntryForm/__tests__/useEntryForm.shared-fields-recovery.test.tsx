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
    let done: () => void = () => {};
    const running = updateOptions.current?.refusedForm?.run(
      () =>
        new Promise<void>(resolve => {
          done = resolve;
        })
    );

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

  it("leaves a language switched to before the reload as that language's document has it", () => {
    const { result, rerender } = render();
    act(() => {
      result.current.form.setValue("nickname", "Stale", { shouldDirty: true });
    });
    act(() => {
      updateOptions.current?.refusedForm?.adoptTaken(["nickname"]);
    });
    // The editor moves to Spanish before the reloaded English entry arrives.
    act(() => {
      rerender({
        entry: { ...stored, nickname: "Apodo" },
        locale: "es",
      });
    });

    expect(result.current.form.getValues("nickname")).toBe("Apodo");
    expect(result.current.form.formState.dirtyFields).not.toHaveProperty(
      "nickname"
    );
  });

  it("keeps an edit made during a recovery that creates the entry's first working draft", async () => {
    // Published, with no pending change of its own yet.
    const { result, rerender } = render();
    // Not inside an outer `act`: one would hold back the reload's render
    // until the recovery had finished, which a browser doesn't.
    let reloaded: Promise<void> | undefined;
    await updateOptions.current?.refusedForm?.run(async () => {
      // Typed while the recovery saves and takes.
      act(() => {
        result.current.form.setValue("bio", "Typed during the recovery", {
          shouldDirty: true,
        });
      });
      // The reload settles. As React Query does, the editor is handed the
      // reloaded entry on a zero-delay timeout queued as it settles: the
      // same entry and version, now carrying the working draft the
      // recovery's save created.
      reloaded = reloadBrings(rerender, { ...stored, _isWorkingDraft: true });
    });
    await reloaded;

    expect(result.current.form.getValues("bio")).toBe(
      "Typed during the recovery"
    );
  });

  it("goes back to judging the overlay once the recovery's reload has arrived", async () => {
    const { result, rerender } = render();
    let reloaded: Promise<void> | undefined;
    await updateOptions.current?.refusedForm?.run(async () => {
      reloaded = reloadBrings(rerender, { ...stored, _isWorkingDraft: true });
    });
    await reloaded;
    // An edit made afterwards, then the working draft goes away from under
    // it, as someone else's discard takes it: that is no write of this
    // editor's, and the form starts again from what is stored.
    act(() => {
      result.current.form.setValue("bio", "Typed after the recovery", {
        shouldDirty: true,
      });
    });
    act(() => {
      rerender({ entry: { ...stored, _isWorkingDraft: false } });
    });

    expect(result.current.form.getValues("bio")).toBe(stored.bio);
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
