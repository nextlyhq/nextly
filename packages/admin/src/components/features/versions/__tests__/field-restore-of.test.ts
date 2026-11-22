/**
 * "Restore this field" withdraws as "Restore…" does once the document turns
 * read-only after the version was shown (another editor takes it): each row is
 * judged again as it is read and as it is restored.
 */
import { describe, expect, it, vi } from "vitest";

import type { EditorRestoreSurface } from "../document-history-context";
import type { RestoreRow } from "../restore-plan";

const { restoreIntoEditor } = vi.hoisted(() => ({
  restoreIntoEditor: vi.fn(),
}));
vi.mock("../restore-into-editor", () => ({ restoreIntoEditor }));

import { fieldRestoreOf } from "../viewed-version-host";

const title: RestoreRow = {
  name: "title",
  label: "Title",
  chosen: true,
  replacesUnsaved: false,
  shared: false,
  value: "Then",
};

function editorWhere(canEdit: () => boolean): EditorRestoreSurface {
  return {
    restore: {
      apply: vi.fn(() => ({ undo: vi.fn() })),
      restoredFromForSave: vi.fn(),
      saved: vi.fn(),
      formReset: vi.fn(),
      holds: vi.fn(() => false),
    },
    fields: [],
    currentValues: () => ({}),
    dirtyFields: () => new Set<string>(),
    canEdit,
  } as EditorRestoreSurface;
}

describe("fieldRestoreOf", () => {
  it("restores a field the person may still change", () => {
    restoreIntoEditor.mockClear();
    const restore = fieldRestoreOf(
      [title],
      editorWhere(() => true),
      {
        versionNo: 3,
        savedAt: null,
      }
    );

    expect(restore.rowFor("title")?.chosen).toBe(true);
    restore.restore("title");
    expect(restoreIntoEditor).toHaveBeenCalledTimes(1);
  });

  it("withdraws a field once the document turns read-only after it was shown", () => {
    restoreIntoEditor.mockClear();
    let editable = true;
    const restore = fieldRestoreOf(
      [title],
      editorWhere(() => editable),
      {
        versionNo: 3,
        savedAt: null,
      }
    );

    // Another editor takes the document.
    editable = false;

    expect(restore.rowFor("title")).toMatchObject({
      chosen: false,
      disabled: "read-only",
    });
    restore.restore("title");
    expect(restoreIntoEditor).not.toHaveBeenCalled();
  });

  it("offers a field again once the document stops being read-only", () => {
    restoreIntoEditor.mockClear();
    // Shown while another editor held the document: judged read-only then.
    const heldElsewhere: RestoreRow = {
      ...title,
      chosen: false,
      disabled: "read-only",
      reason: "You can't edit this field",
    };
    let editable = false;
    const restore = fieldRestoreOf(
      [heldElsewhere],
      editorWhere(() => editable),
      { versionNo: 3, savedAt: null }
    );

    // The other editor lets the document go.
    editable = true;

    expect(restore.rowFor("title")).toMatchObject({ chosen: true });
    expect(restore.rowFor("title")?.disabled).toBeUndefined();
    restore.restore("title");
    expect(restoreIntoEditor).toHaveBeenCalledWith(
      expect.objectContaining({
        names: ["title"],
        rows: [expect.objectContaining({ name: "title", value: "Then" })],
      })
    );
    expect(
      restoreIntoEditor.mock.calls[0]?.[0].rows[0].disabled
    ).toBeUndefined();
  });

  it("keeps a hidden field disabled whatever the document's lock", () => {
    const hidden: RestoreRow = {
      name: "secret",
      label: "Secret",
      chosen: false,
      disabled: "hidden",
      reason: "Hidden: you can't read this field",
      replacesUnsaved: false,
      shared: false,
    };
    const restore = fieldRestoreOf(
      [hidden],
      editorWhere(() => true),
      { versionNo: 3, savedAt: null }
    );

    expect(restore.rowFor("secret")).toMatchObject({ disabled: "hidden" });
  });
});
