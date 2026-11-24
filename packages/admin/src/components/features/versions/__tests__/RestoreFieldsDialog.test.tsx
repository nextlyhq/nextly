/**
 * "Restore…": the fields a version would put back into the editor. Every
 * changed field is listed and chosen, and the person may unchoose any. A field
 * they may not read or change, or one no longer in the content type, is shown
 * unchosen and disabled with its reason. A field with an unsaved edit says the
 * restore replaces it. On a translated document the dialog names the language
 * it changes and each shared field that changes every language. Nothing is
 * stored: confirming hands the chosen fields to the editor.
 */
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { render, screen, within } from "@admin/__tests__/utils";

import { RestoreFieldsDialog } from "../RestoreFieldsDialog";
import type { RestoreRow } from "../restore-plan";

const rows: RestoreRow[] = [
  {
    name: "title",
    label: "Title",
    chosen: true,
    replacesUnsaved: false,
    shared: false,
    value: "Old",
  },
  {
    name: "views",
    label: "Views",
    chosen: true,
    replacesUnsaved: true,
    shared: false,
    value: 1,
  },
  {
    name: "secret",
    label: "Secret",
    chosen: false,
    disabled: "hidden",
    reason: "Hidden: you can't read this field",
    replacesUnsaved: false,
    shared: false,
  },
  {
    name: "subtitle",
    label: "subtitle",
    chosen: false,
    disabled: "removed",
    reason: "No longer in this content type",
    replacesUnsaved: false,
    shared: false,
  },
];

function renderDialog(
  props: Partial<Parameters<typeof RestoreFieldsDialog>[0]> = {}
) {
  const onConfirm = vi.fn();
  render(
    <RestoreFieldsDialog
      open
      onOpenChange={vi.fn()}
      versionNo={3}
      rows={rows}
      onConfirm={onConfirm}
      {...props}
    />
  );
  return { onConfirm };
}

