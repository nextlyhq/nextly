/**
 * Field Builder Helpers
 *
 * Convenient factory functions for creating field configurations.
 * These helpers eliminate the need to manually specify the `type` property,
 * providing a cleaner, more ergonomic API for code-first collection definitions.
 *
 * @module collections/fields/helpers
 * @since 1.0.0
 *
 * @example
 * ```typescript
 * import { text, select, relationship, option } from '@nextly/collections/fields';
 *
 * const fields = [
 *   text({ name: 'title', required: true }),
 *   select({
 *     name: 'status',
 *     options: [
 *       option('Draft'),
 *       option('Published'),
 *       option('Archived'),
 *     ],
 *   }),
 *   relationship({ name: 'author', relationTo: 'users' }),
 * ];
 * ```
 */

import { STORAGE_FORMAT } from "../../schemas/storage-format";

import type {
  // Text field types
  TextFieldConfig,
  TextareaFieldConfig,
  RichTextFieldConfig,
  EmailFieldConfig,
  PasswordFieldConfig,
  CodeFieldConfig,
  // Numeric field types
  NumberFieldConfig,
  // Selection field types
  CheckboxFieldConfig,
  DateFieldConfig,
  SelectFieldConfig,
  RadioFieldConfig,
  SelectOption,
  // Media field types
  UploadFieldConfig,
  // Relational field types
  RelationshipFieldConfig,
  // Structured field types
  RepeaterFieldConfig,
  GroupFieldConfig,
  JSONFieldConfig,
  // Component field types
  FieldGroupFieldConfig,
  // Chips field types
  ChipsFieldConfig,
} from "./types";

// ============================================================
// Text Field Helpers
// ============================================================

/**
 * Creates a text field configuration.
 *
 * Text fields store simple string values with optional constraints
 * like min/max length. Supports `hasMany` for storing arrays of strings.
 *
 * @param config - Field configuration without the `type` property
 * @returns Complete text field configuration
 *
 * @example
 * ```typescript
 * // Basic text field
 * text({ name: 'title', required: true })
 *
 * // Text with constraints
 * text({ name: 'slug', minLength: 3, maxLength: 100, unique: true })
 *
 * // Multiple values (tags)
 * text({ name: 'tags', hasMany: true, minRows: 1, maxRows: 10 })
 * ```
 *
 * Every field factory keeps the name as written, so `defineCollection` can
 * type a read rule's filter by the collection's fields. A name the checker
 * cannot know, such as one built at runtime, is `string`, and the filter is
 * untyped. The factories of the fields a filter may name keep what decides
 * how the field is stored as written too: `virtual`, and where the field has
 * them, `hasMany` and `relationTo`. A field stored as a JSON document, or
 * owning no column, is then no key of the filter.
 */
export const text = <
  const Name extends string,
  Many extends boolean = false,
  Virtual extends boolean = false,
>(
  config: Omit<TextFieldConfig, "type"> & {
    name: Name;
    hasMany?: Many;
    virtual?: Virtual;
  }
): TextFieldConfig & {
  name: Name;
  hasMany?: NoInfer<Many>;
  virtual?: NoInfer<Virtual>;
} => ({
  ...config,
  type: "text",
});

/**
 * Creates a textarea field configuration.
 *
 * Textarea fields store longer text content with a multi-line input.
 * Supports configurable row height and resize behavior.
 *
 * @param config - Field configuration without the `type` property
 * @returns Complete textarea field configuration
 *
 * @example
 * ```typescript
 * // Basic textarea
 * textarea({ name: 'description' })
 *
 * // Fixed height textarea
 * textarea({ name: 'bio', admin: { rows: 5, resize: 'none' } })
 * ```
 */
export const textarea = <
  const Name extends string,
  Virtual extends boolean = false,
>(
  config: Omit<TextareaFieldConfig, "type"> & { name: Name; virtual?: Virtual }
): TextareaFieldConfig & { name: Name; virtual?: NoInfer<Virtual> } => ({
  ...config,
  type: "textarea",
});

/**
 * Creates a rich text field configuration.
 *
 * Rich text fields provide a Lexical-based WYSIWYG editor with
 * configurable formatting features (bold, italic, lists, etc.).
 *
 * @param config - Field configuration without the `type` property
 * @returns Complete rich text field configuration
 *
 * @example
 * ```typescript
 * // Basic rich text
 * richText({ name: 'content' })
 *
 * // Rich text with specific features
 * richText({
 *   name: 'body',
 *   features: ['bold', 'italic', 'link', 'orderedList', 'unorderedList'],
 * })
 * ```
 */
