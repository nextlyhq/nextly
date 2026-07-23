"use client";

/**
 * WebhookForm — presentational create/edit form for a webhook endpoint.
 *
 * The parent owns the mutation: this emits validated `WebhookFormValues` plus a
 * `headersDirty` flag (the parent maps to a create or a minimal-patch update).
 * Header values are never seeded back from a read — they are hidden and start
 * empty — so the form makes the "leave untouched or re-enter the whole set"
 * contract explicit rather than echoing the redacted placeholder.
 */

import { zodResolver } from "@hookform/resolvers/zod";
import {
  Alert,
  AlertDescription,
  Button,
  Checkbox,
  Input,
  Switch,
} from "@nextlyhq/ui";
import type React from "react";
import { Controller, useFieldArray, useForm } from "react-hook-form";

import {
  SettingsRow,
  SettingsSection,
} from "@admin/components/features/settings";
import { Info, Loader2, Plus, Trash2 } from "@admin/components/icons";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormMessage,
} from "@admin/components/ui/form";
import { Link } from "@admin/components/ui/link";
import { ROUTES } from "@admin/constants/routes";
import {
  webhookFormSchema,
  type WebhookFormValues,
} from "@admin/lib/webhook-validation";
import { WEBHOOK_EVENT_TYPES } from "@admin/types/webhooks";

const EMPTY_VALUES: WebhookFormValues = {
  name: "",
  url: "",
  allEvents: false,
  eventTypes: [],
  headers: [],
  clearExistingHeaders: false,
  enabled: true,
};

export interface WebhookFormProps {
  defaultValues?: WebhookFormValues;
  /** Names of headers already configured (values are hidden), shown read-only. */
  existingHeaderNames?: string[];
  onSubmit: (values: WebhookFormValues) => void;
  isPending: boolean;
  submitLabel: string;
  pendingLabel: string;
}

