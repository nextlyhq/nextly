import type { BuilderField } from "@admin/components/features/schema-builder/types";

export type PendingChangeKind =
  | "added"
  | "deleted"
  | "moved"
  | "renamed"
  | "typeChanged"
  | "settings";

export interface PendingChange {
  kind: PendingChangeKind;
  fieldId: string;
  label: string;
  name: string;
  previousName?: string;
  type: string;
  previousType?: string;
  inside?: number;
}

export type RowMark = "new" | "changed" | "moved" | "deleted";

export function pendingChanges(
  _baseline: readonly BuilderField[],
  _current: readonly BuilderField[]
): PendingChange[] {
  return [];
}

export function rowMarks(
  _baseline: readonly BuilderField[],
  _current: readonly BuilderField[]
): Map<string, Set<RowMark>> {
  return new Map();
}
