"use client";

/**
 * EditApiKeyForm
 *
 * Full-page form for editing an API key's name and description. Token type,
 * role, and expiry are set at creation and immutable — they are shown in a
 * read-only section so the key's context is visible without being editable.
 * Uses the shared FormLayout / FieldShell layout so it matches the create
 * page and the rest of /admin/settings.
 */

import { zodResolver } from "@hookform/resolvers/zod";
import {
  Button,
  FieldShell,
  FormActions,
  FormLayout,
  Input,
  Textarea,
} from "@nextlyhq/ui";
import { useEffect, type ReactNode } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";

import { SettingsSection } from "@admin/components/features/settings";
import { Loader2 } from "@admin/components/icons";
import { Form, FormField } from "@admin/components/ui/form";
import { Link } from "@admin/components/ui/link";
import { ROUTES } from "@admin/constants/routes";
import type { ApiKeyMeta } from "@admin/services/apiKeyApi";

// ============================================================
// Schema
// ============================================================

const editApiKeySchema = z.object({
  name: z.string().min(1, "Name is required").max(100, "Name is too long"),
  description: z.string().max(500, "Description is too long").optional(),
});

export type EditApiKeyFormValues = z.infer<typeof editApiKeySchema>;

// ============================================================
// Helpers
// ============================================================

const TOKEN_TYPE_LABELS: Record<ApiKeyMeta["tokenType"], string> = {
  "read-only": "Read-only",
  "full-access": "Full access",
  "role-based": "Role-based",
};

function formatDate(iso: string | null): string {
  if (!iso) return "Never";
  return new Date(iso).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

/**
 * A read-only row that visually matches SettingsRow (label left, value right).
 *
 * Left as its own hand-rolled row rather than `FieldShell`: it renders no
 * input, so there is nothing for a computed id or `aria-describedby` to
 * attach to — the label just names a static value.
 *
 * It carries no vertical padding of its own, and that absence is deliberate.
 * The enclosing `FormSection` applies the rhythm to every direct child through
 * `--nx-field-gap`, so the section's edge inset and the gap between two rows
 * are one measurement. The two paddings would be additive, so a row that
 * restored its own would render at double the gap while looking correct in
 * isolation.
 */
function ReadOnlyRow({
  label,
  description,
  value,
}: {
  label: string;
  description?: string;
  value: ReactNode;
}) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-[2fr_3fr] gap-4 md:gap-8 items-start">
      <div className="flex flex-col">
        <span className="text-sm font-semibold text-foreground">{label}</span>
        {description && (
          <span className="mt-0.5 text-xs text-muted-foreground leading-relaxed">
            {description}
          </span>
        )}
      </div>
      <div className="w-full text-sm text-foreground">{value}</div>
    </div>
  );
}

// ============================================================
// Component
// ============================================================

export interface EditApiKeyFormProps {
  apiKey: ApiKeyMeta;
  isPending: boolean;
  onSubmit: (values: EditApiKeyFormValues) => void;
}

export function EditApiKeyForm({
  apiKey,
  isPending,
  onSubmit,
}: EditApiKeyFormProps) {
  const form = useForm<EditApiKeyFormValues>({
    resolver: zodResolver(editApiKeySchema),
    defaultValues: {
      name: apiKey.name,
      description: apiKey.description ?? "",
    },
  });

  // Keep the form in sync when the loaded key's values change, but never clobber
  // unsaved edits: a cache refetch shouldn't discard what the user is typing.
  useEffect(() => {
    if (form.formState.isDirty) return;
    form.reset({
      name: apiKey.name,
      description: apiKey.description ?? "",
    });
  }, [apiKey.name, apiKey.description, form]);

  const tokenTypeLabel =
    apiKey.tokenType === "role-based" && apiKey.role
      ? `${TOKEN_TYPE_LABELS[apiKey.tokenType]} (${apiKey.role.name})`
      : TOKEN_TYPE_LABELS[apiKey.tokenType];

  return (
    <Form {...form}>
      <FormLayout>
        <form
          onSubmit={e => {
            void form.handleSubmit(onSubmit)(e);
          }}
          className="space-y-6"
        >
          {/* Details (editable) */}
          <SettingsSection label="Details">
            <FormField
              control={form.control}
              name="name"
              render={({ field, fieldState }) => (
                <FieldShell
                  label="Name"
                  description="A label to identify this key."
                  error={fieldState.error?.message}
                >
                  <Input
                    placeholder="e.g. Frontend App Key"
                    autoFocus
                    disabled={isPending}
                    {...field}
                  />
                </FieldShell>
              )}
            />

            <FormField
              control={form.control}
              name="description"
              render={({ field, fieldState }) => (
                <FieldShell
                  label="Description"
                  description="Optional. What this key is used for."
                  error={fieldState.error?.message}
                  width="fill"
                >
                  <Textarea
                    placeholder="What is this key used for?"
                    rows={3}
                    disabled={isPending}
                    {...field}
                  />
                </FieldShell>
              )}
            />
          </SettingsSection>

          {/* Key Properties (read-only) */}
          <SettingsSection label="Key Properties">
            <ReadOnlyRow
              label="Key"
              description="The visible prefix of this key."
              value={
                <code className="font-mono text-xs text-muted-foreground">
                  {apiKey.keyPrefix}…
                </code>
              }
            />
            <ReadOnlyRow
              label="Token Type"
              description="Set at creation and cannot be changed."
              value={tokenTypeLabel}
            />
            <ReadOnlyRow label="Expires" value={formatDate(apiKey.expiresAt)} />
            <ReadOnlyRow label="Created" value={formatDate(apiKey.createdAt)} />
          </SettingsSection>

          <p className="text-xs text-muted-foreground">
            Only the name and description can be changed. To change the token
            type or role, revoke this key and create a new one.
          </p>

          <FormActions dirty={form.formState.isDirty}>
            <Link href={ROUTES.SETTINGS_API_KEYS}>
              <Button type="button" variant="outline" disabled={isPending}>
                Cancel
              </Button>
            </Link>
            <Button type="submit" disabled={isPending}>
              {isPending ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Saving…
                </>
              ) : (
                "Save changes"
              )}
            </Button>
          </FormActions>
        </form>
      </FormLayout>
    </Form>
  );
}
