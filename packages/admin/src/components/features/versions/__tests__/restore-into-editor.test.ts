/**
 * Putting a version's chosen fields into the editor: only the fields that may
 * be restored go in, and the toast names how many, when the version was
 * saved, and on a translated document the language they went into.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { EditorRestoreSurface } from "../document-history-context";
import { restoreIntoEditor } from "../restore-into-editor";
import type { RestoreRow } from "../restore-plan";

const { toastSuccess } = vi.hoisted(() => ({ toastSuccess: vi.fn() }));
vi.mock("@admin/components/ui", () => ({ toast: { success: toastSuccess } }));

function editorWith(extra: Partial<EditorRestoreSurface> = {}) {
  const apply = vi.fn(() => ({ undo: vi.fn() }));
  const editor = {
    restore: { apply, restoredFromForSave: vi.fn(), saved: vi.fn() },
    fields: [],
    currentValues: () => ({}),
    dirtyFields: () => new Set<string>(),
    canEdit: () => true,
    ...extra,
  } as EditorRestoreSurface;
  return { editor, apply };
}

const rows: RestoreRow[] = [
  {
    name: "bio",
    label: "Biography",
    chosen: true,
    replacesUnsaved: false,
    shared: false,
    value: "old",
  },
  {
    name: "secret",
    label: "Secret",
    chosen: false,
    disabled: "hidden",
    reason: "Hidden",
    replacesUnsaved: false,
    shared: false,
  },
];

describe("restoreIntoEditor", () => {
  beforeEach(() => vi.clearAllMocks());

  it("puts in only the fields that may be restored", () => {
    const { editor, apply } = editorWith();

    restoreIntoEditor({ editor, rows, names: ["bio", "secret"], versionNo: 2 });

    expect(apply).toHaveBeenCalledWith({ bio: "old" }, 2);
    expect(toastSuccess).toHaveBeenCalledWith(
      "1 field restored from version 2",
      expect.anything()
    );
  });

  it("names the language the fields went into, on a translated document", () => {
    const { editor } = editorWith({ language: "English" });

    restoreIntoEditor({ editor, rows, names: ["bio"], versionNo: 2 });

    expect(toastSuccess).toHaveBeenCalledWith(
      "1 field restored into English from version 2",
      expect.anything()
    );
  });
});
