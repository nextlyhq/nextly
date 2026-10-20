"use client";

/**
 * CreateApiKeyForm
 *
 * Multi-section form for creating a new API key.
 *
 * Sections:
 *  1. Details      — Name (required), Description (optional)
 *  2. Configuration — Token Duration + Token Type selects
 *     - Token type descriptor block (changes per type)
 *     - Role selector (visible only for "role-based" type)
 *  3. Summary — what the key will be able to do, answered by the server for
 *     the chosen type and role
 *  4. Submit
 *
 * The parent page is responsible for calling useCreateApiKey() and passing
 * isPending + onSubmit as props.
 */

import { zodResolver } from "@hookform/resolvers/zod";
import {
  Alert,
  AlertDescription,
  Button,
  FieldShell,
  FormActions,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Textarea,
} from "@nextlyhq/ui";
import { useForm } from "react-hook-form";
import { z } from "zod";

import { SettingsSection } from "@admin/components/features/settings";
import { Info, Loader2, Shield } from "@admin/components/icons";
import { Form, FormField } from "@admin/components/ui/form";
import { Link } from "@admin/components/ui/link";
import { ROUTES } from "@admin/constants/routes";
import { useRoles } from "@admin/hooks/queries/useRoles";

import { KeySummary } from "./KeySummary";

// ============================================================
// Schema
// ============================================================

/**
 * Local schema matching CreateApiKeySchema from @nextly/schemas.
 * Defined locally so admin does not need a direct dependency on nextly.
 */
const createApiKeySchema = z
  .object({
    name: z
      .string()
      .min(1, "Name is required")
      .max(255, "Name must be 255 characters or less"),
    description: z.string().optional(),
    tokenType: z.enum(["read-only", "full-access", "role-based"]),
    roleId: z.string().min(1, "A role must be selected").optional(),
    expiresIn: z.enum(["7d", "30d", "90d", "unlimited"]),
  })
  .superRefine((data, ctx) => {
    if (data.tokenType === "role-based" && !data.roleId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "A role must be selected for role-based token type",
        path: ["roleId"],
      });
    }
  });

export type CreateApiKeyFormValues = z.infer<typeof createApiKeySchema>;

// ============================================================
// Types
// ============================================================

export interface CreateApiKeyFormProps {
  onSubmit: (values: CreateApiKeyFormValues) => void;
  isPending: boolean;
}

// ============================================================
// Internal — Token Type Descriptor Block
// ============================================================

/**
 * What each type does, in plain words. A read-only or full-access key follows
 * its creator's permissions as they change, which is the fact people miss, so
 * both say it; a role-based key follows its role instead.
 */
const TOKEN_TYPE_DESCRIPTORS = {
  "read-only": {
    icon: Info,
    text: "Reads what you can read, and changes nothing. It follows your permissions: when what you can read changes, so does what this key can read.",
  },
  "full-access": {
    icon: Info,
    text: "Does what you can do. It follows your permissions: when they change, this key's change with them.",
  },
  "role-based": {
    icon: Shield,
    text: "Does what the chosen role allows, and follows that role when its permissions change. Only roles within your own permissions can be chosen.",
  },
} as const;

// ============================================================
// CreateApiKeyForm
// ============================================================

