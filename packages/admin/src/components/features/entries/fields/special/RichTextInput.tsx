"use client";

/**
 * Rich Text Input Component
 *
 * A Lexical-based rich text editor that integrates with React Hook Form.
 * Provides WYSIWYG editing with support for headings, lists, links, code,
 * tables, video embeds, galleries, collapsible sections, and more.
 *
 * The editor stores its state as JSON, allowing for flexible serialization
 * and future conversion to HTML/Markdown as needed.
 *
 * @module components/entries/fields/special/RichTextInput
 * @since 1.0.0
 */

import { CodeNode, CodeHighlightNode } from "@lexical/code";
import { LinkNode, AutoLinkNode } from "@lexical/link";
import { ListNode, ListItemNode } from "@lexical/list";
import { TRANSFORMERS } from "@lexical/markdown";
import { CheckListPlugin } from "@lexical/react/LexicalCheckListPlugin";
import { LexicalComposer } from "@lexical/react/LexicalComposer";
// Lexical core
import { ContentEditable } from "@lexical/react/LexicalContentEditable";
import { LexicalErrorBoundary } from "@lexical/react/LexicalErrorBoundary";
import { HistoryPlugin } from "@lexical/react/LexicalHistoryPlugin";
import { HorizontalRuleNode } from "@lexical/react/LexicalHorizontalRuleNode";
import { HorizontalRulePlugin } from "@lexical/react/LexicalHorizontalRulePlugin";
import { LinkPlugin } from "@lexical/react/LexicalLinkPlugin";
import { ListPlugin } from "@lexical/react/LexicalListPlugin";
import { MarkdownShortcutPlugin } from "@lexical/react/LexicalMarkdownShortcutPlugin";
import { OnChangePlugin } from "@lexical/react/LexicalOnChangePlugin";
import { RichTextPlugin } from "@lexical/react/LexicalRichTextPlugin";
import { TablePlugin } from "@lexical/react/LexicalTablePlugin";
// Lexical nodes
import { HeadingNode, QuoteNode } from "@lexical/rich-text";
import { TableCellNode, TableNode, TableRowNode } from "@lexical/table";
// Types
import type { RichTextFieldConfig } from "@revnixhq/nextly/config";
import type { EditorState, SerializedEditorState } from "lexical";
import { useCallback, useMemo, useState } from "react";
import {
  useController,
  type Control,
  type FieldValues,
  type Path,
} from "react-hook-form";

import { cn } from "@admin/lib/utils";

// Custom nodes
import { ButtonGroupNode } from "./ButtonGroupNode";
import { ButtonLinkNode } from "./ButtonLinkNode";
import {
  CollapsibleContainerNode,
  CollapsibleTitleNode,
  CollapsibleContentNode,
} from "./CollapsibleNode";
import { DraggableBlockMenuPlugin } from "./DraggableBlockMenuPlugin";
import { GalleryNode } from "./GalleryNode";
import { ImageNode } from "./ImageNode";
// Local plugins
import { RichTextButtonGroupPlugin } from "./RichTextButtonGroupPlugin";
import { RichTextButtonLinkPlugin } from "./RichTextButtonLinkPlugin";
import { RichTextCollapsiblePlugin } from "./RichTextCollapsiblePlugin";
import { RichTextGalleryPlugin } from "./RichTextGalleryPlugin";
import { RichTextLinkPlugin } from "./RichTextLinkPlugin";
import { RichTextMediaPlugin } from "./RichTextMediaPlugin";
import { RichTextTablePlugin } from "./RichTextTablePlugin";
import { RichTextToolbar } from "./RichTextToolbar";
import { RichTextVideoPlugin } from "./RichTextVideoPlugin";
import { SlashCommandPlugin } from "./SlashCommandPlugin";
import { TableActionMenuPlugin } from "./TableActionMenuPlugin";
import { VideoNode } from "./VideoNode";

// ============================================================
// Types
// ============================================================

