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

import { TRANSFORMERS } from "@lexical/markdown";
import { CheckListPlugin } from "@lexical/react/LexicalCheckListPlugin";
import { LexicalComposer } from "@lexical/react/LexicalComposer";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
// Lexical core
import { ContentEditable } from "@lexical/react/LexicalContentEditable";
import { LexicalErrorBoundary } from "@lexical/react/LexicalErrorBoundary";
import { HistoryPlugin } from "@lexical/react/LexicalHistoryPlugin";
import { HorizontalRulePlugin } from "@lexical/react/LexicalHorizontalRulePlugin";
import { LinkPlugin } from "@lexical/react/LexicalLinkPlugin";
import { ListPlugin } from "@lexical/react/LexicalListPlugin";
import { MarkdownShortcutPlugin } from "@lexical/react/LexicalMarkdownShortcutPlugin";
import { OnChangePlugin } from "@lexical/react/LexicalOnChangePlugin";
import { RichTextPlugin } from "@lexical/react/LexicalRichTextPlugin";
import { TablePlugin } from "@lexical/react/LexicalTablePlugin";
// Lexical nodes
// Types
import type { EditorState, SerializedEditorState } from "lexical";
import { $createParagraphNode, $getRoot, CLEAR_HISTORY_COMMAND } from "lexical";
import type { RichTextFieldConfig } from "nextly/config";
import type { RefObject } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  useController,
  type Control,
  type FieldValues,
  type Path,
} from "react-hook-form";

import { cn } from "@admin/lib/utils";

// Custom nodes
import { CodeHighlightPlugin } from "./CodeHighlightPlugin";
import { DraggableBlockMenuPlugin } from "./DraggableBlockMenuPlugin";
import {
  RICH_TEXT_NODES,
  RICH_TEXT_THEME as editorTheme,
} from "./rich-text-kit";
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

// ============================================================
// External value sync
// ============================================================

/** Update tag marking editor updates applied FROM the form value, so the change
 *  handler can tell them apart from the user's own edits. */
const EXTERNAL_SYNC_TAG = "external-value-sync";

/**
 * Load external form-value changes into the editor. Lexical only reads
 * `initialConfig.editorState` once, so without this a `form.reset(...)` — a content-language
 * switch or a version restore — swaps every controlled input's value while the editor keeps
 * displaying the first-mounted content (and a save from that stale screen would overwrite the
 * other language's translation with it).
 *
 * Echo detection is by OBJECT IDENTITY: `lastEmittedValueRef` holds the exact object the
 * editor last handed to the form (react-hook-form stores it as-is, while `form.reset(...)`
 * clones its input), so the editor's own typing echoing back is recognized and never
 * re-applied — the caret is left alone while the user types. `lastAppliedRef` (serialized)
 * additionally skips re-APPLYING an external value whose content the editor already shows,
 * while the history reset below still runs for it.
 */
