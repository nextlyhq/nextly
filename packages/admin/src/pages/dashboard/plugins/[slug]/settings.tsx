"use client";

import type React from "react";

import { PermissionGuard } from "@admin/components/guards/PermissionGuard";
import { Package } from "@admin/components/icons";
import { PageContainer } from "@admin/components/layout/page-container";
import { Breadcrumbs } from "@admin/components/shared";
import { PageErrorFallback } from "@admin/components/shared/error-fallbacks";
import { PluginSlot } from "@admin/components/shared/plugin-slot";
import { QueryErrorBoundary } from "@admin/components/shared/query-error-boundary";
import { ROUTES, buildRoute } from "@admin/constants/routes";
import {
  useBranding,
  useBrandingStatus,
} from "@admin/context/providers/BrandingProvider";
import { UPDATE_SETTINGS } from "@admin/lib/permissions/system-policy";
import { pluginSlug } from "@admin/lib/plugins/plugin-slug";
import type { PluginMetadata } from "@admin/types/branding";

import { InstalledPluginsUnavailable } from "../components/InstalledPluginsUnavailable";
import { PluginPageLoading } from "../components/PluginPageLoading";

interface PluginSettingsPageProps {
  params?: { slug?: string };
}

/**
 * Plugin Settings Page
 *
 * Renders a plugin's own settings component full-page. The detail page
 * (`/admin/plugins/[slug]`) stays informational and links here, so a plugin
 * with a large settings UI gets a whole page rather than an embedded box.
 *
 * Route: /admin/plugins/[slug]/settings
 */
export default function PluginSettingsPage({
  params,
}: PluginSettingsPageProps): React.ReactElement {
  return (
    <QueryErrorBoundary fallback={<PageErrorFallback />}>
      <PluginSettingsGate activeSlug={params?.slug}>
        <PageContainer>
          <PluginSettingsContent activeSlug={params?.slug} />
        </PageContainer>
      </PluginSettingsGate>
    </QueryErrorBoundary>
  );
}

/** The installed plugin this page's address names, if any. */
function pluginAt(
  plugins: PluginMetadata[] | undefined,
  activeSlug: string | undefined
): PluginMetadata | undefined {
  return activeSlug
    ? plugins?.find(p => pluginSlug(p.name) === activeSlug)
    : undefined;
}

/**
 * Admit only a caller holding the permission a change to this plugin's
 * settings needs, as the server publishes it in the plugin's metadata.
 *
 * Decided here rather than in the route table, which can only name one
 * permission for every plugin: a settings permission there shut out the role
 * a plugin keeps its settings to, and showed a settings holder an editor
 * whose saves the server refuses. It never gates on a default it
 * merely assumed: while the plugin list is loading it waits, and when the list
 * never arrived it says so, since either way the page cannot know what to ask
 * for, and the default would send away the plugin's own role and admit the one
 * it replaced. A plugin missing from a list that did arrive, or a server that
 * does not name the permission, keeps core's default, a settings change
 * (`update-settings`; `manage-settings` still counts as it).
 */
function PluginSettingsGate({
  activeSlug,
  children,
}: {
  activeSlug?: string;
  children: React.ReactNode;
}) {
  const branding = useBranding();
  const status = useBrandingStatus();
  const unresolved = unresolvedPluginList(branding?.plugins, status);
  if (unresolved) return unresolved;
  return (
    <PermissionGuard
      requiredPermission={settingsPermissionAt(branding?.plugins, activeSlug)}
    >
      {children}
    </PermissionGuard>
  );
}

/**
 * What the gate shows while there is no plugin list to read, or `undefined`
 * once there is one.
 *
 * Only a request that never answered is an outage. A settled answer for a
 * project with no plugins carries no list at all, and is read as an empty
 * one: the plugin is not found, under core's permission.
 */
function unresolvedPluginList(
  plugins: PluginMetadata[] | undefined,
  status: { isPending: boolean; isUnavailable: boolean }
): React.ReactElement | undefined {
  if (plugins !== undefined) return undefined;
  if (status.isPending) return <PluginPageLoading label="Loading plugin…" />;
  if (status.isUnavailable) return <InstalledPluginsUnavailable />;
  return undefined;
}

/**
 * The permission the plugin's metadata names for its settings, or core's.
 * Exported so a test can ask what the guard asks.
 */
export function settingsPermissionAt(
  plugins: PluginMetadata[] | undefined,
  activeSlug: string | undefined
): string {
  return (
    pluginAt(plugins, activeSlug)?.settings?.permission ?? UPDATE_SETTINGS
  );
}

function PluginSettingsContent({ activeSlug }: { activeSlug?: string }) {
  const branding = useBranding();
  const plugin = pluginAt(branding?.plugins, activeSlug);

  const title = plugin?.appearance?.label ?? plugin?.name;
  // A disabled plugin's settings UI must not load: its behavior is off, so a
  // form that pretends to configure it would be a lie.
  const settingsComponent =
    plugin && plugin.enabled !== false ? plugin.settings?.component : undefined;

  return (
    <div>
      <Breadcrumbs
        items={[
          { label: "Dashboard", href: ROUTES.DASHBOARD, isDashboard: true },
          { label: "Plugins", href: ROUTES.PLUGINS },
          ...(plugin
            ? [
                {
                  label: title!,
                  href: buildRoute(ROUTES.PLUGIN_DETAIL, {
                    slug: activeSlug!,
                  }),
                },
              ]
            : []),
          { label: "Settings" },
        ]}
        className="mb-6"
      />

      {settingsComponent ? (
        <PluginSlot
          path={settingsComponent}
          props={{ plugin: plugin as unknown as Record<string, unknown> }}
        />
      ) : (
        <div className="rounded-lg border border-dashed border-border bg-card p-12 text-center">
          <Package className="h-10 w-10 text-muted-foreground mx-auto mb-4" />
          <h3 className="text-sm font-medium text-foreground mb-1">
            {plugin ? "No settings to show" : "Plugin not found"}
          </h3>
          <p className="text-sm text-muted-foreground">
            {plugin
              ? plugin.enabled === false
                ? "This plugin is disabled, so its settings are unavailable."
                : "This plugin does not provide a settings screen."
              : "No installed plugin matches this address."}
          </p>
        </div>
      )}
    </div>
  );
}
