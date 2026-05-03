// Why: ValidationTab shows controls per field type — text-style fields get
// minLength/maxLength/pattern, numeric/date get min/max, repeating types
// get minRows/maxRows. Custom error message is universal. readOnly mode
// disables every input. These tests lock the type-conditional rendering
// so future field-type additions don't quietly leak the wrong controls.
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";

import { render, screen } from "@admin/__tests__/utils";

import type { BuilderField } from "../../types";
import { ValidationTab } from "../ValidationTab";

const text: BuilderField = {
  id: "f1",
  name: "title",
  label: "Title",
  type: "text",
  isSystem: false,
  validation: {},
  admin: { width: "100%" },
};
const num: BuilderField = {
  id: "f2",
  name: "rank",
  label: "Rank",
  type: "number",
  isSystem: false,
  validation: {},
  admin: { width: "100%" },
};

function Controlled(props: {
  initial: BuilderField;
  readOnly?: boolean;
  onChange?: (next: BuilderField) => void;
}) {
  const [field, setField] = useState<BuilderField>(props.initial);
  return (
    <ValidationTab
      field={field}
      readOnly={props.readOnly}
      onChange={next => {
        setField(next);
        props.onChange?.(next);
      }}
    />
  );
}

describe("ValidationTab", () => {
  it("shows minLength/maxLength/pattern for text fields, hides numeric controls", () => {
    render(<Controlled initial={text} />);
    expect(screen.getByLabelText(/min length/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/max length/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/pattern/i)).toBeInTheDocument();
    expect(screen.queryByLabelText(/^min$/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/^max$/i)).not.toBeInTheDocument();
  });

  it("shows min/max for number fields, hides text-length controls", () => {
    render(<Controlled initial={num} />);
    expect(screen.getByLabelText(/^min$/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/^max$/i)).toBeInTheDocument();
    expect(screen.queryByLabelText(/min length/i)).not.toBeInTheDocument();
  });

  it("emits maxLength changes through onChange.validation", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Controlled initial={text} onChange={onChange} />);
    await user.type(screen.getByLabelText(/max length/i), "120");
    const last = onChange.mock.lastCall?.[0] as BuilderField;
    expect(last.validation?.maxLength).toBe(120);
  });

  it("emits custom error message changes (universal control)", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Controlled initial={text} onChange={onChange} />);
    await user.type(
      screen.getByLabelText(/custom error message/i),
      "Required."
    );
    const last = onChange.mock.lastCall?.[0] as BuilderField;
    expect(last.validation?.message).toBe("Required.");
  });

  it("disables every input in readOnly mode", () => {
    render(<Controlled initial={text} readOnly />);
    expect(screen.getByLabelText(/min length/i)).toBeDisabled();
    expect(screen.getByLabelText(/max length/i)).toBeDisabled();
    expect(screen.getByLabelText(/pattern/i)).toBeDisabled();
    expect(screen.getByLabelText(/custom error message/i)).toBeDisabled();
  });
});

describe("ValidationTab -- PR E1 layout + copy", () => {
  it("renders Min length and Max length inside a 50/50 grid row", () => {
    const { container } = render(<Controlled initial={text} />);
    const grids = container.querySelectorAll(
      ".grid.grid-cols-1.sm\\:grid-cols-2"
    );
    expect(grids.length).toBeGreaterThan(0);
  });

  it("renders Min rows / Max rows BEFORE Pattern for textarea", () => {
    const textarea: BuilderField = { ...text, type: "textarea" };
    render(<Controlled initial={textarea} />);
    expect(screen.getByLabelText(/min rows/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/max rows/i)).toBeInTheDocument();
    const minRowsLabel = screen.getByText(/min rows/i);
    const patternLabel = screen.getByText(/^pattern$/i);
    expect(minRowsLabel.compareDocumentPosition(patternLabel)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING
    );
  });

  it("Custom Error Message helper text mentions the Pattern (clarifies regex use)", () => {
    render(<Controlled initial={text} />);
    expect(screen.getByLabelText(/custom error message/i)).toBeInTheDocument();
    expect(
      screen.getByText(/shown when the value fails the pattern/i)
    ).toBeInTheDocument();
  });

  it("Pattern field has helper text explaining it's a regex", () => {
    render(<Controlled initial={text} />);
    expect(screen.getByText(/regex the value must match/i)).toBeInTheDocument();
  });
});
