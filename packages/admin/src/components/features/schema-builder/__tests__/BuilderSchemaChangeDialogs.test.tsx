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

const REQUIRED_REFUSAL = {
  reason: "A required field can't stop being translated in the same change.",
  steps: [
    "Turn off Required and save.",
    "Turn off Localized and save.",
    "Turn Required back on and save.",
  ],
};

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
    previewId: 1,
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
            preservesValues: true,
            defaultSuggestion: "rename",
          },
        ],
      })
    );
    expect(screen.queryByText(/safe change/i)).not.toBeInTheDocument();
    // The full dialog is the one that asks the user to resolve the rename.
    expect(screen.getByText(/rename to/i)).toBeInTheDocument();
  });

  // A field leaving translation moves its other languages to the archive, so the
  // short confirmation's "does not affect existing data" would be untrue.
  it("shows the full dialog, saying what moves to the archive, for a field leaving translation", () => {
    renderDialogs(
      preview({
        leavingTranslation: [
          {
            name: "heading",
            byLocale: { ar: 3, es: 12 },
            total: 15,
            defaultLocale: "en",
            restoreCommand:
              "nextly i18n:restore --collection posts --field heading",
          },
        ],
      })
    );

    expect(screen.queryByText(/safe change/i)).not.toBeInTheDocument();
    expect(
      screen.getByText(
        "12 Spanish and 3 Arabic values move to the archive. English becomes the shared value."
      )
    ).toBeInTheDocument();
    expect(
      screen.getByText("nextly i18n:restore --collection posts --field heading")
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /save changes/i })).toBeEnabled();
  });

  it("names the refusal and does not offer Apply for a field that cannot leave in one change", () => {
    renderDialogs(
      preview({
        leavingTranslation: [
          {
            name: "heading",
            byLocale: { es: 2 },
            total: 2,
            defaultLocale: "en",
            restoreCommand:
              "nextly i18n:restore --collection posts --field heading",
            refusal: REQUIRED_REFUSAL,
          },
        ],
        classification: "interactive",
        interactiveFields: [
          {
            name: "heading",
            reason: "new_required_no_default",
            tableRowCount: 2,
            options: ["provide_default", "mark_nullable", "cancel"],
          },
        ],
      })
    );

    expect(screen.getByText("Needs three steps")).toBeInTheDocument();
    expect(
      screen.getByText(/A required field can't stop being translated/)
    ).toBeInTheDocument();
    // The steps as an ordered list, in the order they have to be taken.
    expect(
      screen.getAllByRole("listitem").map(item => item.textContent)
    ).toEqual(REQUIRED_REFUSAL.steps);
    expect(screen.queryByText(/nextly i18n:restore/)).not.toBeInTheDocument();
    expect(
      screen.getByText("Schema Change Needs Another Step")
    ).toBeInTheDocument();
    expect(
      screen.getByText(/This change cannot be saved to/)
    ).toBeInTheDocument();
    expect(screen.queryByText(/will be applied to/)).not.toBeInTheDocument();
    // The push's own prompt for the refused field's new column is moot, so it is not asked.
    expect(
      screen.queryByText(/is required but table has/)
    ).not.toBeInTheDocument();
    // Nothing in the change could be saved, so the only way out is Close.
    expect(screen.getByRole("button", { name: "Close" })).toBeEnabled();
    expect(
      screen.queryByRole("button", { name: /apply changes|save changes/i })
    ).not.toBeInTheDocument();
  });

  it("keeps Save, disabled and not as a danger, when another change could be saved", () => {
    renderDialogs(
      preview({
        hasDestructiveChanges: true,
        classification: "destructive",
        changes: {
          added: [
            {
              name: "subtitle",
              type: "text",
              required: false,
              hasDefault: false,
              classification: "safe",
            },
          ],
          removed: [],
          changed: [],
          unchanged: [],
        },
        leavingTranslation: [
          {
            name: "heading",
            byLocale: {},
            total: 0,
            defaultLocale: "en",
            restoreCommand:
              "nextly i18n:restore --collection posts --field heading",
            refusal: REQUIRED_REFUSAL,
          },
        ],
      })
    );

    const save = screen.getByRole("button", { name: "Save Changes" });
    expect(save).toBeDisabled();
    expect(save.className).toMatch(/\bbg-primary\b/);
    expect(save.className).not.toMatch(/bg-destructive/);
    expect(
      screen.getByText("Fix the field above to save.")
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Close" })
    ).not.toBeInTheDocument();
  });

  it("copies the restore command", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });
    renderDialogs(
      preview({
        leavingTranslation: [
          {
            name: "heading",
            byLocale: { es: 1 },
            total: 1,
            defaultLocale: "en",
            restoreCommand:
              "nextly i18n:restore --collection posts --field heading",
          },
        ],
      })
    );

    await userEvent.click(
      screen.getByRole("button", { name: /copy the restore command/i })
    );

    expect(writeText).toHaveBeenCalledWith(
      "nextly i18n:restore --collection posts --field heading"
    );
    expect(
      await screen.findByRole("button", { name: "Copied" })
    ).toBeInTheDocument();
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

describe("a rename that keeps the rows but converts their values", () => {
  it("does not call it preserved, and says what happens instead", () => {
    // `numeric` and `float8` are compatible enough to rename between and the
    // dialog used to read that as "data preserved" — while every stored
    // decimal became the nearest binary float.
    renderDialogs(
      preview({
        renamed: [
          {
            table: "orders",
            from: "amount",
            to: "total",
            fromType: "numeric(10,2)",
            toType: "float8",
            typesCompatible: true,
            preservesValues: false,
            valueChangeReason:
              "exact decimals become the nearest binary float, so stored digits are lost",
            defaultSuggestion: "rename",
          },
        ],
      })
    );

    expect(screen.queryByText(/data preserved/i)).not.toBeInTheDocument();
    expect(screen.getByText(/rows kept, values change/i)).toBeInTheDocument();
    expect(screen.getByText(/nearest binary float/i)).toBeInTheDocument();
  });

  it("still says preserved when the values really are", () => {
    // The control: without it, "does not say preserved" is satisfied by a
    // dialog that stopped saying it at all.
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
            preservesValues: true,
            defaultSuggestion: "rename",
          },
        ],
      })
    );
    expect(screen.getByText(/data preserved/i)).toBeInTheDocument();
  });
});
