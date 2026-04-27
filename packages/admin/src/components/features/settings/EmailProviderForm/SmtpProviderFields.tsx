import { Input, Switch } from "@revnixhq/ui";
import type { Control, type FieldValues } from "react-hook-form";

import {
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@admin/components/ui/form";

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
    <div className="space-y-4">
      <h3 className="text-sm font-medium text-foreground">
        SMTP Configuration
      </h3>

      <div className="grid gap-4 md:grid-cols-2">
        <FormField
          control={control}
          name="smtpHost"
          render={({ field }) => (
            <FormItem>
              <FormLabel>SMTP Host</FormLabel>
              <FormControl>
                <Input placeholder="smtp.example.com" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={control}
          name="smtpPort"
          render={({ field }) => (
            <FormItem>
              <FormLabel>SMTP Port</FormLabel>
              <FormControl>
                <Input
                  type="number"
                  placeholder="587"
                  {...field}
                  onChange={e => field.onChange(e.target.valueAsNumber || "")}
                />
              </FormControl>
              <FormDescription>Common ports: 25, 587, 465</FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />
      </div>

      <FormField
        control={control}
        name="smtpSecure"
        render={({ field }) => (
          <FormItem className="flex items-center justify-between rounded-lg border border-border p-4">
            <div className="space-y-0.5">
              <FormLabel>Use Secure Connection (SSL/TLS)</FormLabel>
              <FormDescription>
                Enable SSL/TLS encryption for the SMTP connection. Required for
                port 465.
              </FormDescription>
            </div>
            <FormControl>
              <Switch checked={field.value} onCheckedChange={field.onChange} />
            </FormControl>
          </FormItem>
        )}
      />

      <div className="grid gap-4 md:grid-cols-2">
        <FormField
          control={control}
          name="smtpUsername"
          render={({ field }) => (
            <FormItem>
              <FormLabel>SMTP Username</FormLabel>
              <FormControl>
                <Input placeholder="user@example.com" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <SecretField
          control={control}
          name="smtpPassword"
          label="SMTP Password"
          placeholder="Enter password"
          description="Leave blank to keep existing password"
        />
      </div>
    </div>
  );
}
