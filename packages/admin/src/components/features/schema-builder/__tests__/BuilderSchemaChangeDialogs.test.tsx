// One preview, two dialogs: the short confirmation for an additive change with
// nothing to resolve, and the full one for everything else. The three builder
// pages used to spell that split as a second hand-written condition each, which
// had to stay in step with the one the dialogs themselves make; these tests
// lock the single rule that replaced them.
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { render, screen } from "@admin/__tests__/utils";
import type { SchemaPreviewResponse } from "@admin/services/schemaApi";

import { BuilderSchemaChangeDialogs } from "../BuilderSchemaChangeDialogs";
import type { SchemaChangeConfirmation } from "../types";

function preview(
  overrides: Partial<SchemaPreviewResponse> = {}
): SchemaPreviewResponse {
  return {
    hasChanges: true,
    hasDestructiveChanges: false,
    classification: "safe",
    changes: { added: [], removed: [], changed: [], unchanged: [] },
    warnings: [],
    interactiveFields: [],
    ddlPreview: [],
    schemaVersion: 3,
    renamed: [],
    ...overrides,
  };
}

function confirmationOf(
  p: SchemaPreviewResponse | null,
  overrides: Partial<SchemaChangeConfirmation> = {}
): SchemaChangeConfirmation {
  return {
    preview: p,
    isOpen: true,
    isApplying: false,
    request: vi.fn(),
    setOpen: vi.fn(),
    settle: vi.fn(),
    beginApply: vi.fn(),
    endApply: vi.fn(),
    ...overrides,
  };
}

function renderDialogs(
  p: SchemaPreviewResponse | null,
  onConfirm = vi.fn(),
  overrides: Partial<SchemaChangeConfirmation> = {}
) {
  const result = render(
    <BuilderSchemaChangeDialogs
      confirmation={confirmationOf(p, overrides)}
      entityName="posts"
      onConfirm={onConfirm}
    />
  );
  return { ...result, onConfirm };
}

describe("BuilderSchemaChangeDialogs", () => {
  it("renders nothing when no save is awaiting confirmation", () => {
    const { container } = renderDialogs(null);
    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  });

  it("shows the short confirmation for an additive change with no renames", () => {
    renderDialogs(preview());
    expect(screen.getByText(/safe change/i)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /apply and restart/i })
    ).toBeInTheDocument();
  });

  // A rename candidate needs a decision from the user even though nothing is
  // being destroyed, so a "safe" classification alone must not shorten the
  // dialog.
  it("shows the full dialog for a safe change that carries a rename candidate", () => {
    renderDialogs(
      preview({
        renamed: [
          {
            table: "posts",
            from: "body",
            to: "content",
            fromType: "text",
            toType: "text",
            typesCompatible: true,
            defaultSuggestion: "rename",
          },
        ],
      })
    );
    expect(screen.queryByText(/safe change/i)).not.toBeInTheDocument();
    // The full dialog is the one that asks the user to resolve the rename.
    expect(screen.getByText(/rename to/i)).toBeInTheDocument();
  });

  it("shows the full dialog for a destructive change", () => {
    renderDialogs(
      preview({ classification: "destructive", hasDestructiveChanges: true })
    );
    expect(screen.queryByText(/safe change/i)).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /apply changes/i })
    ).toBeInTheDocument();
  });

  it("stays closed when the confirmation is not open", () => {
    renderDialogs(preview(), vi.fn(), { isOpen: false });
    expect(screen.queryByText(/safe change/i)).not.toBeInTheDocument();
  });

  // The safe path resolves nothing, so it must confirm with an empty
  // resolution set rather than leaving the page to invent one.
  it("confirms the safe path with no resolutions and no renames", async () => {
    const user = userEvent.setup();
    const { onConfirm } = renderDialogs(preview());
    await user.click(
      screen.getByRole("button", { name: /apply and restart/i })
    );
    expect(onConfirm).toHaveBeenCalledWith({}, []);
  });

  it("passes the full dialog's resolutions straight through", async () => {
    const user = userEvent.setup();
    const { onConfirm } = renderDialogs(
      preview({
        classification: "destructive",
        hasDestructiveChanges: true,
        changes: {
          added: [],
          removed: [
            {
              name: "legacy",
              type: "text",
              rowCount: 0,
              classification: "destructive",
            },
          ],
          changed: [],
          unchanged: [],
        },
      })
    );
    await user.click(screen.getByRole("button", { name: /apply changes/i }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onConfirm.mock.calls[0][0]).toEqual({
      legacy: { action: "confirm_drop" },
    });
  });

  it("disables the confirm while the apply is in flight", () => {
    renderDialogs(preview(), vi.fn(), { isApplying: true });
    expect(screen.getByRole("button", { name: /applying/i })).toBeDisabled();
  });
});
