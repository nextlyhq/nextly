import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type {
  FieldResolution,
  SchemaPreviewChange,
  SchemaPreviewRenameCandidate,
} from "@admin/services/schemaApi";

import { SafeChangeConfirmDialog } from "../SafeChangeConfirmDialog";
import { SchemaChangeDialog } from "../SchemaChangeDialog";

// A preview diff with nothing in it; each test fills only the arrays it needs.
const emptyChanges = (): SchemaPreviewChange => ({
  added: [],
  removed: [],
  changed: [],
  unchanged: [],
});

// Renders the dialog in its destructive-change state and captures the
// resolutions the dialog emits on confirm, which is what these tests assert on.
// The confirm reads "Apply changes" when a row deletes values and "Save
// changes" when none does.
function renderDialog(
  changes: SchemaPreviewChange,
  onConfirm: (
    resolutions: Record<string, FieldResolution>,
    renameResolutions: unknown[]
  ) => void,
  renamed: SchemaPreviewRenameCandidate[] = []
) {
  render(
    <SchemaChangeDialog
      open
      onOpenChange={() => {}}
      kind="collection"
      entityName="posts"
      hasDestructiveChanges
      classification="destructive"
      changes={changes}
      renamed={renamed}
      warnings={[]}
      interactiveFields={[]}
      onConfirm={onConfirm}
      isApplying={false}
    />
  );
}

describe("SchemaChangeDialog destructive-drop acknowledgment", () => {
  // Removing a field drops its column; the server now refuses an
  // unacknowledged drop, so the dialog must send an explicit confirm_drop per
  // removed field or the deletion the user just confirmed would fail closed.
  it("attaches a confirm_drop resolution for each removed field", () => {
    const onConfirm = vi.fn();
    const changes = emptyChanges();
    changes.removed = [
      {
        name: "body",
        type: "text",
        rowCount: 5,
        classification: "destructive",
      },
      {
        name: "legacy",
        type: "text",
        rowCount: 0,
        classification: "destructive",
      },
    ];
    renderDialog(changes, onConfirm);

    fireEvent.click(screen.getByRole("button", { name: /apply changes/i }));

    const resolutions = onConfirm.mock.calls[0][0] as Record<
      string,
      FieldResolution
    >;
    expect(resolutions.body).toEqual({ action: "confirm_drop" });
    expect(resolutions.legacy).toEqual({ action: "confirm_drop" });
  });

  // A purely additive change destroys no data, so the dialog must not attach
  // spurious confirm_drop resolutions that would misrepresent the intent.
  it("sends no confirm_drop resolutions when nothing is removed", () => {
    const onConfirm = vi.fn();
    const changes = emptyChanges();
    changes.added = [
      {
        name: "subtitle",
        type: "text",
        required: false,
        hasDefault: false,
        classification: "safe",
      },
    ];
    renderDialog(changes, onConfirm);

    // Nothing is deleted, so the confirm is the plain save.
    fireEvent.click(screen.getByRole("button", { name: /save changes/i }));

    const resolutions = onConfirm.mock.calls[0][0] as Record<
      string,
      FieldResolution
    >;
    expect(resolutions).toEqual({});
  });
});

describe("SchemaChangeDialog renames of a translated field", () => {
  // A translated field's column lives on the companion `<table>_locales`, so its rename is
  // offered there. It has to read as a rename, chosen by default, and come back as one, or the
  // apply drops the column and every language's value with it.
  it("offers the rename on the companion, chosen, and sends it back as a rename", () => {
    const onConfirm = vi.fn();
    renderDialog(emptyChanges(), onConfirm, [
      {
        table: "dc_posts_locales",
        from: "heading",
        to: "title2",
        fromType: "text",
        toType: "text",
        typesCompatible: true,
        preservesValues: true,
        defaultSuggestion: "rename",
      },
    ]);

    expect(
      screen.getByRole("radio", { name: /rename to title2/i })
    ).toBeChecked();

    // A rename keeps every value, so the confirm is the plain save.
    fireEvent.click(screen.getByRole("button", { name: /save changes/i }));

    expect(onConfirm.mock.calls[0][1]).toEqual([
      {
        tableName: "dc_posts_locales",
        fromColumn: "heading",
        toColumn: "title2",
        choice: "rename",
      },
    ]);
  });
});

describe("SchemaChangeDialog and SafeChangeConfirmDialog name the kind", () => {
  // The review is shown for Singles and field groups too, so a title or
  // description fixed to "collection" misnames what is being saved.
  it("titles a Single's plain save by its kind and names it in the description", () => {
    render(
      <SchemaChangeDialog
        open
        onOpenChange={() => {}}
        kind="single"
        entityName="homepage"
        hasDestructiveChanges={false}
        classification="safe"
        changes={emptyChanges()}
        warnings={[]}
        interactiveFields={[]}
        onConfirm={() => {}}
        isApplying={false}
      />
    );
    expect(
      screen.getByRole("heading", { name: "Save Single" })
    ).toBeInTheDocument();
    expect(
      screen.getByText(/will be applied to the Single/)
    ).toBeInTheDocument();
    expect(screen.queryByText(/collection/i)).not.toBeInTheDocument();
  });

  it("names a field group in the short confirmation's title", () => {
    render(
      <SafeChangeConfirmDialog
        open
        onOpenChange={() => {}}
        kind="field-group"
        entityName="hero"
        changes={emptyChanges()}
        onConfirm={() => {}}
        isApplying={false}
      />
    );
    expect(
      screen.getByRole("heading", {
        name: "Apply changes to the field group hero?",
      })
    ).toBeInTheDocument();
  });
});
