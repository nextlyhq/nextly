// Why: lock the General tab contract — name input is disabled for system
// fields (only label is editable) and wherever the surface fixes it, with the
// reason; the name follows the label only while the field is unsaved; required
// and width write through onChange; readOnly disables every input.
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";

import { render, screen } from "@admin/__tests__/utils";

import type { BuilderField } from "@admin/components/features/schema-builder/types";
import { GeneralTab } from "../GeneralTab";

const userTextarea: BuilderField = {
  id: "f-1",
  name: "excerpt",
  label: "Excerpt",
  type: "textarea",
  isSystem: false,
  validation: {},
  admin: { width: "100%" },
};

const systemTitle: BuilderField = {
  id: "system_title",
  name: "title",
  label: "Title",
  type: "text",
  isSystem: true,
  validation: { required: true },
  admin: { width: "100%" },
};

function Controlled(props: {
  initial: BuilderField;
  readOnly?: boolean;
  saved?: boolean;
  nameFixedReason?: string;
  onChange?: (next: BuilderField) => void;
}) {
  const [field, setField] = useState<BuilderField>(props.initial);
  return (
    <GeneralTab
      field={field}
      readOnly={props.readOnly}
      saved={props.saved ?? false}
      nameFixedReason={props.nameFixedReason}
      onChange={next => {
        setField(next);
        props.onChange?.(next);
      }}
    />
  );
}

describe("GeneralTab", () => {
  it("disables Name for system fields, Label remains editable", () => {
    render(<Controlled initial={systemTitle} />);
    expect(screen.getByLabelText(/^name$/i)).toBeDisabled();
    expect(screen.getByLabelText(/^label$/i)).not.toBeDisabled();
  });

  it("emits a name change for user fields", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Controlled initial={userTextarea} onChange={onChange} />);
    const input = screen.getByLabelText(/^name$/i);
    await user.clear(input);
    await user.type(input, "summary");
    const last = onChange.mock.lastCall?.[0] as BuilderField;
    expect(last.name).toBe("summary");
  });

  it("toggles validation.required via the Required switch", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Controlled initial={userTextarea} onChange={onChange} />);
    await user.click(screen.getByRole("switch", { name: /required/i }));
    const last = onChange.mock.lastCall?.[0] as BuilderField;
    expect(last.validation?.required).toBe(true);
  });

  it("disables the name where the surface fixes it, and says why", () => {
    render(
      <Controlled
        initial={userTextarea}
        nameFixedReason="A user field's name is fixed once it is created."
      />
    );
    const name = screen.getByLabelText(/^name$/i);
    expect(name).toBeDisabled();
    expect(name).toHaveAccessibleDescription(
      /a user field's name is fixed once it is created/i
    );
  });

  it("does not follow the label with a name the surface fixes", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const draft: BuilderField = {
      ...userTextarea,
      label: "Excerpt",
      name: "excerpt",
    };
    render(
      <Controlled
        initial={draft}
        nameFixedReason="Fixed."
        onChange={onChange}
      />
    );
    await user.type(screen.getByLabelText(/^label$/i), "s");
    const last = onChange.mock.lastCall?.[0] as BuilderField;
    expect(last.name).toBe("excerpt");
  });

  it("chooses the width from a radio group and writes it to admin.width", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Controlled initial={userTextarea} onChange={onChange} />);
    const widths = screen.getByRole("radiogroup", { name: "Width" });
    expect(widths).toBeInTheDocument();
    await user.click(screen.getByRole("radio", { name: "50%" }));
    const last = onChange.mock.lastCall?.[0] as BuilderField;
    expect(last.admin?.width).toBe("50%");
  });

  it("disables every input in readOnly mode", () => {
    render(<Controlled initial={userTextarea} readOnly />);
    expect(screen.getByLabelText(/^name$/i)).toBeDisabled();
    expect(screen.getByLabelText(/^label$/i)).toBeDisabled();
    expect(screen.getByLabelText(/description/i)).toBeDisabled();
    expect(screen.getByRole("switch", { name: /required/i })).toBeDisabled();
    for (const radio of screen.getAllByRole("radio")) {
      expect(radio).toBeDisabled();
    }
  });
});

