"use client";

/**
 * CodeMirror Editor Component
 *
 * This component is loaded dynamically to avoid SSR issues with PrismJS
 * which references browser globals (window, document) during initialization.
 *
 * @module components/entries/fields/text/CodeMirrorEditor
 * @since 1.0.0
 */

import { linter, type Diagnostic } from "@codemirror/lint";
import { EditorView } from "@codemirror/view";
import CodeMirror, { type ReactCodeMirrorProps } from "@uiw/react-codemirror";
import type { CodeLanguage } from "nextly/config";
import { useMemo } from "react";

import { useTheme } from "@admin/context/providers/ThemeProvider";
import {
  nextlyEditorChrome,
  nextlyHighlighting,
} from "@admin/lib/code-highlight";
import { codeLanguageSupport } from "@admin/lib/code-language";

/** Extension type extracted from ReactCodeMirror props (avoids direct @codemirror/state dependency) */
type Extension = NonNullable<ReactCodeMirrorProps["extensions"]>[number];

// ============================================================
// Types
// ============================================================

export interface CodeMirrorEditorProps {
  value: string;
  onChange: (value: string) => void;
  language: CodeLanguage | "plaintext";
  disabled: boolean;
  readOnly: boolean;
  minHeight: number;
  maxHeight?: number;
  editorOptions: {
    fontSize?: number;
    fontFamily?: string;
    lineNumbers?: boolean;
    folding?: boolean;
    autoCloseBrackets?: boolean;
    matchBrackets?: boolean;
    tabSize?: number;
  };
  placeholder?: string;
  /**
   * Receives the editor view once mounted, for callers that must act on the
   * document directly — inserting at the caret, for one, which has no
   * equivalent in the value/onChange pair.
   */
  onCreateEditor?: (view: EditorView) => void;
}

// ============================================================
// Linters
// ============================================================

/**
 * JSON linter - validates JSON syntax in real-time
 */
function jsonLinter(view: EditorView): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  const content = view.state.doc.toString();

  if (!content.trim()) return diagnostics;

  try {
    JSON.parse(content);
  } catch (error) {
    if (error instanceof SyntaxError) {
      const match = error.message.match(/position (\d+)/);
      const position = match ? parseInt(match[1]) : 0;

      diagnostics.push({
        from: Math.max(0, position - 1),
        to: Math.min(view.state.doc.length, position + 1),
        severity: "error",
        message: error.message,
      });
    }
  }

  return diagnostics;
}

/**
 * XML/HTML linter - validates tag matching
 */
function xmlLinter(view: EditorView): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  const content = view.state.doc.toString();

  if (!content.trim()) return diagnostics;

  const tagStack: { name: string; pos: number }[] = [];
  const selfClosingTags = new Set([
    "br",
    "hr",
    "img",
    "input",
    "meta",
    "link",
    "area",
    "base",
    "col",
    "embed",
    "param",
    "source",
    "track",
    "wbr",
  ]);

  const tagRegex = /<\/?([a-zA-Z][a-zA-Z0-9]*)[^>]*\/?>/g;
  let match;

  while ((match = tagRegex.exec(content)) !== null) {
    const fullTag = match[0];
    const tagName = match[1].toLowerCase();
    const pos = match.index;

    if (fullTag.endsWith("/>") || selfClosingTags.has(tagName)) {
      continue;
    }

    if (fullTag.startsWith("</")) {
      if (tagStack.length === 0) {
        diagnostics.push({
          from: pos,
          to: pos + fullTag.length,
          severity: "error",
          message: `Unexpected closing tag: </${tagName}>`,
        });
      } else {
        const lastTag = tagStack.pop()!;
        if (lastTag.name !== tagName) {
          diagnostics.push({
            from: pos,
            to: pos + fullTag.length,
            severity: "error",
            message: `Mismatched tags: expected </${lastTag.name}>, found </${tagName}>`,
          });
        }
      }
    } else {
      tagStack.push({ name: tagName, pos });
    }
  }

  for (const tag of tagStack) {
    diagnostics.push({
      from: tag.pos,
      to: tag.pos + tag.name.length + 2,
      severity: "error",
      message: `Unclosed tag: <${tag.name}>`,
    });
  }

  return diagnostics;
}

/**
 * CSS linter - validates basic CSS syntax
 */
