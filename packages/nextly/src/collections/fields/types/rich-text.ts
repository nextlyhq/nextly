/**
 * Rich Text Field Type
 *
 * A rich text editor field powered by Lexical.
 * Supports configurable features like formatting, links, lists,
 * headings, and embedded content.
 *
 * @module collections/fields/types/rich-text
 * @since 1.0.0
 */

import type {
  BaseFieldConfig,
  FieldAdminOptions,
  RequestContext,
} from "./base";

// ============================================================
// Rich Text Features
// ============================================================

/**
 * Available rich text editor features.
 *
 * Features can be selectively enabled/disabled to customize
 * the editing experience. By default, all basic formatting
 * features are enabled.
 *
 * **Formatting Features:**
 * - `bold` - Bold text
 * - `italic` - Italic text
 * - `underline` - Underlined text
 * - `strikethrough` - Strikethrough text
 * - `code` - Inline code
 * - `subscript` - Subscript text
 * - `superscript` - Superscript text
 *
 * **Block Features:**
 * - `blockquote` - Block quotes
 * - `h1` through `h6` - Heading levels
 *
 * **List Features:**
 * - `orderedList` - Numbered lists
 * - `unorderedList` - Bullet lists
 * - `checkList` - Checkbox lists
 * - `indent` - Indentation control
 *
 * **Link & Media Features:**
 * - `link` - Hyperlinks
 * - `upload` - Embedded uploads/media
 * - `relationship` - Embedded document references
 *
 * **Advanced Features:**
 * - `table` - Tables
 * - `horizontalRule` - Horizontal dividers
 * - `codeBlock` - Code blocks with syntax highlighting
 * - `align` - Text alignment (left, center, right, justify)
 *
 * **Text Styling Features:**
 * - `fontFamily` - Font family selector
 * - `fontSize` - Font size selector
 * - `fontColor` - Text color picker
 * - `bgColor` - Background color picker
 *
 * **Rich Media Features:**
 * - `video` - Embedded YouTube/Vimeo videos
 * - `buttonLink` - Styled button links
 * - `collapsible` - Collapsible/accordion sections
 * - `gallery` - Multi-image galleries
 */
export type RichTextFeature =
  // Formatting
  | "bold"
  | "italic"
  | "underline"
  | "strikethrough"
  | "code"
  | "subscript"
  | "superscript"
  // Text Styling
  | "fontFamily"
  | "fontSize"
  | "fontColor"
  | "bgColor"
  // Blocks
  | "blockquote"
  | "h1"
  | "h2"
  | "h3"
  | "h4"
  | "h5"
  | "h6"
  // Lists
  | "orderedList"
  | "unorderedList"
  | "checkList"
  | "indent"
  // Links & Media
  | "link"
  | "upload"
  | "relationship"
  // Advanced
  | "table"
  | "horizontalRule"
  | "codeBlock"
  | "align"
  // Rich Media
  | "video"
  | "buttonLink"
  | "collapsible"
  | "gallery";

// ============================================================
// Rich Text Field Value Type
// ============================================================

/**
 * Rich text field value structure.
 *
 * The value is stored as a JSON object representing the Lexical
 * editor state. This includes the root node with all child nodes.
 *
 * @example
 * ```json
 * {
 *   "root": {
 *     "type": "root",
 *     "children": [
 *       {
 *         "type": "paragraph",
 *         "children": [
 *           { "type": "text", "text": "Hello " },
 *           { "type": "text", "text": "world", "format": 1 }
 *         ]
 *       }
 *     ]
 *   }
 * }
 * ```
 */
export interface RichTextValue {
  /**
   * The root node of the Lexical editor state.
   */
  root: {
    type: "root";
    children: RichTextNode[];
    [key: string]: unknown;
  };
}

/**
 * A node in the rich text structure.
 *
 * Nodes can be paragraphs, headings, lists, text, or other
 * content types. Each node has a type and may have children.
 */
export interface RichTextNode {
  /**
   * The node type (e.g., 'paragraph', 'text', 'heading').
   */
  type: string;

