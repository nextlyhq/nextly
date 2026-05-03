// Why: stub for the FieldEditorSheet shell. Full implementation in Task 17.
import type { BuilderField } from "../types";

type Props = {
  field: BuilderField;
  readOnly?: boolean;
  onChange: (next: BuilderField) => void;
};

export function AdminTab(_: Props) {
  return <div data-testid="admin-tab-stub" />;
}
