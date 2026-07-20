import { render, screen, fireEvent } from "@testing-library/react";
import type { SelectFieldConfig } from "nextly/config";
import { useForm } from "react-hook-form";
import { describe, it, expect } from "vitest";

import { MultiSelectInput } from "./MultiSelectInput";

const FIELD = {
  type: "select",
  name: "channels",
  hasMany: true,
  options: [
    { label: "Web", value: "web" },
    { label: "Retail", value: "retail" },
  ],
} as unknown as SelectFieldConfig;

function Harness({ defaultValue }: { defaultValue?: unknown }) {
  const { control, watch } = useForm({
    // Omit the key entirely when there is no value so useController's own
    // default ([]) applies, matching how an untouched field behaves.
    defaultValues: defaultValue === undefined ? {} : { channels: defaultValue },
  });
  const value = watch("channels");
  return (
    <>
      <MultiSelectInput name="channels" field={FIELD} control={control} />
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
});
