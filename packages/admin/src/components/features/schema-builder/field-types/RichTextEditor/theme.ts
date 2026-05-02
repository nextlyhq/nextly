/**
 * Lexical Editor Theme Configuration
 *
 * Maps Lexical editor nodes to TailwindCSS classes for styling.
 * Supports both light and dark modes via next-themes.
 *
 * @see https://lexical.dev/docs/getting-started/theming
 */

import type { EditorThemeClasses } from "lexical";

/**
 * Lexical theme with TailwindCSS classes
 *
 * Used by LexicalComposer to style editor content.
 * All classes support dark mode automatically via Tailwind's dark: variant.
 */
export const lexicalTheme: EditorThemeClasses = {
  // Block-level elements
  paragraph: "mb-2 text-sm",

  // Headings
  heading: {
    h1: "text-3xl font-bold mb-4 mt-6 text-gray-900 dark:text-gray-100",
    h2: "text-2xl font-bold mb-3 mt-5 text-gray-900 dark:text-gray-100",
    h3: "text-xl font-bold mb-3 mt-4 text-gray-900 dark:text-gray-100",
    h4: "text-lg font-semibold mb-2 mt-3 text-gray-900 dark:text-gray-100",
    h5: "text-base font-semibold mb-2 mt-3 text-gray-900 dark:text-gray-100",
    h6: "text-sm font-semibold mb-2 mt-2 text-gray-700 dark:text-gray-300",
  },

  // Lists
  list: {
    // Nested lists are automatically indented via ml-* classes
    nested: {
      listitem: "ml-6",
    },
    ol: "list-decimal ml-6 mb-2",
    ul: "list-disc ml-6 mb-2",
    listitem: "mb-1",
    listitemChecked: "line-through opacity-60",
    listitemUnchecked: "",
  },

  // Images (custom ImageNode styling)
  image: "max-w-full h-auto rounded-none my-4",

  // Links
  link: "text-primary underline hover-unified cursor-pointer",

  // Text formatting
  text: {
    bold: "font-bold",
    code: "bg-gray-100 dark:bg-gray-800 px-1.5 py-0.5 rounded-none text-sm font-mono text-red-600 dark:text-red-400",
    italic: "italic",
    strikethrough: "line-through",
    subscript: "text-xs align-sub",
    superscript: "text-xs align-super",
    underline: "underline",
    underlineStrikethrough: "underline line-through",
  },

  // Code blocks
  code: "bg-gray-900 dark:bg-gray-950 text-gray-100 p-4 rounded-none font-mono text-sm overflow-x-auto my-4 block",
  codeHighlight: {
    atrule: "text-purple-400",
    attr: "text-primary",
    boolean: "text-orange-400",
    builtin: "text-cyan-400",
    cdata: "text-gray-500",
    char: "text-green-400",
    class: "text-yellow-400",
    "class-name": "text-yellow-400",
    comment: "text-gray-500 italic",
    constant: "text-orange-400",
    deleted: "text-red-400",
    doctype: "text-gray-500",
    entity: "text-orange-400",
    function: "text-primary",
    important: "text-red-400 font-bold",
    inserted: "text-green-400",
    keyword: "text-purple-400",
    namespace: "text-primary",
    number: "text-orange-400",
    operator: "text-gray-300",
    prolog: "text-gray-500",
    property: "text-primary",
    punctuation: "text-gray-400",
    regex: "text-green-400",
    selector: "text-green-400",
    string: "text-green-400",
    symbol: "text-orange-400",
    tag: "text-red-400",
    url: "text-primary underline",
    variable: "text-orange-400",
  },

  // Blockquotes
  quote:
    "border-l-4 border-gray-300 dark:border-gray-600 pl-4 italic text-gray-700 dark:text-gray-300 my-4",

  // Tables (if we add table support later)
  table: "border-collapse w-full my-4",
  tableCell: "border border-gray-300 dark:border-gray-600 px-3 py-2",
  tableCellHeader:
    "border border-gray-300 dark:border-gray-600 px-3 py-2 font-bold bg-gray-50 dark:bg-gray-800",

  // Layout/spacing
  indent: "ml-6",

  // RTL support
  ltr: "text-left",
  rtl: "text-right",
};
