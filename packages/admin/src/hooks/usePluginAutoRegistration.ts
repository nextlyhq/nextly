"use client";

/**
 * Plugin Auto-Registration Hook
 *
 * Automatically registers plugin components when collections are loaded.
 * Extracts component paths from collection configs and triggers
 * auto-registration for known plugins.
 *
 * @module hooks/usePluginAutoRegistration
 * @since 1.0.0
 */

import { useEffect, useRef } from "react";

import { autoRegisterPluginComponents } from "@admin/lib/plugins/component-registry";
import type { ApiCollection } from "@admin/types/entities";

/**
 * Extract all component paths from a collection's admin config.
 *
 * @param collection - Collection to extract paths from
 * @returns Array of component path strings
 */
function extractComponentPaths(collection: ApiCollection): string[] {
  const paths: string[] = [];
  const components = collection.admin?.components;

  if (!components) {
    return paths;
  }

  // Extract view components
  if (components.views?.Edit?.Component) {
    paths.push(components.views.Edit.Component);
  }
  if (components.views?.List?.Component) {
    paths.push(components.views.List.Component);
  }

  // Extract injection point components
  if (components.BeforeListTable) {
    paths.push(components.BeforeListTable);
  }
  if (components.AfterListTable) {
    paths.push(components.AfterListTable);
  }
  if (components.BeforeEdit) {
    paths.push(components.BeforeEdit);
  }
  if (components.AfterEdit) {
    paths.push(components.AfterEdit);
  }

  return paths;
}

/**
 * Extract all component paths from multiple collections.
 *
 * @param collections - Array of collections
 * @returns Array of unique component path strings
 */
function extractAllComponentPaths(collections: ApiCollection[]): string[] {
  const allPaths: string[] = [];

  for (const collection of collections) {
    const paths = extractComponentPaths(collection);
    allPaths.push(...paths);
  }

  // Return unique paths
  return [...new Set(allPaths)];
}

/**
 * Hook to auto-register plugin components when collections are loaded.
 *
 * Call this hook in any component that loads collections to ensure
 * plugin components are registered before they're needed.
 *
 * @param collections - Array of loaded collections (can be undefined while loading)
 *
 * @example
 * ```tsx
 * function EntryPage() {
 *   const { data: collections } = useCollections();
 *
 *   // Auto-register plugins when collections load
 *   usePluginAutoRegistration(collections?.data);
 *
 *   // Rest of component...
 * }
 * ```
 */
export function usePluginAutoRegistration(
  collections: ApiCollection[] | undefined
): void {
  // Track if we've already triggered registration
  const hasTriggeredRef = useRef(false);

  useEffect(() => {
    // Only trigger once when collections are available
    if (!collections || hasTriggeredRef.current) {
      return;
    }

    const componentPaths = extractAllComponentPaths(collections);

    if (componentPaths.length > 0) {
      hasTriggeredRef.current = true;
      autoRegisterPluginComponents(componentPaths).catch(error => {
        console.error(
          "[usePluginAutoRegistration] Auto-registration failed:",
          error
        );
      });
    }
  }, [collections]);
}
