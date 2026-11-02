/**
 * A save that fails leaves the form exactly as the author left it.
 *
 * The update writes the payload into the entry's cache before the request
 * (an optimistic update) and puts the old entry back when the request fails.
 * The editor reads that cache, so both arrive here as a changed entry. What
 * these pin is that neither costs the author anything: what they typed and did
 * not manage to save is still on screen, still unsaved, after the failure.
 */
import { renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { act } from "@admin/__tests__/utils";

const { update } = vi.hoisted(() => ({ update: vi.fn() }));

vi.mock("@admin/hooks/queries/useCreateEntry", () => ({
  useCreateEntry: () => ({ mutateAsync: vi.fn(), isPending: false }),
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
  name: "posts",
  label: "Posts",
  fields: [
    { name: "title", type: "text", label: "Title" },
    { name: "summary", type: "text", label: "Summary" },
  ],
} as never;
const stored = {
  id: "e1",
  title: "Shot a",
  updatedAt: "2026-10-19T02:00:00.000Z",
};

afterEach(() => {
  update.mockReset();
});

function render() {
  return renderHook(
    ({ entry, locale }: { entry: Record<string, unknown>; locale?: string }) =>
      useEntryForm({
        collection,
        entry: entry as never,
        mode: "edit",
        ...(locale === undefined ? {} : { locale }),
      }),
    {
      initialProps: { entry: stored } as {
        entry: Record<string, unknown>;
        locale?: string;
      },
    }
  );
}

describe("a save that fails", () => {
  it("keeps what was typed when the optimistic copy is rolled back", async () => {
    // The request stays open until the test fails it, as a slow server does.
    let fail: (error: Error) => void = () => {};
    update.mockImplementation(
      () =>
        new Promise((_resolve, reject) => {
          fail = reject;
        })
    );
    const { result, rerender } = render();
    act(() => {
      result.current.form.setValue("title", "Shot ab", { shouldDirty: true });
    });

    let saving: Promise<unknown> = Promise.resolve();
    act(() => {
      saving = result.current.handleSubmit();
    });
    // Validation runs first; the request is open once the update is called.
    await vi.waitFor(() => expect(update).toHaveBeenCalled());
    // The optimistic write, while the save is in flight: the payload merged
    // over the cached entry, a new object with the stored version unchanged.
    act(() => {
      rerender({ entry: { ...stored, title: "Shot ab" } });
    });
    // The request fails, and the cache is put back to the entry as stored —
    // as a NEW object: the query cache's structural sharing does not return the
    // snapshot it was handed once a field differs from what it holds.
    await act(async () => {
      fail(new Error("The server is unavailable."));
      await saving;
    });
    act(() => {
      rerender({ entry: { ...stored } });
    });

    expect(result.current.form.getValues("title")).toBe("Shot ab");
    expect(result.current.form.formState.isDirty).toBe(true);
    // Still a submitted form, so fixing a field re-validates it as it did.
    expect(result.current.form.formState.isSubmitted).toBe(true);
    expect(result.current.form.formState.submitCount).toBe(1);
  });

  it("keeps the field error the failure reported when the copy is rolled back", () => {
    // The update maps the server's field errors onto the form as it fails, and
    // the rolled-back entry reaches the form after that.
    const { result, rerender } = render();
    act(() => {
      result.current.form.setValue("title", "Shot ab", {
        shouldDirty: true,
        shouldTouch: true,
      });
    });
    act(() => {
      rerender({ entry: { ...stored, title: "Shot ab" } });
    });
    act(() => {
      result.current.form.setError("title", {
        type: "server",
        message: "Title is already taken",
      });
    });

    act(() => {
      rerender({ entry: { ...stored } });
    });

    expect(result.current.form.getValues("title")).toBe("Shot ab");
    expect(result.current.form.formState.errors.title?.message).toBe(
      "Title is already taken"
    );
    expect(result.current.form.formState.touchedFields.title).toBe(true);
  });

  it("still starts from a genuinely new version of the entry", () => {
    // The control: a version saved elsewhere (a colleague, a restore) is not
    // this editor's own save, and the form starts from it as before.
    const { result, rerender } = render();
    act(() => {
      rerender({
        entry: {
          ...stored,
          title: "Theirs",
          updatedAt: "2026-10-19T03:00:00.000Z",
        },
      });
    });

    expect(result.current.form.getValues("title")).toBe("Theirs");
  });

  it("starts from another entry opened while a save is in flight", async () => {
    // A guard that ignored every change during a save would keep this entry's
    // values under the other one, and a later save would write them there.
    update.mockImplementation(() => new Promise(() => {}));
    const { result, rerender } = render();
    act(() => {
      void result.current.handleSubmit();
    });
    await vi.waitFor(() => expect(update).toHaveBeenCalled());

    act(() => {
      rerender({ entry: { ...stored, id: "e2", title: "Another" } });
    });

    expect(result.current.form.getValues("title")).toBe("Another");
  });

  it("starts from another language's values when the language changes", () => {
    // The same row in another language keeps its id and often its version.
    const { result, rerender } = render();
    act(() => {
      rerender({ entry: { ...stored, title: "Plan a" }, locale: "es" });
    });

    expect(result.current.form.getValues("title")).toBe("Plan a");
  });

  it("starts from the live entry when its working draft goes", () => {
    const { result, rerender } = render();
    act(() => {
      rerender({ entry: { ...stored, title: "Draft", _isWorkingDraft: true } });
    });
    // The draft is shown first, so the check below is about leaving it.
    expect(result.current.form.getValues("title")).toBe("Draft");
    act(() => {
      rerender({ entry: { ...stored } });
    });

    expect(result.current.form.getValues("title")).toBe("Shot a");
  });

  /*
   * Every save of a published entry's working draft keeps the published row's
   * `updatedAt`, so a colleague's newer draft arrives with the identity the
   * editor already holds. Only its values are new.
   */
  const draft = {
    ...stored,
    title: "Draft",
    summary: "First take",
    _isWorkingDraft: true,
  };

  it("shows a colleague's newer working draft when nothing here is unsaved", () => {
    const { result, rerender } = render();
    act(() => {
      rerender({ entry: draft });
    });
    expect(result.current.form.getValues("summary")).toBe("First take");

    act(() => {
      rerender({ entry: { ...draft, summary: "Second take" } });
    });

    expect(result.current.form.getValues("summary")).toBe("Second take");
    expect(result.current.form.formState.isDirty).toBe(false);
  });

  it("shows a colleague's newer working draft in the fields the author left alone", () => {
    const { result, rerender } = render();
    act(() => {
      rerender({ entry: draft });
    });
    act(() => {
      result.current.form.setValue("title", "Mine", { shouldDirty: true });
    });

    act(() => {
      rerender({ entry: { ...draft, summary: "Second take" } });
    });

    expect(result.current.form.getValues("summary")).toBe("Second take");
    expect(result.current.form.getValues("title")).toBe("Mine");
    expect(result.current.form.formState.isDirty).toBe(true);
  });

  it("changes nothing the author typed when the write is refused", async () => {
    update.mockRejectedValue(new Error("The server is unavailable."));
    const { result } = render();
    act(() => {
      result.current.form.setValue("title", "Shot ab", { shouldDirty: true });
    });

    await act(async () => {
      await result.current.handleSubmit();
    });

    expect(result.current.form.getValues("title")).toBe("Shot ab");
    expect(result.current.form.formState.isDirty).toBe(true);
  });
});
