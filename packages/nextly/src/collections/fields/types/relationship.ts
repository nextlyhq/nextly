/**
 * Relationship Field Type
 *
 * A field for creating references between documents in different collections.
 * Supports single or multiple relationships, polymorphic relations to
 * multiple collections, and filtering available documents.
 *
 * @module collections/fields/types/relationship
 * @since 1.0.0
 */

import type {
  BaseFieldConfig,
  FieldAdminOptions,
  RequestContext,
} from "./base";

// ============================================================
// Relationship Field Value Types
// ============================================================

/**
 * Reference to a related document (single collection).
 *
 * When `relationTo` is a single string, the value is just the document ID.
 */
export type RelationshipSingleValue = string | null | undefined;

/**
 * Reference to a related document (polymorphic/multiple collections).
 *
 * When `relationTo` is an array of collection slugs, the value includes
 * both the collection slug and document ID to identify which collection
 * the related document belongs to.
 *
 * @example
 * ```typescript
 * // Single polymorphic reference
 * const value: RelationshipPolymorphicValue = {
 *   relationTo: 'users',
 *   value: 'abc123',
 * };
 * ```
 */
export interface RelationshipPolymorphicValue {
  /**
   * The collection slug this relationship points to.
   */
  relationTo: string;

  /**
   * The document ID of the related document.
   */
  value: string;
}

/**
 * Possible value types for a relationship field.
 *
 * The value type depends on the `relationTo` and `hasMany` configuration:
 *
 * - `relationTo: string` + `hasMany: false` → `string | null | undefined`
 * - `relationTo: string` + `hasMany: true` → `string[] | null | undefined`
 * - `relationTo: string[]` + `hasMany: false` → `RelationshipPolymorphicValue | null | undefined`
 * - `relationTo: string[]` + `hasMany: true` → `RelationshipPolymorphicValue[] | null | undefined`
 */
export type RelationshipFieldValue =
  | string
  | string[]
  | RelationshipPolymorphicValue
  | RelationshipPolymorphicValue[]
  | null
  | undefined;

// ============================================================
// Filter Options Types
// ============================================================

/**
 * Arguments passed to the filterOptions function.
 */
export interface RelationshipFilterOptionsArgs {
  /**
   * The collection slug being filtered.
   * When `relationTo` is an array, this indicates which collection
   * the filter is being applied to.
   */
  relationTo: string;

  /**
   * The current document data being edited.
   */
  data: Record<string, unknown>;

  /**
   * Data from sibling fields (fields at the same level in arrays/groups).
   */
  siblingData: Record<string, unknown>;

  /**
   * The ID of the current document being edited.
   * Undefined during create operations.
   */
  id?: string;

  /**
   * The current user making the request.
   */
  user?: RequestContext["user"];

  /**
   * The full request context.
   */
  req: RequestContext;

  /**
   * Parent block data when this field is within a blocks field.
   * Undefined if not inside a block.
   */
  blockData?: Record<string, unknown>;
}

/**
 * Where query for filtering available related documents.
 *
 * Since relationships can filter on any document field, this uses
 * a flexible record type that matches the Nextly Where query syntax.
 *
 * @example
 * ```typescript
 * // Filter by status field
 * const publishedOnly: RelationshipFilterQuery = {
 *   status: { equals: 'published' },
 * };
 *
 * // Filter by category
 * const categoryFilter: RelationshipFilterQuery = {
 *   category: { in: ['news', 'blog'] },
 * };
 *
 * // Complex filter with AND/OR
 * const complexFilter: RelationshipFilterQuery = {
 *   and: [
 *     { status: { equals: 'published' } },
 *     { or: [
 *       { category: { equals: 'featured' } },
 *       { priority: { greater_than: 5 } },
 *     ]},
 *   ],
 * };
 * ```
 */
export type RelationshipFilterQuery = Record<string, unknown>;

