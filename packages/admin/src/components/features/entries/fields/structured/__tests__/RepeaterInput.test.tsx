import type { RepeaterFieldConfig } from "nextly/config";
import { useForm, FormProvider } from "react-hook-form";
import { describe, expect, it } from "vitest";

import { render, screen, fireEvent } from "@admin/__tests__/utils";

import { RepeaterInput } from "../RepeaterInput";

function RepeaterHarness({
  field,
  defaultValues = {},
}: {
  field: RepeaterFieldConfig;
  defaultValues?: Record<string, unknown>;
}) {
  const methods = useForm({ defaultValues });
  return (
    <FormProvider {...methods}>
      <RepeaterInput
        name={field.name as never}
        field={field}
        control={methods.control}
      />
      <pre data-testid="form-values">{JSON.stringify(methods.watch())}</pre>
    </FormProvider>
  );
}

describe("RepeaterInput", () => {
  const baseRepeater: RepeaterFieldConfig = {
    type: "repeater",
    name: "testimonials",
    label: "Customer Testimonials",
    labels: {
      singular: "Testimonial",
      plural: "Testimonials",
    },
    fields: [
      {
        type: "text",
        name: "author",
        label: "Author",
        defaultValue: "Anonymous",
      } as never,
      { type: "number", name: "rating" } as never,
      { type: "checkbox", name: "verified" } as never,
    ],
  };

  it("renders collapsible header with label and item count", () => {
    render(
      <RepeaterHarness
        field={baseRepeater}
        defaultValues={{
          testimonials: [
            { author: "Alice", rating: 5, verified: true },
            { author: "Bob", rating: 4, verified: false },
          ],
        }}
      />
    );

    expect(screen.getByText("Customer Testimonials")).toBeInTheDocument();
    expect(screen.getByText("(2)")).toBeInTheDocument();
  });

  it("renders empty state when there are no items", () => {
    render(
      <RepeaterHarness
        field={baseRepeater}
        defaultValues={{ testimonials: [] }}
      />
    );
    expect(screen.getByText("No testimonials yet.")).toBeInTheDocument();
    expect(screen.getByText("Add Testimonial")).toBeInTheDocument();
  });

  it("adds a new item with computed default values on clicking Add button", () => {
    render(
      <RepeaterHarness
        field={baseRepeater}
        defaultValues={{ testimonials: [] }}
      />
    );
    const addButton = screen.getByRole("button", { name: /Add Testimonial/i });
    fireEvent.click(addButton);

    // Empty state is removed
    expect(screen.queryByText("No testimonials yet.")).not.toBeInTheDocument();
    expect(screen.getByText("(1)")).toBeInTheDocument();
    // The new row is seeded with the declared default values
    const values = JSON.parse(
      screen.getByTestId("form-values").textContent || "{}"
    );
    expect(values.testimonials[0]).toMatchObject({
      author: "Anonymous",
      rating: null,
      verified: false,
    });
  });

  it("displays min-rows warning when row count is less than minRows", () => {
    const minConstrained: RepeaterFieldConfig = {
      ...baseRepeater,
      minRows: 3,
    };

    render(
      <RepeaterHarness
        field={minConstrained}
        defaultValues={{
          testimonials: [{ author: "Alice", rating: 5, verified: true }],
        }}
      />
    );

    expect(
      screen.getByText("Minimum 3 testimonials required. Currently have 1.")
    ).toBeInTheDocument();
  });

  it("displays max-rows info and disables Add button when maxRows is reached", () => {
    const maxConstrained: RepeaterFieldConfig = {
      ...baseRepeater,
      maxRows: 1,
    };

    render(
      <RepeaterHarness
        field={maxConstrained}
        defaultValues={{
          testimonials: [{ author: "Alice", rating: 5, verified: true }],
        }}
      />
    );

    expect(
      screen.getByText("Maximum 1 testimonials reached.")
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /Add Testimonial/i })
    ).not.toBeInTheDocument();
  });
});
