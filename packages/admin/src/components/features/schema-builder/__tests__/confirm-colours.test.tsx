/**
 * Red means data is deleted, and nothing else, in every Builder dialog.
 *
 * The save review takes its answer from the preview's own rows: a removed
 * field always deletes (its column goes, and the preview's count of the values
 * in it reads 0 when counting fails), a type change deletes when the server
 * classes it `destructive`, and every other row (an add, a type change that
 * only converts, a field made required, translations moving to the archive)
 * does not. The preview's overall flag is NOT that answer: it
 * is set for any change that is not `safe`, a question to answer included, so
 * a review that followed it showed a red save over changes that delete
 * nothing.
 *
 * The cases that delete come first. A deletion shown in the primary colour is
 * the failure that costs data; a save shown red over nothing costs only trust.
 */
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { render, screen, within } from "@admin/__tests__/utils";
import type {
  InteractiveField,
  SchemaPreviewChange,
  SchemaPreviewLeavingTranslation,
  SchemaPreviewRenameCandidate,
} from "@admin/services/schemaApi";

import { FieldEditorSheet } from "../FieldEditorSheet";
import { SafeChangeConfirmDialog } from "../SafeChangeConfirmDialog";
import { SchemaChangeDialog } from "../SchemaChangeDialog";
import type { BuilderField } from "../types";

vi.mock("@admin/context/providers/BrandingProvider", async importOriginal => ({
  ...(await importOriginal<
    typeof import("@admin/context/providers/BrandingProvider")
  >()),
  useBranding: () => ({}),
}));

type Colour = "destructive" | "primary";

/** The colour a confirming button is drawn in, read from its fill. */
function colourOf(button: HTMLElement): Colour | "neither" {
  const classes = [...button.classList];
  if (classes.includes("bg-destructive-solid")) return "destructive";
  if (classes.includes("bg-primary")) return "primary";
  return "neither";
}

/** The dialog's confirming button: the last one in its footer. */
function confirmingButton(): HTMLElement {
  const dialog = screen.getByRole("alertdialog");
  const buttons = within(dialog).getAllByRole("button");
  return buttons[buttons.length - 1];
}

const none = (): SchemaPreviewChange => ({
  added: [],
  removed: [],
  changed: [],
  unchanged: [],
});

interface ReviewCase {
  changes?: Partial<SchemaPreviewChange>;
  renamed?: SchemaPreviewRenameCandidate[];
  interactiveFields?: InteractiveField[];
  leavingTranslation?: SchemaPreviewLeavingTranslation[];
  classification?: "safe" | "destructive" | "interactive";
  /** The preview's overall flag, set apart from the rows on purpose. */
  hasDestructiveChanges: boolean;
  /** What the server wrote beside the rows; present in every case by default. */
  warnings?: string[];
}

function reviewColour(review: ReviewCase): Colour | "neither" {
  render(
    <SchemaChangeDialog
      open
      onOpenChange={() => {}}
      kind="collection"
      entityName="posts"
      hasDestructiveChanges={review.hasDestructiveChanges}
      classification={review.classification ?? "safe"}
      changes={{ ...none(), ...review.changes }}
      renamed={review.renamed ?? []}
      warnings={review.warnings ?? ["A warning the server wrote."]}
      interactiveFields={review.interactiveFields ?? []}
      leavingTranslation={review.leavingTranslation}
      onConfirm={() => {}}
      isApplying={false}
    />
  );
  const colour = colourOf(confirmingButton());
  // The dialog answers "does this delete data" once: its data-loss notice
  // shows exactly when its confirm is red, whatever the server wrote.
  const notice = screen.queryByText("Data loss warning") !== null;
  expect(notice, "data-loss notice agrees with the confirm").toBe(
    colour === "destructive"
  );
  return colour;
}

const removedWithValues = {
  name: "body",
  type: "text",
  rowCount: 12,
  classification: "destructive",
};

