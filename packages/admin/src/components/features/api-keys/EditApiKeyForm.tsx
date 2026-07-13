"use client";

/**
 * EditApiKeyForm
 *
 * Full-page form for editing an API key's name and description. Token type,
 * role, and expiry are set at creation and immutable — they are shown in a
 * read-only section so the key's context is visible without being editable.
 * Uses the shared SettingsSection / SettingsRow layout so it matches the
 * create page and the rest of /admin/settings.
 */

import { zodResolver } from "@hookform/resolvers/zod";
import { Button, Input, Textarea } from "@nextlyhq/ui";
import { useEffect, type ReactNode } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";

import {
  SettingsRow,
  SettingsSection,
} from "@admin/components/features/settings";
import { Loader2 } from "@admin/components/icons";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormMessage,
} from "@admin/components/ui/form";
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

/** A read-only row that visually matches SettingsRow (label left, value right). */
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
    <div className="grid grid-cols-1 md:grid-cols-[2fr_3fr] gap-4 md:gap-8 py-5 items-start">
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

  // Keep the form in sync if the loaded key changes (e.g. cache refetch).
  useEffect(() => {
    form.reset({
      name: apiKey.name,
      description: apiKey.description ?? "",
    });
  }, [apiKey, form]);

  const tokenTypeLabel =
    apiKey.tokenType === "role-based" && apiKey.role
      ? `${TOKEN_TYPE_LABELS[apiKey.tokenType]} (${apiKey.role.name})`
      : TOKEN_TYPE_LABELS[apiKey.tokenType];

  return (
    <Form {...form}>
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
            render={({ field }) => (
              <FormItem>
                <SettingsRow
                  label="Name"
                  description="A label to identify this key."
                >
                  <FormControl>
                    <Input
                      placeholder="e.g. Frontend App Key"
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
            name="description"
            render={({ field }) => (
              <FormItem>
                <SettingsRow
                  label="Description"
                  description="Optional. What this key is used for."
                >
                  <FormControl>
                    <Textarea
                      placeholder="What is this key used for?"
                      rows={3}
                      disabled={isPending}
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </SettingsRow>
              </FormItem>
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
          Only the name and description can be changed. To change the token type
          or role, revoke this key and create a new one.
        </p>

        {/* Actions */}
        <div className="flex justify-end gap-3">
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
        </div>
      </form>
    </Form>
  );
}
