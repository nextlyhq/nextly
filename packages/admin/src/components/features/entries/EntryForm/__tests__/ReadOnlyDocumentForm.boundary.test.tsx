// What `disabled` on a read-only document form does and does NOT do.
//
// This file exists because the opposite was assumed. `ReadOnlyDocumentForm`
// passes `disabled: true`, and the obvious reading is that the document is then
// unwritable — so a later reader stops looking for a real boundary. It is not:
// measured against RHF 7.66, a programmatic write through the exact path a field
// component uses (`useController(...).field.onChange`) lands on a disabled form
// exactly as it lands on an enabled one.
//
// The path is chosen deliberately. `plugin-page-builder`'s blocks field declared
// only `{ name, control }` and dropped the `readOnly` FieldRenderer passes it,
// rendering a live editor whose commit is `field.onChange` on whichever form
// context is nearest — which on a past version was the snapshot's. #1043 fixed
// that field; this asserts what the FORM does, which is what covers the next one.
//
// What actually keeps a stray write harmless is ISOLATION: the form is built
// inside the component, never returned, and no save affordance sits in its
// provider.

import { render, screen, act } from "@testing-library/react";
import {
  useForm,
  useController,
  FormProvider,
  type Control,
} from "react-hook-form";
import { describe, it, expect } from "vitest";

/**
 * Stands in for a field component that ignores `readOnly` — the shape the blocks
 * field had before #1043, and the shape any third-party field may still have. It
 * takes only the two props such a component declares, and writes through the
 * controller, which is the path a plugin editor's commit takes.
 */
function IgnoresReadOnly({
  name,
  control,
}: {
  name: string;
  control: Control<Record<string, unknown>>;
}) {
  const { field } = useController({ name, control });
  return (
    <>
      <span data-testid="value">{String(field.value ?? "")}</span>
      <button type="button" onClick={() => field.onChange("WRITTEN")}>
        Commit
      </button>
    </>
  );
}

/** Mirrors `ReadOnlyDocumentForm`'s form construction, without its field tree. */
function Harness({ disabled }: { disabled: boolean }) {
  const form = useForm<Record<string, unknown>>({
    values: { body: "original" },
    disabled,
  });
  return (
    <FormProvider {...form}>
      <IgnoresReadOnly name="body" control={form.control} />
      <span data-testid="form-value">{String(form.watch("body") ?? "")}</span>
    </FormProvider>
  );
}

describe("ReadOnlyDocumentForm's write boundary", () => {
  it("POSITIVE CONTROL: the same write DOES land on a form that is not disabled", async () => {
    // Without this the test below passes on a harness that never wired the
    // button up at all, which is the same green as a working boundary.
    render(<Harness disabled={false} />);
    expect(screen.getByTestId("form-value")).toHaveTextContent("original");

    await act(async () => {
      screen.getByRole("button", { name: "Commit" }).click();
    });

    expect(screen.getByTestId("form-value")).toHaveTextContent("WRITTEN");
  });

  it("does NOT refuse a programmatic write when the form is disabled", async () => {
    // The recorded limit, not a wish. If a future RHF makes `disabled` block
    // this, THIS test fails — and that failure is the signal to promote
    // `disabled` to a real boundary in the docblock, rather than something to
    // "fix" by loosening the assertion.
    render(<Harness disabled />);
    expect(screen.getByTestId("form-value")).toHaveTextContent("original");

    await act(async () => {
      screen.getByRole("button", { name: "Commit" }).click();
    });

    expect(screen.getByTestId("form-value")).toHaveTextContent("WRITTEN");
  });
});
