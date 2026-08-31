/**
 * Inserting a `{{variable}}` where the caret is.
 *
 * Its own module because the rule it encodes is subtle enough to be worth
 * naming, and easy to lose in a component this size: the insert must target the
 * body being EDITED. On the plain-text tab the only mounted textarea is bound to
 * `plainTextContent`, so writing to `htmlContent` would silently corrupt the
 * HTML at an unrelated offset — a defect with no visible symptom until the mail
 * is sent.
 */
import type { EditorView } from "@codemirror/view";
import { useCallback, type RefObject } from "react";
import type { useForm } from "react-hook-form";

import type { TemplateFormValues } from "./schema";

export function useVariableInsertion({
  form,
  editorTab,
  editorWrapRef,
  htmlEditorViewRef,
}: {
  form: ReturnType<typeof useForm<TemplateFormValues>>;
  editorTab: "html" | "text";
  editorWrapRef: RefObject<HTMLDivElement | null>;
  htmlEditorViewRef: RefObject<EditorView | null>;
}): (name: string) => void {
  return useCallback(
    (name: string) => {
      const token = `{{${name}}}`;
      // Insert into whichever body is being edited; on the plain-text tab the
      // only mounted textarea is bound to plainTextContent, so writing to
      // htmlContent would silently corrupt the HTML at an unrelated offset.
      const fieldName =
        editorTab === "html" ? "htmlContent" : "plainTextContent";
      const current = form.getValues(fieldName) ?? "";

      // The HTML tab is CodeMirror, which owns its document and has no
      // textarea to read a caret from. Dispatching the insert lets it update
      // the document and the cursor together; onChange then carries the new
      // value back to the form.
      const view = htmlEditorViewRef.current;
      if (editorTab === "html" && view) {
        const { from, to } = view.state.selection.main;
        view.dispatch({
          changes: { from, to, insert: token },
          selection: { anchor: from + token.length },
        });
        view.focus();
        return;
      }

      const ta = editorWrapRef.current?.querySelector("textarea");
      if (!ta) {
        form.setValue(fieldName, current + token, {
          shouldDirty: true,
          shouldValidate: true,
        });
        return;
      }
      const start = ta.selectionStart ?? current.length;
      const end = ta.selectionEnd ?? current.length;
      const next = current.slice(0, start) + token + current.slice(end);
      form.setValue(fieldName, next, {
        shouldDirty: true,
        shouldValidate: true,
      });
      requestAnimationFrame(() => {
        ta.focus();
        const pos = start + token.length;
        ta.setSelectionRange(pos, pos);
      });
    },
    [form, editorTab, editorWrapRef, htmlEditorViewRef]
  );
}
