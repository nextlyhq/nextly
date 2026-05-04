// Why: lock the General tab contract — name input is disabled for system
// fields (only label is editable), required toggle propagates through
// onChange.validation.required, and readOnly disables every input. Type-
// specific editor router is a placeholder in PR 1; it's wired in PR 2
// when the sheet is mounted by Collection/Single/Component pages.
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";

import { render, screen } from "@admin/__tests__/utils";

import type { BuilderField } from "../../types";
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
  siblingNames?: readonly string[];
  readOnly?: boolean;
  onChange?: (next: BuilderField) => void;
}) {
  const [field, setField] = useState<BuilderField>(props.initial);
  return (
    <GeneralTab
      field={field}
      siblingNames={props.siblingNames ?? []}
      readOnly={props.readOnly}
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

  it("disables every input in readOnly mode", () => {
    render(<Controlled initial={userTextarea} readOnly />);
    expect(screen.getByLabelText(/^name$/i)).toBeDisabled();
    expect(screen.getByLabelText(/^label$/i)).toBeDisabled();
    expect(screen.getByLabelText(/description/i)).toBeDisabled();
    expect(screen.getByRole("switch", { name: /required/i })).toBeDisabled();
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
