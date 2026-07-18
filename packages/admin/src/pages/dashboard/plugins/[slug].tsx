"use client";

import { Badge } from "@nextlyhq/ui";
import type React from "react";

import * as Icons from "@admin/components/icons";
import {
  BookOpen,
  ExternalLink,
  FileText,
  Github,
  Globe,
  LayoutDashboard,
  Layers,
  Menu as MenuIcon,
  Package,
  Route,
  Settings as SettingsIcon,
  Shield,
} from "@admin/components/icons";
import { PageContainer } from "@admin/components/layout/page-container";
import { Breadcrumbs } from "@admin/components/shared";
import { PageErrorFallback } from "@admin/components/shared/error-fallbacks";
import { QueryErrorBoundary } from "@admin/components/shared/query-error-boundary";
import { Link } from "@admin/components/ui/link";
import { ROUTES, buildRoute } from "@admin/constants/routes";
import { useBranding } from "@admin/context/providers/BrandingProvider";
import type { PluginMetadata } from "@admin/types/branding";

import { PluginStatusPill } from "./components/PluginsTable";

/** Human labels for the category vocabulary plugins declare. */
const CATEGORY_LABELS: Record<string, string> = {
  content: "Content",
  forms: "Forms",
  seo: "SEO",
  media: "Media",
  commerce: "Commerce",
  integration: "Integration",
  "dev-tools": "Dev Tools",
  other: "Other",
};

const PLACEMENT_LABELS: Record<string, string> = {
  collections: "Collections",
  singles: "Singles",
  users: "Users",
  settings: "Settings",
  plugins: "Plugins",
  standalone: "Standalone",
};

function toSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

interface PluginDetailPageProps {
  params?: { slug?: string };
}

/**
 * Plugin Detail Page
 *
 * One destination per installed plugin: identity metadata, what the plugin
 * adds to this application (computed from its real registrations, not
 * marketing copy), its own settings UI when it ships one, and an About
 * section with links. Install/update/remove are npm + config operations and
 * are deliberately not offered here.
 *
 * Route: /admin/plugins/[slug]
 */
export default function PluginDetailPage({
  params,
}: PluginDetailPageProps): React.ReactElement {
  return (
    <QueryErrorBoundary fallback={<PageErrorFallback />}>
      <PageContainer>
        <PluginDetailContent activeSlug={params?.slug} />
      </PageContainer>
    </QueryErrorBoundary>
  );
}

function PluginDetailContent({ activeSlug }: { activeSlug?: string }) {
  const branding = useBranding();
  const plugins = branding?.plugins ?? [];
  const plugin = activeSlug
    ? plugins.find(p => toSlug(p.name) === activeSlug)
    : undefined;

  if (!plugin) {
    return (
      <div>
        <Breadcrumbs
          items={[
            { label: "Dashboard", href: ROUTES.DASHBOARD, isDashboard: true },
            { label: "Plugins", href: ROUTES.PLUGINS },
            { label: "Not found" },
          ]}
          className="mb-6"
        />
        <div className="rounded-none border border-dashed border-border bg-card p-12 text-center">
          <Package className="h-10 w-10 text-muted-foreground mx-auto mb-4" />
          <h3 className="text-sm font-medium text-foreground mb-1">
            Plugin not found
          </h3>
          <p className="text-sm text-muted-foreground">
            No installed plugin matches this address. It may have been removed
            from your Nextly config.
          </p>
        </div>
      </div>
    );
  }

  const title = plugin.appearance?.label ?? plugin.name;
  const iconName = plugin.appearance?.icon || "Package";
  const IconComponent =
    (Icons as Record<string, React.ElementType>)[iconName] || Package;

  return (
    <div>
      <Breadcrumbs
        items={[
          { label: "Dashboard", href: ROUTES.DASHBOARD, isDashboard: true },
          { label: "Plugins", href: ROUTES.PLUGINS },
          { label: title },
        ]}
        className="mb-6"
      />

      {/* Identity header */}
      <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex items-start gap-4">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-none bg-primary/5">
            <IconComponent className="h-6 w-6 text-primary" />
          </div>
          <div className="space-y-1">
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
              {plugin.version && (
                <span className="inline-flex items-center rounded-none bg-primary/5 px-2.5 py-0.5 font-mono text-xs text-muted-foreground">
                  v{plugin.version}
                </span>
              )}
              <PluginStatusPill enabled={plugin.enabled !== false} />
              {plugin.category && (
                <Badge
                  variant="default"
                  className="text-xs font-normal text-muted-foreground"
                >
                  {CATEGORY_LABELS[plugin.category] ?? plugin.category}
                </Badge>
              )}
            </div>
            {plugin.description && (
              // Muted foreground so this secondary description meets contrast (a faint primary alpha did not).
              <p className="text-sm font-normal text-muted-foreground">
                {plugin.description}
              </p>
            )}
            {plugin.author && (
              <p className="text-xs text-muted-foreground">
                by {plugin.author}
              </p>
            )}
          </div>
        </div>
        <div className="flex shrink-0 flex-col items-start gap-2 sm:items-end">
          {/* The settings UI gets its own page; the detail page stays
              informational and links to it. */}
          {plugin.enabled !== false && plugin.settings?.component && (
            <Link
              href={buildRoute(ROUTES.PLUGIN_SETTINGS, {
                slug: toSlug(plugin.name),
              })}
              className="inline-flex items-center gap-1.5 rounded-none bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90"
            >
              <SettingsIcon className="h-3.5 w-3.5" />
              Open settings
            </Link>
          )}
          <ExternalLinks plugin={plugin} />
        </div>
      </div>

      {/* What this plugin adds — computed from the plugin's registrations */}
      <Contributions plugin={plugin} />

      <About plugin={plugin} />
    </div>
  );
}

