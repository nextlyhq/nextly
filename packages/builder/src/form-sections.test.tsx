// @vitest-environment jsdom

/**
 * The Form's Content tab, as an author meets it: its Fields as rows to
 * open, drag and add to, and its After sending choice, with a form picked
 * from a fake provider starting on that form's own setting.
 *
 * @module form-sections.test
 */
import {
  clearBlocks,
  hasBlock,
  registerBlocks,
  type BlockDocument,
  type BlockNode,
} from "@nextlyhq/blocks-engine";
import { form } from "@nextlyhq/blocks-react/blocks";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import type { ContentServices } from "./content-controls";
import type { EditorState } from "./editor-state";
import { finishFieldEdit } from "./field-edit";
import { moved, openAfterMove } from "./form-fields-control";
import { InspectorPanel } from "./inspector-panel";

beforeAll(() => {
  const element = window.Element.prototype as unknown as Record<
    string,
    unknown
  >;
  element.scrollIntoView = function scrollIntoView(): void {};
  element.hasPointerCapture = () => false;
  element.releasePointerCapture = () => {};
  (window as unknown as Record<string, unknown>).ResizeObserver =
    class ResizeObserver {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    };
});

afterEach(() => {
  cleanup();
  clearBlocks();
});

/** A page holding one Form with `props`, and an editor recording its writes. */
function mount(
  props: Record<string, unknown> = form.defaultProps as Record<string, unknown>,
  services?: ContentServices
) {
  if (!hasBlock(form.name)) {
    registerBlocks([form] as never, { source: "form-sections-test" });
  }
  const document = {
    formatVersion: 1,
    kind: "page",
    nodes: [{ id: "f", type: "core/form", version: 2, props } as BlockNode],
  } as BlockDocument;
  const editor = {
    document,
    selectedId: "f",
    selection: { ids: ["f"], primary: "f" },
    applyAll: vi.fn(() => document),
    select: vi.fn(),
    apply: vi.fn(() => document),
    undo: vi.fn(),
    redo: vi.fn(),
    canUndo: false,
    canRedo: false,
    undoDepth: 0,
    lockRefusalFor: () => undefined,
    composed: () => undefined,
  } as unknown as EditorState & { apply: ReturnType<typeof vi.fn> };
  render(
    <InspectorPanel
      editor={editor}
      {...(services === undefined ? {} : { contentServices: services })}
    />
  );
  return editor;
}

/** The props the editor was last asked to write. */
function written(editor: {
  apply: ReturnType<typeof vi.fn>;
}): Record<string, unknown> {
  const op = editor.apply.mock.calls.at(-1)?.[0] as {
    patch: { props: Record<string, unknown> };
  };
  return op.patch.props;
}

/** Unfold the panel's section named `name`, as an author does. */
function unfold(name: string): void {
  const trigger = screen
    .getAllByRole("button", { name: new RegExp(`^${name}`) })
    .find(button => button.getAttribute("aria-expanded") === "false");
  if (trigger !== undefined) fireEvent.click(trigger);
}

const fieldsList = (): HTMLElement =>
  screen.getByRole("list", { name: "Fields" });

