/**
 * Component Registry
 *
 * Provides a centralized registry for custom admin view components.
 * Plugins can register their components to replace default admin views
 * or inject components at specific locations in the admin UI.
 *
 * ## Component Path Format
 *
 * Component paths use the format: `"package-name/path#ExportName"`
 * - `package-name/path` is the module path (e.g., `@revnixhq/plugin-form-builder/admin`)
 * - `#ExportName` is the named export (e.g., `#FormBuilderView`)
 *
 * ## Usage
 *
 * ### Registering Components (Plugin Setup)
 * ```typescript
 * import { registerComponent } from '@nextly/admin/lib/component-registry';
 * import { FormBuilderView, CreateFormButton } from '@revnixhq/plugin-form-builder/admin';
 *
 * registerComponent('@revnixhq/plugin-form-builder/admin#FormBuilderView', FormBuilderView);
 * registerComponent('@revnixhq/plugin-form-builder/admin#CreateFormButton', CreateFormButton);
 * ```
 *
 * ### Resolving Components (Admin UI)
 * ```typescript
 * import { getComponent } from '@admin/lib/component-registry';
 *
 * const CustomEditView = getComponent(collection.admin?.components?.views?.Edit?.Component);
 * if (CustomEditView) {
 *   return <CustomEditView {...props} />;
 * }
 * // Fallback to default
 * ```
 *
 * @module lib/component-registry
 * @since 1.0.0
 */

import type { ComponentType } from "react";

// ============================================================================
// Types
// ============================================================================

/**
 * Component path string format.
 * Format: `"package-name/path#ExportName"`
 */
export type ComponentPath = string;

/**
 * Props passed to custom Edit view components.
 */
export interface CustomEditViewProps {
  /** Collection slug */
  collectionSlug: string;
  /** Entry ID (undefined when creating new entry) */
  entryId?: string;
  /** Whether this is a create operation */
  isCreating: boolean;
  /** Initial entry data (undefined when creating) */
  initialData?: Record<string, unknown>;
  /** Callback when save succeeds (receives entry data for create, nothing for edit) */
  onSuccess?: (entry?: Record<string, unknown>) => void;
  /** Callback when entry is deleted */
  onDelete?: () => void;
  /** Callback when user cancels */
  onCancel?: () => void;
  /** Callback to duplicate entry */
  onDuplicate?: () => void;
}

/**
 * Props passed to injection point components (BeforeListTable, etc.).
 */
export interface InjectionPointProps {
  /** Collection slug */
  collectionSlug: string;
  /** Collection configuration */
  collection: Record<string, unknown>;
}

// ============================================================================
// Registry
// ============================================================================

/**
 * Internal component registry map.
 * Maps component path strings to actual React components.
 */
const componentRegistry = new Map<ComponentPath, ComponentType>();

/**
 * Register a component in the registry.
 *
 * Called by plugins during initialization to make their components
 * available for resolution in the admin UI.
 *
 * @param path - Component path in format `"package/path#ExportName"`
 * @param component - The React component to register
 *
 * @example
 * ```typescript
 * import { FormBuilderView } from './FormBuilderView';
 *
 * registerComponent(
 *   '@revnixhq/plugin-form-builder/admin#FormBuilderView',
 *   FormBuilderView
 * );
 * ```
 */
export function registerComponent(
  path: ComponentPath,
  component: ComponentType<never>
): void {
  if (!path) {
    console.warn(
      "[ComponentRegistry] Cannot register component with empty path"
    );
    return;
  }

  if (!component) {
    console.warn(
      `[ComponentRegistry] Cannot register undefined component for path: ${path}`
    );
    return;
  }

  componentRegistry.set(path, component as ComponentType);
}

/**
 * Register multiple components at once.
 *
 * Convenience function for plugins to register all their components
 * in a single call.
 *
 * @param components - Object mapping paths to components
 *
 * @example
 * ```typescript
 * registerComponents({
 *   '@revnixhq/plugin-form-builder/admin#FormBuilderView': FormBuilderView,
 *   '@revnixhq/plugin-form-builder/admin#CreateFormButton': CreateFormButton,
 * });
 * ```
 */
export function registerComponents(
  components: Record<ComponentPath, ComponentType<never>>
): void {
  for (const [path, component] of Object.entries(components)) {
    registerComponent(path, component);
  }
}

/**
 * Get a component from the registry by its path.
 *
 * Returns undefined if the component is not registered.
 * Logs a warning to help debug misconfiguration.
 *
 * @param path - Component path to resolve
 * @returns The registered React component, or undefined if not found
 *
 * @example
 * ```typescript
 * const CustomView = getComponent('@revnixhq/plugin-form-builder/admin#FormBuilderView');
 * if (CustomView) {
 *   return <CustomView {...props} />;
 * }
 * ```
 */
export function getComponent<P = Record<string, unknown>>(
  path: ComponentPath | undefined
): ComponentType<P> | undefined {
  if (!path) {
    return undefined;
  }

  const component = componentRegistry.get(path);

  if (!component) {
    console.warn(
      `[ComponentRegistry] Component not found for path: "${path}". ` +
        `Make sure the plugin is installed and its components are registered. ` +
        `Available components: ${getRegisteredPaths().join(", ") || "(none)"}`
    );
  }

  return component as ComponentType<P> | undefined;
}

/**
 * Check if a component is registered.
 *
 * @param path - Component path to check
 * @returns true if component is registered
 */
export function hasComponent(path: ComponentPath | undefined): boolean {
  if (!path) {
    return false;
  }
  return componentRegistry.has(path);
}