export function CreateApiKeyForm({
  onSubmit,
  isPending,
}: CreateApiKeyFormProps) {
  const form = useForm<CreateApiKeyFormValues>({
    resolver: zodResolver(createApiKeySchema),
    defaultValues: {
      name: "",
      description: "",
      tokenType: "read-only",
      expiresIn: "30d",
    },
  });

  const tokenType = form.watch("tokenType");
  const roleId = form.watch("roleId");

  // Roles for the role selector
  const { data: rolesData, isLoading: rolesLoading } = useRoles({
    pagination: { page: 0, pageSize: 100 },
    sorting: [],
    filters: {},
  });

  const descriptor = TOKEN_TYPE_DESCRIPTORS[tokenType];
  const DescriptorIcon = descriptor.icon;

  const handleSubmit = (values: CreateApiKeyFormValues) => {
    // Strip roleId when not role-based (superRefine doesn't strip, just validates)
    if (values.tokenType !== "role-based") {
      const { roleId: _ignored, ...rest } = values;
      onSubmit(rest);
    } else {
      onSubmit(values);
    }
  };

  return (
    <Form {...form}>
      <form
        onSubmit={e => {
          void form.handleSubmit(handleSubmit)(e);
        }}
        className="space-y-6"
      >
        {/* Details */}
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
                  disabled={isPending}
                  rows={3}
                  {...field}
                />
              </FieldShell>
            )}
          />
        </SettingsSection>

        {/* Configuration */}
        <SettingsSection label="Configuration">
          <FormField
            control={form.control}
            name="expiresIn"
            render={({ field, fieldState }) => (
              <FieldShell
                label="Token Duration"
                description="How long the key stays valid."
                error={fieldState.error?.message}
              >
                {({ id, describedBy, invalid }) => (
                  <Select
                    disabled={isPending}
                    onValueChange={field.onChange}
                    defaultValue={field.value}
                  >
                    <SelectTrigger
                      id={id}
                      aria-describedby={describedBy}
                      aria-invalid={invalid}
                    >
                      <SelectValue placeholder="Select duration" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="7d">7 days</SelectItem>
                      <SelectItem value="30d">30 days</SelectItem>
                      <SelectItem value="90d">90 days</SelectItem>
                      <SelectItem value="unlimited">Unlimited</SelectItem>
                    </SelectContent>
                  </Select>
                )}
              </FieldShell>
            )}
          />

          <FormField
            control={form.control}
            name="tokenType"
            render={({ field, fieldState }) => (
              <FieldShell
                label="Token Type"
                description="What this key is allowed to do."
                error={fieldState.error?.message}
              >
                {({ id, describedBy, invalid }) => (
                  <Select
                    disabled={isPending}
                    onValueChange={value => {
                      field.onChange(value);
                      // Clear roleId when switching away from role-based
                      if (value !== "role-based") {
                        form.setValue("roleId", undefined);
                      }
                    }}
                    defaultValue={field.value}
                  >
                    <SelectTrigger
                      id={id}
                      aria-describedby={describedBy}
                      aria-invalid={invalid}
                    >
                      <SelectValue placeholder="Select token type" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="read-only">Read-only</SelectItem>
                      <SelectItem value="full-access">Full access</SelectItem>
                      <SelectItem value="role-based">Role-based</SelectItem>
                    </SelectContent>
                  </Select>
                )}
              </FieldShell>
            )}
          />

          {/* Role selector — only for "role-based" */}
          {tokenType === "role-based" && (
            <FormField
              control={form.control}
              name="roleId"
              render={({ field, fieldState }) => (
                <FieldShell
                  label="Role"
                  description="The key acts as this role."
                  error={fieldState.error?.message}
                >
                  {({ id, describedBy, invalid }) => (
                    <Select
                      disabled={isPending || rolesLoading}
                      onValueChange={field.onChange}
                      value={field.value ?? ""}
                    >
                      <SelectTrigger
                        id={id}
                        aria-describedby={describedBy}
                        aria-invalid={invalid}
                      >
                        <SelectValue
                          placeholder={
                            rolesLoading ? "Loading roles…" : "Select a role"
                          }
                        />
                      </SelectTrigger>
                      <SelectContent>
                        {rolesData?.items.map(role => (
                          <SelectItem key={role.id} value={role.id}>
                            {role.roleName}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                </FieldShell>
              )}
            />
          )}
        </SettingsSection>

        {/* Token type descriptor */}
        <Alert variant="info" role="status">
          <DescriptorIcon className="h-4 w-4" />
          <AlertDescription>{descriptor.text}</AlertDescription>
        </Alert>

        {/* What the key will be able to do, shown before it is created */}
        <SettingsSection label="What this key will be able to do">
          <KeySummary tokenType={tokenType} roleId={roleId} />
        </SettingsSection>

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
                Creating…
              </>
            ) : (
              "Create API Key"
            )}
          </Button>
        </FormActions>
      </form>
    </Form>
  );
}
