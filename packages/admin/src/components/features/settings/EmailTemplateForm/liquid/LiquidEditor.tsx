"use client";

/**
 * The email editor: the admin's CodeMirror and code palette, reading Liquid.
 *
 * One component for every field that holds Liquid: the body (Liquid inside
 * HTML), the plain text, and the single-line envelope fields (subject,
 * preview text, From, Reply-To), which look and behave like inputs. Each
 * completes the template's variables and their properties, Liquid's tags and
 * filters, and marks a problem at its line as the author types, with the
 * parser the server renders with. A template kept on the previous engine is
 * sent without Liquid, so its editor offers none of that.
 *
 * Loaded on demand (see `LazyLiquidEditor`): it brings CodeMirror's Liquid
 * grammar and LiquidJS, which nothing else in the admin needs.
 */
import { autocompletion } from "@codemirror/autocomplete";
import { html } from "@codemirror/lang-html";
import { liquid } from "@codemirror/lang-liquid";
import { linter, type Diagnostic } from "@codemirror/lint";
import CodeMirror, { EditorState, EditorView } from "@uiw/react-codemirror";
import { useEffect, useMemo, useRef, type MutableRefObject } from "react";

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
  /**
   * Whether the text is Liquid. False for a template kept on the previous
   * engine, which sends `{{ name | upcase }}` as written: no completion and no
   * problems, which would describe an engine the email doesn't use.
   */
  liquid?: boolean;
  /**
   * The form control's attributes, which `FormControl` hands its child: they
   * belong on the text area a keyboard and a screen reader reach, so an
   * invalid field names its message there.
   */
  id?: string;
  "aria-describedby"?: string;
  "aria-invalid"?: boolean | "true" | "false";
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

/** Completion and live problems, for text that is Liquid. */
function liquidTooling(
  completionRef: MutableRefObject<CompletionData>,
  problemsRef: MutableRefObject<LiquidEditorProps["onProblems"]>
) {
  return [
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
  ];
}

/** The grammar: Liquid (inside HTML for the body), or plain HTML or text. */
function language(isLiquid: boolean, mode: LiquidEditorProps["mode"]) {
  if (isLiquid) return liquid(mode === "html" ? { base: html() } : {});
  return mode === "html" ? [html()] : [];
}

interface ContentAttributes {
  label: string;
  id?: string;
  describedBy?: string;
  invalid?: boolean | "true" | "false";
  disabled: boolean;
}

/** The text area's attributes: its name, the form's, and a tab stop. */
function contentAttributes(given: ContentAttributes) {
  const attributes: Record<string, string> = { "aria-label": given.label };
  if (given.id) attributes.id = given.id;
  if (given.describedBy) attributes["aria-describedby"] = given.describedBy;
  if (given.invalid !== undefined) {
    attributes["aria-invalid"] = String(given.invalid);
  }
  // Stated, though an editable element takes focus anyway: assistive checks
  // that ask whether a scrolling region holds anything focusable count a tab
  // stop, not `contenteditable`.
  if (!given.disabled) attributes.tabindex = "0";
  return attributes;
}

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
  liquid: isLiquid = true,
  id,
  "aria-describedby": describedBy,
  "aria-invalid": invalid,
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

  // Without the linter nothing reports, so a list beside the editor is
  // emptied rather than left describing Liquid the email doesn't use.
  useEffect(() => {
    if (!isLiquid) problemsRef.current?.([]);
  }, [isLiquid]);

  const extensions = useMemo(
    () => [
      language(isLiquid, mode),
      ...(isLiquid ? liquidTooling(completionRef, problemsRef) : []),
      EditorView.contentAttributes.of(
        contentAttributes({ label, id, describedBy, invalid, disabled })
      ),
      nextlyHighlighting,
      nextlyEditorChrome({
        fontSize: singleLine ? 14 : 13,
        dark: resolvedTheme === "dark",
      }),
      ...(singleLine ? [oneLine, inputLike] : [EditorView.lineWrapping]),
    ],
    [
      isLiquid,
      mode,
      label,
      id,
      describedBy,
      invalid,
      disabled,
      singleLine,
      resolvedTheme,
    ]
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
