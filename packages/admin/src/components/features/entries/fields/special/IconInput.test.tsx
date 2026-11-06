/**
 * IconInput hands React Hook Form the picker button as the field's element.
 *
 * The form focuses a field through the element its controller's `ref`
 * received: `setFocus(name)`, and the first invalid field after a rejected
 * submit. A field that drops that ref is skipped by both, so the person is
 * told a field is wrong and left wherever focus happened to be.
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
