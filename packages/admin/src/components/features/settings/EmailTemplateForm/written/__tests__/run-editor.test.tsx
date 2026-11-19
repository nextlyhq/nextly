/**
 * The editor of a written block's text: it stops taking input the moment the
 * email turns read-only (as during a save), it shows a chip's marks, and it
 * puts a link on the selected text.
 */
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  $createRangeSelection,
  $getRoot,
  $setSelection,
  type LexicalEditor,
} from "lexical";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { Inline } from "../runs";
import { ChipViewContext } from "../ChipLabel";
import { RunEditor } from "../RunEditor";

const toast = vi.hoisted(() => ({ info: vi.fn() }));
vi.mock("@admin/components/ui", async importOriginal => ({
  ...(await importOriginal<typeof import("@admin/components/ui")>()),
  toast,
}));

afterEach(() => toast.info.mockReset());

/**
 * A rich text field holding `value`, with the field's editor in hand once
 * focused, and the runs it reports.
 */
function mountText(initial: Inline[]) {
  const seen = vi.fn<(runs: Inline[]) => void>();
  let editor: LexicalEditor | undefined;
  // The runs held as the form holds them, so each change is the new value.
  function Field() {
    const [value, setValue] = useState(initial);
    return (
      <RunEditor
        rich
        label="Text"
        value={value}
        onChange={runs => {
          seen(runs);
          setValue(runs);
        }}
        onFocusEditor={focused => {
          editor = focused;
        }}
      />
    );
  }
  render(
    <ChipViewContext.Provider
      value={{
        name: path => (path === "orderUrl" ? "Order page" : path),
        blank: () => false,
        paths: ["orderUrl"],
      }}
    >
      <Field />
    </ChipViewContext.Provider>
  );
  fireEvent.focus(screen.getByRole("textbox", { name: "Text" }));
  /** Selects from `from` in the field's first text to `to` in its last. */
  const select = (from: number, to: number) =>
    act(() => {
      editor?.update(
        () => {
          const texts = $getRoot().getAllTextNodes();
          const selection = $createRangeSelection();
          selection.anchor.set(texts[0].getKey(), from, "text");
          selection.focus.set(texts[texts.length - 1].getKey(), to, "text");
          $setSelection(selection);
        },
        { discrete: true }
      );
    });
  const last = () => seen.mock.calls[seen.mock.calls.length - 1]?.[0];
  return { select, last };
}

describe("a written block's text editor", () => {
  it("stops taking input when the email turns read-only", () => {
    const { rerender } = render(
      <RunEditor label="Heading" value={[]} onChange={() => {}} />
    );
    expect(
      screen
        .getByRole("textbox", { name: "Heading" })
        .getAttribute("contenteditable")
    ).toBe("true");
    rerender(
      <RunEditor label="Heading" value={[]} onChange={() => {}} readOnly />
    );
    expect(
      screen
        .getByRole("textbox", { name: "Heading" })
        .getAttribute("contenteditable")
    ).toBe("false");
  });

  it("shows a chip in bold or italic when it is stored so", () => {
    const { container } = render(
      <RunEditor
        rich
        label="Text"
        value={[{ type: "chip", variable: "name", bold: true, italic: true }]}
        onChange={() => {}}
      />
    );
    const chip = container.querySelector('[data-variable="name"]');
    expect(chip?.className).toContain("font-semibold");
    expect(chip?.className).toContain("italic");
  });

  it("links the selected text to an address", async () => {
    const user = userEvent.setup();
    const { select, last } = mountText([{ type: "text", text: "Track it" }]);
    select(6, 8);
    await user.click(screen.getByRole("button", { name: "Link" }));
    const dialog = await screen.findByRole("dialog", { name: "Add link" });
    await user.type(
      within(dialog).getByLabelText("Address"),
      "https://shop.example"
    );
    await user.click(within(dialog).getByRole("button", { name: "Save link" }));
    expect(last()).toEqual([
      { type: "text", text: "Track " },
      { type: "text", text: "it", link: { url: "https://shop.example" } },
    ]);
  });

  it("links to a variable chosen by name, and removes a link", async () => {
    const user = userEvent.setup();
    const { select, last } = mountText([{ type: "text", text: "See order" }]);
    select(4, 9);
    await user.click(screen.getByRole("button", { name: "Link" }));
    let dialog = await screen.findByRole("dialog", { name: "Add link" });
    await user.click(within(dialog).getByLabelText("A variable"));
    await user.selectOptions(
      within(dialog).getByLabelText("Variable"),
      "Order page"
    );
    await user.click(within(dialog).getByRole("button", { name: "Save link" }));
    expect(last()).toEqual([
      { type: "text", text: "See " },
      { type: "text", text: "order", link: { chip: { variable: "orderUrl" } } },
    ]);

    // From the start of "See " to the end of the linked "order".
    select(0, 5);
    await user.click(screen.getByRole("button", { name: "Link" }));
    dialog = await screen.findByRole("dialog", { name: "Edit link" });
    await user.click(
      within(dialog).getByRole("button", { name: "Remove link" })
    );
    expect(last()).toEqual([{ type: "text", text: "See order" }]);
  });

  it("says to select text first when nothing is selected", async () => {
    const user = userEvent.setup();
    const { select } = mountText([{ type: "text", text: "Hi" }]);
    select(1, 1);
    await user.click(screen.getByRole("button", { name: "Link" }));
    expect(toast.info).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
