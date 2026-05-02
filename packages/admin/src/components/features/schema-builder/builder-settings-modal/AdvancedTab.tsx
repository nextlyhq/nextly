// Why: stub for the BuilderSettingsModal shell test. Full implementation in
// Task 12 — will render Admin group / Category / Order / useAsTitle /
// Status (Draft/Published) / i18n placeholder / Timestamps based on the
// `fields` prop from the per-kind config.
import type { AdvancedField } from "../builder-config";
import type { BuilderSettingsValues } from "../BuilderSettingsModal";

type Props = {
  fields: readonly AdvancedField[];
  values: BuilderSettingsValues;
  onChange: (next: BuilderSettingsValues) => void;
};

export function AdvancedTab(_: Props) {
  return <div data-testid="advanced-tab-stub" />;
}