export interface RichTextInputProps<
  TFieldValues extends FieldValues = FieldValues,
> {
  name: Path<TFieldValues>;
  field: RichTextFieldConfig;
  control: Control<TFieldValues>;
  disabled?: boolean;
  readOnly?: boolean;
  className?: string;
}

// ============================================================
// Theme Configuration
// ============================================================

const editorTheme = {
  // Root element
  root: "focus:outline-none",

  // Text formatting
  text: {
    bold: "font-bold",
    italic: "italic",
    underline: "underline",
    strikethrough: "line-through",
    code: "bg-primary/5 px-1.5 py-0.5 rounded-none font-mono text-sm",
    highlight: "bg-yellow-200 dark:bg-yellow-800",
    subscript: "align-sub text-xs",
    superscript: "align-super text-xs",
  },

  // Headings
  heading: {
    h1: "text-3xl font-bold mt-6 mb-4 first:mt-0",
    h2: "text-2xl font-bold mt-5 mb-3 first:mt-0",
    h3: "text-xl font-bold mt-4 mb-2 first:mt-0",
    h4: "text-lg font-semibold mt-4 mb-2 first:mt-0",
    h5: "text-base font-semibold mt-3 mb-1 first:mt-0",
    h6: "text-sm font-semibold mt-3 mb-1 first:mt-0",
  },

  // Paragraphs
  paragraph: "mb-2 last:mb-0",

  // Lists
  list: {
    ul: "list-disc ml-6 mb-2",
    ol: "list-decimal ml-6 mb-2",
    listitem: "mb-1",
    listitemChecked:
      "line-through text-muted-foreground list-none relative pl-6 before:content-['✓'] before:absolute before:left-0 before:text-green-500",
    listitemUnchecked:
      "list-none relative pl-6 before:content-['○'] before:absolute before:left-0",
    nested: {
      listitem: "list-none",
    },
  },

  // Blockquote
  quote:
    "border-l-4 border-muted-foreground/30 pl-4 italic text-muted-foreground mb-2",

  // Links
  link: "text-primary underline hover-unified cursor-pointer",

  // Code blocks
  code: "block bg-primary/5 p-4 rounded-none font-mono text-sm mb-2 overflow-x-auto",
  codeHighlight: {
    atrule: "text-purple-500",
    attr: "text-primary",
    boolean: "text-orange-500",
    builtin: "text-cyan-500",
    cdata: "text-gray-500",
    char: "text-green-500",
    class: "text-yellow-500",
    "class-name": "text-yellow-500",
    comment: "text-gray-500 italic",
    constant: "text-orange-500",
    deleted: "text-red-500",
    doctype: "text-gray-500",
    entity: "text-red-500",
    function: "text-primary",
    important: "text-red-500 font-bold",
    inserted: "text-green-500",
    keyword: "text-purple-500",
    namespace: "text-gray-500",
    number: "text-orange-500",
    operator: "text-pink-500",
    prolog: "text-gray-500",
    property: "text-primary",
    punctuation: "text-gray-600",
    regex: "text-red-500",
    selector: "text-green-500",
    string: "text-green-500",
    symbol: "text-orange-500",
    tag: "text-red-500",
    url: "text-primary underline",
    variable: "text-orange-500",
  },

  // Tables
  table: "border-collapse w-full my-4",
  tableCell: "border border-border px-3 py-2 text-left align-top min-w-[75px]",
  tableCellHeader:
    "border border-border px-3 py-2 text-left font-bold bg-primary/5 align-top",
  tableRow: "",
  tableRowStriping: "even:bg-primary/5",
};

// ============================================================
// Component
// ============================================================

