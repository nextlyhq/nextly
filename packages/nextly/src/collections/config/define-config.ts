/**
 * Define Config Helper
 *
 * Provides the `defineConfig()` function for creating the main Nextly
 * configuration file. This is the primary API for aggregating collections,
 * singles, and configuring TypeScript/database output paths.
 *
 * Type definitions and the pure sanitization step live in
 * `src/shared/types/config.ts`. This file keeps the validation logic
 * (duplicate slugs, component nesting depth, user-field constraints)
 * and re-exports the types for backwards compatibility.
 *
 * @module collections/config/define-config
 * @since 1.0.0
 *
 * @example
 * ```typescript
 * // nextly.config.ts
 * import { defineConfig } from '@nextly/core';
 * import Posts from './src/collections/posts';
 * import Users from './src/collections/users';
 * import Media from './src/collections/media';
 * import SiteSettings from './src/singles/site-settings';
 *
 * export default defineConfig({
 *   collections: [Posts, Users, Media],
 *   singles: [SiteSettings],
 *   typescript: {
 *     outputFile: './src/types/payload-types.ts',
 *   },
 * });
 * ```
 */

import { MAX_COMPONENT_NESTING_DEPTH } from "../../components/config/validate-component";
import {
  sanitizeConfig,
  type NextlyConfig,
  type SanitizedNextlyConfig,
} from "../../shared/types/config";
import { assertValidUserConfig } from "../../users/config/validate-user-config";

// Re-export config types so existing importers (`from "./define-config"`)
// keep working after the types moved to `src/shared/types/config.ts`.
export type {
  AdminBrandingColors,
  AdminBrandingConfig,
  AdminConfig,
  ApiKeysConfig,
  DatabaseConfig,
  NextlyConfig,
  PluginOverride,
  RateLimitingConfig,
  SanitizedApiKeysConfig,
  SanitizedNextlyConfig,
  SanitizedRateLimitingConfig,
  SecurityConfig,
  TypeScriptConfig,
} from "../../shared/types/config";

// Re-export sanitizeConfig for callers that want to sanitize without validating.
export { sanitizeConfig } from "../../shared/types/config";

// ============================================================
// Component Nesting Validation
// ============================================================

/**
 * Collects all component slugs referenced by component fields in a fields array.
 * Recursively traverses array and group fields to find nested component references.
 */
function collectComponentRefs(
  fields: {
    type?: string;
    component?: string;
    components?: string[];
    fields?: unknown[];
  }[],
  refs: string[]
): void {
  for (const field of fields) {
    if (field.type === "component") {
      if (typeof field.component === "string") {
        refs.push(field.component);
      }
      if (Array.isArray(field.components)) {
        for (const slug of field.components) {
          if (typeof slug === "string") {
            refs.push(slug);
          }
        }
      }
    }
    // Recurse into array/group fields
    if (Array.isArray(field.fields)) {
      collectComponentRefs(
        field.fields as {
          type?: string;
          component?: string;
          components?: string[];
          fields?: unknown[];
        }[],
        refs
      );
    }
  }
}

/**
 * Validates that component nesting has no circular references and
 * does not exceed the maximum nesting depth.
 *
 * Uses DFS cycle detection and longest-path calculation on the
 * component dependency graph.
 *
 * @throws Error if circular references or excessive nesting depth detected
 */
function validateComponentNesting(
  components: { slug: string; fields: unknown[] }[]
): void {
  // Build adjacency list: component slug -> slugs it references
  const graph = new Map<string, string[]>();
  const slugSet = new Set<string>();

  for (const comp of components) {
    const slug = comp.slug.toLowerCase();
    slugSet.add(slug);
    const refs: string[] = [];
    collectComponentRefs(
      comp.fields as {
        type?: string;
        component?: string;
        components?: string[];
        fields?: unknown[];
      }[],
      refs
    );
    // Only include refs to known component slugs
    graph.set(
      slug,
      refs.filter(r => slugSet.has(r.toLowerCase())).map(r => r.toLowerCase())
    );
  }

  // Re-filter refs now that we have all slugs (needed because
  // components may be defined in any order)
  for (const [slug, refs] of graph) {
    graph.set(
      slug,
      refs.filter(r => slugSet.has(r))
    );
  }

  // DFS to detect cycles
  const visited = new Set<string>();
  const inStack = new Set<string>();

  function detectCycle(slug: string, path: string[]): string[] | null {
    if (inStack.has(slug)) {
      return [...path, slug]; // Cycle found
    }
    if (visited.has(slug)) return null;

    visited.add(slug);
    inStack.add(slug);

    for (const ref of graph.get(slug) ?? []) {
      const cycle = detectCycle(ref, [...path, slug]);
      if (cycle) return cycle;
    }

    inStack.delete(slug);
    return null;
  }

  for (const slug of graph.keys()) {
    if (!visited.has(slug)) {
      const cycle = detectCycle(slug, []);
      if (cycle) {
        // Format: a → b → c → a
        const cycleStr = cycle.join(" → ");
        throw new Error(
          `Circular component reference detected: ${cycleStr}. ` +
            `Components cannot reference each other in a cycle.`
        );
      }
    }
  }

  // Check max nesting depth (longest path in DAG)
  const depthCache = new Map<string, number>();

  function getMaxDepth(slug: string): number {
    if (depthCache.has(slug)) return depthCache.get(slug)!;

    const refs = graph.get(slug) ?? [];
    let maxChildDepth = 0;

    for (const ref of refs) {
      maxChildDepth = Math.max(maxChildDepth, getMaxDepth(ref));
    }

    const depth = 1 + maxChildDepth;
    depthCache.set(slug, depth);
    return depth;
  }

  for (const slug of graph.keys()) {
    const depth = getMaxDepth(slug);
    if (depth > MAX_COMPONENT_NESTING_DEPTH) {
      throw new Error(
        `Component nesting depth exceeds maximum of ${MAX_COMPONENT_NESTING_DEPTH} levels ` +
          `(component '${slug}' has a nesting chain ${depth} levels deep). ` +
          `Simplify the component structure to reduce nesting.`
      );
    }
  }
}

