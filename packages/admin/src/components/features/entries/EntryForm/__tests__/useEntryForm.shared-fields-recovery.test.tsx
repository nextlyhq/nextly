/**
 * What the entry form gives the recovery from a publish refused over shared
 * values someone else published since.
 *
 * The recovery stores the form with the editor's own Save and then takes the
 * live values into the pending change. What it stores has to be the form as it
 * is when the action is taken, since the author may have kept editing. And once
 * the live values are taken the form has to show them: the reloaded entry has
 * the same identity as the one on screen, so an ordinary reset keeps the
 * author's unsaved value for the field, the stale one, and the next Publish
 * would send it and put the old value back live.
 */
import { renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { act } from "@admin/__tests__/utils";
import type { RefusedForm } from "@admin/hooks/useSharedFieldsRecovery";

import type { DocumentActionOutcome } from "../useDocumentActionBindings";

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
// Whether reads ask for translation status, as the other useEntryForm tests
// answer it: these entries aren't localized.
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

beforeEach(() => {
  update.mockResolvedValue({ item: stored });
});

afterEach(() => {
  update.mockReset();
  updateOptions.current = undefined;
});

/** The form's recovery, as the editor hands it to its update mutation. */
function recovery(): RefusedForm {
  const refusedForm = updateOptions.current?.refusedForm;
  if (!refusedForm) throw new Error("The editor handed no recovery.");
  return refusedForm;
}

/**
 * The entry form, with the Save its host offers a recovery: the form's own
 * submit of the pending change, as the host's Save runs it.
 */
function render(options: { writesHeld?: () => boolean } = {}) {
  const save: { current: (() => Promise<DocumentActionOutcome>) | undefined } =
    { current: undefined };
  const rendered = renderHook(
    ({ entry, locale }: { entry: Record<string, unknown>; locale?: string }) =>
      useEntryForm({
        collection,
        entry: entry as never,
        mode: "edit",
        ...(locale === undefined ? {} : { locale }),
        saveWithoutPublishing: save,
        ...options,
      }),
    {
      initialProps: { entry: stored } as {
        entry: Record<string, unknown>;
        locale?: string;
      },
    }
  );
  save.current = () =>
    rendered.result.current.handleSubmit(undefined, "save-working-draft");
  return rendered;
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
  it("stores the form with the editor's own Save, as it is when the action is taken", async () => {
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
    const take = vi.fn(async () => undefined);

    await act(async () => {
      await recovery().recover(take);
    });

    // A save of the pending change: no status, so nothing is published.
    expect(update).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledWith({
      nickname: "Ada L",
      bio: "Typed after the refusal",
    });
    expect(take).toHaveBeenCalledTimes(1);
  });

  it("starts the form afresh from the reloaded entry, so it shows the live value and publishes it next", async () => {
    const { result, rerender } = render();
    // The refused publish carried a stale nickname; the bio is the author's
    // own edit. Both are in the pending change the recovery's Save stores.
    act(() => {
      result.current.form.setValue("nickname", "Stale", { shouldDirty: true });
      result.current.form.setValue("bio", "Mine", { shouldDirty: true });
    });

    let reloaded: Promise<void> | undefined;
    await recovery().recover(async () => {
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

    update.mockClear();
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
    const take = vi.fn(async () => undefined);

    await expect(recovery().recover(take)).rejects.toThrow();
    expect(update).not.toHaveBeenCalled();
    expect(take).not.toHaveBeenCalled();
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
    const take = vi.fn(async () => undefined);

    await expect(recovery().recover(take)).rejects.toThrow();
    expect(take).not.toHaveBeenCalled();
    expect(update).toHaveBeenCalledTimes(1);

    await act(async () => {
      finish({ item: stored });
      await saving;
    });
  });

  it("holds the editor's saves and publishes while the recovery takes", async () => {
    const { result } = render();
    // Made before the recovery starts, which takes once its Save is done.
    let done: () => void = () => {};
    const taking = new Promise<void>(resolve => {
      done = resolve;
    });
    let takeStarted = false;
    const running = recovery().recover(() => {
      takeStarted = true;
      return taking;
    });
    await vi.waitFor(() => expect(takeStarted).toBe(true));

    let outcome: unknown;
    await act(async () => {
      outcome = await result.current.handleSubmit(undefined, "publish");
    });
    // A publish now would send the value the take is replacing.
    expect(outcome).toMatchObject({ ok: false, reason: "busy" });
    // The recovery's own Save, and nothing after it.
    expect(update).toHaveBeenCalledTimes(1);

    done();
    await running;
  });

  it("holds the form until the recovery's reloaded entry has reached it", async () => {
    const { result, rerender } = render();
    let heldWhenItArrived: boolean | undefined;
    let reloaded: Promise<void> | undefined;
    await recovery().recover(async () => {
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
      running = recovery().recover(() => reload);
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
      await recovery().recover(async () => {});
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

describe("the entry form's save, when the entry changes hands while it validates", () => {
  it.each(["save-working-draft", "publish"] as const)(
    "stores nothing on %s: the hold is asked again immediately before the write",
    async intent => {
      let held = false;
      const { result } = render({ writesHeld: () => held });
      act(() => {
        result.current.form.setValue("bio", "Mine", { shouldDirty: true });
      });

      let outcome: unknown;
      await act(async () => {
        const saving = result.current.handleSubmit(undefined, intent);
        // A colleague takes the entry over while validation runs.
        held = true;
        outcome = await saving;
      });

      expect(update).not.toHaveBeenCalled();
      expect(outcome).toMatchObject({ ok: false, reason: "refused" });
    }
  );

  it("stores nothing once the editor went to another language and back while it validated", async () => {
    const rendered = render();
    act(() => {
      rendered.result.current.form.setValue("bio", "Mine", {
        shouldDirty: true,
      });
    });

    // Started, then the editor renders the moves while validation runs.
    let saving: Promise<unknown> | undefined;
    act(() => {
      saving = rendered.result.current.handleSubmit(
        undefined,
        "save-working-draft"
      );
    });
    // Away and back: the same language again, but the form started afresh
    // from its cached values, not the ones the Save was for.
    rendered.rerender({ entry: stored, locale: "de" });
    rendered.rerender({ entry: stored });
    let outcome: unknown;
    await act(async () => {
      outcome = await saving;
    });

    expect(update).not.toHaveBeenCalled();
    expect(outcome).toMatchObject({ ok: false, reason: "refused" });
  });

  it("holds a submission made while a language switch's answer is on its way, as before", async () => {
    // The switch has happened, and its answer hasn't come: the editor's
    // writes are held, so a submission started now is held, not "moved".
    let held = false;
    const rendered = render({ writesHeld: () => held });
    rendered.rerender({ entry: stored, locale: "de" });
    held = true;
    act(() => {
      rendered.result.current.form.setValue("bio", "Mine", {
        shouldDirty: true,
      });
    });

    let outcome: unknown;
    await act(async () => {
      outcome = await rendered.result.current.handleSubmit(
        undefined,
        "save-working-draft"
      );
    });

    expect(update).not.toHaveBeenCalled();
    expect(outcome).toEqual({
      ok: false,
      reason: "refused",
      message:
        "This document can't be saved right now: someone else is editing it, or a past version is on screen.",
    });
  });

  it.each(["save-working-draft", "publish"] as const)(
    "stores nothing on %s once the editor moved to another language while it validated",
    async intent => {
      const rendered = render();
      act(() => {
        rendered.result.current.form.setValue("bio", "Mine", {
          shouldDirty: true,
        });
      });

      // Started, then the editor renders the switch while validation runs.
      let saving: Promise<unknown> | undefined;
      act(() => {
        saving = rendered.result.current.handleSubmit(undefined, intent);
      });
      // A switch to a cached language: the form starts afresh from that
      // language's values.
      rendered.rerender({ entry: stored, locale: "de" });
      let outcome: unknown;
      await act(async () => {
        outcome = await saving;
      });

      expect(update).not.toHaveBeenCalled();
      expect(outcome).toEqual({
        ok: false,
        reason: "refused",
        message:
          "You moved to another language or document before this was saved; nothing was stored.",
      });
    }
  );
});
