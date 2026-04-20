/**
 * Define Component Helper
 *
 * Provides the `defineComponent()` function for creating code-first Component
 * configurations with full TypeScript support. This is the primary API for
 * defining Components (reusable field groups) in TypeScript files.
 *
 * Components are shared, reusable field structures that can be independently
 * created and then selected from within Collections and Singles.
 *
 * Key characteristics:
 * - Components are templates (schemas), not documents
 * - Each instance is unique to its parent entry
 * - Support all field types including nested components (max depth: 3)
 * - Separate database table per component type (comp_{slug})
 *
 * @module components/config/define-component
 * @since 1.0.0
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
 */

import type {
  ComponentConfig,
  ComponentLabel,
  ComponentAdminOptions,
} from "./types";
import { assertValidComponentConfig } from "./validate-component";

// ============================================================
// Utility Functions
// ============================================================

/**
 * Converts a slug to title case for display.
 *
 * @param str - The string to convert
 * @returns Title-cased string
 *
 * @example
 * ```typescript
 * toTitleCase('social-link') // 'Social Link'
 * toTitleCase('hero_section') // 'Hero Section'
 * toTitleCase('seo') // 'Seo'
 * ```
 */
function toTitleCase(str: string): string {
  return str.replace(/[-_]/g, " ").replace(/\b\w/g, char => char.toUpperCase());
}

// ============================================================
// defineComponent Function
// ============================================================

/**
 * Define a code-first Component with full type safety.
 *
 * This is the primary API for creating Component configurations in TypeScript.
 * It validates the configuration, applies sensible defaults, and returns a
 * normalized `ComponentConfig` object.
 *
 * **Defaults Applied:**
 * - `label.singular`: Generated from slug (e.g., 'social-link' → 'Social Link')
 * - `admin`: Empty object if not provided
 *
 * **Validation:**
 * - Slug must be valid (lowercase, URL-friendly, not reserved)
 * - Fields array must be non-empty
 * - Component field references validated (single vs multi mode)
 *
 * @param config - The Component configuration
 * @returns Normalized Component configuration with defaults applied
 * @throws Error if configuration is invalid
 *
 * @example Basic Component
 * ```typescript
 * import { defineComponent, text } from '@revnixhq/nextly';
 *
 * export default defineComponent({
 *   slug: 'seo',
 *   fields: [
 *     text({ name: 'metaTitle', required: true }),
 *     text({ name: 'metaDescription' }),
 *   ],
 * });
 * ```
 *
 * @example Component with Admin Options
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
 *
 * @example Component with Nested Component Field
 * ```typescript
 * import { defineComponent, text, component } from '@revnixhq/nextly';
 *
 * export default defineComponent({
 *   slug: 'faq-item',
 *   label: { singular: 'FAQ Item' },
 *   fields: [
 *     text({ name: 'question', required: true }),
 *     text({ name: 'answer', required: true }),
 *     component({ name: 'cta', component: 'cta' }),
 *   ],
 * });
 * ```
 */
export function defineComponent(config: ComponentConfig): ComponentConfig {
  // ============================================================
  // Comprehensive Validation
  // ============================================================

  assertValidComponentConfig(config);

  // ============================================================
  // Apply Defaults
  // ============================================================

  // Generate label from slug if not provided
  const label: ComponentLabel = {
    singular: config.label?.singular ?? toTitleCase(config.slug),
  };

  // Build normalized config with defaults
  const normalized: ComponentConfig = {
    ...config,
    label,
    admin: {
      ...config.admin,
    },
  };

  return normalized;
}

// ============================================================
// Re-exports for Convenience
// ============================================================

export type { ComponentConfig, ComponentLabel, ComponentAdminOptions };
