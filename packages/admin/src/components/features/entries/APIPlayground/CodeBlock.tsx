"use client";

/**
 * Read-only code, highlighted.
 *
 * One viewer for both panes: the response body and the generated snippets sit
 * next to each other, and code that is coloured on one side and grey on the
 * other reads as two different tools. Extends to shell, which the field
 * editor's language list does not carry — curl is the only place we need it.
 *
 * Read-only rather than an editor: no cursor, no active line, no editing
 * affordances on something you cannot edit.
 *
 * @module components/entries/APIPlayground/CodeBlock
 */

import { javascript } from "@codemirror/lang-javascript";
import { json } from "@codemirror/lang-json";
import { StreamLanguage } from "@codemirror/language";
import { shell } from "@codemirror/legacy-modes/mode/shell";
import { EditorView } from "@codemirror/view";
import CodeMirror from "@uiw/react-codemirror";
import { useEffect, useMemo, useState } from "react";

import { useTheme } from "@admin/context/providers/ThemeProvider";
import {
  nextlyEditorChrome,
  nextlyHighlighting,
} from "@admin/lib/code-highlight";

export type CodeBlockLanguage = "json" | "typescript" | "javascript" | "shell";

export interface CodeBlockProps {
  value: string;
  language: CodeBlockLanguage;
  /** Line numbers and folding: worth it for a long response, noise on a snippet. */
  showGutter?: boolean;
}

function languageExtension(language: CodeBlockLanguage) {
  switch (language) {
    case "json":
      return json();
    case "typescript":
      return javascript({ typescript: true });
    case "javascript":
      return javascript();
    case "shell":
      // Shell has no first-party CodeMirror 6 package; the legacy mode is the
      // supported route, and it is the only one we pull in.
      return StreamLanguage.define(shell);
  }
}

export function CodeBlock({
  value,
  language,
  showGutter = false,
}: CodeBlockProps) {
  // Not a colour: every colour here is a token. This is the boolean the
  // CodeMirror packages read to choose between their OWN light and dark rules,
  // which nothing sets under `theme="none"`.
  const { resolvedTheme } = useTheme();

  // CodeMirror reaches for browser globals, so it renders after mount.
  const [isMounted, setIsMounted] = useState(false);
  useEffect(() => {
    setIsMounted(true);
  }, []);

  const extensions = useMemo(
    () => [
      languageExtension(language),
      EditorView.lineWrapping,
      nextlyHighlighting,
      nextlyEditorChrome({
        showGutter,
        dark: resolvedTheme === "dark",
        padding: showGutter ? "16px 12px" : "16px 24px",
      }),
      // Nothing here is editable, so the affordances that say otherwise are
      // switched off rather than merely unused.
      EditorView.theme({
        ".cm-activeLine, .cm-activeLineGutter": {
          backgroundColor: "transparent",
        },
        ".cm-cursor": { display: "none" },
      }),
    ],
    [language, showGutter, resolvedTheme]
  );

  if (!isMounted) {
    return (
      <pre className="overflow-x-auto whitespace-pre p-4 font-mono text-xs text-foreground">
        {value}
      </pre>
    );
  }

  return (
    <CodeMirror
      value={value}
      extensions={extensions}
      // "none" rather than a resolved light/dark: the COLOURS come from
      // `--nx-code-*`, which the theme redeclares under `.dark`, so CSS settles
      // the mode and a bundled palette here would only fight it. The mode is
      // still passed to the chrome, but as a flag the CodeMirror packages read
      // to pick their own light/dark rules -- not as a colour decision.
      theme="none"
      editable={false}
      readOnly
      basicSetup={{
        lineNumbers: showGutter,
        foldGutter: showGutter,
        highlightActiveLine: false,
        highlightActiveLineGutter: false,
        highlightSelectionMatches: showGutter,
        autocompletion: false,
        closeBrackets: false,
        bracketMatching: showGutter,
        tabSize: 2,
        searchKeymap: showGutter,
        allowMultipleSelections: false,
        rectangularSelection: false,
        crosshairCursor: false,
        drawSelection: false,
      }}
      // Square corners: the editor fills its bordered card edge to edge, so
      // the card is the only surface that may carry a radius.
      className="overflow-hidden rounded-none border-none"
    />
  );
}
