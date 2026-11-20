/**
 * The editor of a written block's text: a heading, a text block, a button's
 * label or an image's alt text. It holds the stored runs exactly (see
 * `runs.ts`), shows chips as one piece each, and offers bold and italic
 * where the block takes them.
 *
 * @module components/features/settings/EmailTemplateForm/written/RunEditor
 */
import { LexicalComposer } from "@lexical/react/LexicalComposer";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { ContentEditable } from "@lexical/react/LexicalContentEditable";
import { LexicalErrorBoundary } from "@lexical/react/LexicalErrorBoundary";
import { HistoryPlugin } from "@lexical/react/LexicalHistoryPlugin";
import { OnChangePlugin } from "@lexical/react/LexicalOnChangePlugin";
import { PlainTextPlugin } from "@lexical/react/LexicalPlainTextPlugin";
import { RichTextPlugin } from "@lexical/react/LexicalRichTextPlugin";
import { Button } from "@nextlyhq/ui";
import {
  $getSelection,
  $isRangeSelection,
  $setSelection,
  CLEAR_HISTORY_COMMAND,
  COMMAND_PRIORITY_LOW,
  FOCUS_COMMAND,
  FORMAT_TEXT_COMMAND,
  type LexicalEditor,
  type RangeSelection,
} from "lexical";
import { useContext, useEffect, useState, type JSX } from "react";

import { Bold, Italic, Link } from "@admin/components/icons";
import { toast } from "@admin/components/ui";
import { cn } from "@admin/lib/utils";

import { ChipViewContext } from "./ChipLabel";
import { LinkDialog } from "./LinkDialog";
import {
  $readRuns,
  $selectedLink,
  $setRuns,
  $setSelectionLink,
  RUN_NODES,
  type Inline,
  type WrittenLink,
} from "./runs";

/** Whether two run lists store the same text. */
function sameRuns(a: readonly Inline[], b: readonly Inline[]): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * Keeps the editor on the stored value: when it changes from outside (a move,
 * an Undo, a duplicate), the editor shows it; when it is what the editor
 * already holds (the person typing), nothing is replaced, so the cursor stays.
 */
function SyncPlugin({ value }: { value: readonly Inline[] }): null {
  const [editor] = useLexicalComposerContext();
  useEffect(() => {
    const held = editor.getEditorState().read(() => $readRuns());
    if (!sameRuns(held, value)) {
      editor.update(() => $setRuns(value));
      // A value from outside (a move, an Undo) is another block's text in
      // this place now: its own Undo must not reach back to what was here.
      editor.dispatchCommand(CLEAR_HISTORY_COMMAND, undefined);
    }
  }, [editor, value]);
  return null;
}

/**
 * Keeps the live editor's editability on `readOnly`, which the initial
 * config sets only once: an email turning read-only (as during a save) stops
 * taking input at once.
 */
function EditablePlugin({ readOnly }: { readOnly: boolean }): null {
  const [editor] = useLexicalComposerContext();
  useEffect(() => {
    editor.setEditable(!readOnly);
  }, [editor, readOnly]);
  return null;
}

/** Tells the body which editor was typed in last, for Insert variable. */
function FocusPlugin({
  onFocus,
}: {
  onFocus: ((editor: LexicalEditor) => void) | undefined;
}): null {
  const [editor] = useLexicalComposerContext();
  useEffect(
    () =>
      editor.registerCommand(
        FOCUS_COMMAND,
        () => {
          onFocus?.(editor);
          return false;
        },
        COMMAND_PRIORITY_LOW
      ),
    [editor, onFocus]
  );
  return null;
}

