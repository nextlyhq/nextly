"use client";

import { Badge } from "@nextlyhq/ui";
import {
  useQuery,
  useQueryClient,
  useSuspenseQuery,
} from "@tanstack/react-query";
import { Suspense } from "react";

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
import {
  PageErrorFallback,
  SectionErrorFallback,
} from "@admin/components/shared/error-fallbacks";
import { PluginIcon } from "@admin/components/shared/plugin-icon";
import { QueryErrorBoundary } from "@admin/components/shared/query-error-boundary";
import { Link } from "@admin/components/ui/link";
import { ROUTES, buildRoute } from "@admin/constants/routes";
import {
  useBranding,
  useBrandingStatus,
} from "@admin/context/providers/BrandingProvider";
import { API_PATH_PREFIX } from "@admin/lib/api/fetcher";
import { categoryLabel } from "@admin/lib/plugins/plugin-categories";
import { pluginSlug } from "@admin/lib/plugins/plugin-slug";
import { staticRegistrySource } from "@admin/lib/plugins/registry/static-source";
import { fetchPermissionsFromApi } from "@admin/services/realPermissionsApi";
import type { PluginMetadata } from "@admin/types/branding";

import { NotInstalledPlugin } from "./components/NotInstalledPlugin";
import { PluginPageLoading } from "./components/PluginPageLoading";
import { PluginStatusPill } from "./components/PluginsTable";

const PLACEMENT_LABELS: Record<string, string> = {
  collections: "Collections",
  singles: "Singles",
  users: "Users",
  settings: "Settings",
  plugins: "Plugins",
  standalone: "Standalone",
};

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

/**
 * A slug the project has no plugin for.
 *
 * Two outcomes, and they are different facts: the catalogue knows this package
 * and the reader has simply not installed it, or nothing knows it at all. The
 * first is the ordinary path from the directory, where most entries are not
 * installed, so it must not be reported as an error.
 *
 * Its own component because it queries the catalogue. Held inside
 * `PluginDetailContent` the query would run for every installed plugin too,
 * making a `QueryClientProvider` a requirement of rendering a page that has no
 * need of one.
 */
function UninstalledOrMissing({ activeSlug }: { activeSlug?: string }) {
  const { data: entries } = useSuspenseQuery({
    queryKey: ["plugin-registry"],
    queryFn: () => staticRegistrySource.list(),
  });
  const entry = activeSlug
    ? entries.find(e => pluginSlug(e.id) === activeSlug)
    : undefined;

  if (entry) {
    return (
      <div>
        <Breadcrumbs
          items={[
            { label: "Dashboard", href: ROUTES.DASHBOARD, isDashboard: true },
            { label: "Plugins", href: ROUTES.PLUGINS },
            { label: "Browse", href: ROUTES.PLUGIN_BROWSE },
            { label: entry.name },
          ]}
          className="mb-6"
        />
        <NotInstalledPlugin plugin={entry} />
      </div>
    );
  }

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
      <div className="rounded-lg border border-dashed border-border bg-card p-12 text-center">
        <Package className="h-10 w-10 text-muted-foreground mx-auto mb-4" />
        <h3 className="text-sm font-medium text-foreground mb-1">
          Plugin not found
        </h3>
        <p className="text-sm text-muted-foreground">
          No installed plugin matches this address, and it is not in the plugin
          directory either. It may have been removed from your Nextly config.
        </p>
      </div>
    </div>
  );
}

/**
 * Shown when admin-meta failed, so whether this plugin is installed is
 * unknown.
 *
 * Not the catalogue view: that one states the plugin is absent, which is a
 * claim this page cannot make when the request that would have told it failed.
 */
function InstalledPluginsUnavailable() {
  const queryClient = useQueryClient();

  return (
    <SectionErrorFallback
      title="Could not load your installed plugins"
      description="This page cannot tell whether the plugin is installed until the admin metadata loads."
      reset={() => {
        void queryClient.invalidateQueries({ queryKey: ["admin-meta"] });
      }}
    />
  );
}

