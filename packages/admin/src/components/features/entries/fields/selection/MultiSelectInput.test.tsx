import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { SelectFieldConfig } from "nextly/config";
import { useForm } from "react-hook-form";
import { describe, it, expect, beforeAll, vi } from "vitest";

import { MultiSelectInput } from "./MultiSelectInput";

// Radix Select relies on pointer-capture and scrollIntoView, which jsdom does
// not implement — stub them so the open/select flow can be exercised.
beforeAll(() => {
  Element.prototype.hasPointerCapture = vi.fn();
  Element.prototype.releasePointerCapture = vi.fn();
  Element.prototype.scrollIntoView = vi.fn();
});

const FIELD = {
  type: "select",
  name: "channels",
  hasMany: true,
  options: [
    { label: "Web", value: "web" },
    { label: "Retail", value: "retail" },
  ],
} as unknown as SelectFieldConfig;

function Harness({
  defaultValue,
  readOnly = false,
}: {
  defaultValue?: unknown;
  readOnly?: boolean;
}) {
  const { control, watch } = useForm({
    // Omit the key entirely when there is no value so useController's own
    // default ([]) applies, matching how an untouched field behaves.
    defaultValues: defaultValue === undefined ? {} : { channels: defaultValue },
  });
  const value = watch("channels");
  return (
    <>
      <MultiSelectInput
        name="channels"
        field={FIELD}
        control={control}
        readOnly={readOnly}
      />
      <output data-testid="value">{JSON.stringify(value)}</output>
    </>
  );
}

describe("MultiSelectInput", () => {
  it("renders array default values as labelled badges", () => {
    render(<Harness defaultValue={["web", "retail"]} />);
    expect(screen.getByText("Web")).toBeInTheDocument();
    expect(screen.getByText("Retail")).toBeInTheDocument();
  });

  it("seeds an empty array when the field has no value", () => {
    render(<Harness />);
    expect(screen.getByTestId("value")).toHaveTextContent("[]");
  });

  it("removes a value when its remove button is clicked", () => {
    render(<Harness defaultValue={["web", "retail"]} />);
    fireEvent.click(screen.getByRole("button", { name: "Remove Web" }));
    expect(screen.getByTestId("value")).toHaveTextContent('["retail"]');
  });

  it("appends the chosen option and stops offering it", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole("combobox"));
    await user.click(await screen.findByRole("option", { name: "Web" }));

    expect(screen.getByTestId("value")).toHaveTextContent('["web"]');
    // Web is now selected, so reopening no longer offers it.
    await user.click(screen.getByRole("combobox"));
    expect(
      screen.queryByRole("option", { name: "Web" })
    ).not.toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Retail" })).toBeInTheDocument();
  });

  it("preserves a stored scalar value as a single-item selection", () => {
    render(<Harness defaultValue="web" />);
    expect(screen.getByText("Web")).toBeInTheDocument();
    // The scalar is kept, not discarded to [].
    expect(screen.getByTestId("value")).toHaveTextContent('"web"');
  });

  it("shows an explicit empty marker in read-only mode with no selection", () => {
    render(<Harness readOnly />);
    expect(screen.getByText("—")).toBeInTheDocument();
    // Read-only mode offers no add control.
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
  });
});