/** Bold, italic and a link, for the selected text. */
function MarksToolbar({ label }: { label: string }): JSX.Element {
  const [editor] = useLexicalComposerContext();
  const view = useContext(ChipViewContext);
  // The selection the link is for, kept while the dialog has the focus.
  const [linking, setLinking] = useState<{
    selection: RangeSelection;
    link: WrittenLink | undefined;
  } | null>(null);
  const startLink = () => {
    const found = editor.getEditorState().read(() => {
      const selection = $getSelection();
      return $isRangeSelection(selection) && !selection.isCollapsed()
        ? { selection: selection.clone(), link: $selectedLink() }
        : null;
    });
    if (found) setLinking(found);
    else toast.info("Select some text first, then add a link.");
  };
  const saveLink = (link: WrittenLink | undefined) => {
    const held = linking;
    if (!held) return;
    editor.update(() => {
      $setSelection(held.selection.clone());
      $setSelectionLink(link);
    });
  };
  return (
    <div
      role="toolbar"
      aria-label={`Format ${label}`}
      className="flex gap-1 border-b border-border px-1 py-1"
    >
      <Button
        type="button"
        variant="ghost"
        size="icon"
        aria-label="Bold"
        title="Bold"
        onMouseDown={event => event.preventDefault()}
        onClick={() => editor.dispatchCommand(FORMAT_TEXT_COMMAND, "bold")}
      >
        <Bold className="size-4" />
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        aria-label="Italic"
        title="Italic"
        onMouseDown={event => event.preventDefault()}
        onClick={() => editor.dispatchCommand(FORMAT_TEXT_COMMAND, "italic")}
      >
        <Italic className="size-4" />
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        aria-label="Link"
        title="Link"
        onMouseDown={event => event.preventDefault()}
        onClick={startLink}
      >
        <Link className="size-4" />
      </Button>
      <LinkDialog
        open={linking !== null}
        onOpenChange={open => {
          if (!open) setLinking(null);
        }}
        link={linking?.link}
        choices={view.paths.map(path => ({ path, name: view.name(path) }))}
        onSave={saveLink}
      />
    </div>
  );
}

export interface RunEditorProps {
  /** The runs as stored. */
  value: readonly Inline[];
  onChange: (runs: Inline[]) => void;
  /** What the field is, for a screen reader: "Heading", "Button label". */
  label: string;
  placeholder?: string;
  /** A text block's: bold and italic, and line breaks on Enter. */
  rich?: boolean;
  readOnly?: boolean;
  /** Told when the person starts typing here, with this field's editor. */
  onFocusEditor?: (editor: LexicalEditor) => void;
}

export function RunEditor({
  value,
  onChange,
  label,
  placeholder,
  rich = false,
  readOnly = false,
  onFocusEditor,
}: RunEditorProps): JSX.Element {
  const initialConfig = {
    namespace: "written-run",
    nodes: [...RUN_NODES],
    editable: !readOnly,
    editorState: () => $setRuns(value),
    theme: { text: { bold: "font-semibold", italic: "italic" } },
    onError: (error: Error) => {
      throw error;
    },
  };
  const editable = (
    <ContentEditable
      aria-label={label}
      aria-readonly={readOnly}
      className={cn(
        "min-h-9 px-3 py-2 text-sm outline-none",
        rich && "min-h-16"
      )}
    />
  );
  const shownPlaceholder = placeholder ? (
    <div className="pointer-events-none absolute top-2 left-3 text-sm text-muted-foreground">
      {placeholder}
    </div>
  ) : null;
  const TextPlugin = rich ? RichTextPlugin : PlainTextPlugin;
  return (
    <LexicalComposer initialConfig={initialConfig}>
      <div className="rounded-md border border-input bg-background focus-within:ring-2 focus-within:ring-ring">
        {rich && !readOnly ? <MarksToolbar label={label} /> : null}
        <div className="relative">
          <TextPlugin
            contentEditable={editable}
            placeholder={shownPlaceholder}
            ErrorBoundary={LexicalErrorBoundary}
          />
        </div>
      </div>
      <HistoryPlugin />
      <SyncPlugin value={value} />
      <EditablePlugin readOnly={readOnly} />
      <FocusPlugin onFocus={onFocusEditor} />
      <OnChangePlugin
        ignoreSelectionChange
        onChange={state => {
          const runs = state.read(() => $readRuns());
          if (!sameRuns(runs, value)) onChange(runs);
        }}
      />
    </LexicalComposer>
  );
}
