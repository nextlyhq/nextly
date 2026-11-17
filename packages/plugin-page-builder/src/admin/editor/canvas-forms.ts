/**
 * The forms the editor's canvas draws under (`PageContext.forms`): a picked
 * form described as the person editing reads it, through the editor's own
 * route, so the canvas draws it as a visitor will see it once it is
 * published, a draft included. No plugin code reaches the editor: the
 * canvas draws from the provider's description, as a published page does.
 *
 * Nothing is sent from the canvas. No document is named, and the canvas
 * stops every submit before the browser acts on it (`canvas-link-guard`),
 * so the address a form there carries is never used.
 *
 * @module admin/editor/canvas-forms
 */
import type {
  FormDrawing,
  FormUnavailableDrawing,
  PageForms,
} from "@nextlyhq/blocks-react";

import type { EditorFormResponse } from "../../forms/editor-forms-contract";
import { readEditorForm } from "../editor-forms-client";

/** What a canvas form carries as its address: one that sends nothing. */
const CANVAS_FORM_ACTION = "#";

/** The drawing the block takes for one answer of the describe route. */
export function canvasDrawingOf(
  answer: EditorFormResponse
): FormDrawing | FormUnavailableDrawing {
  switch (answer.state) {
    case "published":
    case "draft":
      return answer.drawing;
    case "closed":
      return answer.message === undefined
        ? { unavailable: "closed" }
        : { unavailable: "closed", message: answer.message };
    case "missing":
      return { unavailable: "missing" };
  }
}

/** The canvas's forms, for one language and one person editing. */
export function canvasForms(
  locale: string | undefined,
  userId: string | null
): PageForms {
  return {
    action: CANVAS_FORM_ACTION,
    returnTo: "",
    describe: async form =>
      canvasDrawingOf(await readEditorForm(form, locale, userId)),
  };
}
