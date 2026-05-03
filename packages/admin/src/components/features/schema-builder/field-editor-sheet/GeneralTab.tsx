// Why: stub for the FieldEditorSheet shell. Full implementation in Task 15.
import type { BuilderField } from "../types";

type Props = {
  field: BuilderField;
  siblingNames: readonly string[];
  readOnly?: boolean;
  onChange: (next: BuilderField) => void;
};

export function GeneralTab(_: Props) {
  return <div data-testid="general-tab-stub" />;
}
