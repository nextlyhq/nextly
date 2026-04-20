/**
 * Component Field Type
 *
 * Defines the component field configuration for embedding Components
 * (reusable field groups) within Collections, Singles, or other Components.
 *
 * Component fields support three embedding modes:
 * - **Single component:** Embed one specific component type (like a typed group)
 * - **Multi-component (dynamic zone):** Allow editors to pick from multiple types
 * - **Repeatable:** Either mode can be repeated as an array of instances
 *
 * Components support nesting: a component's fields can include component
 * fields referencing other components (max depth: 3 levels).
 *
 * @module collections/fields/types/component
 * @since 1.0.0
 */

import type { BaseFieldConfig } from "./base";

// ============================================================
// Component Field Configuration
// ============================================================

/**
 * Component field configuration.
 *
 * Embeds a component (or selection of components) within a Collection,
 * Single, or another Component.
 *
 * **Modes:**
 * - `component: 'seo'` — embeds one specific component type (single mode)
 * - `components: ['hero', 'cta']` — dynamic zone, editor picks type (multi mode)
 *
 * Each mode supports `repeatable: true` for arrays of component instances.
 *
 * @example Single component mode
 * ```typescript
 * import { component } from '@revnixhq/nextly';
 *
 * // Embed one specific component type
 * component({
 *   name: 'seo',
 *   component: 'seo',
 * })
 * ```
 *
 * @example Multi-component mode (dynamic zone)
 * ```typescript
 * import { component } from '@revnixhq/nextly';
 *
 * // Allow editors to pick from multiple component types
 * component({
 *   name: 'layout',
 *   components: ['hero', 'cta', 'content'],
 *   repeatable: true,
 * })
 * ```
 *
 * @example Repeatable single component
 * ```typescript
 * import { component } from '@revnixhq/nextly';
 *
 * // Array of the same component type
 * component({
 *   name: 'features',
 *   component: 'feature-card',
 *   repeatable: true,
 *   minRows: 1,
 *   maxRows: 12,
 * })
 * ```
 */
export interface ComponentFieldConfig extends BaseFieldConfig {
  type: "component";

  /**
   * Single component mode: embed one specific component type.
   * Mutually exclusive with `components`.
   *
   * @example 'seo'
   */
  component?: string;

  /**
   * Multi-component mode (dynamic zone): allow editor to pick from
   * multiple component types.
   * Mutually exclusive with `component`.
   *
   * @example ['hero', 'cta', 'content', 'image-gallery']
   */
  components?: string[];

  /**
   * Whether this field allows multiple instances (array).
   * - `false`: single instance (like group)
   * - `true`: repeatable array of instances (like array)
   *
   * @default false
   */
  repeatable?: boolean;

  /**
   * Minimum number of instances (when `repeatable: true`).
   */
  minRows?: number;

  /**
   * Maximum number of instances (when `repeatable: true`).
   */
  maxRows?: number;

  /**
   * Admin UI options for the component field.
   */
  admin?: BaseFieldConfig["admin"] & {
    /**
     * Whether component instances start collapsed in the form.
     * @default false
     */
    initCollapsed?: boolean;

    /**
     * Whether instances can be reordered via drag-and-drop.
     * Only applies when `repeatable: true`.
     * @default true
     */
    isSortable?: boolean;
  };
}
