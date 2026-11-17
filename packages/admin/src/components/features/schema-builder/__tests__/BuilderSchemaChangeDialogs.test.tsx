// One preview, two dialogs: the short confirmation for an additive change with
// nothing to resolve, and the full one for everything else. The three builder
// pages used to spell that split as a second hand-written condition each, which
// had to stay in step with the one the dialogs themselves make; these tests
// lock the single rule that replaced them.
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { render, screen, within } from "@admin/__tests__/utils";
import type { SettingChange } from "@admin/lib/builder/settings-changes";
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
    isBusy: false,
    request: vi.fn(),
    setOpen: vi.fn(),
    settle: vi.fn(),
    beginPreview: vi.fn(),
    endPreview: vi.fn(),
    beginApply: vi.fn(),
    endApply: vi.fn(),
    ...overrides,
  };
}

function renderDialogs(
  p: SchemaPreviewResponse | null,
  onConfirm = vi.fn(),
  overrides: Partial<SchemaChangeConfirmation> = {},
  creating = false
) {
  const result = render(
    <BuilderSchemaChangeDialogs
      confirmation={confirmationOf(p, overrides)}
      kind="collection"
      entityName="posts"
      onConfirm={onConfirm}
      creating={creating}
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
  // A removal drops its field's column, and the preview's count of the values
  // in it reads 0 when counting fails, so a preview it calls safe can still be
  // deleting values. The short confirmation would say it "does not affect
  // existing data", in the primary colour.
  it("shows the full dialog, in red, for a safe change that removes a field", () => {
    renderDialogs(
      preview({
        changes: {
          added: [],
          removed: [
            {
              name: "summary",
              type: "text",
              rowCount: 0,
              classification: "safe",
            },
          ],
          changed: [],
          unchanged: [],
        },
      })
    );
    expect(
      screen.queryByText(/do not affect existing data/i)
    ).not.toBeInTheDocument();
    const dialog = screen.getByRole("alertdialog");
    const buttons = within(dialog).getAllByRole("button");
    expect(buttons[buttons.length - 1].className).toMatch(
      /\bbg-destructive-solid\b/
    );
  });

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
            column: "heading",
            entriesWithoutDefault: 0,
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

  it("says the values move although they could not be counted, and still names the restore", () => {
    renderDialogs(
      preview({
        leavingTranslation: [
          {
            name: "heading",
            column: "heading",
            entriesWithoutDefault: null,
            byLocale: null,
            total: null,
            defaultLocale: "en",
            restoreCommand:
              "nextly i18n:restore --collection posts --field heading",
          },
        ],
      })
    );

    expect(
      screen.getByText(
        "Values in other languages move to the archive; they couldn't be counted. English becomes the shared value."
      )
    ).toBeInTheDocument();
    expect(
      screen.queryByText(/No other language has a value/)
    ).not.toBeInTheDocument();
    expect(
      screen.getByText("nextly i18n:restore --collection posts --field heading")
    ).toBeInTheDocument();
  });

  it("says how many entries keep another language's value for want of an English one", () => {
    renderDialogs(
      preview({
        leavingTranslation: [
          {
            name: "heading",
            column: "heading",
            entriesWithoutDefault: 2,
            byLocale: { es: 4 },
            total: 4,
            defaultLocale: "en",
            restoreCommand:
              "nextly i18n:restore --collection posts --field heading",
          },
        ],
      })
    );

    expect(
      screen.getByText(
        "4 Spanish values move to the archive. English becomes the shared value. 2 entries have no English value and keep another language's instead."
      )
    ).toBeInTheDocument();
  });

  // The summary names whose page changes: entries whose shared value comes from another language
  // show that language's value to their English readers, so the languages are named.
  it("names the languages entries take their shared value from instead of English", () => {
    renderDialogs(
      preview({
        leavingTranslation: [
          {
            name: "heading",
            column: "heading",
            entriesWithoutDefault: 3,
            sharedFrom: { fr: 1, es: 2 },
            byLocale: { es: 4 },
            total: 4,
            defaultLocale: "en",
            restoreCommand:
              "nextly i18n:restore --collection posts --field heading",
          },
        ],
      })
    );

    expect(
      screen.getByText(
        "4 Spanish values move to the archive. English becomes the shared value. 3 entries take theirs from another language, which their English readers will see: 2 Spanish and 1 French."
      )
    ).toBeInTheDocument();
  });

  // A field becoming translated moves its values to the default language, and every other
  // language shows that value until it is translated: the short confirmation's "does not affect
  // existing data" would hide that, so the full dialog says it.
  it("shows the full dialog, saying whose values a field becoming translated keeps, for a field joining translation", () => {
    renderDialogs(
      preview({
        joiningTranslation: [
          {
            name: "heading",
            column: "heading",
            values: 2,
            defaultLocale: "en",
          },
        ],
      })
    );

    expect(screen.queryByText(/safe change/i)).not.toBeInTheDocument();
    expect(screen.getByText("now localized")).toBeInTheDocument();
    expect(
      screen.getByText(
        "2 values become the English value. Other languages show it until they are translated."
      )
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /save changes/i })).toBeEnabled();
  });

  it("says a field becoming translated keeps its values as English although they could not be counted", () => {
    renderDialogs(
      preview({
        joiningTranslation: [
          {
            name: "heading",
            column: "heading",
            values: null,
            defaultLocale: "en",
          },
        ],
      })
    );

    expect(
      screen.getByText(
        "Its values become the English value; they couldn't be counted. Other languages show it until they are translated."
      )
    ).toBeInTheDocument();
  });

  it("names the refusal and does not offer Apply for a field that cannot leave in one change", () => {
    renderDialogs(
      preview({
        leavingTranslation: [
          {
            // The prompt below names the field by its column, the notice by its name.
            name: "metaTitle",
            column: "meta_title",
            entriesWithoutDefault: 0,
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
            name: "meta_title",
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
      screen.getByText("Schema change needs another step")
    ).toBeInTheDocument();
    expect(
      screen.getByText(/This change cannot be saved to the collection/)
    ).toBeInTheDocument();
    expect(screen.queryByText(/will be applied to/)).not.toBeInTheDocument();
    // The push's own prompt for the refused field's new column is moot, so it is not asked.
    expect(
      screen.queryByText(/A new required field has no value/)
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
            column: "heading",
            entriesWithoutDefault: 0,
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

    const save = screen.getByRole("button", { name: "Save changes" });
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
            column: "heading",
            entriesWithoutDefault: 0,
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
      preview({
        classification: "destructive",
        hasDestructiveChanges: true,
        // What a destructive preview carries: a row the server classes as
        // deleting values, which is what the dialog's colour follows.
        changes: {
          added: [],
          removed: [
            {
              name: "body",
              type: "text",
              rowCount: 3,
              classification: "destructive",
            },
          ],
          changed: [],
          unchanged: [],
        },
      })
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

  // Saving an entity not created yet is its create. Its review is built in the
  // browser, not by the server, so it says what will be created and makes no
  // claim that the change is safe.
  it("says what saving a new entity creates, with no safety verdict", async () => {
    const { onConfirm } = renderDialogs(
      preview({
        changes: {
          added: [
            {
              name: "headline",
              type: "text",
              required: true,
              hasDefault: false,
              classification: "safe",
            },
          ],
          removed: [],
          changed: [],
          unchanged: [],
        },
      }),
      vi.fn(),
      {},
      true
    );
    const dialog = screen.getByRole("alertdialog");
    expect(
      within(dialog).getByRole("heading", {
        name: "Create the collection posts?",
      })
    ).toBeInTheDocument();
    expect(dialog).toHaveTextContent(
      "The collection posts will be created with these fields."
    );
    expect(dialog).toHaveTextContent("headline");
    expect(dialog).not.toHaveTextContent(/safe change/i);
    expect(dialog).not.toHaveTextContent(/do not affect existing data/i);

    await userEvent.click(
      within(dialog).getByRole("button", { name: "Create" })
    );
    expect(onConfirm).toHaveBeenCalledWith({}, []);
  });

  it("says a new entity with no fields is created with none", () => {
    renderDialogs(preview(), vi.fn(), {}, true);
    expect(screen.getByRole("alertdialog")).toHaveTextContent(
      "The collection posts will be created, with no fields yet."
    );
  });
});

// Each changed setting is a pending change, so the review lists it: alone, in
// a review of its own that saves without a restart, or beside the fields it is
// saved with, translation turned off among them.
describe("BuilderSchemaChangeDialogs: the settings a save changes", () => {
  const RENAMED: SettingChange = {
    key: "singularName",
    label: "name",
    from: "Post",
    to: "Article",
  };
  const DRAFTS_ON: SettingChange = {
    key: "status",
    label: "drafts and publishing",
    from: "off",
    to: "on",
  };

  function renderWithSettings(
    p: SchemaPreviewResponse,
    settingChanges: readonly SettingChange[],
    onConfirm = vi.fn()
  ) {
    render(
      <BuilderSchemaChangeDialogs
        confirmation={confirmationOf(p)}
        kind="collection"
        entityName="posts"
        onConfirm={onConfirm}
        settingChanges={settingChanges}
      />
    );
    return { onConfirm };
  }

  it("reviews a settings-only save: each setting it changes, saved without a restart", async () => {
    const { onConfirm } = renderWithSettings(preview({ hasChanges: false }), [
      RENAMED,
      DRAFTS_ON,
    ]);
    const dialog = screen.getByRole("alertdialog");
    expect(
      within(dialog).getByRole("heading", {
        name: "Save the settings of the collection posts?",
      })
    ).toBeInTheDocument();
    const listed = within(
      within(dialog).getByRole("list", { name: "Settings" })
    ).getAllByRole("listitem");
    expect(listed.map(item => item.textContent)).toEqual([
      "Name: Post → Article",
      "Drafts and publishing: off → on",
    ]);
    expect(dialog).not.toHaveTextContent(/restart/i);
    await userEvent.click(within(dialog).getByRole("button", { name: "Save" }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("lists the settings saved with a field change", () => {
    renderWithSettings(
      preview({
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
      }),
      [RENAMED]
    );
    const dialog = screen.getByRole("alertdialog");
    expect(within(dialog).getByText(/safe change/i)).toBeInTheDocument();
    expect(
      within(within(dialog).getByRole("list", { name: "Settings" }))
        .getAllByRole("listitem")
        .map(item => item.textContent)
    ).toEqual(["Name: Post → Article"]);
  });

  it("lists translation turned off among the settings, beside what leaving it moves", () => {
    renderWithSettings(
      preview({
        leavingTranslation: [
          {
            name: "heading",
            column: "heading",
            entriesWithoutDefault: 0,
            byLocale: { es: 12 },
            total: 12,
            defaultLocale: "en",
            restoreCommand:
              "nextly i18n:restore --collection posts --field heading",
          },
        ],
      }),
      [{ key: "i18n", label: "translation", from: "on", to: "off" }]
    );
    const dialog = screen.getByRole("alertdialog");
    expect(
      within(within(dialog).getByRole("list", { name: "Settings" }))
        .getAllByRole("listitem")
        .map(item => item.textContent)
    ).toEqual(["Translation: on → off"]);
    expect(
      within(dialog).getByText(
        "12 Spanish values move to the archive. English becomes the shared value."
      )
    ).toBeInTheDocument();
  });
});

// A field group made from the field picker and not saved yet is created by this save, before the
// entity: every review the save can open lists it first, so it is never created unseen.
describe("field groups the save creates first", () => {
  const HERO = { address: "hero", label: "Hero" };
  const ADDED_SUBTITLE = {
    added: [
      {
        name: "subtitle",
        type: "text",
        required: false,
        hasDefault: false,
        classification: "safe" as const,
      },
    ],
    removed: [],
    changed: [],
    unchanged: [],
  };

  function renderWithCreates(
    p: SchemaPreviewResponse,
    { creating = false }: { creating?: boolean } = {}
  ) {
    const onConfirm = vi.fn();
    render(
      <BuilderSchemaChangeDialogs
        confirmation={confirmationOf(p)}
        kind="collection"
        entityName="posts"
        onConfirm={onConfirm}
        creating={creating}
        fieldGroupCreates={[HERO]}
      />
    );
    return { onConfirm, dialog: screen.getByRole("alertdialog") };
  }

  /** The dialog's text, in order, from its first list of what the save creates. */
  function createsFirst(dialog: HTMLElement): void {
    const list = within(dialog).getByRole("list", {
      name: "Field groups created first",
    });
    expect(
      within(list)
        .getAllByRole("listitem")
        .map(item => item.textContent)
    ).toEqual(["Create the field group Hero"]);
    // Before anything else the dialog lists.
    const lists = within(dialog).getAllByRole("list");
    expect(lists[0]).toBe(list);
  }

  it("lists them first in the short confirmation", () => {
    const { dialog } = renderWithCreates(preview({ changes: ADDED_SUBTITLE }));
    expect(within(dialog).getByText(/safe change/i)).toBeInTheDocument();
    createsFirst(dialog);
  });

  it("lists them first in the full dialog", () => {
    const { dialog } = renderWithCreates(
      preview({
        hasDestructiveChanges: true,
        classification: "destructive",
        changes: {
          added: [],
          removed: [
            {
              name: "body",
              type: "text",
              rowCount: 2,
              classification: "destructive",
            },
          ],
          changed: [],
          unchanged: [],
        },
      })
    );
    createsFirst(dialog);
  });

  it("reviews a save whose only change is a field group to create", async () => {
    const { dialog, onConfirm } = renderWithCreates(
      preview({ hasChanges: false })
    );
    createsFirst(dialog);
    expect(dialog).not.toHaveTextContent(/restart/i);
    await userEvent.click(within(dialog).getByRole("button", { name: "Save" }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("lists them first in a new entity's create", () => {
    const { dialog } = renderWithCreates(preview({ changes: ADDED_SUBTITLE }), {
      creating: true,
    });
    createsFirst(dialog);
  });
});

describe("BuilderSchemaChangeDialogs: an unsaved entity's settings", () => {
  it("lists the settings changed before the first save in its create review", () => {
    render(
      <BuilderSchemaChangeDialogs
        confirmation={confirmationOf(preview())}
        kind="collection"
        entityName="posts"
        onConfirm={vi.fn()}
        creating
        settingChanges={[
          {
            key: "description",
            label: "description",
            from: "",
            to: "Long reads",
          },
        ]}
      />
    );
    const dialog = screen.getByRole("alertdialog");
    expect(
      within(dialog).getByRole("heading", {
        name: "Create the collection posts?",
      })
    ).toBeInTheDocument();
    expect(
      within(within(dialog).getByRole("list", { name: "Settings" }))
        .getAllByRole("listitem")
        .map(item => item.textContent)
    ).toEqual(["Description: none → Long reads"]);
  });
});

// A rename the Builder made is its own to answer (`useSchemaSave` sends it as one), so the dialog
// shows it as a rename whose values are kept: not as a field removed beside one added, not as a
// choice between renaming and losing the values, and not as a save that deletes data.
describe("a rename the Builder made", () => {
  const renaming = preview({
    hasDestructiveChanges: true,
    classification: "destructive",
    changes: {
      added: [
        {
          name: "abstract",
          type: "text",
          required: false,
          hasDefault: false,
          classification: "safe",
        },
      ],
      removed: [
        {
          name: "summary",
          type: "text",
          rowCount: 3,
          classification: "destructive",
        },
      ],
      changed: [],
      unchanged: [],
    },
    renamed: [
      {
        table: "dc_posts",
        from: "summary",
        to: "abstract",
        fromType: "text",
        toType: "text",
        typesCompatible: true,
        preservesValues: true,
        defaultSuggestion: "rename",
      },
    ],
  });

  it("shows it as a rename whose values are kept, with nothing to choose and nothing lost", () => {
    render(
      <BuilderSchemaChangeDialogs
        confirmation={confirmationOf(renaming)}
        kind="collection"
        entityName="posts"
        onConfirm={vi.fn()}
        draftRenames={[
          { label: "Summary", previousName: "summary", name: "abstract" },
        ]}
      />
    );
    expect(
      screen.getByText(/renamed to/i).closest("li, p, div")
    ).toHaveTextContent(/summary.*renamed to.*abstract.*values are kept/is);
    expect(screen.queryAllByRole("radio")).toHaveLength(0);
    expect(screen.queryByText("removed")).not.toBeInTheDocument();
    expect(
      screen.queryByText(/rows have non-null data/)
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText(/Remove it and add a new field/)
    ).not.toBeInTheDocument();
  });

  // A pair from another dropped field onto the renamed field's new column is not offered: the
  // column is the rename's.
  it("does not offer another field's pair onto the renamed field's new column", () => {
    render(
      <BuilderSchemaChangeDialogs
        confirmation={confirmationOf({
          ...renaming,
          renamed: [
            ...(renaming.renamed ?? []),
            { ...(renaming.renamed ?? [])[0], from: "body" },
          ],
        })}
        kind="collection"
        entityName="posts"
        onConfirm={vi.fn()}
        draftRenames={[
          { label: "Summary", previousName: "summary", name: "abstract" },
        ]}
      />
    );
    expect(screen.queryAllByRole("radio")).toHaveLength(0);
  });

  // A required field keeps its values through the rename, so the new column needs no default: the
  // preview's prompt for it (made before the pair was answered) is not the person's to answer, and
  // answering it "optional" would drop the field's Required.
  it("asks nothing about a required field's new column, and sends no answer for it", async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    render(
      <BuilderSchemaChangeDialogs
        confirmation={confirmationOf({
          ...renaming,
          classification: "interactive",
          interactiveFields: [
            {
              name: "abstract",
              reason: "new_required_no_default",
              tableRowCount: 3,
              options: ["provide_default", "mark_nullable", "cancel"],
            },
          ],
        })}
        kind="collection"
        entityName="posts"
        onConfirm={onConfirm}
        draftRenames={[
          { label: "Summary", previousName: "summary", name: "abstract" },
        ]}
      />
    );
    expect(screen.queryAllByRole("radio")).toHaveLength(0);
    await user.click(screen.getByRole("button", { name: /save changes/i }));
    expect(onConfirm).toHaveBeenCalledWith({}, expect.any(Array));
  });

  // A new name that keeps the column (`metaTitle` to `meta_title`) moves no value, though the
  // preview, by name, lists one field removed and another added: shown as the rename it is, with
  // nothing deleted and no removal to confirm.
  it("shows a rename that keeps its column as one, with nothing deleted", async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    render(
      <BuilderSchemaChangeDialogs
        confirmation={confirmationOf(
          preview({
            hasDestructiveChanges: true,
            classification: "destructive",
            changes: {
              added: [
                {
                  name: "meta_title",
                  type: "text",
                  required: false,
                  hasDefault: false,
                  classification: "safe",
                },
              ],
              removed: [
                {
                  name: "metaTitle",
                  type: "text",
                  rowCount: 3,
                  classification: "destructive",
                },
              ],
              changed: [],
              unchanged: [],
            },
          })
        )}
        kind="collection"
        entityName="posts"
        onConfirm={onConfirm}
        draftRenames={[
          {
            label: "Meta title",
            previousName: "metaTitle",
            name: "meta_title",
          },
        ]}
      />
    );
    expect(
      screen.getByText(/renamed to/i).closest("li, p, div")
    ).toHaveTextContent(/metaTitle.*renamed to.*meta_title.*values are kept/is);
    expect(screen.queryByText("removed")).not.toBeInTheDocument();
    expect(screen.queryByText(/data loss/i)).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /save changes/i }));
    expect(onConfirm).toHaveBeenCalledWith({}, []);
  });

  // The control: without the Builder's rename, the same preview asks, and shows the removal.
  it("still asks about the pair when the Builder did not rename the field", () => {
    renderDialogs(renaming);
    expect(screen.getAllByRole("radio").length).toBeGreaterThan(0);
    expect(screen.getByText("removed")).toBeInTheDocument();
  });
});
