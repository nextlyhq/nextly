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
import { publicApi } from "@admin/lib/api/publicApi";
import {
  shouldShowFeatured,
  staticRegistrySource,
} from "@admin/lib/plugins/registry/static-source";
import type { RegistryPlugin } from "@admin/lib/plugins/registry/types";
import type { AdminBranding, PluginMetadata } from "@admin/types/branding";

import { PluginCard } from "./components/PluginCard";

/** Name, description and tags. Author is deliberately not searched: every
 *  first-party entry shares one, so it would match the whole catalogue. */
function matches(plugin: RegistryPlugin, query: string): boolean {
  const haystack = [plugin.name, plugin.description, ...(plugin.tags ?? [])]
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

  const { data: branding } = useSuspenseQuery({
    queryKey: ["admin-meta"],
    queryFn: () => publicApi.get<AdminBranding>("/admin-meta"),
    staleTime: 5 * 60 * 1000,
  });
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
    () => (normalized ? entries.filter(e => matches(e, normalized)) : entries),
    [entries, normalized]
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

  return (
    <>
      <div className="mb-6 max-w-sm">
        <SearchBar
          value={query}
          onChange={setQuery}
          placeholder="Search plugins"
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
          {showFeatured ? "All plugins" : "Plugins"}
        </h2>
        {visible.length > 0 ? (
          <PluginGrid plugins={visible} installedByName={installedByName} />
        ) : (
          <p className="rounded-lg border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
            No plugins match “{query.trim()}”.
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
