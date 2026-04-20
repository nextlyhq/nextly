/**
 * Code Field Type
 *
 * A specialized text field for code input with syntax highlighting.
 * Renders as a code editor in the Admin UI with language-specific
 * highlighting and formatting.
 *
 * @module collections/fields/types/code
 * @since 1.0.0
 */

import type {
  BaseFieldConfig,
  FieldAdminOptions,
  RequestContext,
} from "./base";

// ============================================================
// Code Languages
// ============================================================

/**
 * Supported programming languages for syntax highlighting.
 *
 * These languages are supported by the code editor for
 * syntax highlighting and code formatting.
 */
export type CodeLanguage =
  | "javascript"
  | "typescript"
  | "jsx"
  | "tsx"
  | "html"
  | "css"
  | "scss"
  | "less"
  | "json"
  | "markdown"
  | "yaml"
  | "xml"
  | "sql"
  | "graphql"
  | "python"
  | "ruby"
  | "php"
  | "java"
  | "c"
  | "cpp"
  | "csharp"
  | "go"
  | "rust"
  | "swift"
  | "kotlin"
  | "shell"
  | "bash"
  | "powershell"
  | "dockerfile"
  | "plaintext";

// ============================================================
// Code Field Value Type
// ============================================================

/**
 * Possible value types for a code field.
 */
export type CodeFieldValue = string | null | undefined;

// ============================================================
// Code Editor Options
// ============================================================

/**
 * Code editor configuration options.
 *
 * These options control the behavior and appearance of the
 * code editor in the Admin UI.
 */
export interface CodeEditorOptions {
  /**
   * Show line numbers in the editor.
   *
   * @default true
   */
  lineNumbers?: boolean;

  /**
   * Enable word wrapping.
   *
   * @default false
   */
  wordWrap?: boolean;

  /**
   * Tab size in spaces.
   *
   * @default 2
   */
  tabSize?: number;

  /**
   * Use tabs instead of spaces for indentation.
   *
   * @default false
   */
  useTabs?: boolean;

  /**
   * Minimum height of the editor in pixels.
   *
   * @default 200
   */
  minHeight?: number;

  /**
   * Maximum height of the editor in pixels.
   *
   * When set, the editor will scroll if content exceeds this height.
   */
  maxHeight?: number;

  /**
   * Font size in pixels.
   *
   * @default 14
   */
  fontSize?: number;

  /**
   * Font family for the code editor.
   *
   * @default 'monospace'
   */
  fontFamily?: string;

  /**
   * Enable code folding.
   *
   * @default true
   */
  folding?: boolean;

  /**
   * Enable bracket matching highlight.
   *
   * @default true
   */
  matchBrackets?: boolean;

  /**
   * Enable auto-closing of brackets and quotes.
   *
   * @default true
   */
  autoCloseBrackets?: boolean;
}

// ============================================================
// Code Field Admin Options
// ============================================================

/**
 * Admin panel options specific to code fields.
 *
 * Extends the base admin options with code editor settings.
 */
export interface CodeFieldAdminOptions extends FieldAdminOptions {
  /**
   * Programming language for syntax highlighting.
   *
   * If not specified, defaults to 'plaintext' (no highlighting).
   */
  language?: CodeLanguage;

  /**
   * Code editor configuration options.
   */
  editorOptions?: CodeEditorOptions;
}

// ============================================================
// Code Field Configuration
// ============================================================

/**
 * Configuration interface for code fields.
 *
 * Code fields provide a full-featured code editor with syntax
 * highlighting, line numbers, and other IDE-like features.
 * They are ideal for storing code snippets, configuration files,
 * or any structured text content.
 *
 * @example
 * ```typescript
 * // Basic code field
 * const snippetField: CodeFieldConfig = {
 *   name: 'snippet',
 *   type: 'code',
 *   label: 'Code Snippet',
 *   admin: {
 *     language: 'javascript',
 *   },
 * };
 *
 * // JSON configuration field
 * const configField: CodeFieldConfig = {
 *   name: 'config',
 *   type: 'code',
 *   label: 'Configuration',
 *   admin: {
 *     language: 'json',
 *     description: 'Enter valid JSON configuration',
 *     editorOptions: {
 *       lineNumbers: true,
 *       minHeight: 300,
 *     },
 *   },
 *   validate: (value) => {
 *     if (value) {
 *       try {
 *         JSON.parse(value);
 *       } catch {
 *         return 'Invalid JSON format';
 *       }
 *     }
 *     return true;
 *   },
 * };
 *
 * // CSS styles field
 * const customCssField: CodeFieldConfig = {
 *   name: 'customCss',
 *   type: 'code',
 *   label: 'Custom CSS',
 *   admin: {
 *     language: 'css',
 *     editorOptions: {
 *       wordWrap: true,
 *       minHeight: 200,
 *       maxHeight: 500,
 *     },
 *   },
 * };
 *
 * // Multi-language code field (user selects language)
 * const codeBlockField: CodeFieldConfig = {
 *   name: 'codeBlock',
 *   type: 'code',
 *   label: 'Code Block',
 *   admin: {
 *     language: 'plaintext', // Default, can be changed
 *     editorOptions: {
 *       lineNumbers: true,
 *       folding: true,
 *     },
 *   },
 * };
 * ```
 */
export interface CodeFieldConfig
  extends Omit<
    BaseFieldConfig,
    "type" | "validate" | "defaultValue" | "admin"
  > {
  /**
   * Field type identifier. Must be 'code'.
   */
  type: "code";

  /**
   * Default value for the field.
   *
   * Can be a static string or a function that returns one.
   */
  defaultValue?: string | ((data: Record<string, unknown>) => string);

  /**
   * Admin UI configuration options including language and editor settings.
   */
  admin?: CodeFieldAdminOptions;

  /**
   * Custom validation function.
   *
   * Use this to validate the code content, such as checking
   * for valid JSON, XML, or custom syntax rules.
   *
   * @param value - The code field value (string, null, or undefined)
   * @param args - Object containing document data and request context
   * @returns `true` if valid, or an error message string
   *
   * @example
   * ```typescript
   * // Validate YAML syntax
   * validate: (value) => {
   *   if (value) {
   *     try {
   *       yaml.parse(value);
   *     } catch (e) {
   *       return `Invalid YAML: ${e.message}`;
   *     }
   *   }
   *   return true;
   * }
   * ```
   */
  validate?: (
    value: CodeFieldValue,
    args: { data: Record<string, unknown>; req: RequestContext }
  ) => string | true | Promise<string | true>;
}
