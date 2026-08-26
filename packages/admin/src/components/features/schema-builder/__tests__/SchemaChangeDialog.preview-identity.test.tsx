// Dismissing a preview keeps the dialog mounted so a retry re-opens the same
// unsaved answers. These lock the other half of that: a DIFFERENT preview must
// arrive with its own answers, because an answer about one column is not an
// answer about another.
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";

import { render, screen } from "@admin/__tests__/utils";
import { useSchemaChangeConfirmation } from "@admin/hooks/useSchemaChangeConfirmation";
import type {
  SchemaPreviewRenameCandidate,
  SchemaPreviewResponse,
} from "@admin/services/schemaApi";

import { BuilderSchemaChangeDialogs } from "../BuilderSchemaChangeDialogs";

function rename(
  over: Partial<SchemaPreviewRenameCandidate> = {}
): SchemaPreviewRenameCandidate {
  return {
    table: "dc_posts",
    from: "title",
    to: "heading",
    fromType: "text",
    toType: "text",
    typesCompatible: true,
    preservesValues: true,
    defaultSuggestion: "rename",
    ...over,
  };
}

function preview(
  renamed: SchemaPreviewRenameCandidate[]
): SchemaPreviewResponse {
  return {
    hasChanges: true,
    hasDestructiveChanges: true,
    classification: "destructive",
    changes: { added: [], removed: [], changed: [], unchanged: [] },
    warnings: [],
    interactiveFields: [],
    ddlPreview: [],
    schemaVersion: 3,
    renamed,
  };
}

/** A builder page, reduced to the two buttons these tests need. */
function Host({
  first,
  second,
  entityName = "posts",
}: {
  first: SchemaPreviewResponse;
  second: SchemaPreviewResponse;
  entityName?: string;
}) {
  const confirmation = useSchemaChangeConfirmation();
  const [n, setN] = useState(0);
  return (
    <>
      <button
        onClick={() => {
          confirmation.request(n === 0 ? first : second);
          setN(x => x + 1);
        }}
      >
        save
      </button>
      <BuilderSchemaChangeDialogs
        confirmation={confirmation}
        entityName={entityName}
        onConfirm={vi.fn()}
      />
    </>
  );
}

const selectedRenameLabel = () =>
  screen
    .getAllByRole("radio")
    .find(r => (r as HTMLInputElement).checked)
    ?.closest("label")?.textContent ?? "";

describe("a second preview after the first was dismissed", () => {
  it("selects its own preserving candidate, not the previous preview's", async () => {
    const user = userEvent.setup();
    render(
      <Host
        first={preview([rename({ from: "title", to: "heading" })])}
        second={preview([rename({ from: "author", to: "byline" })])}
      />
    );

    await user.click(screen.getByRole("button", { name: "save" }));
    expect(selectedRenameLabel()).toContain("heading");

    await user.click(screen.getByRole("button", { name: "Cancel" }));
    await user.click(screen.getByRole("button", { name: "save" }));

    expect(selectedRenameLabel()).toContain("byline");
  });

  it("does not leave every candidate unselected when the columns change", async () => {
    // The failure this guards is quieter than a wrong selection: when no key
    // matches, no radio is checked at all and Apply still sends every
    // candidate as drop_and_add.
    const user = userEvent.setup();
    render(
      <Host
        first={preview([rename({ from: "title", to: "heading" })])}
        second={preview([rename({ from: "author", to: "byline" })])}
      />
    );

    await user.click(screen.getByRole("button", { name: "save" }));
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    await user.click(screen.getByRole("button", { name: "save" }));

    expect(
      screen.getAllByRole("radio").some(r => (r as HTMLInputElement).checked)
    ).toBe(true);
  });

  it("keeps the author's answer across a re-render of the page around it", async () => {
    // The control. The reset is meant to happen once per preview, not on every
    // render — a dialog that rebuilt its selections whenever its parent
    // re-rendered would satisfy the two tests above and quietly discard what
    // the author had chosen.
    const user = userEvent.setup();
    const only = preview([rename({ from: "title", to: "heading" })]);
    const { rerender } = render(<Host first={only} second={only} />);

    await user.click(screen.getByRole("button", { name: "save" }));
    await user.click(
      screen.getAllByRole("radio").find(r => !(r as HTMLInputElement).checked)!
    );
    expect(selectedRenameLabel()).toContain("Drop");

    rerender(<Host first={only} second={only} entityName="articles" />);

    expect(selectedRenameLabel()).toContain("Drop");
  });
});