export const WebhookForm: React.FC<WebhookFormProps> = ({
  defaultValues,
  existingHeaderNames,
  onSubmit,
  isPending,
  submitLabel,
  pendingLabel,
}) => {
  const form = useForm<WebhookFormValues>({
    resolver: zodResolver(webhookFormSchema),
    defaultValues: defaultValues ?? EMPTY_VALUES,
  });

  const headers = useFieldArray({ control: form.control, name: "headers" });
  const allEvents = form.watch("allEvents");
  const selectedTypes = form.watch("eventTypes");
  const clearExistingHeaders = form.watch("clearExistingHeaders");
  const hasExistingHeaders = (existingHeaderNames?.length ?? 0) > 0;

  const toggleEventType = (type: (typeof WEBHOOK_EVENT_TYPES)[number]) => {
    const next = selectedTypes.includes(type)
      ? selectedTypes.filter(value => value !== type)
      : [...selectedTypes, type];
    form.setValue("eventTypes", next, { shouldValidate: true });
  };

  const handleSubmit = (values: WebhookFormValues) => {
    onSubmit(values);
  };

  const eventError = form.formState.errors.eventTypes?.message;
  const headersError =
    typeof form.formState.errors.headers?.message === "string"
      ? form.formState.errors.headers.message
      : undefined;

  return (
    <Form {...form}>
      <form
        onSubmit={e => {
          void form.handleSubmit(handleSubmit)(e);
        }}
        className="space-y-6"
      >
        <SettingsSection label="Endpoint">
          <FormField
            control={form.control}
            name="name"
            render={({ field }) => (
              <FormItem>
                <SettingsRow
                  label="Name"
                  description="A label to identify this endpoint."
                >
                  <FormControl>
                    <Input
                      placeholder="e.g. Orders sync"
                      autoFocus
                      disabled={isPending}
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </SettingsRow>
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="url"
            render={({ field }) => (
              <FormItem>
                <SettingsRow
                  label="Payload URL"
                  description="The HTTPS endpoint that receives signed events."
                >
                  <FormControl>
                    <Input
                      placeholder="https://example.com/webhooks"
                      inputMode="url"
                      disabled={isPending}
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </SettingsRow>
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="enabled"
            render={({ field }) => (
              <FormItem>
                <SettingsRow
                  label="Enabled"
                  description="Disabled endpoints receive no deliveries."
                >
                  <FormControl>
                    <Switch
                      checked={field.value}
                      onCheckedChange={field.onChange}
                      disabled={isPending}
                    />
                  </FormControl>
                  <FormMessage />
                </SettingsRow>
              </FormItem>
            )}
          />
        </SettingsSection>

        <SettingsSection label="Events">
          <SettingsRow
            label="Subscription"
            description="Choose which events are delivered to this endpoint."
          >
            <div className="space-y-3">
              <label className="flex items-center gap-2 text-sm font-medium text-foreground">
                <Controller
                  control={form.control}
                  name="allEvents"
                  render={({ field }) => (
                    <Switch
                      checked={field.value}
                      onCheckedChange={value => {
                        field.onChange(value);
                        // The wildcard must be used alone; clear specifics.
                        if (value)
                          form.setValue("eventTypes", [], {
                            shouldValidate: true,
                          });
                      }}
                      disabled={isPending}
                    />
                  )}
                />
                All events (current and future)
              </label>

              {!allEvents && (
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  {WEBHOOK_EVENT_TYPES.map(type => (
                    <label
                      key={type}
                      className="flex items-center gap-2 text-sm text-foreground"
                    >
                      <Checkbox
                        checked={selectedTypes.includes(type)}
                        onCheckedChange={() => toggleEventType(type)}
                        disabled={isPending}
                      />
                      <code className="font-mono text-xs">{type}</code>
                    </label>
                  ))}
                </div>
              )}

              {eventError && (
                <p className="text-sm text-destructive-500">{eventError}</p>
              )}
            </div>
          </SettingsRow>
        </SettingsSection>

        <SettingsSection label="Custom headers">
          <SettingsRow
            label="Headers"
            description="Optional static headers sent with every delivery."
          >
            <div className="space-y-3">
              {hasExistingHeaders && (
                <Alert variant="info" role="status">
                  <Info className="h-4 w-4" />
                  <AlertDescription>
                    Currently sending {existingHeaderNames?.length} header
                    {existingHeaderNames?.length === 1 ? "" : "s"} (values
                    hidden): {existingHeaderNames?.join(", ")}. Leave this
                    section empty to keep them, add headers to replace the whole
                    set, or remove them all below.
                  </AlertDescription>
                </Alert>
              )}

              {hasExistingHeaders && (
                <label className="flex items-center gap-2 text-sm text-foreground">
                  <Controller
                    control={form.control}
                    name="clearExistingHeaders"
                    render={({ field }) => (
                      <Switch
                        checked={field.value}
                        onCheckedChange={field.onChange}
                        disabled={isPending}
                      />
                    )}
                  />
                  Remove all current headers
                </label>
              )}

              {!clearExistingHeaders &&
                headers.fields.map((row, index) => (
                  <div key={row.id} className="flex items-start gap-2">
                    <FormField
                      control={form.control}
                      name={`headers.${index}.name`}
                      render={({ field }) => (
                        <FormItem className="flex-1">
                          <FormControl>
                            <Input
                              placeholder="Header name"
                              disabled={isPending}
                              {...field}
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name={`headers.${index}.value`}
                      render={({ field }) => (
                        <FormItem className="flex-1">
                          <FormControl>
                            <Input
                              placeholder="Value"
                              disabled={isPending}
                              {...field}
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <Button
                      type="button"
                      variant="outline"
                      size="icon-sm"
                      onClick={() => headers.remove(index)}
                      disabled={isPending}
                      aria-label="Remove header"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                ))}

              {headersError && !clearExistingHeaders && (
                <p className="text-sm text-destructive-500">{headersError}</p>
              )}

              {clearExistingHeaders ? (
                <p className="text-sm text-muted-foreground">
                  All current headers will be removed on save.
                </p>
              ) : (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => headers.append({ name: "", value: "" })}
                  disabled={isPending}
                >
                  <Plus className="h-4 w-4" />
                  Add header
                </Button>
              )}
            </div>
          </SettingsRow>
        </SettingsSection>

        <div className="flex justify-end gap-3">
          <Link href={ROUTES.SETTINGS_WEBHOOKS}>
            <Button type="button" variant="outline" disabled={isPending}>
              Cancel
            </Button>
          </Link>
          <Button type="submit" disabled={isPending}>
            {isPending ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                {pendingLabel}
              </>
            ) : (
              submitLabel
            )}
          </Button>
        </div>
      </form>
    </Form>
  );
};
