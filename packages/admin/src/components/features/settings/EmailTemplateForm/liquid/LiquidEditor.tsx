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
import { LanguageSupport, StreamLanguage } from "@codemirror/language";
import { linter, type Diagnostic } from "@codemirror/lint";
import CodeMirror, {
  EditorState,
  EditorView,
  ExternalChange,
  type Transaction,
} from "@uiw/react-codemirror";
import {
  useEffect,
  useMemo,
  useRef,
  type JSX,
  type MutableRefObject,
} from "react";

import { xmlLinter } from "@admin/components/features/entries/fields/text/CodeMirrorEditor";
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

/**
 * A single line: a change that adds a line is refused. One that keeps the
 * count is let through, so a value saved with a break before this editor (the
 * API and the schemas accept one) can still be edited, and repaired.
 */
const oneLine = EditorState.transactionFilter.of(transaction =>
  isFromOutside(transaction) ||
  transaction.newDoc.lines <= Math.max(1, transaction.startState.doc.lines)
    ? transaction
    : []
);

/**
 * Whether the form set the value (a duplicate loading its source, Discard
 * restoring the saved one). That value is the field's already, whatever its
 * lines, and is shown as it is: refusing it would show one thing while a save
 * stores another.
 */
function isFromOutside(transaction: Transaction): boolean {
  return transaction.annotation(ExternalChange) === true;
}

/**
 * Text with no markup in it: a subject, a From line, a plain-text body.
 * Liquid's own default is HTML, whose tag closing would answer the `>` of
 * `Shop <shop@example.com>` with a closing tag.
 */
const plainText = new LanguageSupport(
  StreamLanguage.define({
    name: "text",
    token: stream => {
      stream.skipToEnd();
      return null;
    },
  })
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

/**
 * Completion and live problems, for text that is Liquid. In the HTML body the
 * marks also include the admin's HTML tag check, which the body had before it
 * read Liquid; the problem list stays Liquid's, the ones a save refuses.
 */
function liquidTooling(
  completionRef: MutableRefObject<CompletionData>,
  problemsRef: MutableRefObject<LiquidEditorProps["onProblems"]>,
  mode: LiquidEditorProps["mode"]
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
        const liquidMarks = problems.map(
          (problem): Diagnostic => ({
            from: problem.from,
            to: problem.to,
            severity: "error",
            message: problem.message,
          })
        );
        return mode === "html"
          ? [...liquidMarks, ...xmlLinter(view)]
          : liquidMarks;
      },
      { delay: 300 }
    ),
  ];
}

/** The grammar: Liquid (inside HTML for the body), or plain HTML or text. */
function language(isLiquid: boolean, mode: LiquidEditorProps["mode"]) {
  if (isLiquid) return liquid({ base: mode === "html" ? html() : plainText });
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

/** What `basicSetup` turns on: an input-like line wants none of the code chrome. */
function setupFor(singleLine: boolean, readOnly: boolean) {
  const code = !singleLine;
  return {
    lineNumbers: code,
    foldGutter: code,
    highlightActiveLine: code && !readOnly,
    highlightActiveLineGutter: code && !readOnly,
    // Ours, from `liquidTooling`, with the template's variables.
    autocompletion: false,
    closeBrackets: true,
    bracketMatching: true,
    tabSize: 2,
    indentOnInput: code,
    searchKeymap: code,
    completionKeymap: true,
    lintKeymap: true,
  };
}

/**
 * The editor's extensions, built once per field and its settings. Completion
 * data and the problems callback are read through refs, so the extensions
 * aren't rebuilt (which would reconfigure the editor under the author's
 * caret) each time the test data or the declarations change.
 */
function useLiquidExtensions(
  props: LiquidEditorProps,
  isLiquid: boolean,
  singleLine: boolean,
  disabled: boolean
) {
  const { resolvedTheme } = useTheme();
  const { mode, label, id, completion, onProblems } = props;
  const describedBy = props["aria-describedby"];
  const invalid = props["aria-invalid"];

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

  return useMemo(
    () => [
      language(isLiquid, mode),
      ...(isLiquid ? liquidTooling(completionRef, problemsRef, mode) : []),
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
}

export function LiquidEditor(props: LiquidEditorProps): JSX.Element {
  const singleLine = props.singleLine ?? false;
  const disabled = props.disabled ?? false;
  const extensions = useLiquidExtensions(
    props,
    props.liquid ?? true,
    singleLine,
    disabled
  );

  return (
    <CodeMirror
      value={props.value}
      onChange={props.onChange}
      extensions={extensions}
      // A single line grows past one only for a value saved with a break,
      // which then shows whole until it's repaired.
      minHeight={singleLine ? "36px" : `${props.minHeight ?? 380}px`}
      // Colours come from `--nx-code-*`, which the theme redeclares in dark
      // mode, as for every other code field in the admin.
      theme="none"
      // Read-only still takes focus: an owner's body is read, selected and
      // scrolled from the keyboard. `readOnly` refuses the edits, and marks
      // the field aria-readonly. Only a pending save takes the focus away.
      editable={!disabled}
      readOnly={disabled || props.readOnly}
      basicSetup={setupFor(singleLine, props.readOnly)}
      placeholder={props.placeholder}
      onCreateEditor={props.onCreateEditor}
      className="overflow-hidden rounded-md border border-input"
    />
  );
}
