"use client";

/**
 * A `text` widget's prose, drawn read-only through the rich-text stack.
 *
 * The same Lexical the rich-text field edits with, in a composer that never
 * becomes editable: one rich-text stack in the product rather than a second
 * markdown renderer beside it, the editor's own nodes and (card-scaled) theme,
 * and no HTML string anywhere between the markdown and the DOM. Loaded lazily
 * by `textBody`, so a dashboard with no text card pays nothing for it.
 *
 * The root is a plain element handed to the editor, not `ContentEditable`.
 * That component is an editor's surface: it takes `role="textbox"` and, when
 * the editor is not editable, `aria-readonly` -- so a card of prose read as a
 * disabled form control, and a screen reader moving through headings and links
 * met a textbox instead of a document. Prose in a card is document content,
 * and a plain element says so by saying nothing.
 *
 * Keyed on the content by its caller: a composer reads its initial state once,
 * and a card whose declaration changed under a plugin reload should redraw
 * rather than keep the prose it first mounted with.
 *
 * @module components/features/widgets/archetypes/TextMarkdown
 */

import { $convertFromMarkdownString } from "@lexical/markdown";
import { LexicalComposer } from "@lexical/react/LexicalComposer";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { useCallback, useMemo } from "react";

import { RICH_TEXT_NODES } from "@admin/components/features/entries/fields/special/rich-text-kit";

import {
  $openExternalLinksInNewTab,
  TEXT_WIDGET_THEME,
  TEXT_WIDGET_TRANSFORMERS,
} from "./text-markdown";

export interface TextMarkdownProps {
  content: string;
}

/**
 * The element the editor draws into.
 *
 * `setRootElement` is the whole of what `ContentEditable` does for a
 * non-editable editor, minus the textbox semantics that do not belong on
 * prose. Passing `null` on unmount releases the editor's DOM listeners.
 */
function ProseRoot() {
  const [editor] = useLexicalComposerContext();
  const attach = useCallback(
    (element: HTMLDivElement | null) => {
      editor.setRootElement(element);
    },
    [editor]
  );
  return (
    <div
      ref={attach}
      data-testid="widget-text"
      data-widget-text=""
      className="text-sm text-foreground"
    />
  );
}

export function TextMarkdown({ content }: TextMarkdownProps) {
  const initialConfig = useMemo(
    () => ({
      namespace: "widget-text",
      theme: TEXT_WIDGET_THEME,
      // The editor's list, not a subset chosen here: the transformers create
      // only what they create, and a node they never make costs nothing
      // registered.
      nodes: [...RICH_TEXT_NODES],
      editable: false,
      onError: (error: Error) => {
        console.error("[TextMarkdown] Lexical error:", error);
      },
      editorState: () => {
        $convertFromMarkdownString(content, [...TEXT_WIDGET_TRANSFORMERS]);
        $openExternalLinksInNewTab();
      },
    }),
    [content]
  );

  return (
    <LexicalComposer initialConfig={initialConfig}>
      <ProseRoot />
    </LexicalComposer>
  );
}
