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
 *  3. Access preview — Collapsible toggle showing what the key can access
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
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Textarea,
} from "@nextlyhq/ui";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";

import {
  SettingsRow,
  SettingsSection,
} from "@admin/components/features/settings";
import {
  ChevronDown,
  ChevronUp,
  Info,
  Loader2,
  Shield,
} from "@admin/components/icons";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormMessage,
} from "@admin/components/ui/form";
import { Link } from "@admin/components/ui/link";
import { ROUTES } from "@admin/constants/routes";
import { useRoles } from "@admin/hooks/queries/useRoles";
import { useCurrentUserPermissions } from "@admin/hooks/useCurrentUserPermissions";
import { protectedApi } from "@admin/lib/api/protectedApi";

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

const TOKEN_TYPE_DESCRIPTORS = {
  "read-only": {
    icon: Info,
    text: "This key can only read data. No create, update, or delete operations are permitted.",
  },
  "full-access": {
    icon: Info,
    text: "This key has the same permissions as your account. It can perform any action you are authorized to perform.",
  },
  "role-based": {
    icon: Shield,
    text: "This key will act as the selected role. Only roles with permissions equal to or less than your own are available.",
  },
} as const;

// ============================================================
// Internal — Access Preview Content
// ============================================================

/** Humanises a resource slug: "email-providers" → "Email Providers" */
function humaniseResource(slug: string): string {
  return slug
    .split("-")
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

function ReadOnlyPreview({ permissions }: { permissions: string[] }) {
  const readables = permissions.filter(p => p.startsWith("read-"));

  if (readables.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        This key would have no access — your account has no read permissions.
      </p>
    );
  }

  const resourceNames = readables.map(p =>
    humaniseResource(p.slice("read-".length))
  );

  return (
    <div className="space-y-2">
      <p className="text-sm text-muted-foreground">This key can read:</p>
      <div className="flex flex-wrap gap-1.5">
        {resourceNames.map(name => (
          <span
            key={name}
            className="inline-flex items-center rounded-none border border-input bg-background px-2 py-0.5 text-xs font-medium text-foreground"
          >
            {name}
          </span>
        ))}
      </div>
    </div>
  );
}