// ============================================================
// defineConfig Function
// ============================================================

/**
 * Validate a raw Nextly configuration.
 *
 * Runs slug uniqueness checks across collections/singles/components,
 * component nesting depth + cycle detection, and user-field constraints.
 * Returns nothing — throws on validation failure.
 */
function validateNextlyConfig(config: NextlyConfig): void {
  const collections = config.collections ?? [];
  const slugs = new Set<string>();

  for (const collection of collections) {
    const slug = collection.slug.toLowerCase();

    if (slugs.has(slug)) {
      throw new Error(
        `Duplicate collection slug: '${collection.slug}'. ` +
          `Each collection must have a unique slug.`
      );
    }

    slugs.add(slug);
  }

  const singles = config.singles ?? [];

  for (const single of singles) {
    const slug = single.slug.toLowerCase();

    if (slugs.has(slug)) {
      const isCollectionConflict = collections.some(
        c => c.slug.toLowerCase() === slug
      );

      if (isCollectionConflict) {
        throw new Error(
          `Single slug '${single.slug}' conflicts with a Collection slug. ` +
            `Singles and Collections must have unique slugs.`
        );
      } else {
        throw new Error(
          `Duplicate Single slug: '${single.slug}'. ` +
            `Each Single must have a unique slug.`
        );
      }
    }

    slugs.add(slug);
  }

  const components = config.components ?? [];

  for (const comp of components) {
    const slug = comp.slug.toLowerCase();

    if (slugs.has(slug)) {
      const isCollectionConflict = collections.some(
        c => c.slug.toLowerCase() === slug
      );
      const isSingleConflict = singles.some(s => s.slug.toLowerCase() === slug);

      if (isCollectionConflict) {
        throw new Error(
          `Component slug '${comp.slug}' conflicts with a Collection slug. ` +
            `Components, Collections, and Singles must have unique slugs.`
        );
      } else if (isSingleConflict) {
        throw new Error(
          `Component slug '${comp.slug}' conflicts with a Single slug. ` +
            `Components, Collections, and Singles must have unique slugs.`
        );
      } else {
        throw new Error(
          `Duplicate Component slug: '${comp.slug}'. ` +
            `Each Component must have a unique slug.`
        );
      }
    }

    slugs.add(slug);
  }

  if (components.length > 0) {
    validateComponentNesting(components);
  }

  if (config.users) {
    assertValidUserConfig(config.users);
  }
}

/**
 * Define the Nextly configuration for your application.
 *
 * This is the main entry point for configuring Nextly. It validates
 * the configuration, applies sensible defaults via `sanitizeConfig()`,
 * and returns a fully normalized config object.
 *
 * **Validation:**
 * - Checks for duplicate collection slugs
 * - Checks for duplicate single slugs
 * - Checks for slug conflicts between collections and singles
 * - Checks for component nesting depth and circular references
 * - Validates user-field constraints
 *
 * **Defaults Applied (via sanitizeConfig):**
 * - `collections`: `[]`
 * - `singles`: `[]`
 * - `components`: `[]`
 * - `typescript.outputFile`: `'./src/types/generated/payload-types.ts'`
 * - `typescript.declare`: `true`
 * - `db.schemasDir`: `'./src/db/schemas/collections'`
 * - `db.migrationsDir`: `'./src/db/migrations'`
 * - `storage`: `[]`
 * - `plugins`: `[]`
 * - `rateLimit`: enabled with defaults (100 read / 30 write per minute)
 *
 * @param config - The Nextly configuration object
 * @returns Normalized configuration with all defaults applied
 * @throws Error if configuration is invalid (e.g., duplicate slugs)
 */
export function defineConfig(config: NextlyConfig): SanitizedNextlyConfig {
  validateNextlyConfig(config);
  return sanitizeConfig(config);
}
