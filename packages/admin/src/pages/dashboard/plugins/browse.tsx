"use client";

/**
 * Plugin Directory
 *
 * Browse the plugins Nextly publishes, see which are already installed, and
 * get the commands to add one. Discovery only: installing a plugin means
 * adding a dependency and a line to `nextly.config.ts`, so this page never
 * writes to a project's source and never mutates plugin state.
 *
 * @module pages/dashboard/plugins/browse
 */

import { useSuspenseQuery } from "@tanstack/react-query";
import type React from "react";
import { Suspense, useMemo, useState } from "react";

import { PageContainer } from "@admin/components/layout/page-container";
import { Breadcrumbs } from "@admin/components/shared";
import { PageErrorFallback } from "@admin/components/shared/error-fallbacks";
import { QueryErrorBoundary } from "@admin/components/shared/query-error-boundary";
import { SearchBar } from "@admin/components/shared/search-bar";
import { ROUTES } from "@admin/constants/routes";
import {
  useBranding,
  useBrandingStatus,
} from "@admin/context/providers/BrandingProvider";
import { resolveCataloguePresentation } from "@admin/lib/plugins/registry/resolve-catalogue-presentation";
import {
  shouldShowFeatured,
  staticRegistrySource,
} from "@admin/lib/plugins/registry/static-source";
import type { RegistryPlugin } from "@admin/lib/plugins/registry/types";
import type { PluginMetadata } from "@admin/types/branding";

import { InstalledPluginsUnavailable } from "./components/InstalledPluginsUnavailable";
import { PluginCard } from "./components/PluginCard";
import { PluginPageLoading } from "./components/PluginPageLoading";

/**
 * Name, the RENDERED description, and tags.
 *
 * The description comes from the same resolution the card renders, so an
 * installed plugin is searched by the text a reader can actually see. Reading
 * `plugin.description` here instead would search the catalogue's copy while
 * the card shows the plugin's own, and typing a word visibly on screen would
 * make that card disappear.
 *
 * Author is deliberately not searched: every first-party entry shares one, so
 * it would match the whole catalogue.
 */
function matches(
  plugin: RegistryPlugin,
  installed: Pick<PluginMetadata, "appearance" | "description"> | undefined,
  query: string
): boolean {
  const { description } = resolveCataloguePresentation(plugin, installed);
  const haystack = [plugin.name, description, ...(plugin.tags ?? [])]
    .join(" ")
    .toLowerCase();
  return haystack.includes(query);
}

function PluginGrid({
  plugins,
  installedByName,
}: {
  plugins: RegistryPlugin[];
  installedByName: Map<string, PluginMetadata>;
}): React.ReactElement {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
      {plugins.map(plugin => (
        <PluginCard
          key={plugin.id}
          plugin={plugin}
          installed={installedByName.get(plugin.id)}
        />
      ))}
    </div>
  );
}

