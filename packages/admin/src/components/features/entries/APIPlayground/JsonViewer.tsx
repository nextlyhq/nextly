"use client";

/**
 * A response body, highlighted and foldable.
 *
 * The gutter earns its place here and nowhere else in this pane: a response
 * runs to hundreds of lines, so line numbers, folding and search are how you
 * read one. The generated snippets are a dozen lines and want none of it, so
 * they share the same viewer without a gutter rather than a second copy of it.
 *
 * @module components/entries/APIPlayground/JsonViewer
 */

import { CodeBlock } from "./CodeBlock";

export interface JsonViewerProps {
  /** JSON string to display */
  value: string;
}

export function JsonViewer({ value }: JsonViewerProps) {
  return <CodeBlock value={value} language="json" showGutter />;
}
