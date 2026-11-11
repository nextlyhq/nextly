import type { BuilderField } from "@admin/components/features/schema-builder/types";

export function fieldsWithDeleted(
  current: readonly BuilderField[],
  _saved: readonly BuilderField[]
): readonly BuilderField[] {
  return current;
}
