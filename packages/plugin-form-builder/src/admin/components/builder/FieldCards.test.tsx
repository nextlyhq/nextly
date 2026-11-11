// @vitest-environment jsdom

/**
 * What renaming a field must not cost its author: the card they are typing in.
 *
 * A field's name is its identity almost everywhere in this builder — the
 * selection, the drag ids, update targeting — but it cannot ALSO be the
 * list's React key: the Field Name input rewrites the name on every
 * keystroke, and a list keyed by name unmounts the renamed card mid-word.
 * The input is destroyed with it, so focus falls out after every character
 * and the author has to click back in before the next one.
 *
 * Run against the real view rather than the card alone, because the remount
 * came from the key the LIST chose, not from anything the input did.
 *
 * @module admin/components/builder/FieldCards.test
 */
import { TooltipProvider } from "@nextlyhq/ui";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

import {
  FormBuilderProvider,
  useFormBuilder,
  type FormBuilderContextValue,
} from "../../context/FormBuilderContext";

import { FieldCards } from "./FieldCards";

beforeAll(() => {
  Element.prototype.hasPointerCapture = () => false;
  Element.prototype.setPointerCapture = () => undefined;
  Element.prototype.releasePointerCapture = () => undefined;
  Element.prototype.scrollIntoView = () => undefined;
});

afterEach(cleanup);

/**
 * The list with two fields added in this session: a saved field keeps its
 * name, so only a new one can be renamed.
 */
function view() {
  let form!: FormBuilderContextValue;
  function Probe() {
    form = useFormBuilder();
    return null;
  }
  render(
    <TooltipProvider>
      <FormBuilderProvider initialData={{ fields: [] }}>
        <Probe />
        <FieldCards
          enabledTypes={["email", "textarea"]}
          onAddField={() => {}}
        />
      </FormBuilderProvider>
    </TooltipProvider>
  );
  act(() => {
    form.addField({ name: "email", label: "Email", type: "email" });
    form.addField({ name: "message", label: "Message", type: "textarea" });
    form.selectField(null);
  });
}

describe("renaming a field from its card", () => {
  it("keeps the Name input mounted and focused across the rename", () => {
    view();

    // Open the email row: the settings panel, with its Name input, opens
    // under it.
    // Two buttons match /email/i with aria-expanded — the header toggle and
    // the actions-menu trigger beside it ("Actions for Email") — and the
    // drag handle matches on name alone; the toggle is the one that is not a
    // menu and not a drag handle.
    const toggle = screen
      .getAllByRole("button", { name: /email/i, expanded: false })
      .find(button => !button.hasAttribute("aria-haspopup"));
    if (!toggle) throw new Error("field card header toggle not found");
    fireEvent.click(toggle);

    const input = screen.getByRole("textbox", {
      name: "Name",
    }) as HTMLInputElement;
    input.focus();
    expect(document.activeElement).toBe(input);

    // Two renames, as two edit events: the report is that focus is lost on
    // every character. fireEvent.change rather than typing, because once a
    // node detaches, typing into it no longer means anything — node identity
    // below is the evidence, and this keeps it deterministic.
    fireEvent.change(input, { target: { value: "email2" } });
    fireEvent.change(input, { target: { value: "email23" } });

    // Positive control: the rename reached the form state. Without it,
    // "never remounted" would pass just as well for a list that ignored its
    // input entirely.
    expect(input).toHaveValue("email23");

    // The separating property: the input the author was typing in is still
    // the one in the document (the card was not unmounted and re-mounted
    // under a new key), and it still holds focus.
    expect(screen.getByRole("textbox", { name: "Name" })).toBe(input);
    expect(document.activeElement).toBe(input);
  });

  it("keeps the input mounted when the name is cleared mid-rename", () => {
    // Select-all-and-delete is how a rename usually starts, and the empty
    // string is a legitimate intermediate value: selection must follow the
    // rename through it, or the card collapses (the editor unmounts) and
    // focus is lost — the very defect this list was rekeyed to remove.
    view();

    const toggle = screen
      .getAllByRole("button", { name: /email/i, expanded: false })
      .find(button => !button.hasAttribute("aria-haspopup"));
    if (!toggle) throw new Error("field card header toggle not found");
    fireEvent.click(toggle);
    const input = screen.getByRole("textbox", {
      name: "Name",
    }) as HTMLInputElement;
    input.focus();

    fireEvent.change(input, { target: { value: "" } });
    expect(screen.queryByRole("textbox", { name: "Name" })).toBe(input);
    expect(document.activeElement).toBe(input);

    fireEvent.change(input, { target: { value: "sms" } });
    expect(screen.getByRole("textbox", { name: "Name" })).toBe(input);
    expect(input).toHaveValue("sms");
  });
});
