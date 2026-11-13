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

    expect(screen.getByText(/Spanish/)).toBeInTheDocument();
    const views = screen.getByRole("checkbox", { name: /Views/ }).closest("li");
    expect(
      within(views as HTMLElement).getByText("Changes every language")
    ).toBeInTheDocument();
    const title = screen.getByRole("checkbox", { name: /Title/ }).closest("li");
    expect(
      within(title as HTMLElement).queryByText("Changes every language")
    ).toBeNull();
  });

  it("says nothing is saved until the person saves or publishes", () => {
    renderDialog();

    expect(
      screen.getByText(/Nothing is saved until you save/)
    ).toBeInTheDocument();
  });
});
