/**
 * The editor sends the version its copy started from with every save, and a
 * save refused because the document changed since keeps the edits on screen
 * and opens the conflict.
 *
 * The copy's starting version moves only when the copy on screen is replaced
 * by a read or by a write the server answered. A refusal pins the form: the
 * newer version the refetch after it brings must not reset what the author
 * typed until they choose to load it, or to save theirs anyway.
 */
import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { act } from "@admin/__tests__/utils";
import { RESTRICTED_REFERENCE } from "@admin/lib/form/stored-references";

const { update, saveAutosave, discard } = vi.hoisted(() => ({
  update: vi.fn(),
  saveAutosave: vi.fn(),
  discard: vi.fn(),
}));

vi.mock("@admin/hooks/queries/useCreateEntry", () => ({
  useCreateEntry: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));
vi.mock("@admin/hooks/queries/useUpdateEntry", () => ({
  useUpdateEntry: () => ({ mutateAsync: update, isPending: false }),
}));
vi.mock("@admin/hooks/useCanRequest", () => ({
  useAsksTranslationStatus: () => false,
}));
vi.mock("@admin/hooks/queries/useDeleteEntry", () => ({
  useDeleteEntry: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));
vi.mock("@admin/hooks/queries/useDiscardWorkingDraft", () => ({
  useDiscardWorkingDraft: () => ({ mutateAsync: discard, isPending: false }),
}));
vi.mock("@admin/services/versionApi", async importOriginal => {
  const actual =
    await importOriginal<typeof import("@admin/services/versionApi")>();
  return { ...actual, versionApi: { ...actual.versionApi, saveAutosave } };
});

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
  summary: "kept",
  updatedAt: "2026-10-19T02:00:00.000Z",
  _rev: "3",
};
/** The document as a colleague left it, as the refetch after a refusal reads it. */
const anas = {
  ...stored,
  title: "Ana's title",
  updatedAt: "2026-10-19T02:05:00.000Z",
  _rev: "4",
};
const ANA_CHANGED = {
  currentVersion: "4",
  changedBy: { kind: "person", name: "Ana Ruiz" },
  changedAt: "2026-10-19T02:05:00.000Z",
};

/** The refusal of a save made from an older version, as the fetcher throws it. */
function staleVersion(data: Record<string, unknown> = ANA_CHANGED): Error {
  return Object.assign(
    new Error("This document changed since the version you gave."),
    { status: 409, code: "STALE_VERSION", data }
  );
}

/** What a save the server stored answers with. */
const answered = (item: Record<string, unknown>) => ({
  message: "Saved",
  item,
});

afterEach(() => {
  update.mockReset();
  saveAutosave.mockReset();
  discard.mockReset();
});

function render(initial: Record<string, unknown> = stored) {
  return renderHook(
    ({ entry }: { entry: Record<string, unknown> }) =>
      useEntryForm({ collection, entry: entry as never, mode: "edit" }),
    { initialProps: { entry: initial } }
  );
}

type Rendered = ReturnType<typeof render>;

/** Type into the title and save, as the author does. */
async function typeAndSave(rendered: Rendered, title: string) {
  act(() => {
    rendered.result.current.form.setValue("title", title, {
      shouldDirty: true,
    });
  });
  await act(async () => {
    await rendered.result.current.handleSubmit();
  });
}

/** Refused, then the cache rolled back and refetched to Ana's version. */
async function refusedAfterAnasSave(): Promise<Rendered> {
  update.mockRejectedValueOnce(staleVersion());
  const rendered = render();
  await typeAndSave(rendered, "Mine");
  act(() => rendered.rerender({ entry: { ...stored } }));
  act(() => rendered.rerender({ entry: anas }));
  return rendered;
}

describe("the version the editor's copy started from", () => {
  it("is sent with a save", async () => {
    update.mockResolvedValueOnce(
      answered({ ...stored, title: "Mine", _rev: "4" })
    );
    await typeAndSave(render(), "Mine");
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Mine", _rev: "3" })
    );
  });

  it("moves to the version its own save answered, so a second save is not refused", async () => {
    update.mockResolvedValueOnce(
      answered({
        ...stored,
        title: "Mine",
        updatedAt: "2026-10-19T02:01:00.000Z",
        _rev: "4",
      })
    );
    const rendered = render();
    await typeAndSave(rendered, "Mine");
    update.mockResolvedValueOnce(answered({ ...stored, _rev: "5" }));
    await typeAndSave(rendered, "Mine again");
    expect(update).toHaveBeenLastCalledWith(
      expect.objectContaining({ title: "Mine again", _rev: "4" })
    );
  });

  it("is sent with a write of the status alone", async () => {
    update.mockResolvedValueOnce(
      answered({ ...stored, status: "published", _rev: "4" })
    );
    const { result } = render();
    await act(async () => {
      await result.current.writeStatus("published");
    });
    expect(update).toHaveBeenCalledWith({ status: "published", _rev: "3" });
  });

  it("is sent with a discard, and moves to the version the discard answered", async () => {
    // A discard of the pending change moves the entry's version too.
    discard.mockResolvedValueOnce({
      message: "Working draft discarded.",
      item: { ...stored, _rev: "4" },
    });
    const rendered = render();
    await act(async () => {
      await rendered.result.current.handleDiscardWorkingDraft();
    });
    expect(discard).toHaveBeenCalledWith("3");
    // The page hands the entry over again, as stored after the discard.
    act(() => rendered.rerender({ entry: { ...stored, _rev: "4" } }));

    update.mockResolvedValueOnce(answered({ ...stored, _rev: "5" }));
    await typeAndSave(rendered, "Mine");
    expect(update).toHaveBeenLastCalledWith(
      expect.objectContaining({ _rev: "4" })
    );
  });

  it("lets go of a change it was told of once a save of its own succeeds", async () => {
    // Told of a change while editing, and then its own save goes through:
    // the copy is now the current version, so a newer read must reach it.
    // Still held, every read after would be skipped and the next save sent
    // from a version long gone.
    const rendered = render();
    act(() => {
      rendered.result.current.holdForVersionChange(ANA_CHANGED as never);
    });
    update.mockResolvedValueOnce(
      answered({ ...stored, title: "Mine", _rev: "5" })
    );
    await typeAndSave(rendered, "Mine");

    act(() => rendered.rerender({ entry: { ...anas, _rev: "6" } }));
    update.mockResolvedValueOnce(answered({ ...anas, _rev: "7" }));
    await typeAndSave(rendered, "Mine again");

    expect(update).toHaveBeenLastCalledWith(
      expect.objectContaining({ _rev: "6" })
    );
  });

  it("is not moved by a save's answer once the form shows another entry", async () => {
    // Counters are small, so two entries often stand at the same version:
    // taking one's answer for the other would let a save of the second pass
    // over a colleague's change to it.
    let answerFirst: (answer: unknown) => void = () => {};
    update.mockImplementationOnce(
      () =>
        new Promise(resolve => {
          answerFirst = resolve;
        })
    );
    const rendered = render({ ...stored, _rev: "5" });
    act(() => {
      rendered.result.current.form.setValue("title", "First's edit", {
        shouldDirty: true,
      });
    });
    let saving: Promise<unknown> = Promise.resolve();
    act(() => {
      saving = rendered.result.current.handleSubmit();
    });
    await waitFor(() => expect(update).toHaveBeenCalledTimes(1));

    // The editor moves to another entry, at the same version.
    const second = {
      id: "e2",
      title: "Second",
      summary: "theirs",
      updatedAt: "2026-10-19T03:00:00.000Z",
      _rev: "5",
    };
    act(() => rendered.rerender({ entry: second }));
    await act(async () => {
      answerFirst(answered({ ...stored, _rev: "6" }));
      await saving;
    });

    update.mockResolvedValueOnce(answered({ ...second, _rev: "6" }));
    await typeAndSave(rendered, "Second's edit");
    expect(update).toHaveBeenLastCalledWith(
      expect.objectContaining({ _rev: "5" })
    );
  });

  it("keeps another entry's hold when an earlier save answers after the switch", async () => {
    // 🔴 The first entry's save went through, but the copy it was made from is
    // gone: releasing whatever is shown would let the colleague's newer read
    // reset the second entry over the edits typed into it.
    let answerFirst: (answer: unknown) => void = () => {};
    update.mockImplementationOnce(
      () =>
        new Promise(resolve => {
          answerFirst = resolve;
        })
    );
    const rendered = render({ ...stored, _rev: "5" });
    act(() => {
      rendered.result.current.form.setValue("title", "First's edit", {
        shouldDirty: true,
      });
    });
    let saving: Promise<unknown> = Promise.resolve();
    act(() => {
      saving = rendered.result.current.handleSubmit();
    });
    await waitFor(() => expect(update).toHaveBeenCalledTimes(1));

    const second = {
      id: "e2",
      title: "Second",
      summary: "theirs",
      updatedAt: "2026-10-19T03:00:00.000Z",
      _rev: "5",
    };
    act(() => rendered.rerender({ entry: second }));
    act(() => {
      rendered.result.current.form.setValue("title", "Second's edit", {
        shouldDirty: true,
      });
      rendered.result.current.holdForVersionChange({
        ...ANA_CHANGED,
        currentVersion: "6",
      } as never);
    });
    await act(async () => {
      answerFirst(answered({ ...stored, _rev: "6" }));
      await saving;
    });

    act(() =>
      rendered.rerender({
        entry: {
          ...second,
          title: "Ana's second",
          updatedAt: "2026-10-19T03:05:00.000Z",
          _rev: "6",
        },
      })
    );
    expect(rendered.result.current.form.getValues("title")).toBe(
      "Second's edit"
    );
  });

  it("keeps the edits when the author keeps editing before the current version a load awaits arrives", async () => {
    // 🔴 Loading the current version waits for its read; when that read
    // fails and the author keeps editing, the version arriving later must not
    // replace the edits they chose to keep.
    const rendered = render();
    act(() => {
      rendered.result.current.holdForVersionChange(ANA_CHANGED as never);
      rendered.result.current.form.setValue("title", "Mine", {
        shouldDirty: true,
      });
    });
    await act(async () => {
      await rendered.result.current.loadCurrentVersion(false);
    });
    act(() => rendered.result.current.stopAwaitingCurrentVersion());

    act(() => rendered.rerender({ entry: anas }));
    expect(rendered.result.current.form.getValues("title")).toBe("Mine");
  });

  it("does not pin a refusal that arrives once the form shows another entry", async () => {
    // The refusal is about the first entry: pinned on the second, Save anyway
    // would write the first's values over the second.
    let refuseFirst: (reason: unknown) => void = () => {};
    update.mockImplementationOnce(
      () =>
        new Promise((_resolve, reject) => {
          refuseFirst = reject;
        })
    );
    const rendered = render({ ...stored, _rev: "5" });
    act(() => {
      rendered.result.current.form.setValue("title", "First's edit", {
        shouldDirty: true,
      });
    });
    let saving: Promise<unknown> = Promise.resolve();
    act(() => {
      saving = rendered.result.current.handleSubmit();
    });
    await waitFor(() => expect(update).toHaveBeenCalledTimes(1));

    const second = {
      id: "e2",
      title: "Second",
      summary: "theirs",
      updatedAt: "2026-10-19T03:00:00.000Z",
      _rev: "5",
    };
    act(() => rendered.rerender({ entry: second }));
    await act(async () => {
      refuseFirst(staleVersion());
      await saving.catch(() => {});
    });

    expect(rendered.result.current.versionConflict).toBeNull();
    await act(async () => {
      await rendered.result.current.saveAnyway();
    });
    expect(update).toHaveBeenCalledTimes(1);
  });

  it("does not pin a refusal of a save made before a recovery point without a version was restored", async () => {
    // A point saved before versions existed keeps the version on screen, but
    // its edits are a new copy: pinned on them, Save anyway would send the
    // values from before the restore.
    let refuseEarlier: (reason: unknown) => void = () => {};
    update.mockImplementationOnce(
      () =>
        new Promise((_resolve, reject) => {
          refuseEarlier = reject;
        })
    );
    const rendered = render();
    act(() => {
      rendered.result.current.form.setValue("title", "Before the restore", {
        shouldDirty: true,
      });
    });
    let saving: Promise<unknown> = Promise.resolve();
    act(() => {
      saving = rendered.result.current.handleSubmit();
    });
    await waitFor(() => expect(update).toHaveBeenCalledTimes(1));

    act(() => rendered.result.current.adoptRecoveredVersion(undefined));
    await act(async () => {
      refuseEarlier(staleVersion());
      await saving.catch(() => {});
    });

    expect(rendered.result.current.versionConflict).toBeNull();
  });

  it("moves to a newer version a read brings while nothing is pinned", async () => {
    const rendered = render();
    act(() => rendered.rerender({ entry: anas }));
    update.mockResolvedValueOnce(answered({ ...anas, _rev: "5" }));
    await typeAndSave(rendered, "Mine");
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ _rev: "4" }));
  });
});

