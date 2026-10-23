/**
 * The email editor, as a mounted CodeMirror view.
 *
 * `liquid-editing.test.ts` covers what completion offers and which problems
 * the parser names. These cover the wiring around them: that the editor asks
 * the completion source and the parser at all, that read-only and single-line
 * hold against an edit, and that a variable inserted from a chip lands in the
 * body being edited rather than the other one.
 */
import { currentCompletions, startCompletion } from "@codemirror/autocomplete";
import { act, render, screen, waitFor } from "@testing-library/react";
import { EditorView } from "@uiw/react-codemirror";
import { useForm } from "react-hook-form";
import { beforeAll, describe, expect, it, vi } from "vitest";

import { Form } from "@admin/components/ui/form";

import { BodyEditor } from "../BodyEditor";
import { EnvelopeBar } from "../EnvelopeBar";
import type { CompletionData } from "../liquid/liquid-completion";
import { LiquidEditor, type LiquidEditorProps } from "../liquid/LiquidEditor";
import { DEFAULT_VALUES, type TemplateFormValues } from "../schema";
import { useVariableInsertion } from "../useVariableInsertion";

// BodyEditor loads the editor on demand; warm the import once.
beforeAll(() => import("../liquid/LiquidEditor"), 60_000);

const COMPLETION: CompletionData = {
  declared: [
    { name: "userName", description: "Who signed up", required: true },
  ],
  sample: { userName: "Ada" },
};

function mountEditor(props: Partial<LiquidEditorProps> = {}) {
  let view: EditorView | null = null;
  const onChange = vi.fn();
  render(
    <LiquidEditor
      label="Subject"
      mode="text"
      value=""
      onChange={onChange}
      readOnly={false}
      completion={COMPLETION}
      onCreateEditor={created => {
        view = created;
      }}
      {...props}
    />
  );
  return { view: () => view!, onChange };
}

function type(view: EditorView, text: string) {
  act(() => {
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: text },
      selection: { anchor: text.length },
    });
  });
}

describe("the email editor", () => {
  it("is a named text field, editable unless it is read-only", () => {
    mountEditor();
    const field = screen.getByRole("textbox", { name: "Subject" });
    expect(field.getAttribute("contenteditable")).toBe("true");
    expect(field.getAttribute("aria-readonly")).toBeNull();
  });

  it("refuses edits when read-only, and still takes focus", () => {
    // Focusable so an owner's text can be read, selected and scrolled from
    // the keyboard; the read-only state is what refuses the typing.
    const { view } = mountEditor({ readOnly: true, value: "Welcome" });
    const field = screen.getByRole("textbox", { name: "Subject" });
    expect(field.getAttribute("aria-readonly")).toBe("true");
    expect(field.getAttribute("contenteditable")).toBe("true");
    expect(field.getAttribute("tabindex")).toBe("0");
    expect(view().state.readOnly).toBe(true);
  });

  it("takes no focus while a save is pending", () => {
    mountEditor({ disabled: true, value: "Welcome" });
    const field = screen.getByRole("textbox", { name: "Subject" });
    expect(field.getAttribute("contenteditable")).toBe("false");
    expect(field.getAttribute("tabindex")).toBeNull();
  });

  it("reports what the author types", () => {
    const { view, onChange } = mountEditor();
    type(view(), "Hi {{ userName }}");
    expect(onChange).toHaveBeenLastCalledWith(
      "Hi {{ userName }}",
      expect.anything()
    );
  });

  it("keeps a single-line field to one line", () => {
    const { view } = mountEditor({ singleLine: true, value: "Welcome" });
    type(view(), "Welcome\nto the shop");
    expect(view().state.doc.toString()).toBe("Welcome");
  });

  it("lets a multi-line field take a line break", () => {
    const { view } = mountEditor({ value: "Welcome" });
    type(view(), "Welcome\nto the shop");
    expect(view().state.doc.lines).toBe(2);
  });

  it("completes a declared variable inside an output tag", async () => {
    const { view } = mountEditor();
    type(view(), "Hi {{ us");
    act(() => {
      startCompletion(view());
    });
    await waitFor(() =>
      expect(currentCompletions(view().state).map(c => c.label)).toContain(
        "userName"
      )
    );
  });

  it("names a problem as the author types", async () => {
    const onProblems = vi.fn();
    const { view } = mountEditor({ onProblems });
    type(view(), "Hi {{ userName | nope }}");
    await waitFor(() =>
      expect(onProblems).toHaveBeenLastCalledWith([
        expect.objectContaining({ message: expect.stringMatching(/nope/) }),
      ])
    );

    type(view(), "Hi {{ userName }}");
    await waitFor(() => expect(onProblems).toHaveBeenLastCalledWith([]));
  });

  it("offers no Liquid for a template kept on the previous engine", async () => {
    // That engine sends `{{ userName | nope }}` as written: a problem or a
    // completion would describe an engine the email doesn't use.
    const onProblems = vi.fn();
    const { view } = mountEditor({ onProblems, liquid: false });
    type(view(), "Hi {{ us");
    act(() => {
      startCompletion(view());
    });
    type(view(), "Hi {{ userName | nope }}");
    await new Promise(resolve => setTimeout(resolve, 500));
    expect(currentCompletions(view().state)).toEqual([]);
    expect(onProblems).not.toHaveBeenCalledWith([
      expect.objectContaining({ message: expect.stringMatching(/nope/) }),
    ]);
  });

  it("puts the form control's attributes on its text area", () => {
    mountEditor({
      id: "subject-control",
      "aria-describedby": "subject-message",
      "aria-invalid": "true",
    });
    const field = screen.getByRole("textbox", { name: "Subject" });
    expect(field.id).toBe("subject-control");
    expect(field.getAttribute("aria-describedby")).toBe("subject-message");
    expect(field.getAttribute("aria-invalid")).toBe("true");
  });
});

