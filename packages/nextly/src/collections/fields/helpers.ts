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
  ComponentFieldConfig,
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
 */
export const text = (
  config: Omit<TextFieldConfig, "type">
): TextFieldConfig => ({
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
export const textarea = (
  config: Omit<TextareaFieldConfig, "type">
): TextareaFieldConfig => ({
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
export const richText = (
  config: Omit<RichTextFieldConfig, "type">
): RichTextFieldConfig => ({
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
export const email = (
  config: Omit<EmailFieldConfig, "type">
): EmailFieldConfig => ({
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
export const password = (
  config: Omit<PasswordFieldConfig, "type">
): PasswordFieldConfig => ({
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
export const code = (
  config: Omit<CodeFieldConfig, "type">
): CodeFieldConfig => ({
  ...config,
  type: "code",
});

// ============================================================
// Numeric Field Helpers
// ============================================================

/**
 * Creates a number field configuration.
 *
 * Number fields store numeric values (integers or decimals)
 * with optional min/max constraints and step values.
 *
 * @param config - Field configuration without the `type` property
 * @returns Complete number field configuration
 *
 * @example
 * ```typescript
 * // Basic number field
 * number({ name: 'price', required: true })
 *
 * // Integer with range
 * number({ name: 'quantity', min: 0, max: 100, step: 1 })
 *
 * // Decimal price
 * number({ name: 'amount', min: 0, step: 0.01 })
 * ```
 */
export const number = (
  config: Omit<NumberFieldConfig, "type">
): NumberFieldConfig => ({
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
export const checkbox = (
  config: Omit<CheckboxFieldConfig, "type">
): CheckboxFieldConfig => ({
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
export const date = (
  config: Omit<DateFieldConfig, "type">
): DateFieldConfig => ({
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
export const select = (
  config: Omit<SelectFieldConfig, "type">
): SelectFieldConfig => ({
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
export const radio = (
  config: Omit<RadioFieldConfig, "type">
): RadioFieldConfig => ({
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
export const upload = (
  config: Omit<UploadFieldConfig, "type">
): UploadFieldConfig => ({
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
export const relationship = (
  config: Omit<RelationshipFieldConfig, "type">
): RelationshipFieldConfig => ({
  ...config,
  type: "relationship",
});

// ============================================================
// Structured Field Helpers
// ============================================================

/**
 * Creates an array field configuration.
 *
 * Array fields store repeatable sets of fields. Each row in the
 * array has the same structure defined by the `fields` property.
 *
 * @param config - Field configuration without the `type` property
 * @returns Complete array field configuration
 *
 * @example
 * ```typescript
 * // Simple array of links
 * array({
 *   name: 'links',
 *   fields: [
 *     text({ name: 'label', required: true }),
 *     text({ name: 'url', required: true }),
 *   ],
 * })
 *
 * // Array with constraints
 * array({
 *   name: 'features',
 *   minRows: 1,
 *   maxRows: 10,
 *   fields: [
 *     text({ name: 'title', required: true }),
 *     textarea({ name: 'description' }),
 *     upload({ name: 'icon', relationTo: 'media' }),
 *   ],
 * })
 * ```
 */
export const array = (
  config: Omit<RepeaterFieldConfig, "type">
): RepeaterFieldConfig => ({
  ...config,
  type: "repeater",
});

/**
 * Creates a repeater field configuration.
 *
 * Repeater fields are functionally identical to array fields. Each row in a
 * repeater has the same structure defined by the `fields` property.
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
export const repeater = (
  config: Omit<RepeaterFieldConfig, "type">
): RepeaterFieldConfig => ({
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
export const group = (
  config: Omit<GroupFieldConfig, "type">
): GroupFieldConfig => ({
  ...config,
  type: "group",
});

/**
 * Creates a JSON field configuration.
 *
 * JSON fields store arbitrary JSON data with optional schema validation.
 * Provides a Monaco-based JSON editor in the Admin UI.
 *
 * @param config - Field configuration without the `type` property
 * @returns Complete JSON field configuration
 *
 * @example
 * ```typescript
 * // Basic JSON field
 * json({ name: 'metadata' })
 *
 * // JSON with schema validation
 * json({
 *   name: 'config',
 *   jsonSchema: {
 *     type: 'object',
 *     properties: {
 *       theme: { type: 'string', enum: ['light', 'dark'] },
 *       maxItems: { type: 'number', minimum: 1 },
 *     },
 *     required: ['theme'],
 *   },
 * })
 * ```
 */
export const json = (
  config: Omit<JSONFieldConfig, "type">
): JSONFieldConfig => ({
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
 * component({ name: 'seo', component: 'seo' })
 *
 * // Multi-component / dynamic zone (editor picks type)
 * component({
 *   name: 'layout',
 *   components: ['hero', 'cta', 'content'],
 *   repeatable: true,
 * })
 *
 * // Repeatable single component
 * component({
 *   name: 'features',
 *   component: 'feature-card',
 *   repeatable: true,
 *   minRows: 1,
 *   maxRows: 12,
 * })
 * ```
 */
export const component = (
  config: Omit<ComponentFieldConfig, "type">
): ComponentFieldConfig => ({
  ...config,
  type: "component",
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
export const chips = (
  config: Omit<ChipsFieldConfig, "type">
): ChipsFieldConfig => ({
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
 */
export const option = (label: string, value?: string): SelectOption => ({
  label,
  value: value ?? label.toLowerCase().replace(/\s+/g, "_"),
});