describe("RestoreFieldsDialog", () => {
  it("lists every changed field, chosen", () => {
    renderDialog();

    expect(screen.getByRole("checkbox", { name: /Title/ })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: /Views/ })).toBeChecked();
  });

  it("shows a field that cannot be restored unchosen and disabled, with its reason", () => {
    renderDialog();

    const secret = screen.getByRole("checkbox", { name: /Secret/ });
    expect(secret).not.toBeChecked();
    expect(secret).toBeDisabled();
    expect(
      screen.getByText("Hidden: you can't read this field")
    ).toBeInTheDocument();
    const removed = screen.getByRole("checkbox", { name: /subtitle/ });
    expect(removed).toBeDisabled();
    expect(
      screen.getByText("No longer in this content type")
    ).toBeInTheDocument();
  });

  it("marks a field whose unsaved edit the restore replaces", () => {
    renderDialog();

    const views = screen.getByRole("checkbox", { name: /Views/ });
    const row = views.closest("li");
    expect(row).not.toBeNull();
    expect(
      within(row as HTMLElement).getByText("Replaces your unsaved edit")
    ).toBeInTheDocument();
    const title = screen.getByRole("checkbox", { name: /Title/ }).closest("li");
    expect(
      within(title as HTMLElement).queryByText("Replaces your unsaved edit")
    ).toBeNull();
  });

  it("hands the editor only the fields still chosen", async () => {
    const { onConfirm } = renderDialog();

    await userEvent.click(screen.getByRole("checkbox", { name: /Views/ }));
    await userEvent.click(
      screen.getByRole("button", { name: /Restore 1 field/ })
    );

    expect(onConfirm).toHaveBeenCalledWith(["title"]);
  });

  it("keeps the person's choices when the list refreshes while it is open", async () => {
    const props = {
      open: true,
      onOpenChange: vi.fn(),
      versionNo: 3,
      onConfirm: vi.fn(),
    };
    const { rerender } = render(<RestoreFieldsDialog {...props} rows={rows} />);
    await userEvent.click(screen.getByRole("checkbox", { name: /Views/ }));

    // The same list read again, with a field it did not list before.
    rerender(
      <RestoreFieldsDialog
        {...props}
        rows={[
          ...rows.map(row => ({ ...row })),
          {
            name: "body",
            label: "Body",
            chosen: true,
            replacesUnsaved: false,
            shared: false,
            value: "Then",
          },
        ]}
      />
    );

    expect(screen.getByRole("checkbox", { name: /Views/ })).not.toBeChecked();
    expect(screen.getByRole("checkbox", { name: /Title/ })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: /Body/ })).toBeChecked();
  });

  it("offers no restore once every field is unchosen", async () => {
    renderDialog();

    await userEvent.click(screen.getByRole("checkbox", { name: /Title/ }));
    await userEvent.click(screen.getByRole("checkbox", { name: /Views/ }));

    expect(screen.getByRole("button", { name: /Restore/ })).toBeDisabled();
  });

  it("names the language it changes, and each shared field as changing every language", () => {
    renderDialog({
      language: "Spanish",
      rows: [
        { ...rows[0]!, shared: false },
        { ...rows[1]!, shared: true },
      ],
    });

    const views = screen.getByRole("checkbox", { name: /Views/ }).closest("li");
    expect(
      within(views as HTMLElement).getByText("Shared · every language")
    ).toBeInTheDocument();
    const title = screen.getByRole("checkbox", { name: /Title/ }).closest("li");
    expect(
      within(title as HTMLElement).queryByText("Shared · every language")
    ).toBeNull();
    // Under the list, what the restore changes, counted from what is chosen.
    expect(
      screen.getByText(
        "Changes Spanish and 1 shared field, which changes every language."
      )
    ).toBeInTheDocument();
  });

  it("says a restore of translated fields alone leaves the other languages as they are", async () => {
    renderDialog({
      language: "Spanish",
      rows: [
        { ...rows[0]!, shared: false },
        { ...rows[1]!, shared: true },
      ],
    });
    // Unchoosing the shared field changes what the restore reaches.
    await userEvent.click(screen.getByRole("checkbox", { name: /Views/ }));

    expect(
      screen.getByText(
        "Changes Spanish only. Other languages and shared fields stay as they are."
      )
    ).toBeInTheDocument();
  });

  it("says what a restore does and does not do, under the list", () => {
    renderDialog();

    expect(
      screen.getByText("Readers see nothing change until you publish.")
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "Your other unsaved edits stay, and every version stays in History."
      )
    ).toBeInTheDocument();
    // An untranslated document has no language to name.
    expect(screen.queryByText(/^Changes /)).toBeNull();
  });

  it("names each field as the editor lays it out, and the value it puts back", () => {
    renderDialog({
      rows: [{ ...rows[0]!, place: ["Content"] }, rows[1]!, rows[2]!],
    });

    const title = screen.getByRole("checkbox", { name: /Title/ }).closest("li");
    expect(
      within(title as HTMLElement).getByText("Content › Title")
    ).toBeInTheDocument();
    expect(
      within(title as HTMLElement).getByText("Puts back “Old”")
    ).toBeInTheDocument();
    const views = screen.getByRole("checkbox", { name: /Views/ }).closest("li");
    expect(
      within(views as HTMLElement).getByText("Puts back “1”")
    ).toBeInTheDocument();
    // A hidden field's value never reaches the dialog, so nothing is quoted.
    const secret = screen
      .getByRole("checkbox", { name: /Secret/ })
      .closest("li");
    expect(within(secret as HTMLElement).queryByText(/Puts back/)).toBeNull();
  });

  it("shortens a long value to one line's worth", () => {
    renderDialog({
      rows: [{ ...rows[0]!, value: "word ".repeat(60).trim() }],
    });

    const line = screen.getByText(/^Puts back “/);
    expect(line.textContent).toMatch(/…”$/);
    expect(line.textContent!.length).toBeLessThan(110);
  });

  it("chooses one field alone when it was asked for by name", () => {
    renderDialog({ only: "views" });

    expect(screen.getByRole("checkbox", { name: /Views/ })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: /Title/ })).not.toBeChecked();
    expect(
      screen.getByRole("button", { name: "Restore 1 field" })
    ).toBeEnabled();
  });

  it("never calls putting back a structure it cannot quote a clearing", () => {
    renderDialog({
      rows: [
        { ...rows[0]!, value: { foo: "bar" } },
        { ...rows[1]!, value: null },
      ],
    });

    const title = screen.getByRole("checkbox", { name: /Title/ }).closest("li");
    expect(
      within(title as HTMLElement).getByText("Puts back the version's value")
    ).toBeInTheDocument();
    const views = screen.getByRole("checkbox", { name: /Views/ }).closest("li");
    expect(
      within(views as HTMLElement).getByText("Clears the field")
    ).toBeInTheDocument();
  });

  it("chooses nothing when the one field asked for cannot be restored", () => {
    // Asked for the hidden field: choosing every other field instead would
    // restore what the person did not ask for.
    renderDialog({ only: "secret" });

    for (const box of screen.getAllByRole("checkbox")) {
      expect(box).not.toBeChecked();
    }
    expect(
      screen.getByRole("button", { name: "Restore 0 fields" })
    ).toBeDisabled();
  });

  it("says a save is what readers see, where there is no publish step", () => {
    renderDialog({ lifecycle: false });

    expect(
      screen.getByText("Readers see nothing change until you save.")
    ).toBeInTheDocument();
    expect(screen.queryByText(/until you publish/)).toBeNull();
  });

  it("asks a question naming the version", () => {
    renderDialog();

    expect(
      screen.getByRole("alertdialog", { name: "Restore from version 3?" })
    ).toBeInTheDocument();
  });
});