/** The envelope, with one field already refused, as a failed save leaves it. */
function EnvelopeWithError({
  field,
  message,
  values = {},
}: {
  field?: keyof TemplateFormValues;
  message?: string;
  values?: Partial<TemplateFormValues>;
}) {
  const form = useForm<TemplateFormValues>({
    defaultValues: { ...DEFAULT_VALUES, ...values },
  });
  if (field && message && !form.getFieldState(field).error) {
    form.setError(field, { type: "manual", message });
  }
  return (
    <Form {...form}>
      <EnvelopeBar
        control={form.control}
        isPending={false}
        isLayoutRow={false}
        ownsContent
        completion={COMPLETION}
        liquid
      />
    </Form>
  );
}

describe("the envelope", () => {
  it("names a refused field's message on the text area focus reaches", async () => {
    render(<EnvelopeWithError field="subject" message="Subject is required" />);
    const subject = await screen.findByRole(
      "textbox",
      { name: "Subject" },
      { timeout: 5000 }
    );
    expect(subject.getAttribute("aria-invalid")).toBe("true");
    const describedBy = subject.getAttribute("aria-describedby") ?? "";
    const messages = describedBy
      .split(" ")
      .map(id => document.getElementById(id)?.textContent);
    expect(messages).toContain("Subject is required");
  });

  it("says From's address can't use a variable, as a save would", async () => {
    render(
      <EnvelopeWithError values={{ fromOverride: "Shop <{{ userEmail }}>" }} />
    );
    expect(
      await screen.findByText(/The From address can't use variables/)
    ).toBeDefined();
  });

  it("lets From's name use one", async () => {
    render(
      <EnvelopeWithError
        values={{ fromOverride: "{{ appName }} <shop@example.com>" }}
      />
    );
    await screen.findByRole("textbox", { name: "From" }, { timeout: 5000 });
    expect(
      screen.queryByText(/The From address can't use variables/)
    ).toBeNull();
  });
});

/** The body editor beside a chip that inserts `{{userName}}`. */
function BodyWithChip({ tab }: { tab: "html" | "text" }) {
  const form = useForm<TemplateFormValues>({
    defaultValues: {
      ...DEFAULT_VALUES,
      htmlContent: "<p>Hi</p>",
      plainTextContent: "Hi",
    },
  });
  const bodyViewRef = { current: null as EditorView | null };
  const insert = useVariableInsertion({ form, editorTab: tab, bodyViewRef });
  return (
    <Form {...form}>
      <BodyEditor
        control={form.control}
        editorTab={tab}
        onEditorTabChange={() => {}}
        isPending={false}
        readOnly={false}
        bodyViewRef={bodyViewRef}
        completion={COMPLETION}
        liquid
        chips={
          <button type="button" onClick={() => insert("userName")}>
            userName
          </button>
        }
      />
      <output data-testid="html">{form.watch("htmlContent")}</output>
      <output data-testid="text">{form.watch("plainTextContent")}</output>
    </Form>
  );
}

describe("inserting a variable", () => {
  it.each([
    ["html", "<p>Hi</p>{{userName}}", "Hi"],
    ["text", "<p>Hi</p>", "Hi{{userName}}"],
  ] as const)(
    "on the %s tab writes to that body only",
    async (tab, html, text) => {
      render(<BodyWithChip tab={tab} />);
      const field = await screen.findByRole(
        "textbox",
        { name: tab === "html" ? "HTML body" : "Plain text body" },
        { timeout: 5000 }
      );
      const view = EditorView.findFromDOM(field)!;
      act(() => {
        view.dispatch({ selection: { anchor: view.state.doc.length } });
      });

      act(() => {
        screen.getByRole("button", { name: "userName" }).click();
      });

      await waitFor(() => {
        expect(screen.getByTestId("html").textContent).toBe(html);
        expect(screen.getByTestId("text").textContent).toBe(text);
      });
    }
  );
});