function BrowseContent(): React.ReactElement {
  const [query, setQuery] = useState("");

  // Read through the provider rather than a second query of its own. The
  // plugin list is served by the session-gated route, and a duplicate reader
  // pointed at the public one shares the same cache key while asking a
  // question that route no longer answers — every installed plugin would read
  // as uninstalled.
  const branding = useBranding();
  const { isPending: pluginsPending, isUnavailable: pluginsUnavailable } =
    useBrandingStatus();
  const { data: entries } = useSuspenseQuery({
    queryKey: ["plugin-registry"],
    queryFn: () => staticRegistrySource.list(),
  });
  const { data: featuredIds } = useSuspenseQuery({
    queryKey: ["plugin-registry-featured"],
    queryFn: () => staticRegistrySource.featured(),
  });

  // Installed truth comes from admin-meta and nothing else. An entry absent
  // from it is not installed; an installed plugin absent from the catalogue is
  // private or third-party and is correctly not listed here.
  const installedByName = useMemo(() => {
    const map = new Map<string, PluginMetadata>();
    for (const plugin of branding?.plugins ?? []) map.set(plugin.name, plugin);
    return map;
  }, [branding?.plugins]);

  const normalized = query.trim().toLowerCase();
  const visible = useMemo(
    () =>
      normalized
        ? entries.filter(e => matches(e, installedByName.get(e.id), normalized))
        : entries,
    [entries, installedByName, normalized]
  );

  const featured = useMemo(
    () =>
      featuredIds
        .map(id => entries.find(e => e.id === id))
        .filter((e): e is RegistryPlugin => e !== undefined),
    [entries, featuredIds]
  );

  // The strip is a recommendation, so it is hidden while searching: a filtered
  // grid is the user's own list, and a fixed "start here" row above it answers
  // a question they stopped asking.
  const showFeatured = !normalized && shouldShowFeatured(entries, featuredIds);

  // The grid holds what the strip does not. Showing every entry below a strip
  // that repeats two of them puts the same card on screen twice, which reads
  // as a rendering fault rather than as a recommendation.
  const featuredIdSet = useMemo(
    () => new Set(showFeatured ? featuredIds : []),
    [showFeatured, featuredIds]
  );
  const rest = useMemo(
    () => visible.filter(e => !featuredIdSet.has(e.id)),
    [visible, featuredIdSet]
  );

  // Installed status is read from a list that arrives separately from the
  // catalogue. Until it has, every entry looks uninstalled — which tells
  // someone who already has a plugin to go and install it — so the directory
  // waits rather than rendering a claim it cannot yet support.
  if (pluginsPending) return <PluginPageLoading label="Loading directory…" />;
  // A request that never answered is not an empty install list. Reporting
  // every catalogue entry as uninstalled from an unanswered query tells
  // someone who has the plugin to install it again, so the failure is shown
  // instead of a claim derived from it.
  if (pluginsUnavailable) return <InstalledPluginsUnavailable />;

  return (
    <>
      <div className="mb-6 max-w-sm">
        <SearchBar
          value={query}
          onChange={setQuery}
          placeholder="Search the directory"
        />
      </div>

      {showFeatured && (
        <section className="mb-8" aria-labelledby="featured-plugins">
          <h2
            id="featured-plugins"
            className="mb-3 text-xs font-medium uppercase tracking-wide text-muted-foreground"
          >
            Start here
          </h2>
          <PluginGrid plugins={featured} installedByName={installedByName} />
        </section>
      )}

      <section aria-labelledby="all-plugins">
        <h2
          id="all-plugins"
          className="mb-3 text-xs font-medium uppercase tracking-wide text-muted-foreground"
        >
          {showFeatured ? "More plugins" : "Plugins"}
        </h2>
        {rest.length > 0 ? (
          <PluginGrid plugins={rest} installedByName={installedByName} />
        ) : (
          // Two different nothings. A search that matched nothing names the
          // term, because the reader chose it and can edit it; an empty
          // catalogue must not, since quoting an empty string reads as a bug.
          <p className="rounded-lg border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
            {normalized
              ? `No plugins match “${query.trim()}”.`
              : "No plugins to show yet."}
          </p>
        )}
      </section>
    </>
  );
}

const PluginBrowsePage: React.FC = () => (
  <QueryErrorBoundary fallback={<PageErrorFallback />}>
    <PageContainer>
      <Breadcrumbs
        items={[
          { label: "Dashboard", href: ROUTES.DASHBOARD, isDashboard: true },
          { label: "Plugins", href: ROUTES.PLUGINS },
          { label: "Browse" },
        ]}
        className="mb-6"
      />

      <div className="mb-8">
        <h1 className="text-xl font-semibold tracking-tight">Browse plugins</h1>
        <p className="mt-1 text-sm font-normal text-muted-foreground">
          Plugins published by Nextly. Adding one is a dependency and a line in
          your Nextly config, so open a plugin to get both.
        </p>
      </div>

      <Suspense
        fallback={
          <div
            className="h-64 animate-pulse rounded-lg bg-muted/40"
            aria-hidden="true"
          />
        }
      >
        <BrowseContent />
      </Suspense>
    </PageContainer>
  </QueryErrorBoundary>
);

export default PluginBrowsePage;
