/**
 * Inserting a `{{variable}}` where the caret is.
 *
 * Its own module because the rule it encodes is subtle enough to be worth
 * naming, and easy to lose in a component this size: the insert must target the
 * body being EDITED. Each tab mounts its own editor, bound to its own field, so
 * writing to `htmlContent` from the plain-text tab would silently corrupt the
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
  bodyViewRef,
}: {
  form: ReturnType<typeof useForm<TemplateFormValues>>;
  editorTab: "html" | "text";
  /** The mounted body editor: the tab being edited. */
  bodyViewRef: RefObject<EditorView | null>;
}): (name: string) => void {
  return useCallback(
    (name: string) => {
      const token = `{{${name}}}`;
      // The editor owns its document, so the insert is dispatched to it: it
      // updates the text and the caret together, and its onChange carries the
      // new value to the field this tab is bound to.
      const view = bodyViewRef.current;
      if (view) {
        const { from, to } = view.state.selection.main;
        view.dispatch({
          changes: { from, to, insert: token },
          selection: { anchor: from + token.length },
        });
        view.focus();
        return;
      }
      // The editor is still loading: append to the field being edited.
      const fieldName =
        editorTab === "html" ? "htmlContent" : "plainTextContent";
      form.setValue(fieldName, (form.getValues(fieldName) ?? "") + token, {
        shouldDirty: true,
        shouldValidate: true,
      });
    },
    [form, editorTab, bodyViewRef]
  );
}
