/**
 * IconInput hands React Hook Form the picker button as the field's element,
 * and tells it when the field is left.
 *
 * The form focuses a field through the element its controller's `ref`
 * received: `setFocus(name)`, and the first invalid field after a rejected
 * submit. A field that drops that ref is skipped by both, so the person is
 * told a field is wrong and left wherever focus happened to be.
 *
 * A form in `onBlur` mode marks a field touched, and validates it, when the
 * field reports being left, as a text input does when it loses focus.
 *
 * The value stays empty in every case, so the field never loads the icon set.
 */
import type { IconFieldConfig } from "nextly/config";
import { useEffect } from "react";
import {
  useForm,
  type Resolver,
  type ResolverResult,
  type UseFormReturn,
} from "react-hook-form";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { act, render, screen } from "@admin/__tests__/utils";

import { IconInput } from "./IconInput";

interface Values {
  badge: string;
  title: string;
}

const field: IconFieldConfig = { type: "icon", name: "badge", label: "Badge" };

/** Refuses an empty `badge`, as the entry form's schema does for a required field. */
const requireBadge: Resolver<Values> = async (
  values
): Promise<ResolverResult<Values>> => {
  if (values.badge !== "") return { values, errors: {} };
  return {
    values: {},
    errors: { badge: { type: "required", message: "Badge is required" } },
  };
};

function Harness({
  onForm,
}: {
  onForm: (form: UseFormReturn<Values>) => void;
}) {
  const form = useForm<Values>({
    defaultValues: { badge: "", title: "" },
    resolver: requireBadge,
  });
  useEffect(() => {
    onForm(form);
  }, [form, onForm]);
  return (
    <form onSubmit={event => void form.handleSubmit(() => {})(event)}>
      {/* Somewhere else for focus to start, so landing on the icon is the form's doing. */}
      <input aria-label="Title" {...form.register("title")} />
      <IconInput<Values> name="badge" field={field} control={form.control} />
    </form>
  );
}

function renderHarness(): { form: () => UseFormReturn<Values> } {
  let captured: UseFormReturn<Values> | null = null;
  render(<Harness onForm={form => (captured = form)} />);
  return {
    form: () => {
      if (captured === null) throw new Error("The form was not rendered.");
      return captured;
    },
  };
}

describe("IconInput focus", () => {
  it("is focused by setFocus", () => {
    const { form } = renderHarness();
    screen.getByRole("textbox", { name: "Title" }).focus();
    act(() => form().setFocus("badge"));
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "Badge: none chosen" })
    );
  });

  it("is focused when a submit is refused for it", async () => {
    const { form } = renderHarness();
    screen.getByRole("textbox", { name: "Title" }).focus();
    await act(async () => {
      await form().handleSubmit(() => {})();
    });
    const button = screen.getByRole("button", { name: "Badge: none chosen" });
    // Refused for the icon, so landing on it is the refusal's doing.
    expect(button.getAttribute("aria-invalid")).toBe("true");
    expect(document.activeElement).toBe(button);
  });
});

/** The icon field between two inputs, in a form that validates on leaving. */
function LeaveHarness() {
  const form = useForm<Values>({
    defaultValues: { badge: "", title: "" },
    mode: "onBlur",
    resolver: requireBadge,
  });
  return (
    <form>
      <IconInput<Values> name="badge" field={field} control={form.control} />
      <input aria-label="Title" {...form.register("title")} />
      {/* Read in render, so the form re-renders when it changes. */}
      <output aria-label="Badge touched">
        {String(form.formState.touchedFields.badge === true)}
      </output>
    </form>
  );
}

describe("IconInput leaving", () => {
  it("is marked touched and validated when tabbed away from", async () => {
    const user = userEvent.setup();
    render(<LeaveHarness />);
    const button = screen.getByRole("button", { name: "Badge: none chosen" });
    const touched = screen.getByRole("status", { name: "Badge touched" });
    await user.tab();
    expect(document.activeElement).toBe(button);
    expect(touched.textContent).toBe("false");

    await user.tab();
    expect(document.activeElement).toBe(
      screen.getByRole("textbox", { name: "Title" })
    );
    expect(touched.textContent).toBe("true");
    expect(button.getAttribute("aria-invalid")).toBe("true");
  });
});
