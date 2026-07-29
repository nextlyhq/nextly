/**
 * Components Module - Public Exports
 *
 * Components are shared, reusable field group templates that can be
 * created independently and selected from within Collections and Singles.
 *
 * This module provides:
 * - `defineFieldGroup()` — Create code-first Component configurations
 * - `FieldGroupConfig` — Type definitions for Component configurations
 * - Validation functions for Component configurations
 *
 * @module field-groups
 * @since 1.0.0
 *
 * @example
 * ```typescript
 * import { defineFieldGroup, text, upload } from 'nextly';
 *
 * export default defineFieldGroup({
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
  defineFieldGroup,
  // Validation
  validateFieldGroupConfig,
  assertValidFieldGroupConfig,
  RESERVED_FIELD_GROUP_SLUGS,
  MAX_FIELD_GROUP_NESTING_DEPTH,
} from "./config";

export type {
  // Configuration types
  FieldGroupConfig,
  FieldGroupLabel,
  FieldGroupAdminOptions,
  // Validation types
  FieldGroupValidationErrorCode,
  FieldGroupValidationError,
  FieldGroupValidationResult,
} from "./config";
