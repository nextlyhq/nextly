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
} from "@revnixhq/ui";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";

import {
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  Info,
  Key,
  Loader2,
  Shield,
} from "@admin/components/icons";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
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
    colorClass:
      "bg-primary/10 border-primary/20 text-primary dark:bg-primary/20 dark:border-primary/30 dark:text-primary-foreground/90",
    iconClass: "text-primary",
  },
  "full-access": {
    icon: AlertTriangle,
    text: "This key has the same permissions as your account. It can perform any action you are authorized to perform.",
    colorClass:
      "bg-amber-50 border-amber-200 text-amber-800 dark:bg-amber-950/30 dark:border-amber-800 dark:text-amber-300",
    iconClass: "text-amber-500",
  },
  "role-based": {
    icon: Shield,
    text: "This key will act as the selected role. Only roles with permissions equal to or less than your own are available.",
    colorClass: "bg-primary/5 border-border text-muted-foreground",
    iconClass: "text-muted-foreground",
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
    <p className="text-sm text-muted-foreground">
      This key can read:{" "}
      <span className="font-medium text-foreground">
        {resourceNames.join(", ")}
      </span>
      .
    </p>
  );
}

function RolePermissionsPreview({ roleId }: { roleId: string }) {
  // The listRolePermissions dispatcher emits `respondData({ permissions: [...] })`
  // (spec section 5.1 non-paginated list). The wire body comes through unchanged,
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
    <div className="space-y-1.5">
      {Object.entries(byResource).map(([resource, actions]) => (
        <div key={resource} className="flex items-baseline gap-3 text-sm">
          <span className="min-w-32 font-medium text-foreground">
            {humaniseResource(resource)}
          </span>
          <span className="text-muted-foreground capitalize">
            {actions.join(", ")}
          </span>
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
    <div className="space-y-6">
      <Form {...form}>
        <form onSubmit={(e) => { void form.handleSubmit(handleSubmit)(e); }} className="space-y-6">
          <div className="bg-card border border-border rounded-none overflow-hidden">
            {/* Page Header */}
            <div className="border-b border-border bg-primary/5 px-6 py-5">
              <div className="flex items-center gap-3">
                <div
                  className="shrink-0 flex items-center justify-center w-9 h-9 bg-primary/10 text-primary"
                  style={{
                    borderRadius: "6px",
                    border: "1px solid hsl(var(--primary) / 0.25)",
                  }}
                >
                  <Key className="h-4 w-4" />
                </div>
                <div>
                  <h2 className="text-xl font-semibold">Create API Key</h2>
                  <p className="text-sm text-muted-foreground mt-0.5">
                    Generate a new key for programmatic API access
                  </p>
                </div>
              </div>
            </div>

            <div className="p-6">
              <div className="space-y-8 max-w-2xl">
                {/* ── Details ─────────────────────────────────────── */}
                <section className="space-y-4">
                  <div>
                    <h3 className="text-base font-medium">Details</h3>
                    <p className="mt-0.5 text-sm text-muted-foreground">
                      A label and optional description to identify this key.
                    </p>
                  </div>

                  <FormField
                    control={form.control}
                    name="name"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Name</FormLabel>
                        <FormControl>
                          <Input
                            placeholder="e.g. Frontend App Key"
                            autoFocus
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
                    name="description"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>
                          Description{" "}
                          <span className="font-normal text-muted-foreground">
                            (optional)
                          </span>
                        </FormLabel>
                        <FormControl>
                          <Textarea
                            placeholder="What is this key used for?"
                            disabled={isPending}
                            rows={3}
                            {...field}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </section>

                {/* ── Configuration ───────────────────────────────── */}
                <section className="space-y-4">
                  <div>
                    <h3 className="text-base font-medium">Configuration</h3>
                    <p className="mt-0.5 text-sm text-muted-foreground">
                      Set the token type and how long the key will be valid.
                    </p>
                  </div>

                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    {/* Token Duration */}
                    <FormField
                      control={form.control}
                      name="expiresIn"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Token Duration</FormLabel>
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
                              <SelectItem value="unlimited">
                                Unlimited
                              </SelectItem>
                            </SelectContent>
                          </Select>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    {/* Token Type */}
                    <FormField
                      control={form.control}
                      name="tokenType"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Token Type</FormLabel>
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
                              <SelectItem value="read-only">
                                Read-only
                              </SelectItem>
                              <SelectItem value="full-access">
                                Full access
                              </SelectItem>
                              <SelectItem value="role-based">
                                Role-based
                              </SelectItem>
                            </SelectContent>
                          </Select>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>

                  {/* Token type descriptor */}
                  <div
                    className={`flex items-start gap-3 rounded-none border px-3 py-2.5 text-sm ${descriptor.colorClass}`}
                  >
                    <DescriptorIcon
                      className={`mt-0.5 h-4 w-4 shrink-0 ${descriptor.iconClass}`}
                    />
                    <span>{descriptor.text}</span>
                  </div>

                  {/* Role selector — only for "role-based" */}
                  {tokenType === "role-based" && (
                    <FormField
                      control={form.control}
                      name="roleId"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Role</FormLabel>
                          <Select
                            disabled={isPending || rolesLoading}
                            onValueChange={field.onChange}
                            value={field.value ?? ""}
                          >
                            <FormControl>
                              <SelectTrigger>
                                <SelectValue
                                  placeholder={
                                    rolesLoading
                                      ? "Loading roles…"
                                      : "Select a role"
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
                        </FormItem>
                      )}
                    />
                  )}
                </section>

                {/* ── Access Preview (collapsible) ─────────────────── */}
                <section>
                  <Collapsible
                    open={accessPreviewOpen}
                    onOpenChange={setAccessPreviewOpen}
                  >
                    <CollapsibleTrigger asChild>
                      <button
                        type="button"
                        className="flex w-full items-center justify-between rounded-none border px-3 py-2.5 text-sm font-medium transition-colors hover-unified"
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
                      <div className="rounded-none border border-t-0 px-3 py-3">
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
                            This key can access all resources you are currently
                            authorized for. Its effective permissions will match
                            your account&apos;s permissions at the time of each
                            request.
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
                </section>
              </div>
            </div>

            {/* Form Actions */}
            <div className="border-t border-border px-6 py-4 bg-primary/5">
              <div className="flex justify-end gap-3">
                <Link href={ROUTES.SETTINGS_API_KEYS}>
                  <Button type="button" variant="outline" disabled={isPending}>
                    Cancel
                  </Button>
                </Link>
                <Button type="submit" disabled={isPending}>
                  {isPending ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Creating…
                    </>
                  ) : (
                    "Create API Key"
                  )}
                </Button>
              </div>
            </div>
          </div>
        </form>
      </Form>
    </div>
  );
}
