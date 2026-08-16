"use client";

/**
 * WebhookForm — presentational create/edit form for a webhook endpoint.
 *
 * The parent owns the mutation: this emits validated `WebhookFormValues` (mapped
 * to a create or a minimal-patch update by the caller). Header values are never
 * seeded back from a read — they are hidden and the editable list starts empty —
 * so the form states the "keep, replace, or remove" choice explicitly rather
 * than echoing the redacted placeholder.
 */

import { zodResolver } from "@hookform/resolvers/zod";
import {
  Alert,
  AlertDescription,
  Button,
  Checkbox,
  FieldShell,
  FormActions,
  FormLayout,
  Grid,
  Input,
  Switch,
} from "@nextlyhq/ui";
import type React from "react";
import { Controller, useFieldArray, useForm } from "react-hook-form";

import {
  SettingsRowGroup,
  SettingsSection,
} from "@admin/components/features/settings";
import { Info, Loader2, Plus, Trash2 } from "@admin/components/icons";
import { Form, FormField } from "@admin/components/ui/form";
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
      <FormLayout>
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
              render={({ field, fieldState }) => (
                <FieldShell
                  label="Name"
                  description="A label to identify this endpoint."
                  error={fieldState.error?.message}
                >
                  <Input
                    placeholder="e.g. Orders sync"
                    autoFocus
                    disabled={isPending}
                    {...field}
                  />
                </FieldShell>
              )}
            />

            <FormField
              control={form.control}
              name="url"
              render={({ field, fieldState }) => (
                <FieldShell
                  label="Payload URL"
                  description="The HTTPS endpoint that receives signed events."
                  error={fieldState.error?.message}
                >
                  <Input
                    placeholder="https://example.com/webhooks"
                    inputMode="url"
                    disabled={isPending}
                    {...field}
                  />
                </FieldShell>
              )}
            />

            <FormField
              control={form.control}
              name="enabled"
              render={({ field, fieldState }) => (
                <FieldShell
                  label="Enabled"
                  description="Disabled endpoints receive no deliveries."
                  error={fieldState.error?.message}
                >
                  <Switch
                    checked={field.value}
                    onCheckedChange={field.onChange}
                    disabled={isPending}
                  />
                </FieldShell>
              )}
            />
          </SettingsSection>

          <SettingsSection label="Events">
            {/* Not a FieldShell (or SettingsRow) candidate: a switch and a
                conditional grid of checkboxes are several independently-
                focusable controls, not one a `label for` can name. Grouped
                with `role="group"`/`aria-labelledby` instead. */}
            <SettingsRowGroup
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
                  <Grid cols={2} gap={2} responsive>
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
                  </Grid>
                )}

                {eventError && (
                  <p className="text-sm text-destructive-500">{eventError}</p>
                )}
              </div>
            </SettingsRowGroup>
          </SettingsSection>

          <SettingsSection label="Custom headers">
            {/* Not a FieldShell (or SettingsRow) candidate: an alert, a
                clear-all toggle, a dynamic list of name/value pairs and an
                add/remove control are several independently-focusable
                controls, not one a `label for` can name. Grouped with
                `role="group"`/`aria-labelledby` instead. */}
            <SettingsRowGroup
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
                      section empty to keep them, add headers to replace the
                      whole set, or remove them all below.
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
                          onCheckedChange={value => {
                            field.onChange(value);
                            // Drop any entered rows so "remove all" can't leave
                            // stale replacement headers behind.
                            if (value) form.setValue("headers", []);
                          }}
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
                        render={({ field, fieldState }) => (
                          <FieldShell
                            error={fieldState.error?.message}
                            className="flex-1"
                            width="fill"
                          >
                            <Input
                              placeholder="Header name"
                              disabled={isPending}
                              {...field}
                            />
                          </FieldShell>
                        )}
                      />
                      <FormField
                        control={form.control}
                        name={`headers.${index}.value`}
                        render={({ field, fieldState }) => (
                          <FieldShell
                            error={fieldState.error?.message}
                            className="flex-1"
                            width="fill"
                          >
                            <Input
                              placeholder="Value"
                              disabled={isPending}
                              {...field}
                            />
                          </FieldShell>
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
            </SettingsRowGroup>
          </SettingsSection>

          <FormActions dirty={form.formState.isDirty}>
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
          </FormActions>
        </form>
      </FormLayout>
    </Form>
  );
};
