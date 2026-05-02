"use client";

import {
  Alert,
  AlertDescription,
  AlertTitle,
  Badge,
  Button,
  Skeleton,
  TableSkeleton,
} from "@revnixhq/ui";
import { useQuery } from "@tanstack/react-query";
import type React from "react";
import { useMemo, useState } from "react";

import { SettingsLayout } from "@admin/components/features/settings/SettingsLayout";
import { Info, Shield } from "@admin/components/icons";
import { PageContainer } from "@admin/components/layout/page-container";
import { PageErrorFallback } from "@admin/components/shared/error-fallbacks";
import { QueryErrorBoundary } from "@admin/components/shared/query-error-boundary";
import { SearchBar } from "@admin/components/shared/search-bar";
import { Link } from "@admin/components/ui/link";
import { ROUTES } from "@admin/constants/routes";
import {
  fetchPermissionsFromApi,
  type ApiPermissionEntry,
} from "@admin/services/realPermissionsApi";

//============================================================
// Constants
//============================================================

/** Resources that are built-in to Nextly (not dynamic collections). */
const SYSTEM_RESOURCES = new Set([
  "users",
  "roles",
  "permissions",
  "media",
  "settings",
  "email-providers",
  "email-templates",
]);

const ACTION_BADGE_VARIANT: Record<
  string,
  "default" | "primary" | "success" | "warning" | "destructive"
> = {
  create: "primary",
  read: "default",
  update: "warning",
  delete: "destructive",
  manage: "success",
};

//============================================================
// Types
//============================================================

type TypeFilter = "all" | "system" | "collection";

interface ResourceGroup {
  resource: string;
  isSystem: boolean;
  permissions: ApiPermissionEntry[];
}

//============================================================
// Helpers
//============================================================

function groupPermissionsByResource(
  permissions: ApiPermissionEntry[]
): ResourceGroup[] {
  const map = new Map<string, ApiPermissionEntry[]>();

  for (const perm of permissions) {
    const existing = map.get(perm.resource);
    if (existing) {
      existing.push(perm);
    } else {
      map.set(perm.resource, [perm]);
    }
  }

  // Sort: system resources first (in a stable order), then collection resources alphabetically
  const systemOrder = [
    "users",
    "roles",
    "permissions",
    "media",
    "settings",
    "email-providers",
    "email-templates",
  ];

  const systemGroups: ResourceGroup[] = [];
  const collectionGroups: ResourceGroup[] = [];

  // Add system resources in preferred order
  for (const resource of systemOrder) {
    const perms = map.get(resource);
    if (perms) {
      systemGroups.push({ resource, isSystem: true, permissions: perms });
    }
  }

  // Add remaining (collection) resources alphabetically
  for (const [resource, perms] of map.entries()) {
    if (!SYSTEM_RESOURCES.has(resource)) {
      collectionGroups.push({ resource, isSystem: false, permissions: perms });
    }
  }

  collectionGroups.sort((a, b) => a.resource.localeCompare(b.resource));

  return [...systemGroups, ...collectionGroups];
}