export const richText = <const Name extends string>(
  config: Omit<RichTextFieldConfig, "type"> & { name: Name }
): RichTextFieldConfig & { name: Name } => ({
  ...config,
  type: "richText",
});

/**
 * Creates an email field configuration.
 *
 * Email fields store email addresses with built-in format validation.
 *
 * @param config - Field configuration without the `type` property
 * @returns Complete email field configuration
 *
 * @example
 * ```typescript
 * // Basic email field
 * email({ name: 'email', required: true, unique: true })
 *
 * // Optional contact email
 * email({ name: 'contactEmail', label: 'Contact Email' })
 * ```
 */
export const email = <
  const Name extends string,
  Virtual extends boolean = false,
>(
  config: Omit<EmailFieldConfig, "type"> & { name: Name; virtual?: Virtual }
): EmailFieldConfig & { name: Name; virtual?: NoInfer<Virtual> } => ({
  ...config,
  type: "email",
});

/**
 * Creates a password field configuration.
 *
 * Password fields store hashed passwords with masked input.
 * Includes optional strength indicator and auto-generation.
 *
 * @param config - Field configuration without the `type` property
 * @returns Complete password field configuration
 *
 * @example
 * ```typescript
 * // Basic password field
 * password({ name: 'password', required: true })
 *
 * // Password with strength indicator
 * password({
 *   name: 'password',
 *   minLength: 8,
 *   admin: { showStrengthIndicator: true },
 * })
 * ```
 */
export const password = <const Name extends string>(
  config: Omit<PasswordFieldConfig, "type"> & { name: Name }
): PasswordFieldConfig & { name: Name } => ({
  ...config,
  type: "password",
});

/**
 * Creates a code field configuration.
 *
 * Code fields provide a code editor with syntax highlighting
 * for various programming languages.
 *
 * @param config - Field configuration without the `type` property
 * @returns Complete code field configuration
 *
 * @example
 * ```typescript
 * // JavaScript code field
 * code({ name: 'snippet', language: 'javascript' })
 *
 * // JSON configuration field
 * code({
 *   name: 'config',
 *   language: 'json',
 *   admin: { editorOptions: { lineNumbers: true } },
 * })
 * ```
 */
export const code = <
  const Name extends string,
  Virtual extends boolean = false,
>(
  config: Omit<CodeFieldConfig, "type"> & { name: Name; virtual?: Virtual }
): CodeFieldConfig & { name: Name; virtual?: NoInfer<Virtual> } => ({
  ...config,
  type: "code",
});

// ============================================================
// Numeric Field Helpers
// ============================================================

/**
 * Creates a number field configuration.
 *
 * Number fields store whole numbers by default; opt into an exact decimal
 * column with `dbType: "decimal"` for money and other fractional values.
 *
 * @param config - Field configuration without the `type` property
 * @returns Complete number field configuration
 *
 * @example
 * ```typescript
 * // Integer with range
 * number({ name: 'quantity', min: 0, max: 100, step: 1 })
 *
 * // Exact decimal price (integer is the default and truncates fractions)
 * number({ name: 'amount', min: 0, dbType: 'decimal', scale: 2 })
 * ```
 */
export const number = <
  const Name extends string,
  Many extends boolean = false,
  Virtual extends boolean = false,
>(
  config: Omit<NumberFieldConfig, "type"> & {
    name: Name;
    hasMany?: Many;
    virtual?: Virtual;
  }
): NumberFieldConfig & {
  name: Name;
  hasMany?: NoInfer<Many>;
  virtual?: NoInfer<Virtual>;
} => ({
  ...config,
  type: "number",
});

// ============================================================
// Selection Field Helpers
// ============================================================

/**
 * Creates a checkbox field configuration.
 *
 * Checkbox fields store boolean true/false values.
 *
 * @param config - Field configuration without the `type` property
 * @returns Complete checkbox field configuration
 *
 * @example
 * ```typescript
 * // Basic checkbox
 * checkbox({ name: 'isActive', defaultValue: true })
 *
 * // Feature flag
 * checkbox({ name: 'featured', label: 'Featured Post' })
 * ```
 */
