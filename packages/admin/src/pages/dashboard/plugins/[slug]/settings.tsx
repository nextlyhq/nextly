"use client";

import type React from "react";

import { Package } from "@admin/components/icons";
import { PageContainer } from "@admin/components/layout/page-container";
import { Breadcrumbs } from "@admin/components/shared";
import { PageErrorFallback } from "@admin/components/shared/error-fallbacks";
import { PluginSlot } from "@admin/components/shared/plugin-slot";
import { QueryErrorBoundary } from "@admin/components/shared/query-error-boundary";
import { ROUTES, buildRoute } from "@admin/constants/routes";
import { useBranding } from "@admin/context/providers/BrandingProvider";

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
      <PageContainer>
        <PluginSettingsContent activeSlug={params?.slug} />
      </PageContainer>
    </QueryErrorBoundary>
  );
}

function PluginSettingsContent({ activeSlug }: { activeSlug?: string }) {
  const branding = useBranding();
  const plugins = branding?.plugins ?? [];
  const plugin = activeSlug
    ? plugins.find(p => toSlug(p.name) === activeSlug)
    : undefined;

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
        <div className="rounded-none border border-dashed border-border bg-card p-12 text-center">
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