describe("each Builder dialog's confirming button is destructive only when it deletes data", () => {
  // --- Deletes data: red, whatever the overall flag says. ---

  it("is destructive for a removed field the preview classes as deleting values", () => {
    expect(
      reviewColour({
        changes: { removed: [removedWithValues] },
        hasDestructiveChanges: false,
      })
    ).toBe("destructive");
  });

  it("is destructive for a removed field the preview counts as empty", () => {
    // Removing a field drops its column. The preview's count of the values in
    // it is best-effort and reads 0 when counting fails, so a removal is a
    // deletion whatever its count.
    expect(
      reviewColour({
        changes: {
          removed: [
            {
              name: "summary",
              type: "text",
              rowCount: 0,
              classification: "safe",
            },
          ],
        },
        hasDestructiveChanges: false,
        classification: "safe",
      })
    ).toBe("destructive");
  });

  it("is destructive for a type change the preview classes as losing values", () => {
    expect(
      reviewColour({
        changes: {
          changed: [
            {
              name: "price",
              from: "text",
              to: "number",
              rowCount: 40,
              classification: "destructive",
              reason: "type_changed",
            },
          ],
        },
        hasDestructiveChanges: false,
      })
    ).toBe("destructive");
  });

  it("is destructive for a rename resolved as drop and add over a column with values", () => {
    // A candidate whose types do not fit is not pre-selected, so the drop
    // stays a drop: the old column and its values go, a new one is added.
    expect(
      reviewColour({
        changes: {
          removed: [removedWithValues],
          added: [
            {
              name: "content",
              type: "number",
              required: false,
              hasDefault: false,
              classification: "safe",
            },
          ],
        },
        renamed: [
          {
            table: "dc_posts",
            from: "body",
            to: "content",
            fromType: "text",
            toType: "number",
            typesCompatible: false,
            preservesValues: false,
            defaultSuggestion: "drop_and_add",
          },
        ],
        hasDestructiveChanges: false,
      })
    ).toBe("destructive");
  });

  it("is destructive for the field sheet's delete, which deletes the field's values", async () => {
    const user = userEvent.setup();
    const field: BuilderField = {
      id: "f-1",
      name: "excerpt",
      label: "Excerpt",
      type: "textarea",
      isSystem: false,
      validation: {},
      admin: { width: "100%" },
    };
    render(
      <FieldEditorSheet
        open
        mode="edit"
        kind="collection"
        field={field}
        siblingFields={[]}
        onCancel={vi.fn()}
        onApply={vi.fn()}
        onDelete={vi.fn()}
      />
    );
    await user.click(screen.getByRole("button", { name: /delete field/i }));
    expect(colourOf(confirmingButton())).toBe("destructive");
  });

  // --- Deletes nothing: primary, whatever the overall flag says. ---

  it("is not red for a refused save that removes a field, which applies nothing", () => {
    // A field that cannot leave translation in one change refuses the whole
    // save: nothing runs, so its Save stays disabled and is not a deletion.
    expect(
      reviewColour({
        changes: { removed: [removedWithValues] },
        leavingTranslation: [
          {
            name: "metaTitle",
            column: "meta_title",
            byLocale: { fr: 2 },
            total: 2,
            entriesWithoutDefault: 1,
            defaultLocale: "en",
            restoreCommand: "nextly translations restore",
            refusal: { reason: "An entry has no English value.", steps: [] },
          },
        ],
        hasDestructiveChanges: true,
        classification: "destructive",
      })
    ).toBe("primary");
  });

  it("is primary for added fields", () => {
    expect(
      reviewColour({
        changes: {
          added: [
            {
              name: "summary",
              type: "text",
              required: false,
              hasDefault: false,
              classification: "safe",
            },
          ],
        },
        hasDestructiveChanges: false,
      })
    ).toBe("primary");
  });

  it("is primary for a type change that only converts values", () => {
    expect(
      reviewColour({
        changes: {
          changed: [
            {
              name: "count",
              from: "number",
              to: "text",
              rowCount: 40,
              classification: "safe",
              reason: "type_changed",
            },
          ],
        },
        hasDestructiveChanges: false,
      })
    ).toBe("primary");
  });

  it("is primary for a change that only asks a question, though the preview flags it", () => {
    expect(
      reviewColour({
        changes: {
          changed: [
            {
              name: "title",
              from: "text",
              to: "text",
              rowCount: 8,
              classification: "interactive",
              reason: "constraint_changed",
            },
          ],
        },
        interactiveFields: [
          {
            name: "title",
            reason: "nullable_to_not_null_with_nulls",
            tableRowCount: 8,
            nullCount: 2,
            options: ["provide_default", "mark_nullable", "cancel"],
          },
        ],
        classification: "interactive",
        hasDestructiveChanges: true,
      })
    ).toBe("primary");
  });

  it("is primary for fields leaving translation, whose values move to the archive", () => {
    expect(
      reviewColour({
        leavingTranslation: [
          {
            name: "metaTitle",
            column: "meta_title",
            byLocale: { en: 3, fr: 2 },
            total: 5,
            entriesWithoutDefault: 0,
            defaultLocale: "en",
            restoreCommand: "nextly translations restore",
          },
        ],
        hasDestructiveChanges: true,
        classification: "destructive",
      })
    ).toBe("primary");
  });

  it("is primary for the save of changes that do not affect existing data", () => {
    render(
      <SafeChangeConfirmDialog
        open
        onOpenChange={() => {}}
        kind="collection"
        entityName="posts"
        changes={{
          ...none(),
          added: [
            {
              name: "summary",
              type: "text",
              required: false,
              hasDefault: false,
              classification: "safe",
            },
          ],
        }}
        onConfirm={() => {}}
        isApplying={false}
      />
    );
    expect(colourOf(confirmingButton())).toBe("primary");
  });
});