/**
 * Unregister a component from the registry.
 *
 * Primarily used for testing or hot-reloading scenarios.
 *
 * @param path - Component path to unregister
 * @returns true if component was unregistered, false if it wasn't registered
 */
export function unregisterComponent(path: ComponentPath): boolean {
  return componentRegistry.delete(path);
}

/**
 * Get all registered component paths.
 *
 * Useful for debugging and logging.
 *
 * @returns Array of registered component paths
 */
export function getRegisteredPaths(): ComponentPath[] {
  return Array.from(componentRegistry.keys());
}

/**
 * Clear all registered components.
 *
 * Primarily used for testing.
 */
export function clearRegistry(): void {
  componentRegistry.clear();
}

/**
 * Get the number of registered components.
 *
 * @returns Number of registered components
 */
export function getRegistrySize(): number {
  return componentRegistry.size;
}

// ============================================================================
// Auto-Registration
// ============================================================================

/**
 * Map of known plugin packages to their auto-registration functions.
 * Plugins can register their own registration logic at runtime via `registerKnownPlugin()`.
 */
const knownPluginRegistrations: Map<string, () => Promise<void>> = new Map();

/**
 * Flag to track if auto-registration has been attempted.
 */
let autoRegistrationAttempted = false;

/**
 * Register a known plugin's auto-registration function.
 *
 * Called by plugins to register their auto-registration logic.
 * This is called at module load time by plugin packages.
 *
 * @param packagePrefix - The plugin package prefix (e.g., "@revnixhq/plugin-form-builder")
 * @param registrationFn - Async function that registers the plugin's components
 *
 * @internal
 */
export function registerKnownPlugin(
  packagePrefix: string,
  registrationFn: () => Promise<void>
): void {
  knownPluginRegistrations.set(packagePrefix, registrationFn);
}

/**
 * Dynamic import function for a plugin's admin module.
 * Returns the module if the plugin is installed, or undefined if not.
 *
 * @param modulePath - The full module path (e.g., "@revnixhq/plugin-form-builder/admin")
 * @returns The imported module or undefined
 */
async function tryDynamicImport(
  modulePath: string
): Promise<Record<string, unknown> | undefined> {
  try {
    // Use indirect dynamic import via Function constructor to prevent
    // bundler (Webpack/Turbopack) static analysis warnings.
    // This is intentional: plugin modules are optional and resolved at runtime.
    const importModule = new Function("m", "return import(m)") as (
      m: string
    ) => Promise<Record<string, unknown>>;
    return await importModule(modulePath);
  } catch {
    // Package not installed or import failed - this is expected for optional plugins
    return undefined;
  }
}

/**
 * Auto-register components for plugins used by collections.
 *
 * Scans collection component paths and automatically loads plugin admin modules
 * to register their components. This eliminates the need for manual registration.
 *
 * For official Nextly plugins, this function will:
 * 1. Check if plugin has already self-registered via `registerKnownPlugin()`
 * 2. If not, dynamically import the plugin's admin module to trigger registration
 *
 * @param componentPaths - Array of component paths found in collection configs
 *
 * @example
 * ```typescript
 * // Called internally by admin when collections are loaded
 * const paths = collections.flatMap(c => [
 *   c.admin?.components?.views?.Edit?.Component,
 *   c.admin?.components?.BeforeListTable,
 * ].filter(Boolean));
 *
 * await autoRegisterPluginComponents(paths);
 * ```
 */
export async function autoRegisterPluginComponents(
  componentPaths: string[]
): Promise<void> {
  if (autoRegistrationAttempted) {
    return; // Only attempt once
  }
  autoRegistrationAttempted = true;

  // Extract unique module paths from component paths
  // e.g., "@revnixhq/plugin-form-builder/admin#FormBuilderView" -> "@revnixhq/plugin-form-builder/admin"
  const modulePaths = new Set<string>();
  for (const path of componentPaths) {
    if (!path) continue;

    const hashIndex = path.indexOf("#");
    if (hashIndex === -1) continue;

    const modulePath = path.substring(0, hashIndex);
    modulePaths.add(modulePath);
  }

  // Extract package prefixes for checking known registrations
  const getPackagePrefix = (modulePath: string): string => {
    const parts = modulePath.split("/");
    if (parts[0].startsWith("@")) {
      return `${parts[0]}/${parts[1]}`;
    }
    return parts[0];
  };

  const registrationPromises: Promise<void>[] = [];

  for (const modulePath of modulePaths) {
    const packagePrefix = getPackagePrefix(modulePath);

    // First check if the plugin has already self-registered
    const registrationFn = knownPluginRegistrations.get(packagePrefix);

    if (registrationFn) {
      // Plugin has registered its own registration function
      registrationPromises.push(
        registrationFn().catch(error => {
          console.warn(
            `[ComponentRegistry] Failed to auto-register plugin "${packagePrefix}":`,
            error
          );
        })
      );
    } else {
      // Try to dynamically import the plugin's admin module
      // The import will trigger the plugin's self-registration side effect
      registrationPromises.push(
        tryDynamicImport(modulePath).then(module => {
          if (module) {
            console.log(
              `[ComponentRegistry] Auto-loaded plugin module: ${modulePath}`
            );
          }
        })
      );
    }
  }

  await Promise.all(registrationPromises);
}

/**
 * Reset the auto-registration state.
 *
 * Primarily used for testing.
 *
 * @internal
 */
export function resetAutoRegistration(): void {
  autoRegistrationAttempted = false;
}
