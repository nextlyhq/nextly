// Filling one field from the source language.
//
// The cases that matter are the ones where it must NOT appear: outside
// translation mode, and on the source pane's own fields — where the form it
// would write to is the read-only one and "use the source" means filling a
// field from itself. Both are absences, so each is asserted against a positive
// control in the same file rather than on its own.

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { FormProvider, useForm } from "react-hook-form";
import { describe, it, expect } from "vitest";

import { TranslationFieldProvider } from "../TranslationFieldContext";
import { UseSourceButton } from "../UseSourceButton";

/** Renders the button inside a form, optionally inside the source context. */
function setup(
  source:
    | { sourceValues?: Record<string, unknown>; sourceLabel?: string }
    | undefined,
  fieldName = "headline"
) {
  const seen: { values?: Record<string, unknown> } = {};

  function Harness() {
    const form = useForm<Record<string, unknown>>({
      defaultValues: { headline: "" },
    });
    seen.values = form.watch();
    const button = (
      <UseSourceButton fieldName={fieldName} fieldLabel="Headline" />
    );
    return (
      <FormProvider {...form}>
        <span data-testid="value">{String(form.watch(fieldName) ?? "")}</span>
        <span data-testid="dirty">{String(form.formState.isDirty)}</span>
        {source ? (
          <TranslationFieldProvider value={source}>
            {button}
          </TranslationFieldProvider>
        ) : (
          button
        )}
      </FormProvider>
    );
  }

  render(<Harness />);
  return seen;
}

const SOURCE = {
  sourceValues: { headline: "Autumn release is live" },
  sourceLabel: "English",
};

describe("UseSourceButton", () => {
  it("POSITIVE CONTROL: offers itself when there is a source to use", () => {
    // Without this the absence cases below pass on a component that never
    // renders under any circumstances.
    setup(SOURCE);
    expect(screen.getByRole("button")).toBeInTheDocument();
  });

  it("renders nothing outside translation mode", () => {
    // No provider at all — which is every ordinary edit of a document.
    setup(undefined);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("renders nothing on the source pane's own fields", () => {
    // The source pane is a SIBLING of the target, so it is outside the provider
    // and reads the empty default. This is that shape.
    setup({});
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("renders nothing when the source field is empty", () => {
    // A fill that blanks the target is the opposite of the intent, so a source
    // holding nothing offers nothing.
    setup({ sourceValues: { headline: "   " }, sourceLabel: "English" });
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("fills the field, and marks the form dirty so the work can be saved", async () => {
    setup(SOURCE);
    expect(screen.getByTestId("value")).toHaveTextContent("");
    expect(screen.getByTestId("dirty")).toHaveTextContent("false");

    await userEvent.click(screen.getByRole("button"));

    expect(screen.getByTestId("value")).toHaveTextContent(
      "Autumn release is live"
    );
    // Without `shouldDirty` the fill is invisible to Save and to the
    // unsaved-changes guard: the author would fill a field, navigate away, and
    // lose it with nothing having asked.
    expect(screen.getByTestId("dirty")).toHaveTextContent("true");
  });

  it("names the language AND the field, so several are told apart", () => {
    setup(SOURCE);
    expect(
      screen.getByRole("button", {
        name: "Use the English text for Headline",
      })
    ).toBeInTheDocument();
  });
});