/** Quiet icon links to the plugin's homepage / repository / docs. */
function ExternalLinks({ plugin }: { plugin: PluginMetadata }) {
  const links = [
    plugin.homepage && {
      href: plugin.homepage,
      label: "Homepage",
      icon: Globe,
    },
    plugin.repository && {
      href: plugin.repository,
      label: "Repository",
      icon: Github,
    },
    plugin.docsUrl && {
      href: plugin.docsUrl,
      label: "Docs",
      icon: BookOpen,
    },
  ].filter(Boolean) as Array<{
    href: string;
    label: string;
    icon: React.ElementType;
  }>;

  if (links.length === 0) return null;

  return (
    <div className="flex shrink-0 items-center gap-2">
      {links.map(link => (
        <a
          key={link.label}
          href={link.href}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 rounded-none border border-border bg-background px-2.5 py-1.5 text-xs text-muted-foreground hover:bg-accent/10 hover:text-foreground"
        >
          <link.icon className="h-3.5 w-3.5" />
          {link.label}
          <ExternalLink className="h-3 w-3" />
        </a>
      ))}
    </div>
  );
}

interface ContributionGroup {
  key: string;
  label: string;
  icon: React.ElementType;
  items: Array<{ primary: string; secondary?: string; href?: string }>;
}

/**
 * "What this plugin adds": every surface the plugin registers, listed from
 * the serialized metadata the server already computed. Honest by
 * construction — an empty group simply is not rendered.
 */