describe("a Form's Fields", () => {
  it("lists a new form's Name, Email and Message, with their types and marks", () => {
    mount();
    const rows = within(fieldsList()).getAllByRole("listitem");
    expect(rows.map(row => row.textContent)).toEqual([
      expect.stringMatching(/^Name \*, required.*Text$/),
      expect.stringMatching(/^Email \*, required.*Email$/),
      expect.stringMatching(/^Message.*Long text$/),
    ]);
  });

  it("adds a field with '+ Add field', and opens it", () => {
    const editor = mount();
    fireEvent.click(screen.getByRole("button", { name: "+ Add field" }));
    const fields = written(editor).fields as unknown[];
    expect(fields).toHaveLength(4);
    expect(fields[3]).toEqual({ label: "New field", type: "text" });
  });

  it("opens a field to edit its label, type and Required", () => {
    const editor = mount();
    fireEvent.click(screen.getByRole("button", { name: /^Message/ }));
    const label = screen.getByLabelText("Label");
    fireEvent.change(label, { target: { value: "Your question" } });
    fireEvent.blur(label);
    expect((written(editor).fields as unknown[])[2]).toEqual({
      label: "Your question",
      type: "textarea",
    });
    fireEvent.click(screen.getByRole("switch", { name: "Required" }));
    expect((written(editor).fields as unknown[])[2]).toEqual({
      label: "Message",
      type: "textarea",
      required: true,
    });
  });

  it("writes a label still being typed when the page is stored", () => {
    // Save pressed from the keyboard, focus still in the label: the label
    // is written as leaving it would write it.
    const editor = mount();
    fireEvent.click(screen.getByRole("button", { name: /^Message/ }));
    const label = screen.getByLabelText("Label");
    act(() => label.focus());
    fireEvent.change(label, { target: { value: "Your question" } });
    expect(editor.apply).not.toHaveBeenCalled();

    act(() => finishFieldEdit());
    expect((written(editor).fields as unknown[])[2]).toEqual({
      label: "Your question",
      type: "textarea",
    });
  });

  it("offers every field type by the words an author knows", () => {
    mount();
    fireEvent.click(screen.getByRole("button", { name: /^Message/ }));
    fireEvent.click(screen.getByRole("combobox", { name: "Field type" }));
    expect(
      screen.getAllByRole("option").map(option => option.textContent)
    ).toEqual([
      "Text",
      "Email",
      "Phone",
      "Number",
      "Link",
      "Date",
      "Long text",
      "Dropdown",
      "Checkbox",
      "Choice",
    ]);
  });

  it("gives a Dropdown and a Choice a list of options to edit", () => {
    const editor = mount({
      fields: [{ label: "Size", type: "select", options: ["S", "M"] }],
    });
    fireEvent.click(screen.getByRole("button", { name: /^Size/ }));
    const options = screen.getByRole("group", { name: "Options" });
    expect(
      within(options)
        .getAllByRole("textbox")
        .map(box => (box as HTMLInputElement).value)
    ).toEqual(["S", "M"]);
    fireEvent.click(
      within(options).getByRole("button", { name: "+ Add option" })
    );
    expect(
      (written(editor).fields as { options: string[] }[])[0]?.options
    ).toEqual(["S", "M", "Option 3"]);
  });

  it("shows the name each answer is sent under, made from its label and unique", () => {
    mount({ fields: [{ label: "Your email" }, { label: "Your email" }] });
    const names: string[] = [];
    for (const row of within(fieldsList()).getAllByRole("listitem")) {
      fireEvent.click(within(row).getByRole("button", { name: /^Your email/ }));
      const name = within(row).getByLabelText("Name sent with the form");
      names.push((name as HTMLInputElement).placeholder);
    }
    expect(names).toEqual(["your-email", "your-email-2"]);
  });

  it("moves a field by its handle, with the arrow keys", () => {
    const editor = mount();
    const handle = screen.getByRole("button", { name: "Move Email" });
    fireEvent.keyDown(handle, { key: "ArrowUp" });
    expect(
      (written(editor).fields as { label: string }[]).map(field => field.label)
    ).toEqual(["Email", "Name", "Message"]);
    expect(screen.getByRole("status").textContent).toBe(
      "Email moved to position 1 of 3."
    );
  });

  it("moves a field by dragging its handle onto another row", () => {
    const editor = mount();
    const rows = within(fieldsList()).getAllByRole("listitem");
    const handle = screen.getByRole("button", { name: "Move Message" });
    const dataTransfer = {
      setData: vi.fn(),
      effectAllowed: "",
      dropEffect: "",
    };
    act(() => {
      fireEvent.dragStart(handle, { dataTransfer });
    });
    fireEvent.dragOver(rows[0]!, { dataTransfer });
    fireEvent.drop(rows[0]!, { dataTransfer });
    expect(
      (written(editor).fields as { label: string }[]).map(field => field.label)
    ).toEqual(["Message", "Name", "Email"]);
  });

  it("keeps the open field open when another field moves past it", () => {
    // [A, B, C] with B open; A moves after C: B is now first.
    expect(openAfterMove(1, 0, 2)).toBe(0);
    // The open field itself moves with its row.
    expect(openAfterMove(0, 0, 2)).toBe(2);
    // C moves before A: B, then second, is now third.
    expect(openAfterMove(1, 2, 0)).toBe(2);
    // A move that does not cross it leaves it where it was.
    expect(openAfterMove(0, 1, 2)).toBe(0);
    expect(openAfterMove(null, 1, 2)).toBeNull();
  });

  it("draws a stored field whose words are not text, rather than failing", () => {
    mount({ fields: [{ label: 42 }, { label: "Email", type: 7 }] as never });
    expect(within(fieldsList()).getAllByRole("listitem")).toHaveLength(2);
  });

  it("shows the name an answer is sent under where the written one is taken", () => {
    mount({
      fields: [
        { label: "Email", name: "email" },
        { label: "Work email", name: "email" },
      ],
    });
    fireEvent.click(screen.getByRole("button", { name: /^Work email/ }));
    expect(screen.getByText("Sent as email-2.")).toBeDefined();
  });

  it("adds no field past the most a form draws", () => {
    mount({
      fields: Array.from({ length: 100 }, (_, index) => ({
        label: `F${index}`,
      })),
    });
    expect(
      (screen.getByRole("button", { name: "+ Add field" }) as HTMLButtonElement)
        .disabled
    ).toBe(true);
  });

  it("moves within the list, and never past either end", () => {
    expect(moved(["a", "b", "c"], 0, 2)).toEqual(["b", "c", "a"]);
    expect(moved(["a", "b"], 1, 9)).toEqual(["a", "b"]);
    expect(moved(["a"], 3, 0)).toEqual(["a"]);
  });
});

