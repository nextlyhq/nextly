/**
 * Component Configuration Types
 *
 * Type definitions for Components (Reusable Field Groups).
 * Components are shared, reusable field structures that can be created
 * independently and then selected from within Collections and Singles.
 *
 * Key characteristics:
 * - Components are templates (schemas), not documents
 * - Each instance is unique to its parent entry
 * - Support all field types available in Collections
 * - Separate database table per component type (comp_{slug})
 * - Dual creation: Code-First (defineComponent) and Schema Builder
 *
 * @module components/config/types
 * @since 1.0.0
 */

import type { FieldConfig } from "../../collections/fields/types";

// ============================================================
// Component Labels
// ============================================================

/**
 * Display label for a Component.
 *
 * Components only need a singular label since the label is used
 * in the component selector, sidebar navigation, and builder UI.
 *
 * @example
 * ```typescript
 * const label: ComponentLabel = {
 *   singular: 'SEO Metadata',
 * };
 * ```
 */
export interface ComponentLabel {
  /**
   * Singular display name for the Component.
   * Used in the Admin UI sidebar, component selector, breadcrumbs,
   * and page titles.
   *
   * @example 'SEO Metadata', 'Hero Section', 'Call To Action'
   */
  singular: string;
}

// ============================================================
// Admin Options
// ============================================================

/**
 * Admin panel configuration options for a Component.
 *
 * Controls how the Component appears and behaves in the Admin UI,
 * including sidebar navigation, the component selector modal,
 * and the component builder page.
 *
 * @example
 * ```typescript
 * const admin: ComponentAdminOptions = {
 *   category: 'Shared',
 *   icon: 'Search',
 *   description: 'Search engine optimization metadata',
 * };
 * ```
 */
export interface ComponentAdminOptions {
  /**
   * Category for organizing Components in the sidebar and selection UI.
   *
   * Components with the same category appear together under a common
   * heading in the sidebar navigation and the component selector modal.
   *
   * @example 'Shared', 'Blocks', 'Elements', 'Layout'
   */
  category?: string;

  /**
   * Icon identifier for the Component.
   * Should be a valid icon name from the icon library (e.g., Lucide).
   * Displayed in the sidebar, component selector, and builder header.
   *
   * @example 'Search', 'Image', 'Link', 'Type', 'Layout'
   */
  icon?: string;

  /**
   * Hide the Component from Admin UI navigation.
   * The Component is still accessible via direct URL and API,
   * and can still be used in Collections and Singles.
   *
   * @default false
   */
  hidden?: boolean;

  /**
   * Description text displayed below the Component title.
   * Shown in the component selector modal and builder page
   * to provide helpful context for editors.
   *
   * @example 'Search engine optimization metadata for pages'
   */
  description?: string;

  /**
   * Preview image URL shown in the component selector.
   * Provides a visual preview of the Component's intended layout
   * or appearance to help editors choose the right component.
   *
   * @example '/images/components/hero-preview.png'
   */
  imageURL?: string;
}

// ============================================================
// Component Configuration
// ============================================================

/**
 * Complete Component configuration interface.
 *
 * This is the main interface for defining a Component in code.
 * Only `slug` and `fields` are required; all other properties have defaults.
 *
 * Components are reusable field group templates:
 * - Define a set of fields once as a Component
 * - Use the Component in multiple Collections and Singles
 * - Each usage creates a separate data instance in the Component's table
 * - Table naming: `comp_` prefix (e.g., `comp_seo`, `comp_hero`)
 *
 * @example
 * ```typescript
 * import { defineComponent, text, upload } from '@revnixhq/nextly';
 *
 * export default defineComponent({
 *   slug: 'seo',
 *   label: { singular: 'SEO Metadata' },
 *   admin: {
 *     category: 'Shared',
 *     icon: 'Search',
 *     description: 'Search engine optimization metadata',
 *   },
 *   fields: [
 *     text({ name: 'metaTitle', required: true, label: 'Meta Title' }),
 *     text({ name: 'metaDescription', label: 'Meta Description' }),
 *     upload({ name: 'metaImage', relationTo: 'media', label: 'OG Image' }),
 *     text({ name: 'canonicalUrl', label: 'Canonical URL' }),
 *   ],
 * });
 * ```
 *
 * @example Hero Section Component
 * ```typescript
 * import { defineComponent, text, upload, select } from '@revnixhq/nextly';
 *
 * export default defineComponent({
 *   slug: 'hero',
 *   label: { singular: 'Hero Section' },
 *   admin: {
 *     category: 'Blocks',
 *     icon: 'Image',
 *     description: 'Full-width hero banner with heading and CTA',
 *   },
 *   fields: [
 *     text({ name: 'heading', required: true, label: 'Heading' }),
 *     text({ name: 'subheading', label: 'Subheading' }),
 *     upload({ name: 'backgroundImage', relationTo: 'media', label: 'Background Image' }),
 *     text({ name: 'ctaText', label: 'CTA Button Text' }),
 *     text({ name: 'ctaLink', label: 'CTA Button Link' }),
 *     select({
 *       name: 'alignment',
 *       label: 'Content Alignment',
 *       options: [
 *         { label: 'Left', value: 'left' },
 *         { label: 'Center', value: 'center' },
 *         { label: 'Right', value: 'right' },
 *       ],
 *       defaultValue: 'center',
 *     }),
 *   ],
 * });
 * ```
 */
export interface ComponentConfig {
  /**
   * Unique identifier for the Component.
   *
   * Used as the database table name prefix and reference key.
   * Must be:
   * - Unique across all Components, Collections, AND Singles
   * - URL-friendly (lowercase, no spaces)
   * - Not a reserved name
   *
   * @example 'seo', 'hero', 'cta', 'social-link'
   */
  slug: string;

  /**
   * Field definitions for the Component.
   *
   * An array of field configurations that define the Component's structure.
   * Supports all field types available in Collections (text, number,
   * select, relationship, upload, array, group, json, etc.).
   *
   * @example
   * ```typescript
   * fields: [
   *   text({ name: 'heading', required: true }),
   *   text({ name: 'subheading' }),
   *   upload({ name: 'image', relationTo: 'media' }),
   * ]
   * ```
   */
  fields: FieldConfig[];

  /**
   * Display label for the Admin UI.
   * If not provided, the label is auto-generated from the slug
   * (e.g., 'social-link' becomes 'Social Link').
   *
   * @example
   * ```typescript
   * label: { singular: 'SEO Metadata' }
   * ```
   */
  label?: ComponentLabel;

  /**
   * Admin panel configuration options.
   * Controls how the Component appears in the Admin UI sidebar,
   * component selector, and builder page.
   */
  admin?: ComponentAdminOptions;

  /**
   * Custom database table name.
   *
   * If not specified, the table name is generated from the slug
   * with a `comp_` prefix (e.g., 'seo' -> 'comp_seo').
   *
   * @example 'comp_site_seo', 'component_hero'
   */
  dbName?: string;

  /**
   * Description of the Component.
   *
   * Displayed in the Admin UI and used for documentation.
   * If not provided, falls back to `admin.description`.
   */
  description?: string;

  /**
   * Custom metadata for plugins and extensions.
   *
   * Store arbitrary data that can be accessed by hooks, plugins,
   * or custom code. Not persisted to the database.
   *
   * @example
   * ```typescript
   * custom: {
   *   previewTemplate: 'hero-preview',
   *   allowedCollections: ['pages', 'posts'],
   * }
   * ```
   */
  custom?: Record<string, unknown>;
}
