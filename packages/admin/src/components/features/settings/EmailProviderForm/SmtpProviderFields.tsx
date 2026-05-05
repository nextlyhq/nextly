import { Input, Switch } from "@revnixhq/ui";
import type { Control, FieldValues } from "react-hook-form";

import {
  FormControl,
  FormField,
  FormItem,
  FormMessage,
} from "@admin/components/ui/form";

import { SettingsRow } from "../SettingsRow";
import { SettingsSection } from "../SettingsSection";

import { SecretField } from "./SecretField";

// ============================================================
// SMTP Configuration Fields
// ============================================================

export function SmtpConfigFields({
  control,
}: {
  control: Control<FieldValues>;
}) {
  return (
    <SettingsSection label="SMTP Configuration">
      <FormField
        control={control}
        name="smtpHost"
        render={({ field }) => (
          <FormItem className="m-0">
            <SettingsRow
              label="SMTP Host"
              description="Hostname of your SMTP server."
            >
              <FormControl>
                <Input placeholder="smtp.example.com" {...field} />
              </FormControl>
              <FormMessage className="mt-1.5" />
            </SettingsRow>
          </FormItem>
        )}
      />

      <FormField
        control={control}
        name="smtpPort"
        render={({ field }) => (
          <FormItem className="m-0">
            <SettingsRow
              label="SMTP Port"
              description="Common ports: 25, 587, 465."
            >
              <FormControl>
                <Input
                  type="number"
                  placeholder="587"
                  {...field}
                  onChange={e => field.onChange(e.target.valueAsNumber || "")}
                />
              </FormControl>
              <FormMessage className="mt-1.5" />
            </SettingsRow>
          </FormItem>
        )}
      />

      <FormField
        control={control}
        name="smtpSecure"
        render={({ field }) => (
          <FormItem className="m-0">
            <SettingsRow
              label="Use Secure Connection (SSL/TLS)"
              description="Enable SSL/TLS encryption for the SMTP connection. Required for port 465."
            >
              <FormControl>
                <Switch
                  checked={field.value}
                  onCheckedChange={field.onChange}
                />
              </FormControl>
              <FormMessage className="mt-1.5" />
            </SettingsRow>
          </FormItem>
        )}
      />

      <FormField
        control={control}
        name="smtpUsername"
        render={({ field }) => (
          <FormItem className="m-0">
            <SettingsRow
              label="SMTP Username"
              description="Account used to authenticate against the SMTP server."
            >
              <FormControl>
                <Input placeholder="user@example.com" {...field} />
              </FormControl>
              <FormMessage className="mt-1.5" />
            </SettingsRow>
          </FormItem>
        )}
      />

      <SecretField
        control={control}
        name="smtpPassword"
        label="SMTP Password"
        placeholder="Enter password"
        description="Leave blank to keep existing password."
      />
    </SettingsSection>
  );
}