function ExternalValueSyncPlugin({
  value,
  lastAppliedRef,
  lastEmittedValueRef,
}: {
  value: unknown;
  lastAppliedRef: RefObject<string | null>;
  lastEmittedValueRef: RefObject<unknown>;
}): null {
  const [editor] = useLexicalComposerContext();
  useEffect(() => {
    if (value === lastEmittedValueRef.current) return;
    lastEmittedValueRef.current = value;

    // A locale's freshly-seeded translation is byte-identical to the default locale's
    // content, so "the value did not change" must not be inferred from content equality —
    // only re-APPLYING is skipped for identical content; the history reset still runs.
    const incoming = value ? JSON.stringify(value) : null;
    if (incoming !== lastAppliedRef.current) {
      lastAppliedRef.current = incoming;
      // A stored value can be corrupted or reference a node type that is no longer
      // registered; parsing throws synchronously, which would take down the whole editor
      // tree. Degrade to the empty document instead — showing the PREVIOUS document is not
      // an option, since saving from it would write that content into this language.
      let applied = false;
      if (incoming) {
        try {
          editor.setEditorState(editor.parseEditorState(incoming), {
            tag: EXTERNAL_SYNC_TAG,
          });
          applied = true;
        } catch (error) {
          console.error(
            "[RichTextInput] Failed to load external editor value:",
            error
          );
        }
      }
      if (!applied) {
        // No stored value for this language (or an unloadable one): show an empty
        // document (one empty paragraph — Lexical's canonical empty state).
        editor.update(
          () => {
            const root = $getRoot();
            root.clear();
            root.append($createParagraphNode());
          },
          { tag: EXTERNAL_SYNC_TAG }
        );
      }
    }
    // An external value replaces the whole document (another language's content, a restored
    // version), so the undo stack must not bridge it: an undo would resurrect the PREVIOUS
    // document into this one and a save would persist it there. Runs even when the content
    // is identical (the seeded-translation case above) — the documents are still distinct.
    editor.dispatchCommand(CLEAR_HISTORY_COMMAND, undefined);
  }, [value, editor, lastAppliedRef, lastEmittedValueRef]);
  return null;
}

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

  // The form value as of MOUNT, frozen: Lexical reads initialConfig.editorState exactly
  // once, so the config must not observe later values — those are handled by
  // OnChangePlugin + ExternalValueSyncPlugin. Reading through a never-updated ref keeps
  // `value` out of the memo entirely.
  const mountValueRef = useRef(value);

  const initialConfig = useMemo(
    () => ({
      namespace: name,
      theme: editorTheme,
      // The SHARED list, not a copy. Two lists agree the day they are written
      // and diverge the day one gains a node, and neither side raises anything
      // because an unregistered node is a rendering outcome, not an error.
      nodes: [...RICH_TEXT_NODES],
      editable: !disabled && !readOnly,
      onError: (error: Error) => {
        console.error("[RichTextInput] Lexical error:", error);
      },
      editorState: mountValueRef.current
        ? JSON.stringify(mountValueRef.current as SerializedEditorState)
        : undefined,
    }),
    [name, disabled, readOnly]
  );

  // The serialized state the editor last held, whatever its origin (the user's edits or an
  // applied external value). The sync plugin uses this to skip re-applying content the
  // editor already shows. Seeded with the mount value (initialConfig loaded it).
  const lastAppliedRef = useRef<string | null>(
    value ? JSON.stringify(value) : null
  );
  // The exact object the editor last handed to the form via onChange (or the mount value):
  // the sync plugin's echo detector. Object identity distinguishes the editor's own
  // emission coming back (same reference) from a form reset (react-hook-form clones reset
  // values, so those always arrive as new references).
  const lastEmittedValueRef = useRef<unknown>(value);

  const handleChange = useCallback(
    (editorState: EditorState, _editor: unknown, tags: Set<string>) => {
      const serializedState = editorState.toJSON();
      // Record what the editor now holds (possibly normalized by Lexical) BEFORE
      // notifying the form, so the echo of this value never re-applies.
      lastAppliedRef.current = JSON.stringify(serializedState);
      // An update applied FROM the form value must not be pushed back into the form:
      // clearing for an untranslated language would otherwise overwrite the form's
      // `null` with an empty document, marking that language as "translated".
      if (tags.has(EXTERNAL_SYNC_TAG)) return;
      lastEmittedValueRef.current = serializedState;
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
        "relative rounded-md  border border-input bg-background",
        !isEditable && "bg-primary/5 cursor-not-allowed",
        className
      )}
      data-richtext-editor
    >
      <LexicalComposer initialConfig={initialConfig}>
        {/* Toolbar, omitted rather than disabled when the field cannot be
            edited. A row of dead controls advertises actions that are not
            available, costs a band of vertical space on every read-only
            field, and reaches assistive technology as a toolbar with a dozen
            unusable buttons. The other structured inputs already drop their
            controls this way; this one greyed them instead. */}
        {isEditable ? <RichTextToolbar features={field.features} /> : null}

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
        {/* Follows external form-value changes (locale switch, version restore). */}
        <ExternalValueSyncPlugin
          value={value}
          lastAppliedRef={lastAppliedRef}
          lastEmittedValueRef={lastEmittedValueRef}
        />
        <ListPlugin />
        <CheckListPlugin />
        <LinkPlugin />
        <MarkdownShortcutPlugin transformers={TRANSFORMERS} />
        <HorizontalRulePlugin />
        <CodeHighlightPlugin />
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