/**
 * Function to dynamically filter available related documents.
 *
 * Allows documents to be filtered based on the current document data,
 * user context, or other dynamic conditions. Return values:
 * - `true` - No filtering, show all documents
 * - `false` - Prevent all documents from being shown
 * - `RelationshipFilterQuery` - Apply the specified Where query filter
 *
 * @param args - Filter arguments with context
 * @returns Filter result or Promise resolving to filter result
 *
 * @example
 * ```typescript
 * // Role-based filtering
 * filterOptions: ({ user }) => {
 *   if (user?.role === 'admin') {
 *     return true; // Admins see all documents
 *   }
 *   return { status: { equals: 'published' } }; // Others only see published
 * }
 *
 * // Context-aware filtering - only show users from same organization
 * filterOptions: ({ data }) => {
 *   if (data.organizationId) {
 *     return { organizationId: { equals: data.organizationId } };
 *   }
 *   return true;
 * }
 *
 * // Polymorphic filtering - different filters per collection
 * filterOptions: ({ relationTo, user }) => {
 *   if (relationTo === 'users') {
 *     return { role: { not_equals: 'admin' } };
 *   }
 *   if (relationTo === 'posts') {
 *     return { status: { equals: 'published' } };
 *   }
 *   return true;
 * }
 * ```
 */
export type RelationshipFilterOptionsFunction = (
  args: RelationshipFilterOptionsArgs
) =>
  | boolean
  | RelationshipFilterQuery
  | Promise<boolean | RelationshipFilterQuery>;

/**
 * Filter options for relationship fields.
 *
 * Can be either a static Where query or a dynamic function.
 */
export type RelationshipFilterOptions =
  | RelationshipFilterQuery
  | RelationshipFilterOptionsFunction;

// ============================================================
// Sort Options Types
// ============================================================

/**
 * Sort options for the relationship field dropdown.
 *
 * Controls how related documents are sorted when displayed in the
 * Admin UI dropdown. Can be:
 * - A field name string (ascending order)
 * - An object mapping collection slugs to field names (for polymorphic)
 *
 * @example
 * ```typescript
 * // Simple sort by title
 * sortOptions: 'title'
 *
 * // Sort by title descending
 * sortOptions: '-title'
 *
 * // Per-collection sorting (polymorphic)
 * sortOptions: {
 *   users: 'lastName',
 *   posts: '-createdAt',
 *   categories: 'name',
 * }
 * ```
 */
export type RelationshipSortOptions = string | Record<string, string>;

// ============================================================
// Relationship Field Admin Options
// ============================================================

/**
 * UI appearance options for the relationship field.
 *
 * - `select` - Standard dropdown selector (default)
 * - `drawer` - Opens a drawer/modal for document selection
 */
export type RelationshipAppearance = "select" | "drawer";

/**
 * Admin panel options specific to relationship fields.
 *
 * Extends the base admin options with relationship-specific settings
 * for controlling the document picker behavior.
 */
export interface RelationshipFieldAdminOptions extends FieldAdminOptions {
  /**
   * Allow creating new related documents directly from the field.
   *
   * When `true`, displays a "Create New" button that allows users to
   * create new documents in the related collection without leaving
   * the current form.
   *
   * @default true
   */
  allowCreate?: boolean;

  /**
   * Allow editing related documents from within the field.
   *
   * When `true`, displays an edit button that opens the related
   * document for editing (in a drawer or new tab).
   *
   * @default true
   */
  allowEdit?: boolean;

  /**
   * Allow drag-and-drop reordering of selected relationships.
   *
   * Only applies when `hasMany: true`. Enables users to reorder
   * their selections by dragging.
   *
   * @default true
   */
  isSortable?: boolean;

  /**
   * Default sort order for documents in the dropdown.
   *
   * Can be a field name (prefix with `-` for descending) or an object
   * mapping collection slugs to field names for polymorphic relationships.
   *
   * @example
   * ```typescript
   * // Sort by title ascending
   * sortOptions: 'title'
   *
   * // Sort by createdAt descending
   * sortOptions: '-createdAt'
   *
   * // Per-collection sorting
   * sortOptions: {
   *   users: 'email',
   *   posts: '-publishedAt',
   * }
   * ```
   */
  sortOptions?: RelationshipSortOptions;

  /**
   * UI appearance style for the relationship picker.
   *
   * - `select` - Standard dropdown (default, good for small lists)
   * - `drawer` - Opens a drawer/modal (better for large lists with search)
   *
   * @default 'select'
   */
  appearance?: RelationshipAppearance;
}

