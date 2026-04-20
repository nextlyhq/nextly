/**
 * Join Field Type
 *
 * A virtual field type for displaying reverse relationships - entries from
 * another collection that reference the current document. Join fields query
 * related entries at read time and are display-only (no data storage).
 *
 * This enables bi-directional relationship views without duplicating data.
 * For example, when viewing a Category, you can display all Posts that
 * reference that category through a relationship field.
 *
 * Inspired by modern CMS join field patterns.
 *
 * @module collections/fields/types/join
 * @since 1.0.0
 */

import type { FieldAdminOptions } from "./base";

// ============================================================
// Join Field Admin Options
// ============================================================

/**
 * Admin panel options specific to join fields.
 *
 * Controls how the joined entries are displayed in the Admin Panel,
 * including navigation options and display columns.
 */
export interface JoinFieldAdminOptions
  extends Omit<FieldAdminOptions, "placeholder" | "readOnly" | "components"> {
  /**
   * Allow navigating to joined entries.
   *
   * When `true`, joined entries are displayed as clickable links
   * that navigate to the entry's edit page.
   *
   * @default true
   */
  allowNavigation?: boolean;

  /**
   * Field names to display in the joined entries list.
   *
   * Controls which columns appear when displaying joined entries.
   * If not specified, uses the collection's default display fields.
   *
   * @example
   * ```typescript
   * defaultColumns: ['title', 'status', 'createdAt']
   * ```
   */
  defaultColumns?: string[];

  /**
   * Allow creating new related documents from the join field.
   *
   * When `true`, displays a "Create New" button that opens a modal
   * to create a new entry in the joined collection with the relationship
   * pre-filled to point to the current document.
   *
   * @default false
   */
  allowCreate?: boolean;
}

// ============================================================
// Join Field Where Clause
// ============================================================

/**
 * Where clause for filtering joined entries.
 *
 * Uses the same query syntax as relationship filters.
 * Can filter joined entries based on any of their fields.
 *
 * @example
 * ```typescript
 * // Only show published posts
 * where: { status: { equals: 'published' } }
 *
 * // Only show recent posts
 * where: { createdAt: { greater_than: '2024-01-01' } }
 * ```
 */
export type JoinFieldWhere = Record<string, unknown>;

// ============================================================
// Join Field Configuration
// ============================================================

/**
 * Configuration interface for join fields.
 *
 * Join fields display entries from another collection that reference
 * the current document through a relationship or upload field. They
 * are virtual (no data storage) and query related entries at read time.
 *
 * **Key Features:**
 * - Display reverse relationships (bi-directional)
 * - No data duplication (single source of truth)
 * - Configurable filtering and sorting
 * - Optional navigation to related entries
 * - Read-only display (entries edited from their own collection)
 *
 * **How It Works:**
 * 1. Define a join field on the "parent" collection (e.g., Categories)
 * 2. Specify which collection contains the referencing field (e.g., Posts)
 * 3. Specify the field name that references this collection (e.g., 'category')
 * 4. The Admin Panel queries Posts where category equals the current Category ID
 *
 * **Use Cases:**
 * - Show all Posts in a Category
 * - Show all Orders for a Customer
 * - Show all Comments on a Post
 * - Show all Products in a Collection
 * - Show all Team Members in a Department
 *
 * @example
 * ```typescript
 * // Basic join field - show posts that reference this category
 * const relatedPosts: JoinFieldConfig = {
 *   name: 'posts',
 *   type: 'join',
 *   label: 'Posts in this Category',
 *   collection: 'posts',
 *   on: 'category', // Field in posts that references categories
 * };
 *
 * // Join field with filtering and sorting
 * const publishedPosts: JoinFieldConfig = {
 *   name: 'publishedPosts',
 *   type: 'join',
 *   label: 'Published Posts',
 *   collection: 'posts',
 *   on: 'category',
 *   where: {
 *     status: { equals: 'published' },
 *   },
 *   defaultSort: '-publishedAt', // Newest first
 *   defaultLimit: 5,
 * };
 *
 * // Join field with nested relationship path (dot notation)
 * const authorPosts: JoinFieldConfig = {
 *   name: 'authorPosts',
 *   type: 'join',
 *   label: 'Posts by this Author',
 *   collection: 'posts',
 *   on: 'metadata.author', // Nested field path
 * };
 *
 * // Join field for orders on a customer collection
 * const customerOrders: JoinFieldConfig = {
 *   name: 'orders',
 *   type: 'join',
 *   label: 'Customer Orders',
 *   collection: 'orders',
 *   on: 'customer',
 *   defaultSort: '-createdAt',
 *   defaultLimit: 10,
 *   admin: {
 *     defaultColumns: ['orderNumber', 'total', 'status', 'createdAt'],
 *     allowNavigation: true,
 *   },
 * };
 *
 * // Join field in a collection
 * const categoriesCollection = {
 *   slug: 'categories',
 *   fields: [
 *     { name: 'name', type: 'text', required: true },
 *     { name: 'slug', type: 'slug', from: 'name' },
 *     {
 *       name: 'posts',
 *       type: 'join',
 *       label: 'Posts in Category',
 *       collection: 'posts',
 *       on: 'category',
 *       defaultSort: '-createdAt',
 *       admin: {
 *         position: 'sidebar',
 *         defaultColumns: ['title', 'status'],
 *       },
 *     },
 *   ],
 * };
 * ```
 */
export interface JoinFieldConfig {
  /**
   * Field type identifier. Must be 'join'.
   */
  type: "join";

  /**
   * Unique identifier for this join field.
   *
   * Used for UI identification and field targeting.
   * Does not create a database column (virtual field).
   */
  name: string;

  /**
   * Display label for the field in the Admin Panel.
   *
   * If not provided, a label is generated from the field name.
   *
   * @example 'Posts in this Category'
   */
  label?: string;

  /**
   * Collection slug that contains the referencing relationship field.
   *
   * This is the collection whose entries will be displayed.
   * The collection must have a relationship or upload field that
   * references the collection containing this join field.
   *
   * @example 'posts' // Posts collection has a 'category' relationship field
   */
  collection: string;

  /**
   * Name of the relationship or upload field that references this collection.
   *
   * Supports dot notation for nested fields (e.g., 'metadata.author').
   * This field in the joined collection must reference the collection
   * that contains this join field.
   *
   * @example 'category' // Posts.category references Categories
   * @example 'metadata.author' // Nested relationship path
   */
  on: string;

  /**
   * Where clause to filter joined entries.
   *
   * Applies additional filtering to the joined entries beyond
   * the relationship match. Uses Nextly where clause syntax.
   *
   * @example
   * ```typescript
   * // Only show published entries
   * where: { status: { equals: 'published' } }
   * ```
   */
  where?: JoinFieldWhere;

  /**
   * Maximum number of joined entries to display.
   *
   * Set to 0 to display all matching entries (use with caution).
   *
   * @default 10
   */
  defaultLimit?: number;

  /**
   * Field name to sort joined entries by.
   *
   * Prefix with `-` for descending order.
   *
   * @example '-createdAt' // Newest first
   * @example 'title' // Alphabetical by title
   */
  defaultSort?: string;

  /**
   * Maximum depth for populating relationships in joined entries.
   *
   * Controls how deeply related documents are populated.
   * Set to 0 to return only IDs.
   *
   * @default 1
   */
  maxDepth?: number;

  /**
   * Admin UI configuration options.
   */
  admin?: JoinFieldAdminOptions;
}
