/**
 * Library Utilities — Re-export
 *
 * Utilities have moved to `src/shared/lib/`. This file re-exports them
 * so existing imports continue to work.
 *
 * @module lib
 * @since 1.0.0
 */

// Field transformation utilities
export {
  transformForStorage,
  transformFromStorage,
  getSerializedFieldNames,
  requiresTransformation,
  type TransformOptions,
} from "./field-transform";

// Re-export other lib modules
export * from "./env";
export * from "./get-base-url";
export * from "./logger";
export {
  getMediaVariant,
  getSmallestMediaVariant,
  getMediaBaseUrl,
  toAbsoluteMediaUrl,
  absolutizeMediaUrls,
  type MediaLike,
  type GetMediaVariantOptions,
} from "./media-variant";