export const checkbox = <
  const Name extends string,
  Virtual extends boolean = false,
>(
  config: Omit<CheckboxFieldConfig, "type"> & { name: Name; virtual?: Virtual }
): CheckboxFieldConfig & { name: Name; virtual?: NoInfer<Virtual> } => ({
  ...config,
  type: "checkbox",
});

/**
 * Creates a date field configuration.
 *
 * Date fields store date and/or time values with a date picker UI.
 * Supports various display formats and picker appearances.
 *
 * @param config - Field configuration without the `type` property
 * @returns Complete date field configuration
 *
 * @example
 * ```typescript
 * // Date only
 * date({ name: 'publishedAt' })
 *
 * // Date and time
 * date({
 *   name: 'eventTime',
 *   admin: { date: { pickerAppearance: 'dayAndTime' } },
 * })
 *
 * // Time only
 * date({
 *   name: 'openingTime',
 *   admin: { date: { pickerAppearance: 'timeOnly' } },
 * })
 * ```
 */
export const date = <
  const Name extends string,
  Virtual extends boolean = false,
>(
  config: Omit<DateFieldConfig, "type"> & { name: Name; virtual?: Virtual }
): DateFieldConfig & { name: Name; virtual?: NoInfer<Virtual> } => ({
  ...config,
  type: "date",
});

/**
 * Creates a select field configuration.
 *
 * Select fields provide a dropdown for choosing from predefined options.
 * Supports single or multiple selections with searchable dropdown.
 *
 * @param config - Field configuration without the `type` property
 * @returns Complete select field configuration
 *
 * @example
 * ```typescript
 * // Basic select
 * select({
 *   name: 'status',
 *   options: [
 *     { label: 'Draft', value: 'draft' },
 *     { label: 'Published', value: 'published' },
 *   ],
 * })
 *
 * // Using option helper
 * select({
 *   name: 'status',
 *   options: [option('Draft'), option('Published'), option('Archived')],
 * })
 *
 * // Multi-select
 * select({
 *   name: 'categories',
 *   hasMany: true,
 *   options: [option('Tech'), option('Business'), option('Design')],
 * })
 * ```
 */
export const select = <
  const Name extends string,
  Many extends boolean = false,
  Virtual extends boolean = false,
>(
  config: Omit<SelectFieldConfig, "type"> & {
    name: Name;
    hasMany?: Many;
    virtual?: Virtual;
  }
): SelectFieldConfig & {
  name: Name;
  hasMany?: NoInfer<Many>;
  virtual?: NoInfer<Virtual>;
} => ({
  ...config,
  type: "select",
});

/**
 * Creates a radio field configuration.
 *
 * Radio fields display options as radio buttons for single selection.
 * Better for small option sets where all choices should be visible.
 *
 * @param config - Field configuration without the `type` property
 * @returns Complete radio field configuration
 *
 * @example
 * ```typescript
 * // Basic radio field
 * radio({
 *   name: 'priority',
 *   options: [option('Low'), option('Medium'), option('High')],
 * })
 *
 * // Horizontal layout
 * radio({
 *   name: 'size',
 *   options: [option('S'), option('M'), option('L'), option('XL')],
 *   admin: { layout: 'horizontal' },
 * })
 * ```
 */
export const radio = <
  const Name extends string,
  Virtual extends boolean = false,
>(
  config: Omit<RadioFieldConfig, "type"> & { name: Name; virtual?: Virtual }
): RadioFieldConfig & { name: Name; virtual?: NoInfer<Virtual> } => ({
  ...config,
  type: "radio",
});

// ============================================================
// Media Field Helpers
// ============================================================

/**
 * Creates an upload field configuration.
 *
 * Upload fields reference files from upload-enabled collections.
 * Supports single or multiple files with polymorphic references.
 *
 * @param config - Field configuration without the `type` property
 * @returns Complete upload field configuration
 *
 * @example
 * ```typescript
 * // Single image
 * upload({ name: 'featuredImage', relationTo: 'media' })
 *
 * // Multiple images (gallery)
 * upload({
 *   name: 'gallery',
 *   relationTo: 'media',
 *   hasMany: true,
 *   maxRows: 10,
 * })
 *
 * // Polymorphic uploads (multiple collections)
 * upload({
 *   name: 'attachment',
 *   relationTo: ['media', 'documents'],
 * })
 * ```
 */
