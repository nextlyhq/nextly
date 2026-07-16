import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { FieldDefaultValueInput } from "./FieldDefaultValueInput";
import { FieldTypePicker } from "./FieldTypePicker";

describe("FieldTypePicker", () => {
  const types = ["text", "number", "date"] as const;

  it("renders one radio card per allowed type, in catalog order with catalog labels", () => {
    render(<FieldTypePicker types={types} value="text" onChange={() => {}} />);
    const radios = screen.getAllByRole("radio");
    expect(radios.map(r => r.textContent)).toEqual([
      expect.stringContaining("Text"),
      expect.stringContaining("Number"),
      expect.stringContaining("Date"),
    ]);
    // Catalog hints render, so every surface describes a type identically.
    expect(screen.getByText("Single-line input")).toBeInTheDocument();
    expect(screen.getByText("Integer or decimal")).toBeInTheDocument();
  });

  it("marks the selected type and reports a change on click", () => {
    const onChange = vi.fn();
    render(<FieldTypePicker types={types} value="text" onChange={onChange} />);
    expect(screen.getByRole("radio", { checked: true })).toHaveTextContent(
      "Text"
    );
    fireEvent.click(screen.getByRole("radio", { name: /Number/ }));
    expect(onChange).toHaveBeenCalledWith("number");
  });

  it("names the group and moves selection with arrow keys (roving tabindex)", () => {
    const onChange = vi.fn();
    render(<FieldTypePicker types={types} value="text" onChange={onChange} />);
    const group = screen.getByRole("radiogroup", { name: "Field type" });
    // One tab stop: the selected card; the rest are removed from tab order.
    expect(screen.getByRole("radio", { name: /Text/ })).toHaveAttribute(
      "tabindex",
      "0"
    );
    expect(screen.getByRole("radio", { name: /Number/ })).toHaveAttribute(
      "tabindex",
      "-1"
    );
    fireEvent.keyDown(group, { key: "ArrowRight" });
    expect(onChange).toHaveBeenCalledWith("number");
    // Backward from the first entry wraps to the last.
    fireEvent.keyDown(group, { key: "ArrowUp" });
    expect(onChange).toHaveBeenCalledWith("date");
  });

  it("disables every card when disabled", () => {
    const onChange = vi.fn();
    render(
      <FieldTypePicker
        types={types}
        value="text"
        onChange={onChange}
        disabled
      />
    );
    for (const radio of screen.getAllByRole("radio")) {
      expect(radio).toBeDisabled();
    }
    fireEvent.click(screen.getByRole("radio", { name: /Number/ }));
    expect(onChange).not.toHaveBeenCalled();
  });
});

describe("FieldDefaultValueInput", () => {
  it("renders a true/false choice for checkbox", () => {
    render(
      <FieldDefaultValueInput
        fieldType="checkbox"
        value=""
        onChange={() => {}}
      />
    );
    expect(
      screen.getByRole("combobox", { name: "Default value" })
    ).toBeInTheDocument();
  });

  it("renders the field's own options for select", () => {
    render(
      <FieldDefaultValueInput
        fieldType="select"
        options={[
          { label: "Red", value: "red" },
          { label: "", value: "  " },
        ]}
        value="red"
        onChange={() => {}}
      />
    );
    // The blank-valued option is not offered; the current value renders.
    expect(screen.getByRole("combobox")).toHaveTextContent("Red");
  });

  it("falls back to a typed input and echoes changes for number", () => {
    const onChange = vi.fn();
    render(
      <FieldDefaultValueInput
        fieldType="number"
        value="5"
        onChange={onChange}
      />
    );
    const input = screen.getByRole("spinbutton", { name: "Default value" });
    fireEvent.change(input, { target: { value: "7" } });
    expect(onChange).toHaveBeenCalledWith("7");
  });

  it("keeps an option literally valued __none__ selectable instead of clearing", () => {
    render(
      <FieldDefaultValueInput
        fieldType="select"
        options={[
          { label: "None marker", value: "__none__" },
          { label: "Red", value: "red" },
        ]}
        value="__none__"
        onChange={() => {}}
      />
    );
    // The sentinel extends past the collision, so the trigger shows the real
    // option rather than the "No default" placeholder.
    expect(screen.getByRole("combobox")).toHaveTextContent("None marker");
  });

  it("renders a select with no options as a text input rather than an empty menu", () => {
    render(
      <FieldDefaultValueInput fieldType="select" value="" onChange={() => {}} />
    );
    expect(
      screen.getByRole("textbox", { name: "Default value" })
    ).toBeInTheDocument();
  });
});