function PluginDetailContent({ activeSlug }: { activeSlug?: string }) {
  const branding = useBranding();
  const { isPending, isUnavailable } = useBrandingStatus();
  const plugins = branding?.plugins ?? [];
  const plugin = activeSlug
    ? plugins.find(p => pluginSlug(p.name) === activeSlug)
    : undefined;

  // Installed metadata is observed; the catalogue is a claim, so the observed
  // one decides. Only when the project has no such plugin is the catalogue
  // consulted, and that lookup lives inside `UninstalledOrMissing` so its query
  // is not a dependency of rendering an installed plugin.
  //
  // Absence is only a fact once admin-meta has answered. Until then the list is
  // empty for a reason that says nothing about the project, and reading it as
  // "not installed" tells someone who HAS this plugin to go and install it.
  if (!plugin) {
    if (isPending) return <PluginPageLoading label="Loading plugin…" />;
    if (isUnavailable) return <InstalledPluginsUnavailable />;
    // Its own Suspense boundary: `UninstalledOrMissing` suspends on the
    // catalogue, and the nearest boundary above is RootLayout's
    // `fallback={null}`, which would blank the page for the duration.
    return (
      <Suspense fallback={<PluginPageLoading label="Loading plugin…" />}>
        <UninstalledOrMissing activeSlug={activeSlug} />
      </Suspense>
    );
  }

  const title = plugin.appearance?.label ?? plugin.name;

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

      {/* A CONTAINER query, not a viewport one. The two sidebars take a
          variable share of the window — around 630px with both open — so a
          `lg:` breakpoint would split a 1024px viewport into a 320px rail and
          a main column narrower than the rail. `@container/content` is
          declared on the dashboard's `<main>`, so this measures the space the
          page actually has and gains the second column when a sidebar
          collapses rather than when the window happens to grow.

          The rail is a fixed 20rem so the main column absorbs the rest;
          `minmax(0,1fr)` rather than `1fr` because a grid item's default
          `min-width: auto` lets a long unbroken string — a package name, an
          API route — push the column wider than its track instead of
          scrolling inside it. */}
      <div className="grid grid-cols-1 gap-8 @3xl/content:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="min-w-0">
          {/* Identity header */}
          <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div className="flex items-start gap-4">
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-md bg-primary/5">
                {/* Package, not Database: this page presents a plugin as the
                package you installed rather than as its collections. */}
                <PluginIcon
                  plugin={plugin}
                  fallback="Package"
                  className="h-6 w-6 text-primary"
                />
              </div>
              <div className="space-y-1">
                <div className="flex flex-wrap items-center gap-3">
                  <h1 className="text-xl font-semibold tracking-tight">
                    {title}
                  </h1>
                  {plugin.version && (
                    <span className="inline-flex items-center rounded-sm bg-primary/5 px-2.5 py-0.5 font-mono text-xs text-muted-foreground">
                      v{plugin.version}
                    </span>
                  )}
                  <PluginStatusPill enabled={plugin.enabled !== false} />
                  {plugin.category && (
                    <Badge
                      variant="default"
                      className="text-xs font-normal text-muted-foreground"
                    >
                      {categoryLabel(plugin.category)}
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
                    slug: pluginSlug(plugin.name),
                  })}
                  className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90"
                >
                  <SettingsIcon className="h-3.5 w-3.5" />
                  Open settings
                </Link>
              )}
            </div>
          </div>

          {/* What this plugin adds — computed from the plugin's registrations */}
          <Contributions plugin={plugin} />

          <WhenEnabled plugin={plugin} />
        </div>

        {/* `self-start` is what makes `sticky` work here: a grid item stretches
            to the row height by default, so the rail would be exactly as tall
            as the content it is meant to stay beside and never have anywhere
            to stick to. Sticky only once the columns exist — in the stacked
            layout the rail is the last thing on the page, and pinning it there
            would cover the content the reader scrolled to. */}
        <aside
          aria-label={`About ${title}`}
          className="@3xl/content:sticky @3xl/content:top-6 @3xl/content:self-start"
        >
          <About plugin={plugin} />
        </aside>
      </div>
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
    <div className="flex flex-wrap items-center gap-2">
      {links.map(link => (
        <a
          key={link.label}
          href={link.href}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-2.5 py-1.5 text-xs text-muted-foreground hover:bg-accent/10 hover:text-foreground"
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
/**
 * A plugin's permissions, read from the SEEDED ROWS rather than folded from the
 * configuration.
 *
 * The rows are what the seeder actually wrote, so Schema Builder entities,
 * `setup` transformers and orphan repair are all already accounted for — none
 * of which a fold over the configuration can see, because a Builder collection
 * exists only in `dynamic_collections`. It also keeps the permission vocabulary
 * off the public `admin-meta` payload, which served it to anonymous callers.
 *
 * `owner` is the DECLARING PLUGIN NAME, and the host's own sentinel is the
 * literal string `"app"`. A plugin legally named `app` is therefore
 * indistinguishable here from host-declared permissions, because the row
 * carries no `source` column to separate them — the collector computes that
 * distinction in memory and never persists it. Accepted rather than guarded:
 * the ambiguity needs a schema change to close, and it is recorded here so the
 * next reader is not surprised by it.
 *
 * Its own query rather than a suspending one, so a caller without the roles
 * read permission degrades THIS card instead of the page.
 */
function PluginPermissions({ pluginName }: { pluginName: string }) {
  const { data, isPending, isError } = useQuery({
    queryKey: ["plugin-permissions", pluginName],
    queryFn: () => fetchPermissionsFromApi({ limit: 200 }),
    // A refusal is an answer about this viewer's access, not a transient
    // failure, so retrying it only delays the message.
    retry: false,
  });

  const owned = (data?.data ?? []).filter(entry => entry.owner === pluginName);

  // Rendered even when empty, unlike the configuration-fed groups beside it.
  // An absent section reads as "this plugin declares none", which is a claim
  // this card cannot make while the request is pending or refused.
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="mb-2 flex items-center gap-2">
        <Shield className="h-4 w-4 text-muted-foreground" />
        <h3 className="text-sm font-medium text-foreground">Permissions</h3>
      </div>
      {isPending && (
        <p className="text-xs text-muted-foreground">Loading permissions…</p>
      )}
      {isError && (
        <p className="text-xs text-muted-foreground">
          Not available. Reading permissions needs the roles read permission, so
          this list is hidden rather than empty.
        </p>
      )}
      {!isPending && !isError && owned.length === 0 && (
        <p className="text-xs text-muted-foreground">
          This plugin declares no permissions.
        </p>
      )}
      {!isPending && !isError && owned.length > 0 && (
        <ul className="space-y-1.5">
          {owned.map(entry => (
            <li key={entry.id} className="text-sm text-foreground">
              {entry.name || `${entry.action}-${entry.resource}`}
              {entry.danger === true && (
                <span className="ml-2 text-xs text-muted-foreground">
                  danger
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

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
      key: "fieldGroups",
      label: "Field Groups",
      icon: Package,
      items: (plugin.fieldGroups ?? []).map(slug => ({ primary: slug })),
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
      key: "routes",
      label: "API routes",
      icon: Route,
      items: (plugin.routes ?? []).map(r => ({
        primary: `${r.method} ${API_PATH_PREFIX}${r.fullPath}`,
      })),
    },
  ].filter(group => group.items.length > 0);

  // NOT `groups.length === 0`: permissions come from their own query now, so a
  // plugin whose only contribution is a permission would have had the whole
  // section removed by a check that cannot see them.

  return (
    <section className="mb-8">
      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
        What this plugin adds
      </h2>
      {!enabled && (
        // Names which parts survive being disabled and which do not, because
        // this section now lists both. Permissions are seeded and granted for
        // every plugin, disabled included, so calling them inactive here would
        // contradict the roles UI that still offers them.
        //
        // The surfaces named as stopped are the ones the payload itself gates
        // on the enabled flag — routes, menu, pages and settings. It does not
        // say a grant is inert: a permission is a global slug, any component
        // may test it through the SDK's `useCan`, and a disabled plugin keeps
        // its field editors mounted for collections that already use them.
        <p className="mb-3 text-xs text-muted-foreground">
          This plugin is disabled: its collections, data and permissions are
          retained, and its permissions stay granted. Its API routes, admin
          pages, menu items and settings panel are not registered — though the
          field editors it contributes stay available to collections that use
          them.
        </p>
      )}
      {/* Auto-fitting tracks rather than a breakpoint. These cards sit inside
          the main column, whose width depends on whether the metadata rail is
          beside them — so no viewport breakpoint describes the space they
          have. At the width where the rail first appears the column is around
          22rem, and a viewport-based two-column rule would split that into
          ~10.5rem cards that wrap every route and permission label. A 16rem
          minimum track fits one card until there is genuinely room for two. */}
      <div className="grid grid-cols-[repeat(auto-fit,minmax(16rem,1fr))] gap-4">
        {groups.map(group => (
          <div
            key={group.key}
            className="rounded-lg border border-border bg-card p-4"
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
        <PluginPermissions pluginName={plugin.name} />
      </div>
    </section>
  );
}

/**
 * The endpoints a disabled plugin would serve once enabled.
 *
 * Routes only. A disabled plugin's PERMISSIONS are seeded like any other
 * plugin's — the permission fold runs over disabled plugins too — so they are
 * not pending on anything and presenting them here would say otherwise. Routes
 * are the half that genuinely does not exist yet: the route fold skips
 * disabled plugins entirely.
 *
 * Renders nothing when the server sent no dormant set, which is every enabled
 * plugin, every disabled one declaring no routes, and any whose declarations
 * could not mount.
 */
function WhenEnabled({ plugin }: { plugin: PluginMetadata }) {
  const routes = plugin.whenEnabled?.routes ?? [];
  if (routes.length === 0) return null;

  return (
    <section className="mb-8">
      <h2 className="mb-1 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
        Would serve when enabled
      </h2>
      {/* Names the restart because the config edit alone does not serve these.
          Config HMR re-evaluates the route module but does not re-run service
          registration, plugin initialization or route mounting — see
          `plugins/initialized-plugins.ts`, which states that a full restart is
          what actually enables a plugin. Telling an operator to flip the flag
          and stop there sends them to a route that still 404s. */}
      <p className="mb-3 text-xs text-muted-foreground">
        Declared by the plugin and not mounted while it is disabled. Enable it
        in your Nextly config and restart the app to serve these — editing the
        config alone does not mount them.
      </p>
      <div className="rounded-lg border border-dashed border-border bg-card p-4">
        <div className="mb-2 flex items-center gap-2">
          <Route className="h-4 w-4 text-muted-foreground" />
          <h3 className="text-sm font-medium text-foreground">API routes</h3>
          <span className="ml-auto text-xs text-muted-foreground">
            {routes.length}
          </span>
        </div>
        <ul className="space-y-1.5">
          {routes.map(r => (
            <li
              key={`${r.method}-${r.path}`}
              className="break-words font-mono text-sm text-foreground"
            >
              {`${r.method} ${API_PATH_PREFIX}${r.fullPath}`}
            </li>
          ))}
        </ul>
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
    <section>
      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
        About
      </h2>
      <div className="rounded-lg border border-border bg-card">
        <dl className="divide-y divide-border">
          {rows.map(row => (
            // Label above value, not a justify-between row. In a 20rem rail a
            // package name or a dependency range has no room left beside its
            // label, and right-aligning what then wraps ragged is harder to
            // scan than a plain stack.
            <div key={row.label} className="px-4 py-2.5">
              <dt className="text-xs text-muted-foreground">{row.label}</dt>
              <dd
                className={`mt-0.5 break-words text-sm text-foreground ${row.mono ? "font-mono" : ""}`}
              >
                {row.value}
              </dd>
            </div>
          ))}
          {plugin.tags && plugin.tags.length > 0 && (
            <div className="px-4 py-2.5">
              <dt className="text-xs text-muted-foreground">Tags</dt>
              <dd className="mt-1 flex flex-wrap gap-1.5">
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
      <div className="mt-3">
        <ExternalLinks plugin={plugin} />
      </div>

      <p className="mt-3 text-xs text-muted-foreground">
        Plugins are installed and updated with your package manager and wired in
        your Nextly config; there is nothing to install or update from this
        page.
      </p>
    </section>
  );
}
