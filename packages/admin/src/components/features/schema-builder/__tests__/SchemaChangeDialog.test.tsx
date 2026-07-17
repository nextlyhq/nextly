import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type {
  FieldResolution,
  SchemaPreviewChange,
} from "@admin/services/schemaApi";

import { SchemaChangeDialog } from "../SchemaChangeDialog";

const emptyChanges = (): SchemaPreviewChange => ({
  added: [],
  removed: [],
  changed: [],
  unchanged: [],
});

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
