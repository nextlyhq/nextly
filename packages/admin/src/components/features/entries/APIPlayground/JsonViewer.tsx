/**
 * JSON Viewer Component
 *
 * Read-only CodeMirror-based JSON syntax highlighter for displaying
 * API response data with proper formatting, folding, and theme support.
 *
 * @module components/entries/APIPlayground/JsonViewer
 * @since 1.0.0
 */

import { json } from "@codemirror/lang-json";
import { EditorView } from "@codemirror/view";
import CodeMirror from "@uiw/react-codemirror";
import { useTheme } from "next-themes";
import { useMemo, useState, useEffect } from "react";

// ============================================================================
// Types
// ============================================================================

export interface JsonViewerProps {
  /** JSON string to display */
  value: string;
}

// ============================================================================
// Component
// ============================================================================

/**
 * JsonViewer - Read-only JSON syntax highlighter
 *
 * Uses CodeMirror 6 with the JSON language extension to provide:
 * - Syntax highlighting with theme-aware colors
 * - Code folding for nested objects/arrays
 * - Line numbers for easy reference
 * - Read-only mode (no editing)
 *
 * @example
 * ```tsx
 * <JsonViewer value={JSON.stringify(data, null, 2)} />
 * ```
 */
export function JsonViewer({ value }: JsonViewerProps) {
  const { theme } = useTheme();

  // SSR guard - only render CodeMirror on the client
  const [isMounted, setIsMounted] = useState(false);

  useEffect(() => {
    setIsMounted(true);
  }, []);

  const extensions = useMemo(() => [json()], []);

  const editorTheme = useMemo(
    () =>
      EditorView.theme({
        "&": {
          fontSize: "12px",
          fontFamily:
            "'Fira Code', 'Cascadia Code', 'JetBrains Mono', monospace",
          backgroundColor: "transparent !important",
        },
        ".cm-scroller": {
          fontFamily:
            "'Fira Code', 'Cascadia Code', 'JetBrains Mono', monospace",
          padding: "16px 0",
        },
        ".cm-gutters": {
          borderRight: "1px solid hsl(var(--border) / 0.5)",
          backgroundColor: "hsl(var(--muted) / 0.3)",
          color: "hsl(var(--muted-foreground) / 0.5)",
          padding: "0 4px",
        },
        ".cm-activeLine, .cm-activeLineGutter": {
          backgroundColor: "transparent",
        },
        ".cm-cursor": {
          display: "none",
        },
      }),
    []
  );

  if (!isMounted) {
    return (
      <pre className="p-4 text-sm font-mono whitespace-pre overflow-x-auto text-foreground">
        {value}
      </pre>
    );
  }

  return (
    <CodeMirror
      value={value}
      extensions={[...extensions, editorTheme]}
      theme={theme === "dark" ? "dark" : "light"}
      editable={false}
      readOnly={true}
      basicSetup={{
        lineNumbers: true,
        foldGutter: true,
        highlightActiveLine: false,
        highlightActiveLineGutter: false,
        highlightSelectionMatches: true,
        autocompletion: false,
        closeBrackets: false,
        bracketMatching: true,
        tabSize: 2,
        searchKeymap: true,
        allowMultipleSelections: false,
        rectangularSelection: false,
        crosshairCursor: false,
        drawSelection: false,
      }}
      className="overflow-hidden rounded-none border-none"
    />
  );
}