describe("a save refused because the document changed since", () => {
  it("a refused save keeps the edits and opens the conflict", async () => {
    const { result } = await refusedAfterAnasSave();

    expect(result.current.form.getValues("title")).toBe("Mine");
    expect(result.current.form.formState.isDirty).toBe(true);
    expect(result.current.versionConflict).toMatchObject({
      stale: ANA_CHANGED,
    });
  });

  it("save anyway sends the overwrite with the version the edits began from", async () => {
    const rendered = await refusedAfterAnasSave();
    update.mockResolvedValueOnce(
      answered({
        ...stored,
        title: "Mine",
        updatedAt: "2026-10-19T02:06:00.000Z",
        _rev: "5",
      })
    );

    await act(async () => {
      await rendered.result.current.saveAnyway();
    });

    expect(update).toHaveBeenLastCalledWith(
      expect.objectContaining({ title: "Mine", _rev: "3", _overwrite: true })
    );
    expect(rendered.result.current.versionConflict).toBeNull();
    // Its version is the one the overwrite answered.
    update.mockResolvedValueOnce(answered({ ...stored, _rev: "6" }));
    await typeAndSave(rendered, "Mine again");
    expect(update).toHaveBeenLastCalledWith(
      expect.objectContaining({ _rev: "5" })
    );
  });

  it("load current keeps the edits as a recovery point, then shows the current version", async () => {
    saveAutosave.mockResolvedValueOnce({
      message: "Draft recovery point saved.",
      item: { updatedAt: "2026-10-19T02:06:00.000Z", locale: null },
    });
    const rendered = await refusedAfterAnasSave();

    await act(async () => {
      await rendered.result.current.loadCurrentVersion(true);
    });

    // The edits, recoverable, remembering the version they began from.
    expect(saveAutosave).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "collection", entryId: "e1" }),
      expect.objectContaining({ title: "Mine", _rev: "3" }),
      undefined
    );
    expect(rendered.result.current.versionConflict).toBeNull();
    expect(rendered.result.current.form.getValues("title")).toBe("Ana's title");
    expect(rendered.result.current.form.formState.isDirty).toBe(false);
    // And the next save starts from the version on screen.
    update.mockResolvedValueOnce(answered({ ...anas, _rev: "5" }));
    await typeAndSave(rendered, "Mine on top of Ana's");
    expect(update).toHaveBeenLastCalledWith(
      expect.objectContaining({ _rev: "4" })
    );
  });

  it("load current on an entry that keeps no recovery points writes none, and shows the current version", async () => {
    const rendered = await refusedAfterAnasSave();

    await act(async () => {
      await rendered.result.current.loadCurrentVersion(false);
    });

    // Discarded, as the conflict said they would be: the server would refuse
    // a recovery point here, and the form would stay pinned.
    expect(saveAutosave).not.toHaveBeenCalled();
    expect(rendered.result.current.versionConflict).toBeNull();
    expect(rendered.result.current.form.getValues("title")).toBe("Ana's title");
  });

  it("a read of another entry releases the conflict and shows that entry", async () => {
    const rendered = await refusedAfterAnasSave();
    const other = {
      id: "e2",
      title: "Another post",
      summary: "theirs",
      updatedAt: "2026-10-19T03:00:00.000Z",
      _rev: "9",
    };

    act(() => rendered.rerender({ entry: other }));

    expect(rendered.result.current.versionConflict).toBeNull();
    expect(rendered.result.current.form.getValues("title")).toBe(
      "Another post"
    );
    // And its saves start from that entry's version, not the refused one's.
    update.mockResolvedValueOnce(answered({ ...other, _rev: "10" }));
    await typeAndSave(rendered, "Mine on the other");
    expect(update).toHaveBeenLastCalledWith(
      expect.objectContaining({ _rev: "9" })
    );
  });

  it("save anyway keeps a link the editor cannot see", async () => {
    // The stored row leaves out the link the editor may not read; taking it
    // in would drop the link from the form, for the next save to remove.
    const related = {
      name: "posts",
      label: "Posts",
      fields: [
        { name: "title", type: "text", label: "Title" },
        {
          name: "related",
          type: "relationship",
          label: "Related",
          relationTo: "articles",
          hasMany: true,
        },
      ],
    } as never;
    const hidden = { id: "a2", [RESTRICTED_REFERENCE]: true };
    const withHidden = {
      ...stored,
      related: [{ id: "a1", title: "Seen" }, hidden],
    };
    update.mockRejectedValueOnce(staleVersion());
    update.mockImplementationOnce((sent: Record<string, unknown>) =>
      Promise.resolve(
        answered({
          ...withHidden,
          ...sent,
          related: [{ id: "a1", title: "Seen" }],
          _rev: "5",
        })
      )
    );
    const rendered = renderHook(() =>
      useEntryForm({ collection: related, entry: withHidden, mode: "edit" })
    );
    await typeAndSave(rendered, "Mine");

    await act(async () => {
      await rendered.result.current.saveAnyway();
    });

    expect(rendered.result.current.form.getValues("related")).toEqual([
      { id: "a1", title: "Seen" },
      hidden,
    ]);
  });

  it("save anyway after a refused publish leaves the form as it is, a hidden link included", async () => {
    // A status write carries no form values: overwriting it stores the
    // status alone, as a publish that went through does, and the form keeps
    // what it holds rather than taking an answer that leaves out the link.
    const related = {
      name: "posts",
      label: "Posts",
      fields: [
        { name: "title", type: "text", label: "Title" },
        {
          name: "related",
          type: "relationship",
          label: "Related",
          relationTo: "articles",
          hasMany: true,
        },
      ],
    } as never;
    const hidden = { id: "a2", [RESTRICTED_REFERENCE]: true };
    const withHidden = {
      ...stored,
      related: [{ id: "a1", title: "Seen" }, hidden],
    };
    update.mockRejectedValueOnce(staleVersion());
    update.mockResolvedValueOnce(
      answered({
        ...withHidden,
        status: "published",
        related: [{ id: "a1", title: "Seen" }],
        _rev: "5",
      })
    );
    const rendered = renderHook(() =>
      useEntryForm({ collection: related, entry: withHidden, mode: "edit" })
    );
    await act(async () => {
      await rendered.result.current.writeStatus("published");
    });

    await act(async () => {
      await rendered.result.current.saveAnyway();
    });

    expect(update).toHaveBeenLastCalledWith(
      expect.objectContaining({ status: "published", _overwrite: true })
    );
    expect(rendered.result.current.form.getValues("related")).toEqual([
      { id: "a1", title: "Seen" },
      hidden,
    ]);
  });

  it("save anyway writes nothing while someone else holds the document", async () => {
    let held = false;
    update.mockRejectedValueOnce(staleVersion());
    const rendered = renderHook(() =>
      useEntryForm({
        collection,
        entry: stored as never,
        mode: "edit",
        writesHeld: () => held,
      })
    );
    await typeAndSave(rendered, "Mine");
    // A colleague takes the document while the conflict is open.
    held = true;

    await act(async () => {
      await rendered.result.current.saveAnyway().catch(() => {});
    });

    expect(update).toHaveBeenCalledTimes(1);
    expect(rendered.result.current.versionConflict).toMatchObject({
      failure: expect.any(String),
    });
  });

  it("load current replaces nothing when the edits could not be kept", async () => {
    saveAutosave.mockRejectedValueOnce(new Error("The server is unavailable."));
    const rendered = await refusedAfterAnasSave();

    await act(async () => {
      await rendered.result.current.loadCurrentVersion(true).catch(() => {});
    });

    expect(rendered.result.current.form.getValues("title")).toBe("Mine");
    expect(rendered.result.current.versionConflict).toMatchObject({
      stale: ANA_CHANGED,
      failure: expect.any(String),
    });
  });
});
