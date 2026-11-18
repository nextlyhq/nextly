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
import { FORMAT_TEXT_COMMAND } from "lexical";
import { useEffect, type JSX } from "react";

import { Bold, Italic } from "@admin/components/icons";
import { cn } from "@admin/lib/utils";

import { $readRuns, $setRuns, RUN_NODES, type Inline } from "./runs";

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
    if (!sameRuns(held, value)) editor.update(() => $setRuns(value));
  }, [editor, value]);
  return null;
}

/** Bold and italic, for the selected text. */
function MarksToolbar({ label }: { label: string }): JSX.Element {
  const [editor] = useLexicalComposerContext();
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
}

export function RunEditor({
  value,
  onChange,
  label,
  placeholder,
  rich = false,
  readOnly = false,
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
