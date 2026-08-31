/**
 * A refused save must SAY something, wherever the offending field lives.
 *
 * `regionsForRefusal` decides which summoned region to reopen. A test of that
 * helper alone cannot see whether anything then renders the message: a field
 * whose region is already on screen needs no region opened, and will still be
 * silent if it has nowhere to put the text. These assert the outcome instead —
 * the message in the DOM, reached through the real component.
 */
import { cleanup, render, screen } from "@testing-library/react";
import { useForm } from "react-hook-form";
import { afterEach, describe, expect, it } from "vitest";

import { Form } from "@admin/components/ui/form";

import { BodyEditor } from "../BodyEditor";
import { EditorBar } from "../EditorBar";
import { DEFAULT_VALUES, type TemplateFormValues } from "../schema";

afterEach(cleanup);

/** Mounts a region with one field already rejected, as a refused save leaves it. */
function WithError({
  field,
  message,
  children,
}: {
  field: keyof TemplateFormValues;
  message: string;
  children: (
    form: ReturnType<typeof useForm<TemplateFormValues>>
  ) => React.ReactNode;
}) {
  const form = useForm<TemplateFormValues>({ defaultValues: DEFAULT_VALUES });
  form.setError(field, { type: "manual", message });
  return <Form {...form}>{children(form)}</Form>;
}

describe("a refusal is visible where the field is", () => {
  it("reports a rejected template name in the bar", () => {
    render(
      <WithError field="name" message="Template name is required">
        {form => (
          <EditorBar
            control={form.control}
            isEdit={false}
            isPending={false}
            isActive
            isDirty={false}
            slug="welcome"
            onNameChange={(v, onChange) => onChange(v)}
            onSendTest={() => {}}
            onOpenSettings={() => {}}
          />
        )}
      </WithError>
    );

    expect(screen.getByText("Template name is required")).toBeDefined();
  });

  it("reports a rejected HTML body in the editor toolbar", () => {
    render(
      <WithError field="htmlContent" message="HTML content is required">
        {form => (
          <BodyEditor
            control={form.control}
            editorTab="html"
            onEditorTabChange={() => {}}
            isPending={false}
            editorWrapRef={{ current: null }}
            htmlEditorViewRef={{ current: null }}
          />
        )}
      </WithError>
    );

    expect(screen.getByText("HTML content is required")).toBeDefined();
  });

  it("names the other tab when that is where the refusal is", () => {
    // An author on the plain-text tab is blocked by the HTML body, which has
    // nothing on screen belonging to it. Without naming the tab, the message
    // describes a field the author cannot see.
    render(
      <WithError field="htmlContent" message="HTML content is required">
        {form => (
          <BodyEditor
            control={form.control}
            editorTab="text"
            onEditorTabChange={() => {}}
            isPending={false}
            editorWrapRef={{ current: null }}
            htmlEditorViewRef={{ current: null }}
          />
        )}
      </WithError>
    );

    expect(screen.getByText("HTML: HTML content is required")).toBeDefined();
  });

  it("says nothing when nothing was rejected", () => {
    // The control. Without it, a component that rendered its message
    // unconditionally would pass all three tests above.
    render(
      <WithError field="name" message="">
        {form => (
          <BodyEditor
            control={form.control}
            editorTab="html"
            onEditorTabChange={() => {}}
            isPending={false}
            editorWrapRef={{ current: null }}
            htmlEditorViewRef={{ current: null }}
          />
        )}
      </WithError>
    );

    expect(screen.queryByRole("alert")).toBeNull();
  });
});
