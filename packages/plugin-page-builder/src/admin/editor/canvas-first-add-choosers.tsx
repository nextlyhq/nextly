"use client";

/**
 * The chooser a block just added asks for (Columns: its layout), on the
 * editor's canvas, ended by a store of the document.
 *
 * A pick joins the block's insert as one step of the history, at the same
 * depth. The editor's save point is a depth, so a pick made after a store
 * would change the stored row while the page still read as saved, and
 * leaving would drop it without asking. So a store ends the step first: the
 * row is stored as it was added, and its layout is changed from Content.
 *
 * @module @nextlyhq/plugin-page-builder/admin/editor/canvas-first-add-choosers
 */
import {
  FirstAddChoosers,
  type FirstAddChoosersProps,
} from "@nextlyhq/builder/shell";
import { useBeforeDocumentAction } from "@nextlyhq/plugin-sdk/admin";
import { useRef } from "react";

/** The canvas's first-add chooser, ended by any action that stores the page. */
export function CanvasFirstAddChoosers(
  props: FirstAddChoosersProps
): React.JSX.Element {
  // Read when the action runs, which may be after renders this one missed.
  const editor = useRef(props.editor);
  editor.current = props.editor;
  useBeforeDocumentAction(() => {
    editor.current.firstAdd?.skip();
  });
  return <FirstAddChoosers {...props} />;
}
