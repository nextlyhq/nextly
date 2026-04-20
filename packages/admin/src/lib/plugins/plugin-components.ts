/**
 * Plugin Components Registration
 *
 * Provides utilities for registering plugin components in the admin UI.
 * Plugin components are registered via the component registry and can
 * replace default admin views or inject components at specific locations.
 *
 * ## How it works
 *
 * 1. Plugins define components and export them from their admin subpath
 * 2. Users import the plugin's registration function in their app
 * 3. The registration function adds components to the admin's registry
 * 4. When rendering, admin checks registry for custom components
 *
 * ## For Plugin Authors
 *
 * Create a registration function in your plugin:
 *
 * ```typescript
 * // packages/plugin-foo/src/admin/register.ts
 * import { registerComponents } from '@revnixhq/admin/lib/component-registry';
 * import { FooView, FooButton } from './components';
 *
 * export function registerFooComponents() {
 *   registerComponents({
 *     '@revnixhq/plugin-foo/admin#FooView': FooView,
 *     '@revnixhq/plugin-foo/admin#FooButton': FooButton,
 *   });
 * }
 * ```
 *
 * ## For Plugin Users
 *
 * Import and call the registration in your app's admin layout:
 *
 * ```typescript
 * // app/(admin)/admin/layout.tsx
 * import { registerFooComponents } from '@nextly/plugin-foo/admin';
 *
 * // Call once at app startup
 * registerFooComponents();
 * ```
 *
 * @module lib/plugin-components
 * @since 1.0.0
 */

import type { ComponentType } from "react";

import { registerComponents } from "./component-registry";

// ============================================================================
// Form Builder Plugin Registration
// ============================================================================

/**
 * Register Form Builder plugin components synchronously.
 *
 * Call this function in your admin layout after importing the
 * Form Builder plugin's admin components.
 *
 * @param components - The Form Builder admin components
 *
 * @example
 * ```typescript
 * // In your admin layout or setup
 * import { FormBuilderView, CreateFormButton } from '@revnixhq/plugin-form-builder/admin';
 * import { registerFormBuilderComponents } from '@revnixhq/admin/lib/plugin-components';
 *
 * registerFormBuilderComponents({
 *   FormBuilderView,
 *   CreateFormButton,
 * });
 * ```
 */
export function registerFormBuilderComponents(components: {
  FormBuilderView: ComponentType<never>;
}): void {
  registerComponents({
    "@revnixhq/plugin-form-builder/admin#FormBuilderView":
      components.FormBuilderView,
  });
}

// ============================================================================
// Generic Plugin Registration Helper
// ============================================================================

/**
 * Helper for plugins to register their components.
 *
 * Plugins can use this to create their own registration functions.
 *
 * @param pluginName - The plugin package name (e.g., '@revnixhq/plugin-foo')
 * @param components - Map of export names to components
 *
 * @example
 * ```typescript
 * // In plugin's admin/register.ts
 * import { registerPluginComponents } from '@revnixhq/admin/lib/plugin-components';
 * import { MyView, MyButton } from './components';
 *
 * export function registerMyPlugin() {
 *   registerPluginComponents('@revnixhq/plugin-my-plugin/admin', {
 *     MyView,
 *     MyButton,
 *   });
 * }
 * ```
 */
export function registerPluginComponents(
  pluginPath: string,
  components: Record<string, ComponentType<never>>
): void {
  const mapped: Record<string, ComponentType<never>> = {};

  for (const [exportName, component] of Object.entries(components)) {
    mapped[`${pluginPath}#${exportName}`] = component;
  }

  registerComponents(mapped);
}
