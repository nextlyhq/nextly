"use client";

/**
 * Tokenizes code blocks in the editor.
 *
 * `CodeHighlightNode` was registered on the editor, but nothing produced those
 * nodes without this — code blocks rendered as one undifferentiated run of
 * text, and the `codeHighlight` theme map never matched anything.
 *
 * Prism rather than Shiki, despite Shiki being the better highlighter in the
 * abstract: its tokenizer writes each token's colour inline and stores the
 * theme name on the code node, so the author's theme is saved into the content
 * and travels to every reader and to the published site. Prism emits a
 * semantic token type instead, which the editor theme maps to a class — so the
 * palette stays in the design tokens and light and dark are settled by CSS.
 *
 * @module components/entries/fields/special/CodeHighlightPlugin
 */

import { registerCodeHighlighting } from "@lexical/code-prism";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { useEffect } from "react";

export function CodeHighlightPlugin(): null {
  const [editor] = useLexicalComposerContext();

  useEffect(() => registerCodeHighlighting(editor), [editor]);

  return null;
}