function formatResourceLabel(resource: string): string {
  // Convert kebab-case to Title Case: "email-providers" → "Email Providers"
  return resource
    .split("-")
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

//============================================================
// Resource Section Component
//============================================================

function ResourceSection({ group }: { group: ResourceGroup }) {
  const { resource, isSystem, permissions } = group;

  return (
    <div className="mb-6">
      {/* Section header */}
      <div className="flex items-center gap-2 mb-2">
        <h3 className="text-sm font-semibold">
          {formatResourceLabel(resource)}
        </h3>
        <Badge variant={isSystem ? "primary" : "default"}>
          {isSystem ? "System" : "Collection"}
        </Badge>
        <span className="text-xs text-muted-foreground">
          {permissions.length}{" "}
          {permissions.length === 1 ? "permission" : "permissions"}
        </span>
      </div>

      {/* Permissions table */}
      <div className="table-wrapper rounded-none border border-border bg-card overflow-hidden">
        <div className="border-0 rounded-none shadow-none">
          <table className="w-full text-sm">
            <thead className="bg-primary/5 border-b border-border">
              <tr>
                <th className="px-6 py-4 text-left font-medium text-foreground">
                  Name
                </th>
                <th className="px-6 py-4 text-left font-medium text-foreground">
                  Slug
                </th>
                <th className="px-6 py-4 text-left font-medium text-foreground">
                  Action
                </th>
              </tr>
            </thead>
            <tbody>
              {permissions.map((perm, index) => (
                <tr
                  key={perm.id}
                  className={
                    index < permissions.length - 1
                      ? "border-b border-border hover-unified"
                      : "hover-unified"
                  }
                >
                  <td className="px-6 py-4 font-medium">{perm.name}</td>
                  <td className="px-6 py-4">
                    <code className="text-xs bg-primary/5 px-1.5 py-0.5 rounded-none font-mono">
                      {perm.slug}
                    </code>
                  </td>
                  <td className="px-6 py-4">
                    <Badge
                      variant={ACTION_BADGE_VARIANT[perm.action] ?? "default"}
                    >
                      {perm.action}
                    </Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

//============================================================
// Loading Skeleton
//============================================================

function PermissionsSkeleton() {
  return (
    <div className="space-y-6">
      {[1, 2, 3].map(i => (
        <div key={i}>
          <div className="flex items-center gap-2 mb-2">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-5 w-16 rounded-none" />
            <Skeleton className="h-3 w-20" />
          </div>
          <TableSkeleton columns={3} rowCount={3} />
        </div>
      ))}
    </div>
  );
}

//============================================================
// Permissions Content Component
//============================================================

function PermissionsContent() {
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<TypeFilter>("all");

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["permissions-overview"],
    queryFn: () => fetchPermissionsFromApi({ limit: 200 }),
    staleTime: 5 * 60 * 1000, // 5 minutes
  });

  // Apply search and type filters client-side
  const filteredGroups = useMemo<ResourceGroup[]>(() => {
    const allPermissions = data?.data ?? [];
    let filtered = allPermissions;

    // Apply type filter
    if (typeFilter === "system") {
      filtered = filtered.filter(p => SYSTEM_RESOURCES.has(p.resource));
    } else if (typeFilter === "collection") {
      filtered = filtered.filter(p => !SYSTEM_RESOURCES.has(p.resource));
    }

    // Apply search filter (name, slug, action, or resource)
    if (search.trim()) {
      const term = search.trim().toLowerCase();
      filtered = filtered.filter(
        p =>
          p.name.toLowerCase().includes(term) ||
          p.slug.toLowerCase().includes(term) ||
          p.action.toLowerCase().includes(term) ||
          p.resource.toLowerCase().includes(term)
      );
    }

    return groupPermissionsByResource(filtered);
  }, [data?.data, search, typeFilter]);

  const totalPermissions = filteredGroups.reduce(
    (acc, g) => acc + g.permissions.length,
    0
  );

  return (
    <>
      {/* Page Header and Info */}
      <div className="rounded-none border border-border bg-card overflow-hidden mb-6">
        <div className="border-b border-border bg-primary/5 px-6 py-5">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-none bg-primary/10 shrink-0">
              <Shield className="h-5 w-5 text-primary" />
            </div>
            <div>
              <h2 className="text-xl font-semibold">Permissions</h2>
              <p className="text-sm text-muted-foreground mt-0.5">
                All system and collection permissions, grouped by resource
              </p>
            </div>
          </div>
        </div>
        <div className="px-6 py-5 border-b border-border bg-primary/5">
          <div className="flex items-start gap-3">
            <Info className="h-5 w-5 text-muted-foreground shrink-0 mt-0.5" />
            <div className="text-sm text-muted-foreground">
              <span className="font-medium text-foreground">
                Read-only overview:
              </span>{" "}
              Permissions are auto-generated when collections are created.
              Assign them to roles via{" "}
              <Link
                href={ROUTES.SECURITY_ROLES}
                className="font-medium underline underline-offset-2 hover-unified"
              >
                Security &amp; Access → Roles
              </Link>
              .
            </div>
          </div>
        </div>
      </div>

      {/* Search + type filter */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center mb-6">
        <div className="flex-1">
          <SearchBar
            value={search}
            onChange={setSearch}
            placeholder="Search by name, slug, action, or resource..."
            isLoading={isLoading}
          />
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          {(["all", "system", "collection"] as TypeFilter[]).map(f => (
            <Button
              key={f}
              variant={typeFilter === f ? "default" : "outline"}
              size="sm"
              onClick={() => setTypeFilter(f)}
              className="capitalize"
            >
              {f === "all" ? "All" : f === "system" ? "System" : "Collections"}
            </Button>
          ))}
        </div>
      </div>

      {/* Content */}
      {isLoading && !data ? (
        <PermissionsSkeleton />
      ) : isError ? (
        <Alert variant="destructive">
          <AlertTitle>Error</AlertTitle>
          <AlertDescription>
            {error instanceof Error
              ? error.message
              : "Failed to load permissions. Please try again."}
          </AlertDescription>
        </Alert>
      ) : filteredGroups.length === 0 ? (
        <div className="rounded-none border border-border bg-card p-10 text-center">
          <Shield className="h-8 w-8 text-muted-foreground mx-auto mb-3" />
          <p className="text-sm font-medium text-foreground">
            {search || typeFilter !== "all"
              ? "No permissions match your filters"
              : "No permissions found"}
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            {search || typeFilter !== "all"
              ? "Try adjusting your search or clearing the filter."
              : "Permissions are auto-generated when you run next dev or create collections."}
          </p>
          {(search || typeFilter !== "all") && (
            <Button
              variant="outline"
              size="sm"
              className="mt-4"
              onClick={() => {
                setSearch("");
                setTypeFilter("all");
              }}
            >
              Clear filters
            </Button>
          )}
        </div>
      ) : (
        <>
          {/* Summary */}
          <p className="text-sm text-muted-foreground mb-4">
            Showing {totalPermissions}{" "}
            {totalPermissions === 1 ? "permission" : "permissions"} across{" "}
            {filteredGroups.length}{" "}
            {filteredGroups.length === 1 ? "resource" : "resources"}
          </p>

          {/* Grouped sections */}
          {filteredGroups.map(group => (
            <ResourceSection key={group.resource} group={group} />
          ))}
        </>
      )}
    </>
  );
}

// ============================================================
// Page Component
// ============================================================

const SettingsPermissionsPage: React.FC = () => {
  return (
    <QueryErrorBoundary fallback={<PageErrorFallback />}>
      <PageContainer>
        <SettingsLayout>
          <PermissionsContent />
        </SettingsLayout>
      </PageContainer>
    </QueryErrorBoundary>
  );
};

export default SettingsPermissionsPage;