// ============================================================
// Relationship Field Configuration
// ============================================================

/**
 * Configuration interface for relationship fields.
 *
 * Relationship fields create references between documents in different
 * collections. They're one of the most powerful field types, enabling
 * complex data relationships and content structures.
 *
 * **Key Features:**
 * - Reference documents from one or multiple collections
 * - Filter available documents by any field
 * - Support for single or multiple selections
 * - Create/edit related documents directly from the field
 * - Polymorphic relationships (multiple target collections)
 *
 * **Use Cases:**
 * - Author/user relationships on posts
 * - Category/tag assignments
 * - Parent-child hierarchies
 * - Cross-referencing content
 * - Many-to-many relationships
 *
 * @example
 * ```typescript
 * // Basic single relationship - Post author
 * const author: RelationshipFieldConfig = {
 *   name: 'author',
 *   type: 'relationship',
 *   label: 'Author',
 *   relationTo: 'users',
 *   required: true,
 *   filterOptions: {
 *     role: { in: ['author', 'editor', 'admin'] },
 *   },
 * };
 *
 * // Has many relationship - Post categories
 * const categories: RelationshipFieldConfig = {
 *   name: 'categories',
 *   type: 'relationship',
 *   label: 'Categories',
 *   relationTo: 'categories',
 *   hasMany: true,
 *   minRows: 1,
 *   maxRows: 5,
 *   admin: {
 *     description: 'Select 1-5 categories',
 *     isSortable: true,
 *   },
 * };
 *
 * // Polymorphic relationship - Media can reference multiple collections
 * const relatedContent: RelationshipFieldConfig = {
 *   name: 'relatedContent',
 *   type: 'relationship',
 *   label: 'Related Content',
 *   relationTo: ['posts', 'pages', 'products'],
 *   hasMany: true,
 *   admin: {
 *     description: 'Link to related posts, pages, or products',
 *     sortOptions: {
 *       posts: '-publishedAt',
 *       pages: 'title',
 *       products: 'name',
 *     },
 *   },
 * };
 *
 * // Self-referencing relationship - Parent page
 * const parentPage: RelationshipFieldConfig = {
 *   name: 'parent',
 *   type: 'relationship',
 *   label: 'Parent Page',
 *   relationTo: 'pages',
 *   filterOptions: ({ id }) => {
 *     // Exclude self from options to prevent circular reference
 *     if (id) {
 *       return { id: { not_equals: id } };
 *     }
 *     return true;
 *   },
 * };
 *
 * // Dynamic filtering based on document data
 * const teamMembers: RelationshipFieldConfig = {
 *   name: 'teamMembers',
 *   type: 'relationship',
 *   label: 'Team Members',
 *   relationTo: 'users',
 *   hasMany: true,
 *   filterOptions: ({ data }) => {
 *     // Only show users from the same organization
 *     if (data.organizationId) {
 *       return { organizationId: { equals: data.organizationId } };
 *     }
 *     return true;
 *   },
 * };
 *
 * // Relationship with drawer appearance for large lists
 * const products: RelationshipFieldConfig = {
 *   name: 'featuredProducts',
 *   type: 'relationship',
 *   label: 'Featured Products',
 *   relationTo: 'products',
 *   hasMany: true,
 *   maxRows: 10,
 *   admin: {
 *     appearance: 'drawer',
 *     allowCreate: false,
 *     sortOptions: '-sales',
 *   },
 * };
 * ```
 */
