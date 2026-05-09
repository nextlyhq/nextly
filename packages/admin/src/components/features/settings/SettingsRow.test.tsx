import { render, screen } from "@testing-library/react";
import { useForm } from "react-hook-form";
import { describe, it, expect } from "vitest";

import { Form, FormField, FormItem } from "@admin/components/ui/form";

import { SettingsRow } from "./SettingsRow";

function Harness({ description }: { description?: string }) {
  const form = useForm({ defaultValues: { foo: "" } });
  return (
    <Form {...form}>
      <FormField
        control={form.control}
        name="foo"
        render={() => (
          <FormItem>
            <SettingsRow label="My Label" description={description}>
              <input data-testid="control" />
            </SettingsRow>
          </FormItem>
        )}
      />
    </Form>
  );
}

describe("SettingsRow", () => {
  it("renders the label", () => {
    render(<Harness />);
    expect(screen.getByText("My Label")).toBeInTheDocument();
  });

  it("renders the description when provided", () => {
    render(<Harness description="extra help" />);
    expect(screen.getByText("extra help")).toBeInTheDocument();
  });

  it("renders the control slot", () => {
    render(<Harness />);
    expect(screen.getByTestId("control")).toBeInTheDocument();
  });
});
