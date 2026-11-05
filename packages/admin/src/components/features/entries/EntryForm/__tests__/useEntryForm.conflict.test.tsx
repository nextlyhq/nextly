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
import { renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { act } from "@admin/__tests__/utils";

const { update, saveAutosave } = vi.hoisted(() => ({
  update: vi.fn(),
  saveAutosave: vi.fn(),
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
  useDiscardWorkingDraft: () => ({ mutateAsync: vi.fn(), isPending: false }),
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
      await rendered.result.current.loadCurrentVersion();
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

  it("load current replaces nothing when the edits could not be kept", async () => {
    saveAutosave.mockRejectedValueOnce(new Error("The server is unavailable."));
    const rendered = await refusedAfterAnasSave();

    await act(async () => {
      await rendered.result.current.loadCurrentVersion().catch(() => {});
    });

    expect(rendered.result.current.form.getValues("title")).toBe("Mine");
    expect(rendered.result.current.versionConflict).toMatchObject({
      stale: ANA_CHANGED,
      failure: expect.any(String),
    });
  });
});
