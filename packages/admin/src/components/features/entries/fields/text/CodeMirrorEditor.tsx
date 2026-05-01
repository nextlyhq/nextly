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

import { css } from "@codemirror/lang-css";
import { html } from "@codemirror/lang-html";
import { javascript } from "@codemirror/lang-javascript";
import { json } from "@codemirror/lang-json";
import { markdown } from "@codemirror/lang-markdown";
import { python } from "@codemirror/lang-python";
import { sql } from "@codemirror/lang-sql";
import { xml } from "@codemirror/lang-xml";
import { yaml } from "@codemirror/lang-yaml";
import { linter, type Diagnostic } from "@codemirror/lint";
import { EditorView } from "@codemirror/view";
import type { CodeLanguage } from "@revnixhq/nextly/config";
import CodeMirror, { type ReactCodeMirrorProps } from "@uiw/react-codemirror";
import { useMemo } from "react";

/** Extension type extracted from ReactCodeMirror props (avoids direct @codemirror/state dependency) */
type Extension = NonNullable<ReactCodeMirrorProps["extensions"]>[number];

// ============================================================
// Types
// ============================================================

export interface CodeMirrorEditorProps {
  value: string;
  onChange: (value: string) => void;
  language: CodeLanguage | "plaintext";
  theme: "dark" | "light";
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
 * Gets the appropriate CodeMirror language extension and linter
 */
function getLanguageExtensions(language?: CodeLanguage | "plaintext") {
  const extensions: Extension[] = [];

  switch (language) {
    case "javascript":
    case "jsx":
      extensions.push(javascript({ jsx: true }));
      break;
    case "typescript":
    case "tsx":
      extensions.push(
        javascript({ typescript: true, jsx: language === "tsx" })
      );
      break;
    case "json":
      extensions.push(json());
      extensions.push(linter(jsonLinter));
      break;
    case "html":
      extensions.push(html());
      extensions.push(linter(xmlLinter));
      break;
    case "css":
    case "scss":
    case "less":
      extensions.push(css());
      extensions.push(linter(cssLinter));
      break;
    case "python":
      extensions.push(python());
      break;
    case "sql":
      extensions.push(sql());
      break;
    case "yaml":
      extensions.push(yaml());
      break;
    case "markdown":
      extensions.push(markdown());
      break;
    case "xml":
      extensions.push(xml());
      extensions.push(linter(xmlLinter));
      break;
    default:
      break;
  }

  return extensions;
}

// ============================================================
// Component
// ============================================================

export function CodeMirrorEditor({
  value,
  onChange,
  language,
  theme,
  disabled,
  readOnly,
  minHeight,
  maxHeight,
  editorOptions,
  placeholder,
}: CodeMirrorEditorProps) {
  // Get language extensions with linters
  const extensions = useMemo(() => getLanguageExtensions(language), [language]);

  // Editor theme configuration
  const editorTheme = useMemo(() => {
    return EditorView.theme({
      "&": {
        fontSize: `${editorOptions.fontSize ?? 14}px`,
        fontFamily:
          editorOptions.fontFamily ??
          "'Fira Code', 'Cascadia Code', 'JetBrains Mono', monospace",
      },
      ".cm-scroller": {
        fontFamily:
          editorOptions.fontFamily ??
          "'Fira Code', 'Cascadia Code', 'JetBrains Mono', monospace",
      },
      ".cm-gutters": {
        borderRight: "1px solid hsl(var(--border))",
        backgroundColor: "hsl(var(--muted))",
      },
      ".cm-activeLineGutter": {
        backgroundColor: "hsl(var(--accent))",
      },
      ".cm-activeLine": {
        backgroundColor: "hsl(var(--accent) / 0.1)",
      },
      ".cm-selectionMatch": {
        backgroundColor: "hsl(var(--primary) / 0.2)",
      },
      ".cm-searchMatch": {
        backgroundColor: "hsl(var(--warning) / 0.3)",
      },
      ".cm-searchMatch.cm-searchMatch-selected": {
        backgroundColor: "hsl(var(--warning) / 0.5)",
      },
    });
  }, [editorOptions.fontSize, editorOptions.fontFamily]);

  return (
    <CodeMirror
      value={value}
      onChange={onChange}
      extensions={[...extensions, editorTheme]}
      height={maxHeight ? undefined : `${minHeight}px`}
      minHeight={`${minHeight}px`}
      maxHeight={maxHeight ? `${maxHeight}px` : undefined}
      theme={theme}
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
      className="overflow-hidden rounded-md"
    />
  );
}
