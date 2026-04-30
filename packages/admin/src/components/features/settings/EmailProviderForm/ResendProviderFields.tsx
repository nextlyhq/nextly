import type { Control, FieldValues } from "react-hook-form";

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
    <div className="space-y-4">
      <h3 className="text-sm font-medium text-foreground">
        {providerLabel} Configuration
      </h3>
      <SecretField
        control={control}
        name="apiKey"
        label="API Key"
        placeholder="Enter your API key"
        description="Leave blank to keep existing API key"
      />
    </div>
  );
}
