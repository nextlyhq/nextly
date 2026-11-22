/**
 * Putting a version's chosen fields into the editor: only the fields that may
 * be restored go in, and the toast names how many, when the version was
 * saved, and on a translated document the language they went into.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { EditorRestoreSurface } from "../document-history-context";
import type { EditorRestore } from "../editor-restore";
import { restoreIntoEditor } from "../restore-into-editor";
import type { RestoreRow } from "../restore-plan";

const { toastSuccess } = vi.hoisted(() => ({ toastSuccess: vi.fn() }));
vi.mock("@admin/components/ui", () => ({ toast: { success: toastSuccess } }));

function editorWith(extra: Partial<EditorRestoreSurface> = {}) {
  // Typed as the restore's own `apply`, so a test can read what it was handed.
  const apply = vi.fn<EditorRestore["apply"]>(() => ({ undo: vi.fn() }));
  const editor = {
    restore: {
      apply,
      restoredFromForSave: vi.fn(),
      saved: vi.fn(),
      formReset: vi.fn(),
      holds: vi.fn(() => false),
    },
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

    expect(apply).toHaveBeenCalledWith({ bio: "old" }, 2, expect.any(Function));
    expect(toastSuccess).toHaveBeenCalledWith(
      "1 field restored from version 2",
      expect.anything()
    );
  });

  it("tells the restore each field's type, so it compares as the field holds values", () => {
    const { editor, apply } = editorWith({
      fields: [
        { name: "bio", type: "json" },
      ] as unknown as EditorRestoreSurface["fields"],
    });

    restoreIntoEditor({ editor, rows, names: ["bio"], versionNo: 2 });

    const typeOf = apply.mock.calls[0]?.[2];
    expect(typeOf?.("bio")).toBe("json");
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
