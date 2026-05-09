import type { Control, FieldValues } from "react-hook-form";

import { SettingsSection } from "../SettingsSection";

import { SecretField } from "./SecretField";

// ============================================================
// API Key Configuration Fields (Resend / SendLayer)
// ============================================================

export function ApiKeyConfigFields({
  control,
  providerLabel,
}: {
  control: Control<FieldValues>;
  providerLabel: string;
}) {
  return (
    <SettingsSection label={`${providerLabel} Configuration`}>
      <SecretField
        control={control}
        name="apiKey"
        label="API Key"
        placeholder="Enter your API key"
        description="Leave blank to keep existing API key."
      />
    </SettingsSection>
  );
}
