/**
 * The rich-text editor's node set and theme, in one place.
 *
 * Lifted out of `RichTextInput` so the field editor and the page builder read
 * the SAME list. Two lists agree on the day they are written; the day one gains
 * a node is the day a document written in the builder renders as an unknown
 * block in the field editor, or the reverse — and neither side raises anything,
 * because an unregistered node is a rendering outcome rather than an error.
 *
 * ## Why this module is only ever reached by dynamic import
 *
 * Importing it statically pulls Lexical — and PrismJS behind it — into whatever
 * bundle does so. Measured on this package: the editor lands in a 630KB lazy
 * chunk against a 777KB main bundle, and `FieldRenderer` loads it with
 * `lazy(() => import(...))` for exactly that reason, plus SSR. A static
 * re-export from the package index would make that eager for every consumer,
 * including those who never open a rich-text field.
 *
 * @module components/features/entries/fields/special/rich-text-kit
 */
import { CodeNode, CodeHighlightNode } from "@lexical/code-core";
import { LinkNode, AutoLinkNode } from "@lexical/link";
import { ListNode, ListItemNode } from "@lexical/list";
import { HorizontalRuleNode } from "@lexical/react/LexicalHorizontalRuleNode";
import { HeadingNode, QuoteNode } from "@lexical/rich-text";
import { TableCellNode, TableNode, TableRowNode } from "@lexical/table";
import type { Klass, LexicalNode } from "lexical";

import { ButtonGroupNode } from "./ButtonGroupNode";
import { ButtonLinkNode } from "./ButtonLinkNode";
import {
  CollapsibleContainerNode,
  CollapsibleContentNode,
  CollapsibleTitleNode,
} from "./CollapsibleNode";
import { GalleryNode } from "./GalleryNode";
import { ImageNode } from "./ImageNode";
import { VideoNode } from "./VideoNode";

const editorTheme = {
  // Root element
  root: "focus:outline-none",

  // Text formatting
  text: {
    bold: "font-bold",
    italic: "italic",
    underline: "underline",
    strikethrough: "line-through",
    code: "bg-primary/5 px-1.5 py-0.5 rounded-md font-mono text-sm",
    // Its own token rather than a status one: a marker drawn over text is not
    // a warning, and it carries its own foreground so the text stays readable
    // when the page's own flips to white.
    highlight: "bg-highlight text-highlight-foreground",
    subscript: "align-sub text-xs",
    superscript: "align-super text-xs",
  },

  // Headings
  heading: {
    h1: "text-3xl font-bold mt-6 mb-4 first:mt-0",
    h2: "text-2xl font-bold mt-5 mb-3 first:mt-0",
    h3: "text-xl font-bold mt-4 mb-2 first:mt-0",
    h4: "text-lg font-semibold mt-4 mb-2 first:mt-0",
    h5: "text-base font-semibold mt-3 mb-1 first:mt-0",
    h6: "text-sm font-semibold mt-3 mb-1 first:mt-0",
  },

  // Paragraphs
  paragraph: "mb-2 last:mb-0",

  // Lists
  list: {
    ul: "list-disc ml-6 mb-2",
    ol: "list-decimal ml-6 mb-2",
    listitem: "mb-1",
    listitemChecked:
      "line-through text-muted-foreground list-none relative pl-6 before:content-['✓'] before:absolute before:left-0 before:text-success-500",
    listitemUnchecked:
      "list-none relative pl-6 before:content-['○'] before:absolute before:left-0",
    nested: {
      listitem: "list-none",
    },
  },

  // Blockquote
  quote: "border-l-4 border-border pl-4 italic text-muted-foreground mb-2",

  // Links
  link: "text-primary underline hover-unified cursor-pointer",

  // Code blocks. The tokenizer names what each token is; these classes decide
  // how it looks, so the palette lives in the design tokens and both modes are
  // settled by CSS rather than stored with the content.
  code: "block bg-code-bg text-code-fg p-4 rounded-md font-mono text-sm mb-2 overflow-x-auto",
  codeHighlight: {
    atrule: "text-code-keyword",
    attr: "text-code-function",
    boolean: "text-code-number",
    builtin: "text-code-function",
    cdata: "text-code-comment",
    char: "text-code-string",
    class: "text-code-variable",
    "class-name": "text-code-variable",
    comment: "text-code-comment italic",
    constant: "text-code-number",
    deleted: "text-code-deleted",
    doctype: "text-code-comment",
    entity: "text-code-tag",
    function: "text-code-function",
    important: "text-code-tag font-bold",
    inserted: "text-code-inserted",
    keyword: "text-code-keyword",
    namespace: "text-code-comment",
    number: "text-code-number",
    operator: "text-code-operator",
    prolog: "text-code-comment",
    property: "text-code-function",
    punctuation: "text-code-punctuation",
    regex: "text-code-string",
    selector: "text-code-tag",
    string: "text-code-string",
    symbol: "text-code-number",
    tag: "text-code-tag",
    url: "text-code-function underline",
    variable: "text-code-variable",
  },

  // Tables
  table: "border-collapse w-full my-4",
  tableCell: "border border-border px-3 py-2 text-left align-top min-w-[75px]",
  tableCellHeader:
    "border border-border px-3 py-2 text-left font-bold bg-primary/5 align-top",
  tableRow: "",
  tableRowStriping: "even:bg-primary/5",
};

/**
 * Every node class an editor must register to read this site's rich text.
 *
 * Order is Lexical's own concern, not ours — it fills in static methods as it
 * walks the list — so this stays in the order the field editor has always used
 * rather than being sorted for tidiness.
 */
export const RICH_TEXT_NODES: ReadonlyArray<Klass<LexicalNode>> = [
  HeadingNode,
  QuoteNode,
  ListNode,
  ListItemNode,
  LinkNode,
  AutoLinkNode,
  CodeNode,
  CodeHighlightNode,
  HorizontalRuleNode,
  TableNode,
  TableCellNode,
  TableRowNode,
  ImageNode,
  VideoNode,
  ButtonLinkNode,
  ButtonGroupNode,
  GalleryNode,
  CollapsibleContainerNode,
  CollapsibleTitleNode,
  CollapsibleContentNode,
];

/** The class names an editor's output is styled with. */
export const RICH_TEXT_THEME = editorTheme;

/** What a host needs to build an editor that reads this site's rich text. */
export interface RichTextEditorKit {
  readonly nodes: ReadonlyArray<Klass<LexicalNode>>;
  readonly theme: typeof RICH_TEXT_THEME;
}

/** The kit, as one value. */
export function richTextEditorKit(): RichTextEditorKit {
  return { nodes: RICH_TEXT_NODES, theme: RICH_TEXT_THEME };
}