function RolePermissionsPreview({ roleId }: { roleId: string }) {
  // The listRolePermissions dispatcher emits `respondData({ permissions: [...] })`
  // (spec §5.1 non-paginated list). The wire body comes through unchanged,
  // so we type the response with the canonical `{ permissions }` shape and read
  // `data.permissions`.
  const { data, isLoading, isError } = useQuery({
    queryKey: ["rolePermissions", roleId],
    queryFn: () =>
      protectedApi.get<{
        permissions: Array<{ id: string; action: string; resource: string }>;
      }>(`/roles/${roleId}/permissions`),
    enabled: !!roleId,
    staleTime: 60_000,
  });

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
        Loading role permissions…
      </div>
    );
  }

  if (isError || !data?.permissions) {
    return (
      <p className="text-sm text-muted-foreground">
        Unable to load role permissions.
      </p>
    );
  }

  const permissions = data.permissions;

  if (permissions.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        This role has no permissions assigned.
      </p>
    );
  }

  // Group actions by resource
  const byResource = permissions.reduce<Record<string, string[]>>(
    (acc, perm) => {
      if (!acc[perm.resource]) acc[perm.resource] = [];
      acc[perm.resource].push(perm.action);
      return acc;
    },
    {}
  );

  return (
    <div className="space-y-2">
      {Object.entries(byResource).map(([resource, actions]) => (
        <div
          key={resource}
          className="flex flex-wrap items-baseline gap-x-3 gap-y-1.5 text-sm"
        >
          <span className="min-w-32 font-medium text-foreground">
            {humaniseResource(resource)}
          </span>
          <div className="flex flex-wrap gap-1.5">
            {actions.map(action => (
              <span
                key={action}
                className="inline-flex items-center rounded-none border border-input bg-background px-2 py-0.5 text-xs font-medium text-foreground capitalize"
              >
                {action}
              </span>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

// ============================================================
// CreateApiKeyForm
// ============================================================

export function CreateApiKeyForm({
  onSubmit,
  isPending,
}: CreateApiKeyFormProps) {
  const [accessPreviewOpen, setAccessPreviewOpen] = useState(false);

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

  // Current user permissions for the read-only access preview
  const { permissions, isLoading: permissionsLoading } =
    useCurrentUserPermissions();

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
                      disabled={isPending}
                      rows={3}
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </SettingsRow>
              </FormItem>
            )}
          />
        </SettingsSection>

        {/* Configuration */}
        <SettingsSection label="Configuration">
          <FormField
            control={form.control}
            name="expiresIn"
            render={({ field }) => (
              <FormItem>
                <SettingsRow
                  label="Token Duration"
                  description="How long the key stays valid."
                >
                  <Select
                    disabled={isPending}
                    onValueChange={field.onChange}
                    defaultValue={field.value}
                  >
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder="Select duration" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value="7d">7 days</SelectItem>
                      <SelectItem value="30d">30 days</SelectItem>
                      <SelectItem value="90d">90 days</SelectItem>
                      <SelectItem value="unlimited">Unlimited</SelectItem>
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </SettingsRow>
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="tokenType"
            render={({ field }) => (
              <FormItem>
                <SettingsRow
                  label="Token Type"
                  description="What this key is allowed to do."
                >
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
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder="Select token type" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value="read-only">Read-only</SelectItem>
                      <SelectItem value="full-access">Full access</SelectItem>
                      <SelectItem value="role-based">Role-based</SelectItem>
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </SettingsRow>
              </FormItem>
            )}
          />

          {/* Role selector — only for "role-based" */}
          {tokenType === "role-based" && (
            <FormField
              control={form.control}
              name="roleId"
              render={({ field }) => (
                <FormItem>
                  <SettingsRow
                    label="Role"
                    description="The key acts as this role."
                  >
                    <Select
                      disabled={isPending || rolesLoading}
                      onValueChange={field.onChange}
                      value={field.value ?? ""}
                    >
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue
                            placeholder={
                              rolesLoading ? "Loading roles…" : "Select a role"
                            }
                          />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {rolesData?.items.map(role => (
                          <SelectItem key={role.id} value={role.id}>
                            {role.roleName}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </SettingsRow>
                </FormItem>
              )}
            />
          )}
        </SettingsSection>

        {/* Token type descriptor */}
        <Alert variant="info" role="status">
          <DescriptorIcon className="h-4 w-4" />
          <AlertDescription>{descriptor.text}</AlertDescription>
        </Alert>

        {/* Access Preview (collapsible) */}
        <Collapsible
          open={accessPreviewOpen}
          onOpenChange={setAccessPreviewOpen}
        >
          <CollapsibleTrigger asChild>
            <button
              type="button"
              className="flex w-full items-center justify-between rounded-md border border-input bg-card px-4 py-3 text-sm font-medium transition-colors hover:bg-muted"
            >
              <span>What can this key access?</span>
              {accessPreviewOpen ? (
                <ChevronUp className="h-4 w-4 text-muted-foreground" />
              ) : (
                <ChevronDown className="h-4 w-4 text-muted-foreground" />
              )}
            </button>
          </CollapsibleTrigger>

          <CollapsibleContent>
            <div className="rounded-md border border-input border-t-0 px-4 py-3">
              {tokenType === "read-only" &&
                (permissionsLoading ? (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    Loading your permissions…
                  </div>
                ) : (
                  <ReadOnlyPreview permissions={permissions} />
                ))}

              {tokenType === "full-access" && (
                <p className="text-sm text-muted-foreground">
                  This key can access all resources you are currently authorized
                  for. Its effective permissions will match your account&apos;s
                  permissions at the time of each request.
                </p>
              )}

              {tokenType === "role-based" && !roleId && (
                <p className="text-sm text-muted-foreground">
                  Select a role above to preview its permissions.
                </p>
              )}

              {tokenType === "role-based" && roleId && (
                <RolePermissionsPreview roleId={roleId} />
              )}
            </div>
          </CollapsibleContent>
        </Collapsible>

        {/* Form Actions */}
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
                Creating…
              </>
            ) : (
              "Create API Key"
            )}
          </Button>
        </div>
      </form>
    </Form>
  );
}