function cssLinter(view: EditorView): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  const content = view.state.doc.toString();

  if (!content.trim()) return diagnostics;

  let braceCount = 0;
  let pos = 0;

  for (const char of content) {
    if (char === "{") braceCount++;
    if (char === "}") {
      braceCount--;
      if (braceCount < 0) {
        diagnostics.push({
          from: pos,
          to: pos + 1,
          severity: "error",
          message: "Unexpected closing brace }",
        });
        braceCount = 0;
      }
    }
    pos++;
  }

  if (braceCount > 0) {
    diagnostics.push({
      from: content.length - 1,
      to: content.length,
      severity: "error",
      message: `${braceCount} unclosed brace(s)`,
    });
  }

  return diagnostics;
}

// ============================================================
// Helpers
// ============================================================

/**
 * Which linter runs for a language, where one exists.
 *
 * Separate from the grammar table, which `@admin/lib/code-language` owns and a
 * version comparison reads too. A comparison wants the parser and has no use
 * for diagnostics, so only this half stays with the editor.
 */
const LINTERS: Record<
  string,
  ((view: EditorView) => Diagnostic[]) | undefined
> = {
  json: jsonLinter,
  html: xmlLinter,
  xml: xmlLinter,
  css: cssLinter,
  scss: cssLinter,
  less: cssLinter,
};

/**
 * The grammar and the diagnostics for a language.
 *
 * The grammar is asked for rather than chosen here: the same question is
 * answered for a version comparison, and two tables would agree today and
 * drift apart later with nothing to notice it.
 */
function getLanguageExtensions(language?: CodeLanguage | "plaintext") {
  const extensions: Extension[] = [];
  if (language === undefined) return extensions;

  const support = codeLanguageSupport(language);
  if (support) extensions.push(support);

  const lint = LINTERS[language];
  if (lint) extensions.push(linter(lint));

  return extensions;
}

// ============================================================
// Component
// ============================================================

export function CodeMirrorEditor({
  value,
  onChange,
  language,
  disabled,
  readOnly,
  minHeight,
  maxHeight,
  editorOptions,
  placeholder,
  onCreateEditor,
}: CodeMirrorEditorProps) {
  // Not a colour: see `EditorChromeOptions.dark`.
  const { resolvedTheme } = useTheme();

  const extensions = useMemo(
    () => [
      ...getLanguageExtensions(language),
      nextlyHighlighting,
      nextlyEditorChrome({
        fontSize: editorOptions.fontSize ?? 14,
        dark: resolvedTheme === "dark",
      }),
      // A caller may still pin a face — a code field whose content is meant to
      // be read in a particular one. Absent that, the shared chrome's
      // `--font-mono` stands, so the editor matches every other mono surface.
      ...(editorOptions.fontFamily
        ? [
            EditorView.theme({
              "&": { fontFamily: editorOptions.fontFamily },
              ".cm-scroller": { fontFamily: editorOptions.fontFamily },
            }),
          ]
        : []),
    ],
    [language, editorOptions.fontSize, editorOptions.fontFamily, resolvedTheme]
  );

  return (
    <CodeMirror
      value={value}
      onChange={onChange}
      extensions={extensions}
      height={maxHeight ? undefined : `${minHeight}px`}
      minHeight={`${minHeight}px`}
      maxHeight={maxHeight ? `${maxHeight}px` : undefined}
      // "none" rather than a resolved light/dark: the COLOURS come from
      // `--nx-code-*`, which the theme redeclares under `.dark`, so CSS settles
      // the mode and a bundled palette here would only fight it. The mode is
      // still passed to the chrome, but as a flag the CodeMirror packages read
      // to pick their own light/dark rules -- not as a colour decision.
      theme="none"
      editable={!disabled && !readOnly}
      readOnly={disabled || readOnly}
      basicSetup={{
        lineNumbers: editorOptions.lineNumbers ?? true,
        foldGutter: editorOptions.folding ?? true,
        highlightActiveLine: !readOnly && !disabled,
        highlightActiveLineGutter: !readOnly && !disabled,
        highlightSelectionMatches: true,
        autocompletion: !readOnly && !disabled,
        closeBrackets: editorOptions.autoCloseBrackets ?? true,
        bracketMatching: editorOptions.matchBrackets ?? true,
        tabSize: editorOptions.tabSize ?? 2,
        indentOnInput: true,
        closeBracketsKeymap: true,
        searchKeymap: true,
        completionKeymap: true,
        lintKeymap: true,
        allowMultipleSelections: true,
        rectangularSelection: true,
        crosshairCursor: true,
        drawSelection: true,
      }}
      placeholder={placeholder}
      onCreateEditor={onCreateEditor}
      className="overflow-hidden rounded-md"
    />
  );
}
