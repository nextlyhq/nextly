"use client";

import {
  Badge,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@revnixhq/ui";
import React from "react";

import * as Icons from "@admin/components/icons";
import { ChevronRight, Home, Package, Puzzle } from "@admin/components/icons";
import { PageContainer } from "@admin/components/layout/page-container";
import { PageErrorFallback } from "@admin/components/shared/error-fallbacks";
import { QueryErrorBoundary } from "@admin/components/shared/query-error-boundary";
import { Link } from "@admin/components/ui/link";
import { ROUTES, buildRoute } from "@admin/constants/routes";
import { useBranding } from "@admin/context/providers/BrandingProvider";
import type { PluginMetadata } from "@admin/types/branding";

function toSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

interface PluginSettingsPageProps {
  params?: { slug?: string };
}

/**
 * Plugins Overview Page
 *
 * Displays a table of all installed plugins with their name, version,
 * sidebar placement, and status.
 *
 * Route: /admin/plugins/[slug]
 */
export default function PluginSettingsPage({
  params,
}: PluginSettingsPageProps): React.ReactElement {
  return (
    <QueryErrorBoundary fallback={<PageErrorFallback />}>
      <PageContainer>
        <PluginsContent activeSlug={params?.slug} />
      </PageContainer>
    </QueryErrorBoundary>
  );
}

// ---------------------------------------------------------------------------
// Main content
// ---------------------------------------------------------------------------

function PluginsContent({ activeSlug }: { activeSlug?: string }) {
  const branding = useBranding();
  const plugins = branding?.plugins ?? [];

  return (
    <div className="space-y-8">
      {/* Breadcrumb */}
      <nav aria-label="Breadcrumb">
        <ol className="flex items-center gap-2 text-sm text-muted-foreground">
          <li className="flex items-center gap-2">
            <Link
              href={ROUTES.DASHBOARD}
              className="flex items-center gap-1 hover-unified"
            >
              <Home className="h-4 w-4" />
              <span>Dashboard</span>
            </Link>
            <ChevronRight className="h-4 w-4" />
          </li>
          <li className="text-foreground font-medium">Plugins</li>
        </ol>
      </nav>

      {/* Page header */}
      <div className="flex items-start gap-4">
        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-primary/10">
          <Puzzle className="h-6 w-6 text-primary" />
        </div>
        <div className="space-y-1">
          <h1 className="text-[clamp(1.5rem,5vw,2.5rem)] font-bold tracking-[-0.04em] text-foreground leading-tight">
            Plugins
          </h1>
          <p className="text-base text-muted-foreground">
            {plugins.length} installed plugin{plugins.length !== 1 ? "s" : ""}
          </p>
        </div>
      </div>

      {/* Plugins table */}
      <PluginsTable plugins={plugins} activeSlug={activeSlug} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Plugins table
// ---------------------------------------------------------------------------

const PLACEMENT_LABELS: Record<string, string> = {
  collections: "Collections",
  singles: "Singles",
  users: "Users",
  settings: "Settings",
  plugins: "Plugins",
};

function PluginsTable({
  plugins,
  activeSlug,
}: {
  plugins: PluginMetadata[];
  activeSlug?: string;
}) {
  const activePlugin = activeSlug
    ? plugins.find(p => toSlug(p.name) === activeSlug)
    : null;

  const name = activePlugin?.appearance?.label ?? activePlugin?.name;
  const version = activePlugin?.version;
  const description = activePlugin?.description;

  if (plugins.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border bg-card p-12 text-center">
        <Package className="h-10 w-10 text-muted-foreground mx-auto mb-4" />
        <h3 className="text-sm font-medium text-foreground mb-1">
          No plugins installed
        </h3>
        <p className="text-sm text-muted-foreground">
          Add plugins to your Nextly config to extend functionality.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {activePlugin && (
        <div className="flex items-start gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-bold tracking-[-0.04em] text-foreground leading-tight">
                {name}
              </h1>
              {version && (
                <span className="mt-1 inline-flex items-center rounded-full bg-muted px-2.5 py-0.5 text-xs font-medium text-muted-foreground">
                  v{version}
                </span>
              )}
            </div>
            {description && (
              <p className="text-base text-muted-foreground">{description}</p>
            )}
          </div>
        </div>
      )}

      <div className="rounded-lg border border-border bg-card overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/30">
              <TableHead className="font-semibold">Name</TableHead>
              <TableHead className="font-semibold">Version</TableHead>
              <TableHead className="font-semibold">Placement</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {plugins.map(plugin => {
              const slug = toSlug(plugin.name);
              const isCurrent = slug === activeSlug;
              const placement = plugin.placement ?? plugin.group ?? "plugins";
              const iconName = plugin.appearance?.icon || "Package";
              const IconComponent =
                (Icons as Record<string, React.ElementType>)[iconName] ||
                Package;

              return (
                <TableRow
                  key={slug}
                  className={isCurrent ? "bg-primary/5" : undefined}
                >
                  <TableCell>
                    <Link
                      href={buildRoute(ROUTES.PLUGIN_SETTINGS, { slug })}
                      className="flex items-center gap-3 hover-unified"
                    >
                      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-primary/10">
                        <IconComponent className="h-4 w-4 text-primary" />
                      </div>
                      <div>
                        <p className="font-medium text-foreground">
                          {plugin.appearance?.label ?? plugin.name}
                        </p>
                        {plugin.description && (
                          <p className="text-xs text-muted-foreground line-clamp-1">
                            {plugin.description}
                          </p>
                        )}
                      </div>
                    </Link>
                  </TableCell>
                  <TableCell>
                    <span className="text-muted-foreground text-sm font-mono">
                      {plugin.version ?? "—"}
                    </span>
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline" className="text-xs capitalize">
                      {PLACEMENT_LABELS[placement] ?? placement}
                    </Badge>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