describe("a Form's After sending", () => {
  it("offers Show a message and Go to a page, a message first, with its words", () => {
    mount();
    unfold("After sending");
    // Named for what it chooses, not the section's own title again.
    expect(
      screen.queryByRole("radiogroup", { name: "After sending" })
    ).toBeNull();
    const choice = screen.getByRole("radiogroup", { name: "Then" });
    expect(
      within(choice)
        .getAllByRole("radio")
        .map(radio => [radio.textContent, radio.getAttribute("aria-checked")])
    ).toEqual([
      ["Show a message", "true"],
      ["Go to a page", "false"],
    ]);
    // Its own row, with what an empty one says.
    expect(screen.getByLabelText("Message")).toBeDefined();
    expect(
      screen.getByText(/Left empty, it says "Thanks, we got your message\."/)
    ).toBeDefined();
  });

  it("goes to a page through the shared link setting", () => {
    const editor = mount();
    unfold("After sending");
    fireEvent.click(screen.getByRole("radio", { name: "Go to a page" }));
    expect(written(editor).afterSending).toBe("page");
    cleanup();
    mount({ ...(form.defaultProps as object), afterSending: "page" });
    unfold("After sending");
    // The link control every linking block uses: a page of the site, or an
    // address.
    expect(
      screen.getByRole("button", {
        name: "Page: search or paste a URL",
      })
    ).toBeDefined();
    expect(screen.queryByLabelText("Message")).toBeNull();
  });

  it("starts a picked form on its own setting, saying what it is", async () => {
    const describeForm = vi.fn(async () => ({
      afterSending: { kind: "page" as const },
    }));
    mount({ form: { provider: "acme", ref: "contact" } }, {
      describeForm,
    } as ContentServices);
    unfold("After sending");
    expect(describeForm).toHaveBeenCalledWith({
      provider: "acme",
      ref: "contact",
    });
    const trigger = screen.getByRole("combobox", { name: "Then" });
    expect(
      await within(trigger).findByText(
        "Use the form's own setting (Go to a page)"
      )
    ).toBeDefined();
  });
});

describe("a Form inside a component's own view", () => {
  it("keeps After sending's switch to expose it as a field of the component", async () => {
    const { formSectionBodies } = await import("./form-sections");
    const { inspectSelection } = await import("./inspector");
    registerBlocks([form] as never, { source: "form-sections-expose" });
    const document = {
      formatVersion: 1,
      kind: "page",
      nodes: [
        { id: "f", type: "core/form", version: 2, props: {} } as BlockNode,
      ],
    } as BlockDocument;
    const inspection = inspectSelection(document, "f");
    const bodies = formSectionBodies({
      inspection: inspection!,
      stored: {},
      services: undefined,
      writable: () => true,
      onCommit: () => undefined,
      rowsOf: () => <></>,
      exposeOf: prop => <span data-testid="expose">{prop.name}</span>,
    });
    render(<>{bodies?.get("After sending")}</>);
    expect(screen.getByTestId("expose").textContent).toBe("afterSending");
  });
});