  /**
   * Child nodes (for container nodes like paragraphs).
   */
  children?: RichTextNode[];

  /**
   * Text content (for text nodes).
   */
  text?: string;

  /**
   * Text formatting flags (bold, italic, etc.).
   */
  format?: number;

  /**
   * Additional node-specific properties.
   */
  [key: string]: unknown;
}

/**
 * Possible value types for a rich text field.
 */
export type RichTextFieldValue = RichTextValue | null | undefined;

// ============================================================
// Rich Text Field Admin Options
// ============================================================

/**
 * Admin panel options specific to rich text fields.
 *
 * Extends the base admin options with rich text-specific settings.
 */
export interface RichTextFieldAdminOptions extends FieldAdminOptions {
  /**
   * Hide the editor toolbar.
   *
   * When `true`, the toolbar is hidden and users can only
   * use keyboard shortcuts for formatting.
   *
   * @default false
   */
  hideToolbar?: boolean;
}

// ============================================================
// Rich Text Field Configuration
// ============================================================

/**
 * Configuration interface for rich text fields.
 *
 * Rich text fields provide a full-featured text editor powered by
 * Lexical. They support formatting, links, lists, headings, and
 * can be configured with custom features.
 *
 * **Note:** Only the Lexical editor is supported. The editor
 * property is not needed as Lexical is the default and only option.
 *
 * @example
 * ```typescript
 * // Basic rich text field with default features
 * const contentField: RichTextFieldConfig = {
 *   name: 'content',
 *   type: 'richText',
 *   label: 'Content',
 *   required: true,
 * };
 *
 * // Rich text with limited features
 * const simpleContentField: RichTextFieldConfig = {
 *   name: 'simpleContent',
 *   type: 'richText',
 *   label: 'Simple Content',
 *   features: ['bold', 'italic', 'link', 'orderedList', 'unorderedList'],
 * };
 *
 * // Rich text with all features
 * const fullContentField: RichTextFieldConfig = {
 *   name: 'fullContent',
 *   type: 'richText',
 *   label: 'Full Content',
 *   features: [
 *     'bold', 'italic', 'underline', 'strikethrough', 'code',
 *     'h1', 'h2', 'h3', 'blockquote',
 *     'orderedList', 'unorderedList', 'checkList',
 *     'link', 'upload', 'table',
 *   ],
 * };
 * ```
 */
export interface RichTextFieldConfig
  extends Omit<
    BaseFieldConfig,
    "type" | "validate" | "defaultValue" | "admin"
  > {
  /**
   * Field type identifier. Must be 'richText'.
   */
  type: "richText";

  /**
   * Enabled editor features.
   *
   * If not specified, a default set of features is enabled:
   * - Formatting: bold, italic, underline, strikethrough, code
   * - Headings: h1, h2, h3, h4
   * - Lists: orderedList, unorderedList, indent
   * - Other: blockquote, link
   *
   * Set to an empty array `[]` to start with a plain text editor.
   */
  features?: RichTextFeature[];

  /**
   * Default value for the field.
   *
   * Can be a static RichTextValue or a function that returns one.
   */
  defaultValue?:
    | RichTextValue
    | ((data: Record<string, unknown>) => RichTextValue);

  /**
   * Admin UI configuration options.
   */
  admin?: RichTextFieldAdminOptions;

  /**
   * Custom validation function.
   *
   * Receives the typed rich text value and returns `true` for valid
   * or an error message string for invalid.
   *
   * @param value - The rich text field value
   * @param args - Object containing document data and request context
   * @returns `true` if valid, or an error message string
   *
   * @example
   * ```typescript
   * validate: (value, { data }) => {
   *   if (!value || !value.root.children.length) {
   *     return 'Content is required';
   *   }
   *   return true;
   * }
   * ```
   */
  validate?: (
    value: RichTextFieldValue,
    args: { data: Record<string, unknown>; req: RequestContext }
  ) => string | true | Promise<string | true>;
}
