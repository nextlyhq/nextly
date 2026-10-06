/**
 * How a parent's field-group instances are selected: by the parent row, the
 * parent table and the field, in their stored order.
 *
 * Shared by the query and mutation services, which both read a parent's
 * existing instances and must agree on which rows those are and in what
 * order.
 *
 * @module domains/field-groups/services/instance-query
 */
import { STORAGE_FORMAT } from "../../../schemas/storage-format";

/** The equality conditions that pick one parent field's instances. */
export function instanceKey(
  parentId: string,
  parentTable: string,
  fieldName: string
): Record<string, string> {
  return {
    [STORAGE_FORMAT.columns.parentId]: parentId,
    [STORAGE_FORMAT.columns.parentTable]: parentTable,
    [STORAGE_FORMAT.columns.parentField]: fieldName,
  };
}

/** Instances in the order they were stored. */
export const INSTANCE_ORDER = [
  { column: STORAGE_FORMAT.columns.order, direction: "asc" as const },
];
