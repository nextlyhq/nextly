// A save that moves a field into or out of a group is reviewed as a move whose values are kept:
// the field's old column is not listed as removed, nothing reads as deleting data, and the save's
// own lines on the move (what it does not carry) are shown as the server wrote them.
import { describe, expect, it, vi } from "vitest";

import { render, screen } from "@admin/__tests__/utils";
import type { SchemaPreviewResponse } from "@admin/services/schemaApi";

import { BuilderSchemaChangeDialogs } from "../BuilderSchemaChangeDialogs";
import type { SchemaChangeConfirmation } from "../types";

const NOT_CARRIED =
  "Moving summary into meta keeps every value; not carried, since a JSON value has no place for them: index posts_summary_idx.";

const previewed: SchemaPreviewResponse = {
  hasChanges: true,
  hasDestructiveChanges: true,
  classification: "destructive",
  changes: {
    added: [],
    removed: [
      {
        name: "summary",
        type: "text",
        rowCount: 12,
        classification: "destructive",
      },
    ],
    changed: [],
    unchanged: [],
  },
  warnings: [],
  interactiveFields: [],
  ddlPreview: [],
  schemaVersion: 3,
  renamed: [],
  notices: [NOT_CARRIED],
};

const confirmation: SchemaChangeConfirmation = {
  preview: previewed,
  previewId: 1,
  isOpen: true,
  isApplying: false,
  isBusy: false,
  request: vi.fn(),
  setOpen: vi.fn(),
  settle: vi.fn(),
  beginPreview: vi.fn(),
  endPreview: vi.fn(),
  beginApply: vi.fn(),
  endApply: vi.fn(),
};

describe("the review of a save that moves a field", () => {
  it("shows the move as kept, not the field as removed, with the save's own line on it", () => {
    render(
      <BuilderSchemaChangeDialogs
        confirmation={confirmation}
        kind="collection"
        entityName="posts"
        onConfirm={vi.fn()}
        draftMoves={[
          {
            fieldId: "summary",
            label: "summary",
            from: ["summary"],
            to: ["meta", "summary"],
          },
        ]}
      />
    );

    const dialog = screen.getByRole("alertdialog");
    expect(dialog).toHaveTextContent(
      "summary is moved to meta.summary. Its values are kept."
    );
    expect(dialog).toHaveTextContent(NOT_CARRIED);
    expect(dialog).not.toHaveTextContent("12 rows");
  });
});
