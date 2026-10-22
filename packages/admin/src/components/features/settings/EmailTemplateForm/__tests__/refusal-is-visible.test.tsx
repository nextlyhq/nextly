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
import { DEFAULT_VALUES, type TemplateFormValues } from "../schema";
import { WorkbenchHeader } from "../WorkbenchHeader";

afterEach(cleanup);

const NO_COMPLETION = { declared: [], sample: {} };

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
  it("reports a rejected template name in the header", () => {
    render(
      <WithError field="name" message="Template name is required">
        {form => (
          <WorkbenchHeader
            tier="desktop"
            control={form.control}
            onNameChange={(v, onChange) => onChange(v)}
            isEdit={false}
            isPending={false}
            isDirty={false}
            isActive
            ownsContent
            hasData
            sheet={null}
            onToggleSheet={() => {}}
            onExit={() => {}}
            exitLabel="Back to Messages"
            onSendTest={() => {}}
            onOverride={() => {}}
            menu={{}}
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
            bodyViewRef={{ current: null }}
            completion={NO_COMPLETION}
            readOnly={false}
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
            bodyViewRef={{ current: null }}
            completion={NO_COMPLETION}
            readOnly={false}
          />
        )}
      </WithError>
    );

    expect(screen.getByText("HTML: HTML content is required")).toBeDefined();
  });

  it("keeps the alert out of the strip that scrolls", () => {
    /*
     * The chip strip is bounded and scrollable, because it grows by a row per
     * declared variable. An alert laid out inside it mounts below the visible
     * area once there are enough chips, and submitting does not scroll that
     * container — so the message exists, is in the DOM, and cannot be seen.
     *
     * Containment is the discriminating assertion: "the alert is present"
     * passes in both arrangements, which is how the first version of this
     * shipped.
     */
    render(
      <WithError field="htmlContent" message="HTML content is required">
        {form => (
          <BodyEditor
            control={form.control}
            editorTab="html"
            onEditorTabChange={() => {}}
            isPending={false}
            bodyViewRef={{ current: null }}
            completion={NO_COMPLETION}
            readOnly={false}
            chips={<span>{"{{appName}}"}</span>}
          />
        )}
      </WithError>
    );

    const alert = screen.getByRole("alert");
    const strip = screen.getByTestId("body-editor-chips");

    expect(alert).toBeDefined();
    expect(strip.contains(alert)).toBe(false);
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
            bodyViewRef={{ current: null }}
            completion={NO_COMPLETION}
            readOnly={false}
          />
        )}
      </WithError>
    );

    expect(screen.queryByRole("alert")).toBeNull();
  });
});
