/**
 * Field Type Mapping Utilities
 *
 * Utilities for converting between database field types and form field types
 * used in collection schema definition.
 *
 * ## Context
 *
 * Collections store field definitions with specific types like "string", "number", etc.
 * The ContentTypeForm component uses different type strings like "TEXT", "NUMBER", etc.
 * These utilities handle the bidirectional mapping between the two systems.
 *
 * ## Usage
 *
 * - **mapFieldType**: Converts form type (e.g., "TEXT") → schema type (e.g., "string")
 * - **mapFieldTypeToForm**: Converts schema type (e.g., "string") → form type (e.g., "TEXT")
 *
 * @example
 * ```ts
 * import { mapFieldType, mapFieldTypeToForm } from '@admin/lib/field-type-mapping';
 *
 * // Converting from form to schema (for create/update operations)
 * const schemaType = mapFieldType("TEXT"); // "string"
 * const schemaType2 = mapFieldType("NUMBER"); // "number"
 *
 * // Converting from schema to form (for edit operations)
 * const formType = mapFieldTypeToForm("string"); // "TEXT"
 * const formType2 = mapFieldTypeToForm("richtext"); // "EDITOR"
 * ```
 *
 * @see types/collection.ts - Defines FieldDefinition schema types
 */

import type { FieldDefinition } from "../types/collection";

/**
 * Maps form field type to schema field type
 *
 * Converts the type string from ContentTypeForm (e.g., "TEXT", "NUMBER")
 * to the FieldDefinition type used in collection schemas (e.g., "string", "number").
 *
 * @param type - Form field type from ContentTypeForm
 * @returns Schema field type for FieldDefinition
 *
 * @example
 * ```ts
 * mapFieldType("TEXT")      // "string"
 * mapFieldType("TEXTAREA")  // "text"
 * mapFieldType("NUMBER")    // "number"
 * mapFieldType("EMAIL")     // "email"
 * mapFieldType("UNKNOWN")   // "string" (fallback)
 * ```
 */
export function mapFieldType(type: string): FieldDefinition["type"] {
  switch (type) {
    case "TEXT":
      return "string";
    case "TEXTAREA":
      return "text";
    case "NUMBER":
      return "number";
    case "BOOLEAN":
      return "boolean";
    case "DATE_PICKER":
      return "date";
    case "PASSWORD":
      return "password";
    case "EMAIL":
      return "email";
    case "RICHTEXT":
      return "richtext";
    case "JSON":
      return "json";
    case "RELATION":
      return "relation";
    case "CHIPS":
      return "chips";
    default:
      return "string"; // Safe fallback for unknown types
  }
}

/**
 * Maps schema field type to form field type
 *
 * Converts the FieldDefinition type from collection schemas (e.g., "string", "number")
 * to the type string expected by ContentTypeForm (e.g., "TEXT", "NUMBER").
 *
 * This is the inverse operation of mapFieldType(), used when loading existing
 * collection data into the edit form.
 *
 * @param type - Schema field type from FieldDefinition
 * @returns Form field type for ContentTypeForm
 *
 * @example
 * ```ts
 * mapFieldTypeToForm("string")    // "TEXT"
 * mapFieldTypeToForm("text")      // "TEXTAREA"
 * mapFieldTypeToForm("number")    // "NUMBER"
 * mapFieldTypeToForm("richtext")  // "EDITOR"
 * mapFieldTypeToForm("email")     // "EMAIL"
 * ```
 */
export function mapFieldTypeToForm(type: FieldDefinition["type"]): string {
  switch (type) {
    case "string":
      return "TEXT";
    case "text":
      return "TEXTAREA";
    case "number":
      return "NUMBER";
    case "boolean":
      return "BOOLEAN";
    case "date":
      return "DATE_PICKER";
    case "password":
      return "PASSWORD";
    case "email":
      return "EMAIL";
    case "richtext":
      return "EDITOR";
    case "json":
      return "JSON";
    case "relation":
      return "RELATION";
    case "chips":
      return "CHIPS";
    default:
      return "TEXT"; // Safe fallback for unknown types
  }
}
