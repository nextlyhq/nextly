// Why: stub for the FieldEditorSheet shell. Full implementation in Task 18.
import type { BuilderField } from "../types";

type Props = {
  field: BuilderField;
  readOnly?: boolean;
  onChange: (next: BuilderField) => void;
};

export function AdvancedTab(_: Props) {
  return <div data-testid="advanced-tab-stub" />;
}
