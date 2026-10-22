"use client";

/**
 * The email editor: the admin's CodeMirror and code palette, reading Liquid.
 *
 * One component for every field that holds Liquid: the body (Liquid inside
 * HTML), the plain text, and the single-line envelope fields (subject,
 * preview text, From, Reply-To), which look and behave like inputs. Each
 * completes the template's variables and their properties, Liquid's tags and
 * filters, and marks a problem at its line as the author types, with the
 * parser the server renders with.
 *
 * Loaded on demand (see `LazyLiquidEditor`): it brings CodeMirror's Liquid
 * grammar and LiquidJS, which nothing else in the admin needs.
 */
import { autocompletion } from "@codemirror/autocomplete";
import { html } from "@codemirror/lang-html";
import { liquid } from "@codemirror/lang-liquid";
import { linter, type Diagnostic } from "@codemirror/lint";
import CodeMirror, { EditorState, EditorView } from "@uiw/react-codemirror";
import { useEffect, useMemo, useRef } from "react";

import { useTheme } from "@admin/context/providers/ThemeProvider";
import {
  nextlyEditorChrome,
  nextlyHighlighting,
} from "@admin/lib/code-highlight";

import {
  emailCompletionSource,
  type CompletionData,
} from "./liquid-completion";
import { liquidProblems, type LiquidProblem } from "./liquid-problems";

export interface LiquidEditorProps {
  value: string;
  onChange: (value: string) => void;
  /** `html`: Liquid inside HTML (the body). `text`: Liquid in plain text. */
  mode: "html" | "text";
  /** One line that looks like an input: Enter and pasted breaks are refused. */
  singleLine?: boolean;
  /** The accessible name: what a screen reader announces for the field. */
  label: string;
  readOnly: boolean;
  disabled?: boolean;
  /** What completion offers: the template's variables and test data. */
  completion: CompletionData;
  placeholder?: string;
  /** Lines of height for a multi-line editor before it grows. */
  minHeight?: number;
  onCreateEditor?: (view: EditorView) => void;
  /** Told each time the problems change, for a list beside the editor. */
  onProblems?: (problems: LiquidProblem[]) => void;
}

/** A single line: a change that would make two is refused. */
const oneLine = EditorState.transactionFilter.of(transaction =>
  transaction.newDoc.lines > 1 ? [] : transaction
);

/**
 * A single-line editor sized, spaced and set like the admin's inputs: a
 * subject is prose with Liquid in it, not code, so it reads in the body face.
 * `&.cm-editor` outranks the chrome's mono rule for the scroller.
 */
const inputLike = EditorView.theme({
  "&": { minHeight: "36px" },
  "&.cm-editor .cm-scroller": {
    fontFamily: "var(--font-sans, ui-sans-serif, system-ui, sans-serif)",
  },
  ".cm-content": { padding: "7px 0" },
  ".cm-line": { padding: "0 10px" },
  ".cm-scroller": { overflowX: "auto", overflowY: "hidden" },
});

export function LiquidEditor({
  value,
  onChange,
  mode,
  singleLine = false,
  label,
  readOnly,
  disabled = false,
  completion,
  placeholder,
  minHeight = 380,
  onCreateEditor,
  onProblems,
}: LiquidEditorProps) {
  const { resolvedTheme } = useTheme();

  // Read through refs, so the extensions are built once per field: test
  // data and declarations change as the author works, and rebuilding the
  // extensions each time would reconfigure the editor under their caret.
  const completionRef = useRef(completion);
  const problemsRef = useRef(onProblems);
  useEffect(() => {
    completionRef.current = completion;
    problemsRef.current = onProblems;
  });

  const extensions = useMemo(
    () => [
      liquid(mode === "html" ? { base: html() } : {}),
      autocompletion({
        override: [
          context => emailCompletionSource(completionRef.current)(context),
        ],
      }),
      linter(
        view => {
          const problems = liquidProblems(view.state.doc.toString());
          problemsRef.current?.(problems);
          return problems.map(
            (problem): Diagnostic => ({
              from: problem.from,
              to: problem.to,
              severity: "error",
              message: problem.message,
            })
          );
        },
        { delay: 300 }
      ),
      EditorView.contentAttributes.of({
        "aria-label": label,
        // Stated, though an editable element takes focus anyway: assistive
        // checks that ask whether a scrolling region holds anything focusable
        // count a tab stop, not `contenteditable`.
        ...(disabled ? {} : { tabindex: "0" }),
      }),
      nextlyHighlighting,
      nextlyEditorChrome({
        fontSize: singleLine ? 14 : 13,
        dark: resolvedTheme === "dark",
      }),
      ...(singleLine ? [oneLine, inputLike] : [EditorView.lineWrapping]),
    ],
    [mode, label, singleLine, disabled, resolvedTheme]
  );

  return (
    <CodeMirror
      value={value}
      onChange={onChange}
      extensions={extensions}
      height={singleLine ? "36px" : undefined}
      minHeight={singleLine ? undefined : `${minHeight}px`}
      // Colours come from `--nx-code-*`, which the theme redeclares in dark
      // mode, as for every other code field in the admin.
      theme="none"
      // Read-only still takes focus: an owner's body is read, selected and
      // scrolled from the keyboard. `readOnly` refuses the edits, and marks
      // the field aria-readonly. Only a pending save takes the focus away.
      editable={!disabled}
      readOnly={disabled || readOnly}
      basicSetup={{
        lineNumbers: !singleLine,
        foldGutter: !singleLine,
        highlightActiveLine: !singleLine && !readOnly,
        highlightActiveLineGutter: !singleLine && !readOnly,
        // Ours, above, with the template's variables.
        autocompletion: false,
        closeBrackets: true,
        bracketMatching: true,
        tabSize: 2,
        indentOnInput: !singleLine,
        searchKeymap: !singleLine,
        completionKeymap: true,
        lintKeymap: true,
      }}
      placeholder={placeholder}
      onCreateEditor={onCreateEditor}
      className="overflow-hidden rounded-md border border-input"
    />
  );
}
