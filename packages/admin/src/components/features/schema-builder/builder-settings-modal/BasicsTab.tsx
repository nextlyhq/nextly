// Why: stub for the BuilderSettingsModal shell test. Full implementation in
// Task 11 — will render Singular/Plural/Slug/Description/Icon based on the
// `fields` prop from the per-kind config.
import type { BasicsField } from "../builder-config";
import type { BuilderSettingsValues } from "../BuilderSettingsModal";

type Props = {
  fields: readonly BasicsField[];
  values: BuilderSettingsValues;
  onChange: (next: BuilderSettingsValues) => void;
};

export function BasicsTab(_: Props) {
  return <div data-testid="basics-tab-stub" />;
}
