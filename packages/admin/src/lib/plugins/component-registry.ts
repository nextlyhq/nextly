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
 * - `package-name/path` is the module path (e.g., `@nextlyhq/plugin-form-builder/admin`)
 * - `#ExportName` is the named export (e.g., `#FormBuilderView`)
 *
 * ## Usage
 *
 * ### Registering Components (Plugin Setup)
 * ```typescript
 * import { registerComponent } from '@nextly/admin/lib/component-registry';
 * import { FormBuilderView, CreateFormButton } from '@nextlyhq/plugin-form-builder/admin';
 *
 * registerComponent('@nextlyhq/plugin-form-builder/admin#FormBuilderView', FormBuilderView);
 * registerComponent('@nextlyhq/plugin-form-builder/admin#CreateFormButton', CreateFormButton);
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

import type { FieldConfig, OverridableDocumentAction } from "nextly/config";
import { noticeDeprecation } from "nextly/deprecation-notice";
import type { ComponentType } from "react";
import type { Control, FieldValues } from "react-hook-form";

import type { DocumentLockGates } from "@admin/components/features/entries/EntryForm/document-lock-affordances";
import type {
  PlaceContributionProps,
  PlaceTabProps,
} from "@admin/components/shared/target-slot";
import { isDevelopmentRuntime } from "@admin/lib/development-runtime";

import {
  componentRegistry,
  CORE_COMPONENT_PREFIX,
  markComponentMapComplete,
  writeComponent,
} from "./component-registry-internal";

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
  /**
   * What a colleague's claim on this document withholds.
   *
   * A custom view replaces the FORM, not the facts about the document, and the
   * strip above it says in words that unsaved changes cannot be saved while
   * someone else holds the claim. A view that writes anyway makes that sentence
   * false, so the two decisions travel together and reach the view through the
   * props it already receives rather than an admin-internal hook it cannot
   * import.
   *
   * Absent while creating, which has no document to claim.
   */
  documentLock?: DocumentLockGates;
}

/**
 * @experimental Props passed to a plugin's document view: the full-screen
 * screen a plugin contributes under a document's address.
 *
 * The admin keeps the document's own machinery around the view — it loads the
 * document, holds its lock, offers recovered work, guards leaving and answers
 * the save shortcut — so these props are the document's facts and the form's
 * state, not a second way to save.
 *
 * Restoring recovered work unmounts the view, replaces the form's values, then
 * mounts the view afresh, so a view may keep a working copy of the document
 * read when it mounts, and anything it writes into the form as it unmounts is
 * replaced by the restore.
 */
export interface DocumentViewProps {
  /** The collection's slug, when the document is an entry. */
  collectionSlug?: string;
  /** The Single's slug, when the document is a Single. */
  singleSlug?: string;
  /** The entry's id, when the document is an entry. */
  entryId?: string;
  /**
   * The document form's control. Values written through it are what the
   * admin's save sends, and what its unsaved-changes guard and recovery
   * points read.
   */
  control: Control<FieldValues>;
  /**
   * True while a colleague holds the document: the view shows it and takes
   * no edits, matching the banner the admin draws above it.
   */
  readOnly: boolean;
  /** Return to the document's own edit screen, keeping unsaved work. */
  exit: () => void;
  /**
   * For a view offered on a field type: the declaration of the top-level field
   * it edits — the same `FieldConfig` a plugin field editor receives as its
   * `field` prop, carrying `name`. The only field of that type, or the one the
   * address names (`?field=`); where the document has several and the address
   * names none of them, the admin asks the author before the view is drawn.
   */
  field?: FieldConfig;
  /**
   * For a view offered on a field type: where the field sits in the document
   * form, from its root — `layout` for a top-level field, `hero.body` for one
   * inside a named group. Bind through this rather than `field.name`, which
   * names the field within its own group only.
   *
   * @experimental
   */
  fieldPath?: string;
  /**
   * For a view offered on a field type: the field's address from the
   * document's root, which the view's own address carries (`?field=`). The
   * same as `fieldPath` except inside a repeater's row, which the address
   * names by its saved id (`sections.<rowId>.body`) and the form by its
   * position (`sections.1.body`). It names the same field however the rows are
   * reordered, so key anything that must stay with the field by this.
   *
   * @experimental
   */
  fieldAddress?: string;
  /**
   * For a field below the top level: where it sits, in words an author reads,
   * each container's label and each row's title as the form's row header
   * shows it, then the field's label (`Sections · Hero banner · Body`).
   * Absent for a top-level field.
   *
   * @experimental
   */
  fieldLocation?: string;
  /**
   * For a field inside a repeater's row: where its address names it in a copy
   * of the document's values — the values as stored, a recovery point, or,
   * given none, the form's own values at the moment of asking — finding the
   * row by its id wherever it now stands, or `undefined` where that row is
   * not there. Ask it at the moment of writing and write only where it
   * answers, never through a path read earlier: a row that moved since would
   * put the value in another row. Absent where the field sits in no row, and
   * `fieldPath` names it in every copy.
   *
   * @experimental
   */
  fieldPathIn?: (values?: Record<string, unknown>) => string | undefined;
}

/**
 * @experimental What a plugin tells the editor its document came to, after a
 * replaced action or a panel section acted on it: `"deleted"` leaves for the
 * collection's list, as the built-in Delete does; `"changed"` reads the
 * document again, so the editor shows what the plugin wrote.
 */
export type DocumentChangeResult = "deleted" | "changed";

/**
 * @experimental Props passed to the component a plugin opens in place of a
 * built-in document action (`views[slug].documentActions`).
 *
 * Mounted when the author chooses the action and unmounted when it calls
 * `close`, so a dialog renders open from the start.
 */
export interface DocumentActionReplacementProps {
  /** Which action the author chose. */
  action: OverridableDocumentAction;
  /** The collection's slug. */
  collectionSlug: string;
  /** The entry's id. */
  entryId: string;
  /**
   * What holds the document right now, kept current while the component is
   * open. `readOnly` covers its fields: a colleague's claim, a past version
   * on screen, a reader's page, the editor readying the document.
   * `actionsDisabled` covers a plugin's own writes, as it does the built-in
   * Delete: a colleague's claim, a past version, a collection removed from
   * code, the editor readying it. A reader's page alone does not hold them;
   * the plugin's route judges its own permission.
   */
  documentLock: DocumentLockGates;
  /**
   * Whether the document may be written at this instant. Ask it immediately
   * before the write, after anything awaited: the document can change hands
   * while a dialog is open, and the editor's own Delete asks the same.
   */
  mayWrite: () => boolean;
  /**
   * Close it, with what it came to: `"deleted"` or `"changed"` (see
   * `DocumentChangeResult`), or nothing when the author backed out.
   */
  close: (result?: DocumentChangeResult) => void;
}

/**
 * @experimental Props passed to a section a plugin adds to the document panel
 * (`views[slug].panelSections`). The admin draws the section's heading and
 * frame; this draws what is under them.
 */
export interface DocumentPanelSectionProps {
  /** The collection's slug. */
  collectionSlug: string;
  /** The entry's id. */
  entryId: string;
  /**
   * What holds the document right now, the pair a custom edit view is given:
   * `readOnly` as the fields are held (a colleague's claim, a past version, a
   * reader's page, the editor readying the document), and `actionsDisabled`
   * as the built-in Delete is (a colleague's claim, a past version, a
   * collection removed from code, the editor readying it). A section that
   * writes holds its writes while `actionsDisabled`.
   */
  documentLock: DocumentLockGates;
  /**
   * Whether the document may be written at this instant: ask it immediately
   * before a write, after anything awaited.
   */
  mayWrite: () => boolean;
  /**
   * Tell the editor the section changed the document: `"deleted"` leaves for
   * the collection's list, `"changed"` reads the document again.
   */
  documentChanged: (result: DocumentChangeResult) => void;
}

/**
 * @experimental Props passed to a side panel section a plugin declares at an
 * edit page's place (`kind: "sidebarSection"`): the place's `context` and
 * `entry`, as every contributed component receives them, and on a collection
 * entry's page also the document's own handles that a section added through
 * `views[slug].panelSections` is given. One component written against the
 * place's props works on both edit pages; on a collection entry's page it may
 * also act on the document.
 */
export type SidebarSectionProps =
  | (PlaceContributionProps<"collection.edit"> & DocumentPanelSectionProps)
  | PlaceContributionProps<"single.edit">;

/**
 * @experimental Props passed to a tab a plugin declares at an edit page's
 * place (`kind: "tab"` at `collection.edit` or `single.edit`): what every
 * contributed tab receives (the place's `context` and `entry`, and
 * `setBadge`), and the document's form and lock, on a saved entry, a new one
 * and a Single alike.
 *
 * The tab is drawn inside the document's editor, under the same bar, so Save
 * and Publish store what it writes through `control` with everything else,
 * and `useDocumentLocale()` and `useDocumentActions()` answer for the same
 * document. It stays mounted while another tab is open, so what it holds is
 * kept across tabs and its count stays current.
 */
export type DocumentTabProps = (
  | PlaceTabProps<"collection.edit">
  | PlaceTabProps<"single.edit">
) & {
  /**
   * The document form's control, the one its fields write through and a
   * document view is handed: read values the author typed and has not saved,
   * and write values the bar's Save and Publish then store.
   */
  control: Control<FieldValues>;
  /**
   * What holds the document right now, the answer a side panel section is
   * given: `readOnly` as the fields are held, when the tab takes no edits,
   * and `actionsDisabled` as a plugin's own writes are held.
   */
  documentLock: DocumentLockGates;
};

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
 *   '@nextlyhq/plugin-form-builder/admin#FormBuilderView',
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

  // Warned and refused rather than thrown, matching the two checks above: this
  // runs while the admin is mounting, and a throw would trade one unresolvable
  // card for the whole panel.
  if (path.startsWith(CORE_COMPONENT_PREFIX)) {
    console.warn(
      `[ComponentRegistry] "${CORE_COMPONENT_PREFIX}" is reserved for Nextly's ` +
        `own dashboard cards and cannot be registered by a plugin: ${path}`
    );
    return;
  }

  writeComponent(path, component);
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
 *   '@nextlyhq/plugin-form-builder/admin#FormBuilderView': FormBuilderView,
 *   '@nextlyhq/plugin-form-builder/admin#CreateFormButton': CreateFormButton,
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
 * @experimental Register the app's generated component map: every component
 * the admin resolves by string, imported at once by `nextly generate:types`'s
 * map, which calls this as it loads.
 *
 * Registers them as {@link registerComponents} does, then records that the
 * map is complete. Nothing else is on its way after it, so a surface waiting
 * for a component that is still missing draws its "not registered" fallback
 * rather than loading. For the generated map, not a plugin's own module: a
 * plugin registers its components with `registerComponents`.
 */
