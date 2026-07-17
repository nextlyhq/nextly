import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type {
  FieldResolution,
  SchemaPreviewChange,
} from "@admin/services/schemaApi";

import { SchemaChangeDialog } from "../SchemaChangeDialog";

// A preview diff with nothing in it; each test fills only the arrays it needs.
const emptyChanges = (): SchemaPreviewChange => ({
  added: [],
  removed: [],
  changed: [],
  unchanged: [],
});

// Renders the dialog in its destructive-change state (the only mode that shows
// the confirm button as "Apply Changes") and captures the resolutions the
// dialog emits on confirm, which is what these tests assert on.
function renderDialog(
  changes: SchemaPreviewChange,
  onConfirm: (
    resolutions: Record<string, FieldResolution>,
    renameResolutions: unknown[]
  ) => void
) {
  render(
    <SchemaChangeDialog
      open
      onOpenChange={() => {}}
      collectionName="posts"
      hasDestructiveChanges
      classification="destructive"
      changes={changes}
      renamed={[]}
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

    fireEvent.click(screen.getByRole("button", { name: /apply changes/i }));

    const resolutions = onConfirm.mock.calls[0][0] as Record<
      string,
      FieldResolution
    >;
    expect(resolutions).toEqual({});
  });
});
