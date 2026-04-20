/**
 * Shared Library Utilities
 *
 * Internal utility functions and helpers for Nextly.
 *
 * @module shared/lib
 * @since 1.0.0
 */

export * from "./case-conversion";
export * from "./date-formatting";
export * from "./env";
export {
  transformForStorage,
  transformFromStorage,
  getSerializedFieldNames,
  requiresTransformation,
  FieldTransformError,
  type TransformOptions,
  transformRichTextFields,
} from "./field-transform";
export * from "./logger";
export * from "./pluralization";
export * from "./rich-text-html";