export const upload = <
  const Name extends string,
  Target extends string | string[] = string,
  Many extends boolean = false,
  Virtual extends boolean = false,
>(
  config: Omit<UploadFieldConfig, "type"> & {
    name: Name;
    relationTo: Target;
    hasMany?: Many;
    virtual?: Virtual;
  }
): UploadFieldConfig & {
  name: Name;
  relationTo: NoInfer<Target>;
  hasMany?: NoInfer<Many>;
  virtual?: NoInfer<Virtual>;
} => ({
  ...config,
  type: "upload",
});

// ============================================================
// Relational Field Helpers
// ============================================================

/**
 * Creates a relationship field configuration.
 *
 * Relationship fields reference documents from other collections.
 * Supports single or multiple references with polymorphic relations.
 *
 * @param config - Field configuration without the `type` property
 * @returns Complete relationship field configuration
 *
 * @example
 * ```typescript
 * // Single relationship
 * relationship({ name: 'author', relationTo: 'users' })
 *
 * // Multiple relationships
 * relationship({
 *   name: 'relatedPosts',
 *   relationTo: 'posts',
 *   hasMany: true,
 *   maxRows: 5,
 * })
 *
 * // Polymorphic relationship
 * relationship({
 *   name: 'reference',
 *   relationTo: ['posts', 'pages', 'products'],
 * })
 * ```
 */
export const relationship = <
  const Name extends string,
  Target extends string | string[] = string,
  Many extends boolean = false,
  Virtual extends boolean = false,
>(
  config: Omit<RelationshipFieldConfig, "type"> & {
    name: Name;
    relationTo: Target;
    hasMany?: Many;
    virtual?: Virtual;
  }
): RelationshipFieldConfig & {
  name: Name;
  relationTo: NoInfer<Target>;
  hasMany?: NoInfer<Many>;
  virtual?: NoInfer<Virtual>;
} => ({
  ...config,
  type: "relationship",
});

// ============================================================
// Structured Field Helpers
// ============================================================

/**
 * Creates a repeater field configuration.
 *
 * This is an alias for `repeater()` kept for backwards compatibility.
 * Prefer `repeater()` for new code — both produce `type: "repeater"`.
 *
 * @param config - Field configuration without the `type` property
 * @returns Complete repeater field configuration
 *
 * @example
 * ```typescript
 * // Simple list of links
 * array({
 *   name: 'links',
 *   fields: [
 *     text({ name: 'label', required: true }),
 *     text({ name: 'url', required: true }),
 *   ],
 * })
 *
 * // With constraints
 * array({
 *   name: 'features',
 *   minRows: 1,
 *   maxRows: 10,
 *   fields: [
 *     text({ name: 'title', required: true }),
 *     textarea({ name: 'description' }),
 *   ],
 * })
 * ```
 */
export const array = <const Name extends string>(
  config: Omit<RepeaterFieldConfig, "type"> & { name: Name }
): RepeaterFieldConfig & { name: Name } => ({
  ...config,
  type: "repeater",
});

/**
 * Creates a repeater field configuration.
 *
 * Repeater fields store an ordered list of structured rows, each sharing
 * the same field schema defined by the `fields` property.
 *
 * @param config - Field configuration without the `type` property
 * @returns Complete repeater field configuration
 *
 * @example
 * ```typescript
 * repeater({
 *   name: 'features',
 *   fields: [
 *     text({ name: 'title', required: true }),
 *     textarea({ name: 'description' }),
 *   ],
 * })
 * ```
 */
export const repeater = <const Name extends string>(
  config: Omit<RepeaterFieldConfig, "type"> & { name: Name }
): RepeaterFieldConfig & { name: Name } => ({
  ...config,
  type: "repeater",
});

/**
 * Creates a group field configuration.
 *
 * Group fields organize related fields together. Named groups create
 * nested data structures, while presentational groups just organize UI.
 *
 * @param config - Field configuration without the `type` property
 * @returns Complete group field configuration
 *
 * @example
 * ```typescript
 * // Named group (creates nested data)
 * group({
 *   name: 'seo',
 *   fields: [
 *     text({ name: 'metaTitle' }),
 *     textarea({ name: 'metaDescription' }),
 *   ],
 * })
 * // Data: { seo: { metaTitle: '...', metaDescription: '...' } }
 *
 * // Presentational group (no data nesting)
 * group({
 *   name: 'contactInfo',
 *   admin: { hideGutter: true },
 *   fields: [
 *     email({ name: 'email' }),
 *     text({ name: 'phone' }),
 *   ],
 * })
 * ```
 */