export interface RelationshipFieldConfig
  extends Omit<
    BaseFieldConfig,
    "type" | "validate" | "defaultValue" | "admin"
  > {
  /**
   * Field type identifier. Must be 'relationship'.
   */
  type: "relationship";

  /**
   * Collection(s) that this field can reference.
   *
   * Must be a collection slug or array of slugs. When using an array,
   * the relationship becomes "polymorphic" and can reference documents
   * from any of the specified collections.
   *
   * **Single collection:**
   * ```typescript
   * relationTo: 'users'
   * ```
   *
   * **Multiple collections (polymorphic):**
   * ```typescript
   * relationTo: ['users', 'organizations', 'teams']
   * ```
   *
   * When using multiple collections, the field value includes
   * a `relationTo` property to identify which collection the
   * related document belongs to.
   */
  relationTo: string | string[];

  /**
   * Allow multiple document references.
   *
   * When `true`, the field accepts an array of document references
   * instead of a single reference.
   *
   * @default false
   */
  hasMany?: boolean;

  /**
   * Minimum number of relationships when `hasMany` is true.
   *
   * Validation will fail if fewer relationships are selected.
   */
  minRows?: number;

  /**
   * Maximum number of relationships when `hasMany` is true.
   *
   * Validation will fail if more relationships are selected.
   * The Admin UI will disable the add button when this limit is reached.
   */
  maxRows?: number;

  /**
   * Maximum depth for populating related documents.
   *
   * Limits how deeply related documents are populated when querying.
   * Useful for controlling response size and preventing circular refs.
   *
   * @default 1
   */
  maxDepth?: number;

  /**
   * Filter options for available related documents.
   *
   * Can be a static Where query or a dynamic function that returns
   * a filter based on context (document data, user, etc.).
   *
   * **Note:** When using both `filterOptions` and a custom `validate`
   * function, the API will not automatically validate against filterOptions.
   * Include filter validation in your custom validate function if needed.
   *
   * @example
   * ```typescript
   * // Static filter - only published documents
   * filterOptions: {
   *   status: { equals: 'published' },
   * }
   *
   * // Dynamic filter - exclude self-reference
   * filterOptions: ({ id }) => {
   *   if (id) {
   *     return { id: { not_equals: id } };
   *   }
   *   return true;
   * }
   *
   * // Role-based filtering
   * filterOptions: ({ user }) => {
   *   if (user?.role !== 'admin') {
   *     return { public: { equals: true } };
   *   }
   *   return true;
   * }
   * ```
   */
  filterOptions?: RelationshipFilterOptions;

  /**
   * Default value for the field.
   *
   * Can be a static value or a function that returns a value.
   *
   * @example
   * ```typescript
   * // Single relationship default
   * defaultValue: 'default-category-id'
   *
   * // Multiple relationships default
   * defaultValue: ['category1-id', 'category2-id']
   *
   * // Polymorphic default
   * defaultValue: { relationTo: 'users', value: 'default-user-id' }
   *
   * // Dynamic default based on current user
   * defaultValue: ({ user }) => user?.id
   * ```
   */
  defaultValue?:
    | string
    | string[]
    | RelationshipPolymorphicValue
    | RelationshipPolymorphicValue[]
    | ((
        data: Record<string, unknown>
      ) =>
        | string
        | string[]
        | RelationshipPolymorphicValue
        | RelationshipPolymorphicValue[]);

  /**
   * Admin UI configuration options.
   */
  admin?: RelationshipFieldAdminOptions;

  /**
   * Custom validation function.
   *
   * Receives the relationship field value and returns `true` for valid
   * or an error message string for invalid.
   *
   * **Note:** When using `filterOptions` with a custom `validate`
   * function, the filter constraints are not automatically validated.
   * You should include filter validation in your custom function if needed.
   *
   * @param value - The relationship field value
   * @param args - Object containing document data and request context
   * @returns `true` if valid, or an error message string
   *
   * @example
   * ```typescript
   * // Require at least 2 categories
   * validate: (value) => {
   *   if (Array.isArray(value) && value.length < 2) {
   *     return 'Please select at least 2 categories';
   *   }
   *   return true;
   * }
   *
   * // Conditional requirement
   * validate: (value, { data }) => {
   *   if (data.featured && !value) {
   *     return 'Featured items must have an author';
   *   }
   *   return true;
   * }
   *
   * // Prevent self-reference
   * validate: (value, { data }) => {
   *   if (value === data.id) {
   *     return 'Cannot reference self';
   *   }
   *   return true;
   * }
   * ```
   */
  validate?: (
    value: RelationshipFieldValue,
    args: { data: Record<string, unknown>; req: RequestContext }
  ) => string | true | Promise<string | true>;
}
