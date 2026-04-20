/**
 * Components Module - Public Exports
 *
 * Components are shared, reusable field group templates that can be
 * created independently and selected from within Collections and Singles.
 *
 * This module provides:
 * - `defineComponent()` — Create code-first Component configurations
 * - `ComponentConfig` — Type definitions for Component configurations
 * - Validation functions for Component configurations
 *
 * @module components
 * @since 1.0.0
 *
 * @example
 * ```typescript
 * import { defineComponent, text, upload } from '@revnixhq/nextly';
 *
 * export default defineComponent({
 *   slug: 'seo',
 *   label: { singular: 'SEO Metadata' },
 *   fields: [
 *     text({ name: 'metaTitle', required: true }),
 *     upload({ name: 'metaImage', relationTo: 'media' }),
 *   ],
 * });
 * ```
 */

export {
  // Define helper
  defineComponent,
  // Validation
  validateComponentConfig,
  assertValidComponentConfig,
  RESERVED_COMPONENT_SLUGS,
  MAX_COMPONENT_NESTING_DEPTH,
} from "./config";

export type {
  // Configuration types
  ComponentConfig,
  ComponentLabel,
  ComponentAdminOptions,
  // Validation types
  ComponentValidationErrorCode,
  ComponentValidationError,
  ComponentValidationResult,
} from "./config";
