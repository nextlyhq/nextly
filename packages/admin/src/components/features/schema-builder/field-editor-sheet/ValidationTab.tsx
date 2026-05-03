// Why: stub for the FieldEditorSheet shell. Full implementation in Task 16.
import type { BuilderField } from "../types";

type Props = {
  field: BuilderField;
  readOnly?: boolean;
  onChange: (next: BuilderField) => void;
};

export function ValidationTab(_: Props) {
  return <div data-testid="validation-tab-stub" />;
}