export function registerComponentMap(
  components: Record<ComponentPath, ComponentType<never>>
): void {
  registerComponents(components);
  markComponentMapComplete();
}

/**
 * Get a component from the registry by its path.
 *
 * Returns undefined if the component is not registered.
 * Logs a warning naming the path, in development, to help debug misconfiguration.
 *
 * @param path - Component path to resolve
 * @returns The registered React component, or undefined if not found
 *
 * @example
 * ```typescript
 * const CustomView = getComponent('@nextlyhq/plugin-form-builder/admin#FormBuilderView');
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

  // Development only: a missing component is a fault in the app's own map, so
  // it is the developer who can act on it, and the caller already draws its
  // fallback for whoever is using the admin.
  if (!component && isDevelopmentRuntime()) {
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
  // Removing a core card is the same takeover by the other route: the
  // definition still names `core#…`, so a deleted entry leaves the card
  // unresolvable rather than merely unregistered.
  if (path.startsWith(CORE_COMPONENT_PREFIX)) {
    console.warn(
      `[ComponentRegistry] "${CORE_COMPONENT_PREFIX}" is reserved and cannot be ` +
        `unregistered: ${path}`
    );
    return false;
  }

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
  // Reserved entries survive, because this is the third route into the same
  // map and the other two already refuse them. Core registers its components
  // once, when the grid's module is evaluated, so a plugin clearing them wholesale
  // could not be recovered from -- every core card would resolve to nothing for
  // the life of the page, with no error anywhere.
  //
  // Cleared by ITERATION rather than `Map.clear()` for that reason: the bulk
  // call cannot express an exception, so reaching for it here would have been
  // choosing convenience over the guarantee the other two writers make.
  for (const path of componentRegistry.keys()) {
    if (path.startsWith(CORE_COMPONENT_PREFIX)) continue;
    componentRegistry.delete(path);
  }
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
// Deprecated self-registration
// ============================================================================

/**
 * Hand the admin a function that registers a plugin's components.
 *
 * @deprecated Register components with `registerComponents()` in the plugin's
 * admin module, which the generated component map imports. Removed at the next
 * major release.
 *
 * Kept working: the function runs at once, so its components register as soon
 * as the module calling this is imported, which the generated map does. It
 * used to wait until a collection naming the plugin's components loaded,
 * because the admin then imported plugin modules by name at run time; the map
 * imports every module a plugin's admin names, so nothing waits now.
 *
 * @param packagePrefix - The plugin's package name, as it was keyed by.
 * @param registrationFn - Registers the plugin's components.
 */
export function registerKnownPlugin(
  packagePrefix: string,
  registrationFn: () => Promise<void>
): void {
  noticeDeprecation(
    {
      surface: "`registerKnownPlugin()`",
      replacement: "`registerComponents()`",
      message:
        "`registerKnownPlugin()` is deprecated and will be removed at the " +
        "next major release. Register your components with " +
        "`registerComponents()` in your plugin's admin module: the generated " +
        "component map imports it.",
    },
    // The browser's console: a plugin author reads it in their devtools.
    message => console.warn(message)
  );
  // Run inside a promise, so a function that throws before it returns one is
  // named as one that rejects is: the generated map imports this module with
  // the admin's, and a throw escaping here would stop the admin loading.
  new Promise<void>(resolve => resolve(registrationFn())).catch(error => {
    console.warn(
      `[ComponentRegistry] Failed to register plugin "${packagePrefix}":`,
      error
    );
  });
}