describe("GeneralTab -- PR E1 Label-first + Name auto-derive", () => {
  const blank: BuilderField = {
    id: "fnew",
    name: "",
    label: "",
    type: "text",
    isSystem: false,
    validation: {},
  };

  it("renders Label BEFORE Name in the DOM", () => {
    render(<Controlled initial={blank} />);
    const labelInput = screen.getByLabelText(/^Label$/);
    const nameInput = screen.getByLabelText(/^Name$/);
    expect(labelInput.compareDocumentPosition(nameInput)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING
    );
  });

  it("auto-derives Name from Label (snake_case) while Name is still auto", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Controlled initial={blank} onChange={onChange} />);
    await user.type(screen.getByLabelText(/^Label$/), "Blog Post");
    const last = onChange.mock.lastCall?.[0] as BuilderField;
    expect(last.label).toBe("Blog Post");
    expect(last.name).toBe("blog_post");
  });

  it("derives punctuation in the Label away rather than underscoring it", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Controlled initial={blank} onChange={onChange} />);
    await user.type(screen.getByLabelText(/^Label$/), "phone no.");
    const last = onChange.mock.lastCall?.[0] as BuilderField;
    expect(last.label).toBe("phone no.");
    expect(last.name).toBe("phone_no");
  });

  it("keeps following the Label for a name minted under the previous rule", async () => {
    // A field whose label was "phone no." derived "phone_no_" before
    // punctuation runs collapsed. That stored name is legal and stays as it
    // is, but it must still read as AUTO-derived — otherwise the first label
    // edit after the rule change would treat it as manually overridden and
    // strand the name while the label moves on.
    const user = userEvent.setup();
    const onChange = vi.fn();
    const seeded: BuilderField = {
      ...blank,
      label: "phone no.",
      name: "phone_no_",
    };
    render(<Controlled initial={seeded} onChange={onChange} />);
    await user.type(screen.getByLabelText(/^Label$/), "!");
    const last = onChange.mock.lastCall?.[0] as BuilderField;
    expect(last.label).toBe("phone no.!");
    expect(last.name).toBe("phone_no");
  });

  it("does not treat a manual repeated-underscore name as automatic", async () => {
    // `line__item` is a legal name the save path preserves verbatim as the
    // field's identity; the label "Line Item" derives to `line_item`, and a
    // comparison through normalization would call the two equal and rewrite
    // the manual name on the first label edit. Recognition must match the
    // derivations EXACTLY, never a normalized stored name.
    const user = userEvent.setup();
    const onChange = vi.fn();
    const seeded: BuilderField = {
      ...blank,
      label: "Line Item",
      name: "line__item",
    };
    render(<Controlled initial={seeded} onChange={onChange} />);
    await user.type(screen.getByLabelText(/^Label$/), "s");
    const last = onChange.mock.lastCall?.[0] as BuilderField;
    expect(last.label).toBe("Line Items");
    expect(last.name).toBe("line__item");
  });

  it("keeps a saved field's name when its label changes, though the name was derived", async () => {
    // A saved field's name is its column and API key. Its label is only what
    // editors read, so relabelling "Summary" as "Excerpt" must leave the name
    // alone even though "summary" is exactly what the old label derived.
    const user = userEvent.setup();
    const onChange = vi.fn();
    const saved: BuilderField = { ...blank, label: "Summary", name: "summary" };
    render(<Controlled initial={saved} saved onChange={onChange} />);
    const labelInput = screen.getByLabelText(/^Label$/);
    await user.clear(labelInput);
    await user.type(labelInput, "Excerpt");
    const last = onChange.mock.lastCall?.[0] as BuilderField;
    expect(last.label).toBe("Excerpt");
    expect(last.name).toBe("summary");
  });

  it("lets an unsaved field's derived name follow its label", async () => {
    // The positive control for the test above: the same edit on a field not
    // yet saved re-derives the name, so the test above is not passing merely
    // because nothing derives at all.
    const user = userEvent.setup();
    const onChange = vi.fn();
    const draft: BuilderField = { ...blank, label: "Summary", name: "summary" };
    render(<Controlled initial={draft} onChange={onChange} />);
    const labelInput = screen.getByLabelText(/^Label$/);
    await user.clear(labelInput);
    await user.type(labelInput, "Excerpt");
    const last = onChange.mock.lastCall?.[0] as BuilderField;
    expect(last.name).toBe("excerpt");
  });

  it("leaves the earlier snake-case rule to a surface whose names are snake case", async () => {
    // "phone_no_" is what the earlier snake-case rule derived from "phone no.".
    // On a surface that derives names some other way it was typed by hand, so
    // a label edit must not take it for derived and replace it.
    const user = userEvent.setup();
    const onChange = vi.fn();
    const kebab = (label: string) =>
      label
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "");
    const seeded: BuilderField = {
      ...blank,
      label: "phone no.",
      name: "phone_no_",
    };
    render(
      <GeneralTab field={seeded} deriveName={kebab} onChange={onChange} />
    );
    await user.type(screen.getByLabelText(/^Label$/), "!");
    const last = onChange.mock.lastCall?.[0] as BuilderField;
    expect(last.name).toBe("phone_no_");
  });

  it("stops auto-deriving Name once the user manually edits Name", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const seeded: BuilderField = {
      ...blank,
      label: "Body",
      name: "body",
    };
    render(<Controlled initial={seeded} onChange={onChange} />);
    // Override Name manually.
    const nameInput = screen.getByLabelText(/^Name$/) as HTMLInputElement;
    await user.clear(nameInput);
    await user.type(nameInput, "content");
    onChange.mockClear();

    // Now keep typing in Label. Name must NOT change.
    await user.type(screen.getByLabelText(/^Label$/), " text");
    const last = onChange.mock.lastCall?.[0] as BuilderField;
    expect(last.label).toBe("Body text");
    expect(last.name).toBe("content");
  });
});
