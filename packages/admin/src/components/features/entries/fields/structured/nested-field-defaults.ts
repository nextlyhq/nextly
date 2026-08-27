/**
 * Nested Field Defaults Helper
 *
 * Computes the values a newly appended component or repeater row holds before
 * anyone edits it.
 *
 * The values themselves come from `getDefaultValues`, which is the same
 * function the surrounding create form seeds itself from. A row appended inside
 * a form must start where an identical field would start at the top level, so
 * this asks that question rather than answering it a second time — a parallel
 * table drifts silently, and every divergence it grew (text `hasMany`, select
 * multiplicity, relational `hasMany`) reached a user as a row that failed
 * validation before it was touched.
 *
 * What remains here is the part the canonical helper has no reason to know
 * about: a dynamic-zone row carries a discriminator naming which component it
 * is, and that is layered on top of the seeded values.
 *
 * @module components/entries/fields/structured/nested-field-defaults
 */

import type { FieldConfig } from "nextly/config";
import { writeFieldGroupType } from "nextly/field-group-type";

import { getDefaultValues } from "@admin/lib/form/default-values";

export interface CreateDefaultFieldValuesOptions {
  /**
   * Optional component type slug (for multi-component / dynamic zone instances).
   * When provided, writes the field group type discriminator onto the returned object.
   */
  componentType?: string;
}

/**
 * Computes default values for an array of nested sub-fields based on schema configuration.
 *
 * @param fields - Array of sub-field configurations from the schema
 * @param options - Optional configuration options including componentType discriminator
 * @returns An object containing default field values mapped by field name
 */
export function createDefaultFieldValues(
  fields: FieldConfig[] | undefined,
  options?: CreateDefaultFieldValuesOptions
): Record<string, unknown> {
  const defaultValues: Record<string, unknown> = {};

  // In multi-component mode, record the field group discriminator
  if (options?.componentType) {
    writeFieldGroupType(defaultValues, options.componentType);
  }

  if (!fields) return defaultValues;

  return Object.assign(defaultValues, getDefaultValues(fields));
}
