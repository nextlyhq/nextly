// @vitest-environment jsdom

/**
 * "Save as shared style…": the name, the class name it gives, what moves, and
 * the order of the two writes.
 */
import type { BlockDocument, NamedClass } from "@nextlyhq/blocks-engine";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import * as React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { EditorState } from "./editor-state";
import { SaveSharedStyleDialog } from "./shared-style-save-dialog";

afterEach(cleanup);

const card: NamedClass = {
  id: "c-card",
  slug: "card",
  orderIndex: 4,
  styles: {},
};

function editorWith(
  styles: Record<string, unknown> = {
    base: { base: { color: "#123456" }, md: { color: "#654321" } },
    hover: { base: { color: "#000000" } },
  }
): EditorState & { applyAll: ReturnType<typeof vi.fn> } {
  const document = {
    formatVersion: 1,
    kind: "page",
    nodes: [
      {
        id: "a",
        type: "core/box",
        version: 1,
        props: {},
        styles,
      },
    ],
  } as unknown as BlockDocument;
  return {
    document,
    selectedId: "a",
    selection: { ids: ["a"], primary: "a" },
    applyAll: vi.fn(() => document),
    lockRefusalFor: () => undefined,
    composed: () => undefined,
  } as unknown as EditorState & { applyAll: ReturnType<typeof vi.fn> };
}

function open(
  onAdd = vi.fn(async (_entry: NamedClass) => undefined as string | undefined)
) {
  const editor = editorWith();
  const onSaved = vi.fn();
  const onClose = vi.fn();
  render(
    <SaveSharedStyleDialog
      editor={editor}
      nodeId="a"
      offer={{ library: [card], mayChange: true }}
      onAdd={onAdd}
      onSaved={onSaved}
      onClose={onClose}
    />
  );
  return { editor, onAdd, onSaved, onClose };
}

const name = () => screen.getByRole("textbox", { name: "Name" });

describe("naming the new shared style", () => {
  it("says what moves, and shows the class name as the author types", () => {
    open();
    expect(
      screen.getByText(
        /Moves this block's 3 values \(2 devices, Hover\) into the new shared style\./
      )
    ).toBeDefined();
    fireEvent.change(name(), { target: { value: "Primary button" } });
    // The class the page will carry, as developers read it.
    expect(screen.getByText(".nx-c-primary-button")).toBeDefined();
    expect(screen.getByText(/into Primary button\./)).toBeDefined();
  });

  it("refuses a name whose class name another style has, before saving", () => {
    const { onAdd } = open();
    fireEvent.change(name(), { target: { value: "Card" } });
    // Named as typed, in the field-error style the other editors use.
    const alert = screen.getByRole("alert");
    expect(alert.textContent).toBe(
      "“Card” is already a shared style. Choose another name."
    );
    expect(alert.className).toBe("nx-vars-editor__issue");
    // Nothing reads as a merge into the style that already has the name.
    expect(screen.queryByText(/into Card/)).toBeNull();
    expect(
      screen.getByText(
        /^Choose another name to move this block's 3 values \(2 devices, Hover\)\./
      )
    ).toBeDefined();
    expect(
      (
        screen.getByRole("button", {
          name: "Save shared style",
        }) as HTMLButtonElement
      ).disabled
    ).toBe(true);
    expect(onAdd).not.toHaveBeenCalled();
  });
});

describe("saving", () => {
  it("stores the style first, then moves the block onto it", async () => {
    const { editor, onAdd, onSaved, onClose } = open();
    fireEvent.change(name(), { target: { value: "Promo" } });
    fireEvent.click(screen.getByRole("button", { name: "Save shared style" }));

    await waitFor(() => expect(onClose).toHaveBeenCalled());
    const entry = onAdd.mock.calls[0]?.[0];
    expect(entry).toMatchObject({
      slug: "promo",
      label: "Promo",
      orderIndex: 5,
    });
    expect(editor.applyAll).toHaveBeenCalledWith([
      {
        kind: "update",
        id: "a",
        patch: { classes: [entry?.id] },
        unset: ["styles"],
      },
    ]);
    expect(onAdd.mock.invocationCallOrder[0]).toBeLessThan(
      editor.applyAll.mock.invocationCallOrder[0] ?? 0
    );
    expect(onSaved).toHaveBeenCalledWith("Promo");
  });

  it("keeps an edit made to the block while the style was being stored", async () => {
    let store: (refused: string | undefined) => void = () => {};
    const onAdd = vi.fn(
      (_entry: NamedClass) =>
        new Promise<string | undefined>(resolve => {
          store = resolve;
        })
    );
    const first = editorWith();
    const props = {
      nodeId: "a",
      offer: { library: [card], mayChange: true },
      onAdd,
      onClose: vi.fn(),
    };
    const view = render(<SaveSharedStyleDialog editor={first} {...props} />);
    fireEvent.change(name(), { target: { value: "Promo" } });
    fireEvent.click(screen.getByRole("button", { name: "Save shared style" }));

    // The block gains a value the style does not hold while the save is out.
    const node = first.document.nodes[0] as unknown as Record<string, unknown>;
    const styles = node.styles as { base: { base: Record<string, unknown> } };
    const later = editorWith({
      ...styles,
      base: { ...styles.base, base: { ...styles.base.base, opacity: 0.5 } },
    });
    view.rerender(<SaveSharedStyleDialog editor={later} {...props} />);
    await act(async () => {
      store(undefined);
    });

    const entry = onAdd.mock.calls[0]?.[0];
    expect(later.applyAll).toHaveBeenCalledWith([
      {
        kind: "update",
        id: "a",
        // Only what the style took leaves the block; the new value stays.
        patch: {
          styles: { base: { base: { opacity: 0.5 } } },
          classes: [entry.id],
        },
      },
    ]);
  });

  it("leaves the block untouched when the style is refused, and says why", async () => {
    const { editor, onClose } = open(vi.fn(async () => "The site refused it."));
    fireEvent.change(name(), { target: { value: "Promo" } });
    fireEvent.click(screen.getByRole("button", { name: "Save shared style" }));

    expect((await screen.findByRole("alert")).textContent).toBe(
      "The site refused it."
    );
    expect(editor.applyAll).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });
});