export function RichTextInput<TFieldValues extends FieldValues = FieldValues>({
  name,
  field,
  control,
  disabled = false,
  readOnly = false,
  className,
}: RichTextInputProps<TFieldValues>) {
  const {
    field: { value, onChange },
  } = useController({
    name,
    control,
    defaultValue: null as TFieldValues[Path<TFieldValues>],
  });

  const initialConfig = useMemo(
    () => ({
      namespace: name,
      theme: editorTheme,
      nodes: [
        HeadingNode,
        QuoteNode,
        ListNode,
        ListItemNode,
        LinkNode,
        AutoLinkNode,
        CodeNode,
        CodeHighlightNode,
        HorizontalRuleNode,
        TableNode,
        TableCellNode,
        TableRowNode,
        ImageNode,
        VideoNode,
        ButtonLinkNode,
        ButtonGroupNode,
        GalleryNode,
        CollapsibleContainerNode,
        CollapsibleTitleNode,
        CollapsibleContentNode,
      ],
      editable: !disabled && !readOnly,
      onError: (error: Error) => {
        console.error("[RichTextInput] Lexical error:", error);
      },
      editorState: value
        ? JSON.stringify(value as SerializedEditorState)
        : undefined,
    }),
    // Reason: value is intentionally excluded — Lexical's initialConfig should only
    // be computed once; subsequent value changes are handled by Lexical internally.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [name, disabled, readOnly]
  );

  const handleChange = useCallback(
    (editorState: EditorState) => {
      const serializedState = editorState.toJSON();
      onChange(serializedState);
    },
    [onChange]
  );

  const isEditable = !disabled && !readOnly;
  const placeholder = field.admin?.placeholder ?? "Start writing...";
  const [editorAnchor, setEditorAnchor] = useState<HTMLDivElement | null>(null);

  return (
    <div
      className={cn(
        "relative rounded-none border bg-background",
        !isEditable && "bg-primary/5 cursor-not-allowed",
        className
      )}
      data-richtext-editor
    >
      <LexicalComposer initialConfig={initialConfig}>
        {/* Toolbar */}
        <RichTextToolbar features={field.features} disabled={!isEditable} />

        {/* Main editor area */}
        <div className="relative" ref={setEditorAnchor}>
          <RichTextPlugin
            contentEditable={
              <ContentEditable
                className={cn(
                  "min-h-[200px] pt-8 pl-12 pr-4 pb-4 outline-none prose prose-sm dark:prose-invert max-w-none",
                  !isEditable && "cursor-not-allowed opacity-60"
                )}
                aria-label={field.label || name}
                aria-describedby={
                  field.admin?.description ? `${name}-description` : undefined
                }
              />
            }
            placeholder={
              <div className="absolute top-8 left-12 text-muted-foreground pointer-events-none select-none">
                {placeholder}
              </div>
            }
            ErrorBoundary={LexicalErrorBoundary}
          />
        </div>

        {/* Core Plugins */}
        <HistoryPlugin />
        <OnChangePlugin onChange={handleChange} ignoreSelectionChange />
        <ListPlugin />
        <CheckListPlugin />
        <LinkPlugin />
        <MarkdownShortcutPlugin transformers={TRANSFORMERS} />
        <HorizontalRulePlugin />
        <TablePlugin />
        <TableActionMenuPlugin disabled={!isEditable} />

        {/* Custom Plugins */}
        <RichTextLinkPlugin disabled={!isEditable} />
        <RichTextMediaPlugin disabled={!isEditable} />
        <RichTextVideoPlugin disabled={!isEditable} />
        <RichTextButtonLinkPlugin disabled={!isEditable} />
        <RichTextButtonGroupPlugin disabled={!isEditable} />
        <RichTextTablePlugin disabled={!isEditable} />
        <RichTextCollapsiblePlugin disabled={!isEditable} />
        <RichTextGalleryPlugin disabled={!isEditable} />
        <SlashCommandPlugin disabled={!isEditable} />
        {editorAnchor && (
          <DraggableBlockMenuPlugin
            disabled={!isEditable}
            anchorElem={editorAnchor}
          />
        )}
      </LexicalComposer>
    </div>
  );
}

// ============================================================
// Exports
// ============================================================
