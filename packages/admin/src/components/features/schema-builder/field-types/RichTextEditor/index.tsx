/**
 * RichTextEditor Component
 *
 * Main Lexical editor component for rich text editing.
 * Integrates toolbar, plugins, and custom nodes.
 *
 * Features:
 * - WYSIWYG editing with toolbar
 * - Markdown shortcuts
 * - Image insertion via MediaPickerDialog
 * - Undo/redo support
 * - JSON serialization for database storage
 * - Dark mode support
 *
 * @see https://lexical.dev/docs/react/
 */

"use client";

import { CodeNode } from "@lexical/code";
import { LinkNode, AutoLinkNode } from "@lexical/link";
import { ListNode, ListItemNode } from "@lexical/list";
import { TRANSFORMERS } from "@lexical/markdown";
import { AutoFocusPlugin } from "@lexical/react/LexicalAutoFocusPlugin";
import { LexicalComposer } from "@lexical/react/LexicalComposer";
import { ContentEditable } from "@lexical/react/LexicalContentEditable";
import { LexicalErrorBoundary } from "@lexical/react/LexicalErrorBoundary";
import { HistoryPlugin } from "@lexical/react/LexicalHistoryPlugin";
import { LinkPlugin } from "@lexical/react/LexicalLinkPlugin";
import { ListPlugin } from "@lexical/react/LexicalListPlugin";
import { MarkdownShortcutPlugin } from "@lexical/react/LexicalMarkdownShortcutPlugin";
import { OnChangePlugin } from "@lexical/react/LexicalOnChangePlugin";
import { RichTextPlugin } from "@lexical/react/LexicalRichTextPlugin";
import { HeadingNode, QuoteNode } from "@lexical/rich-text";
import type { EditorState } from "lexical";

import { EditorToolbar } from "./EditorToolbar";
import { ImageNode } from "./ImageNode";
import { ImagePlugin } from "./ImagePlugin";
import { lexicalTheme } from "./theme";

interface RichTextEditorProps {
  /**
   * Initial editor state (JSON string from database)
   * If undefined, editor starts empty
   */
  value?: string;

  /**
   * Callback when editor content changes
   * Receives serialized JSON state
   */
  onChange: (jsonState: string) => void;

  /**
   * Placeholder text when editor is empty
   */
  placeholder?: string;

  /**
   * Minimum height for editor (in pixels)
   */
  height?: number;

  /**
   * Toolbar options configuration
   */
  toolbarOptions?: {
    basic_formatting?: boolean;
    links?: boolean;
    lists?: boolean;
    images?: boolean;
    code_blocks?: boolean;
  };

  /**
   * Disable editor (read-only mode)
   */
  disabled?: boolean;
}

/**
 * RichTextEditor Component
 *
 * Wraps Lexical editor with all necessary plugins and configuration.
 * Designed to be used within react-hook-form Controller.
 */
export function RichTextEditor({
  value,
  onChange,
  placeholder = "Start writing...",
  height = 300,
  toolbarOptions,
  disabled = false,
}: RichTextEditorProps) {
  // Parse initial state from JSON
  const initialEditorState = value ? value : undefined;

  // Lexical configuration
  const initialConfig = {
    namespace: "NextlyRichTextEditor",
    theme: lexicalTheme,
    onError: (error: Error) => {
      console.error("Lexical error:", error);
    },
    editable: !disabled,
    nodes: [
      HeadingNode,
      ListNode,
      ListItemNode,
      QuoteNode,
      CodeNode,
      LinkNode,
      AutoLinkNode,
      ImageNode,
    ],
    editorState: initialEditorState,
  };

  // Handle editor state changes
  const handleChange = (editorState: EditorState) => {
    const json = JSON.stringify(editorState.toJSON());
    onChange(json);
  };

  return (
    <LexicalComposer initialConfig={initialConfig}>
      <div className="relative border border-gray-300 dark:border-gray-600 rounded-md overflow-hidden bg-white dark:bg-gray-900">
        {/* Toolbar */}
        {!disabled && <EditorToolbar toolbarOptions={toolbarOptions} />}

        {/* Editor */}
        <div className="relative">
          <RichTextPlugin
            contentEditable={
              <ContentEditable
                className="outline-none px-4 py-3 overflow-auto"
                style={{ minHeight: `${height}px` }}
                aria-label="Rich text editor"
              />
            }
            placeholder={
              <div className="absolute top-3 left-4 text-gray-400 pointer-events-none select-none">
                {placeholder}
              </div>
            }
            ErrorBoundary={LexicalErrorBoundary}
          />
        </div>

        {/* Plugins */}
        <HistoryPlugin />
        <ListPlugin />
        <LinkPlugin />
        <MarkdownShortcutPlugin transformers={TRANSFORMERS} />
        <ImagePlugin />
        <OnChangePlugin onChange={handleChange} />
        {!disabled && <AutoFocusPlugin />}
      </div>
    </LexicalComposer>
  );
}