function Contributions({ plugin }: { plugin: PluginMetadata }) {
  const enabled = plugin.enabled !== false;

  const groups: ContributionGroup[] = [
    {
      key: "collections",
      label: "Collections",
      icon: Layers,
      items: (plugin.collections ?? []).map(slug => ({
        primary: slug,
        href: `/admin/collections/${slug}`,
      })),
    },
    {
      key: "singles",
      label: "Singles",
      icon: FileText,
      items: (plugin.singles ?? []).map(slug => ({ primary: slug })),
    },
    {
      key: "components",
      label: "Components",
      icon: Package,
      items: (plugin.components ?? []).map(slug => ({ primary: slug })),
    },
    {
      key: "menu",
      label: "Navigation items",
      icon: MenuIcon,
      items: (plugin.menu ?? []).map(item => ({
        primary: item.label,
        secondary: item.to,
        href: item.to,
      })),
    },
    {
      key: "pages",
      label: "Admin pages",
      icon: LayoutDashboard,
      items: (plugin.pages ?? []).map(page => ({
        primary: page.path,
        secondary: page.requiredPermission
          ? `requires ${page.requiredPermission}`
          : undefined,
      })),
    },
    {
      key: "widgets",
      label: "Dashboard widgets",
      icon: LayoutDashboard,
      items: (plugin.widgets ?? []).map(widget => ({
        primary: widget.id,
        secondary: widget.size ? `${widget.size} width` : undefined,
      })),
    },
    {
      key: "fieldTypes",
      label: "Field types",
      icon: SettingsIcon,
      items: (plugin.fieldTypes ?? []).map(ft => ({ primary: ft.type })),
    },
    {
      key: "permissions",
      label: "Permissions",
      icon: Shield,
      items: (plugin.permissions ?? []).map(p => ({
        primary: p.label ?? `${p.action}-${p.resource}`,
        secondary: p.danger ? "danger" : undefined,
      })),
    },
    {
      key: "routes",
      label: "API routes",
      icon: Route,
      items: (plugin.routes ?? []).map(r => ({
        primary: `${r.method} /api/plugins/${toSlug(plugin.name)}${r.path}`,
      })),
    },
  ].filter(group => group.items.length > 0);

  if (groups.length === 0) return null;

  return (
    <section className="mb-8">
      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
        What this plugin adds
      </h2>
      {!enabled && (
        <p className="mb-3 text-xs text-muted-foreground">
          This plugin is disabled: its collections and data are retained, but
          its behavior does not load.
        </p>
      )}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
        {groups.map(group => (
          <div
            key={group.key}
            className="rounded-none border border-border bg-card p-4"
          >
            <div className="mb-2 flex items-center gap-2">
              <group.icon className="h-4 w-4 text-muted-foreground" />
              <h3 className="text-sm font-medium text-foreground">
                {group.label}
              </h3>
              <span className="ml-auto text-xs text-muted-foreground">
                {group.items.length}
              </span>
            </div>
            <ul className="space-y-1.5">
              {group.items.map(item => (
                <li key={`${item.primary}-${item.secondary ?? ""}`}>
                  {item.href ? (
                    <Link
                      href={item.href}
                      className="text-sm text-foreground hover-unified"
                    >
                      {item.primary}
                    </Link>
                  ) : (
                    <span className="font-mono text-sm text-foreground">
                      {item.primary}
                    </span>
                  )}
                  {item.secondary && (
                    <span className="ml-2 text-xs text-muted-foreground">
                      {item.secondary}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </section>
  );
}

/** License, compatibility, dependencies, placement, tags. */
function About({ plugin }: { plugin: PluginMetadata }) {
  const placement = plugin.placement ?? plugin.group ?? "plugins";
  const dependsOn = Object.entries(plugin.dependsOn ?? {});

  const rows = [
    { label: "Package", value: plugin.name, mono: true },
    plugin.version && {
      label: "Installed version",
      value: plugin.version,
      mono: true,
    },
    plugin.license && { label: "License", value: plugin.license },
    {
      label: "Sidebar placement",
      value: PLACEMENT_LABELS[placement] ?? placement,
    },
    dependsOn.length > 0 && {
      label: "Depends on",
      value: dependsOn.map(([name, range]) => `${name} ${range}`).join(", "),
      mono: true,
    },
  ].filter(Boolean) as Array<{ label: string; value: string; mono?: boolean }>;

  return (
    <section className="mb-8">
      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
        About
      </h2>
      <div className="rounded-none border border-border bg-card">
        <dl className="divide-y divide-border">
          {rows.map(row => (
            <div
              key={row.label}
              className="flex items-baseline justify-between gap-4 px-4 py-2.5"
            >
              <dt className="text-sm text-muted-foreground">{row.label}</dt>
              <dd
                className={`text-right text-sm text-foreground ${row.mono ? "font-mono" : ""}`}
              >
                {row.value}
              </dd>
            </div>
          ))}
          {plugin.tags && plugin.tags.length > 0 && (
            <div className="flex items-baseline justify-between gap-4 px-4 py-2.5">
              <dt className="text-sm text-muted-foreground">Tags</dt>
              <dd className="flex flex-wrap justify-end gap-1.5">
                {plugin.tags.map(tag => (
                  <Badge
                    key={tag}
                    variant="outline"
                    className="text-xs font-normal text-muted-foreground"
                  >
                    {tag}
                  </Badge>
                ))}
              </dd>
            </div>
          )}
        </dl>
      </div>
      <p className="mt-3 text-xs text-muted-foreground">
        Plugins are installed and updated with your package manager and wired in
        your Nextly config; there is nothing to install or update from this
        page.
      </p>
    </section>
  );
}