export const group = <const Name extends string>(
  config: Omit<GroupFieldConfig, "type"> & { name: Name }
): GroupFieldConfig & { name: Name } => ({
  ...config,
  type: "group",
});

export const json = <const Name extends string>(
  config: Omit<JSONFieldConfig, "type"> & { name: Name }
): JSONFieldConfig & { name: Name } => ({
  ...config,
  type: "json",
});

// ============================================================
// Component Field Helpers
// ============================================================

/**
 * Creates a component field configuration.
 *
 * Component fields embed reusable Components within Collections, Singles,
 * or other Components. Supports single component, multi-component (dynamic
 * zone), and repeatable modes.
 *
 * @param config - Field configuration without the `type` property
 * @returns Complete component field configuration
 *
 * @example
 * ```typescript
 * // Single component (one specific type)
 * fieldGroup({ name: 'seo', component: 'seo' })
 *
 * // Multi-component / dynamic zone (editor picks type)
 * fieldGroup({
 *   name: 'layout',
 *   components: ['hero', 'cta', 'content'],
 *   repeatable: true,
 * })
 *
 * // Repeatable single component
 * fieldGroup({
 *   name: 'features',
 *   component: 'feature-card',
 *   repeatable: true,
 *   minRows: 1,
 *   maxRows: 12,
 * })
 * ```
 */
export const fieldGroup = <const Name extends string>(
  config: Omit<FieldGroupFieldConfig, "type"> & { name: Name }
): FieldGroupFieldConfig & { name: Name } => ({
  ...config,
  type: STORAGE_FORMAT.fieldType,
});

// ============================================================
// Chips Field Helpers
// ============================================================

/**
 * Creates a chips field configuration.
 *
 * Chips fields store an array of unique free-form string values.
 * Renders as interactive chips/tags with add/remove capability.
 * Duplicate values are automatically prevented.
 *
 * @param config - Field configuration without the `type` property
 * @returns Complete chips field configuration
 *
 * @example
 * ```typescript
 * // Basic chips field
 * chips({ name: 'tags' })
 *
 * // Tags with limit
 * chips({ name: 'keywords', maxChips: 10 })
 *
 * // Required with min/max
 * chips({ name: 'categories', required: true, minChips: 1, maxChips: 5 })
 * ```
 */
export const chips = <const Name extends string>(
  config: Omit<ChipsFieldConfig, "type"> & { name: Name }
): ChipsFieldConfig & { name: Name } => ({
  ...config,
  type: "chips",
});

// ============================================================
// Helper Utilities
// ============================================================

/**
 * Creates a select option configuration.
 *
 * A convenient helper for creating select/radio options.
 * If no value is provided, it's auto-generated from the label.
 *
 * @param label - Display text for the option
 * @param value - Value stored in database (defaults to lowercase label with underscores)
 * @returns Select option object
 *
 * @example
 * ```typescript
 * // Auto-generated values
 * option('Draft')           // { label: 'Draft', value: 'draft' }
 * option('In Progress')     // { label: 'In Progress', value: 'in_progress' }
 * option('Published')       // { label: 'Published', value: 'published' }
 *
 * // Custom value
 * option('Active', 'active')
 * option('High Priority', 'high')
 *
 * // Used in select field
 * select({
 *   name: 'status',
 *   options: [
 *     option('Draft'),
 *     option('In Review'),
 *     option('Published'),
 *   ],
 * })
 * ```
 *
 * With a value given, the option keeps it as the literal written, so a widget
 * setting's select (`setting.select`) is typed by exactly the values it
 * offers; an option whose value comes from its label is a plain string.
 */
export function option<const Value extends string>(
  label: string,
  value: Value
): SelectOption & { value: Value };
export function option(label: string, value?: string): SelectOption;
export function option(label: string, value?: string): SelectOption {
  return {
    label,
    value: value ?? label.toLowerCase().replace(/\s+/g, "_"),
  };
}
