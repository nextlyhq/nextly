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
import { htmlLanguage } from "@codemirror/lang-html";
import { forceParsing } from "@codemirror/language";
import { forEachDiagnostic } from "@codemirror/lint";
import { act, render, screen, waitFor } from "@testing-library/react";
import { EditorView } from "@uiw/react-codemirror";
import { useRef } from "react";
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

  it("lets a value saved with a break be repaired, and adds no new one", () => {
    // The API and the schemas accept a break in a subject. Refusing every edit
    // to such a value would leave it impossible to fix in the editor.
    const { view } = mountEditor({ singleLine: true, value: "Welcome\nback" });
    act(() => {
      view().dispatch({ changes: { from: 0, to: 7, insert: "Hello" } });
    });
    expect(view().state.doc.toString()).toBe("Hello\nback");

    type(view(), "Hello\nback\nagain");
    expect(view().state.doc.toString()).toBe("Hello\nback");

    type(view(), "Hello back");
    expect(view().state.doc.toString()).toBe("Hello back");
  });

  it("shows a multi-line value the form resets it to, unchanged", () => {
    // A duplicate loading its source, or Discard restoring a saved value, sets
    // the field from outside. A value saved with a break must arrive whole:
    // showing anything else would differ from what a save then stores.
    let view: EditorView | null = null;
    const props = {
      label: "Subject",
      mode: "text" as const,
      singleLine: true,
      onChange: () => {},
      readOnly: false,
      completion: COMPLETION,
      onCreateEditor: (created: EditorView) => {
        view = created;
      },
    };
    const { rerender } = render(<LiquidEditor {...props} value="Welcome" />);
    rerender(<LiquidEditor {...props} value={"Welcome\nback"} />);
    expect(view!.state.doc.toString()).toBe("Welcome\nback");
  });

  it("closes no HTML tag in a text field", () => {
    // An address is written `Shop <shop@example.com>`: the closing `>` must
    // not be read as the end of an HTML tag and answered with `</shop…>`.
    const { view } = mountEditor({ value: "Shop <shop" });
    const v = view();
    const at = v.state.doc.length;
    act(() => {
      v.dispatch({ selection: { anchor: at } });
      // As a browser has by the time anyone types: the whole text parsed,
      // the layer inside Liquid included.
      forceParsing(v, at, 5000);
    });
    // HTML's tag closing acts wherever HTML is the language, so the text
    // must not be read as HTML at all.
    expect(htmlLanguage.isActiveAt(v.state, at, -1)).toBe(false);
    expect(htmlLanguage.isActiveAt(v.state, 0, 1)).toBe(false);
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

  it("marks broken HTML in the HTML body, as the code editor did", async () => {
    // The body's editor marked mismatched and unclosed tags before it read
    // Liquid; reading Liquid must not take that warning away.
    const { view } = mountEditor({
      mode: "html",
      label: "HTML body",
      value: "<p>Hi {{ userName }}</div>",
    });
    const messages = () => {
      const found: string[] = [];
      forEachDiagnostic(view().state, diagnostic =>
        found.push(diagnostic.message)
      );
      return found;
    };
    await waitFor(() =>
      expect(messages()).toEqual(
        expect.arrayContaining([expect.stringMatching(/Mismatched tags/)])
      )
    );
  });

  it("marks no HTML in a text field", async () => {
    const onProblems = vi.fn();
    const { view } = mountEditor({ value: "Hi <b>{{ userName }}", onProblems });
    await waitFor(() => expect(onProblems).toHaveBeenCalled());
    let count = 0;
    forEachDiagnostic(view().state, () => {
      count++;
    });
    expect(count).toBe(0);
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
    // Asked while the caret is still inside the tag: a later edit would
    // close any completion anyway, and hide one that was offered.
    await new Promise(resolve => setTimeout(resolve, 100));
    expect(currentCompletions(view().state)).toEqual([]);

    type(view(), "Hi {{ userName | nope }}");
    await new Promise(resolve => setTimeout(resolve, 500));
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
  liquid = true,
}: {
  field?: keyof TemplateFormValues;
  message?: string;
  values?: Partial<TemplateFormValues>;
  liquid?: boolean;
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
        liquid={liquid}
      />
    </Form>
  );
}

describe("the envelope", () => {
  it("keeps From's Liquid checked on a template kept on the previous engine", async () => {
    // That engine sends the subject as written, but From and Reply-To render
    // through Liquid on every engine, and a save checks them as Liquid.
    render(
      <EnvelopeWithError
        liquid={false}
        values={{
          subject: "Hi {{ userName | nope }}",
          fromOverride: "{{ userName | nope }} <shop@example.com>",
        }}
      />
    );
    await screen.findByRole("textbox", { name: "From" }, { timeout: 5000 });
    await waitFor(() =>
      expect(
        screen
          .getAllByRole("alert")
          .filter(alert => /nope/.test(alert.textContent ?? ""))
      ).toHaveLength(1)
    );
  });

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
  const bodyViewRef = useRef<EditorView | null>(null);
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

  it("still lands in the body once its editor is gone", async () => {
    // On a phone or tablet, Details takes the body's place and destroys its
    // editor; the ref still holds the view. A chip in Details then writes to
    // the field, not to a view no one can see.
    render(<BodyWithChip tab="text" />);
    const field = await screen.findByRole(
      "textbox",
      { name: "Plain text body" },
      { timeout: 5000 }
    );
    act(() => {
      EditorView.findFromDOM(field)!.destroy();
    });

    act(() => {
      screen.getByRole("button", { name: "userName" }).click();
    });

    await waitFor(() =>
      expect(screen.getByTestId("text").textContent).toBe("Hi{{userName}}")
    );
    expect(screen.getByTestId("html").textContent).toBe("<p>Hi</p>");
  });
});
