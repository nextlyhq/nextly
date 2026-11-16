/**
 * Plugin document surfaces on one collection's document screen: overrides of
 * its built-in actions (`views[slug].documentActions`) and sections added to
 * its document panel (`views[slug].panelSections`). The boot check that each
 * can be drawn, and the lists the admin is given.
 *
 * Refused at boot rather than skipped in the admin, for the reason document
 * views are: an override naming an action this version does not know would
 * leave that action in place with nothing on screen to say why, and two
 * plugins overriding one action on one collection would have the admin pick
 * one of them silently. Registration is the last moment either is visible.
 *
 * @module plugins/document-surfaces
 */
import { NextlyError } from "../errors/nextly-error";

import {
  OVERRIDABLE_DOCUMENT_ACTIONS,
  type ComponentPath,
  type OverridableDocumentAction,
  type PluginDocumentActionOverride,
} from "./admin-contributions";
import type { PluginDefinition } from "./plugin-context";
import { renamedSlug } from "./plugin-slug";

/** One action override as the admin is given it, on the slug it applies to. */
export interface PublishedDocumentActionOverride {
  slug: string;
  action: OverridableDocumentAction;
  override: PluginDocumentActionOverride;
}

/** One panel section as the admin is given it, on the slug it applies to. */
export interface PublishedPanelSection {
  slug: string;
  title: string;
  component: ComponentPath;
}

/** An override, with the plugin that declared it, for the boot check. */
interface DeclaredOverride {
  slug: string;
  /** As declared: read from config, which a JavaScript plugin may misspell. */
  action: string;
  override: unknown;
  plugin: string;
}

function surfaceError(
  pluginName: string,
  reason: string,
  context: Record<string, unknown>
): NextlyError {
  return new NextlyError({
    code: "NEXTLY_PLUGIN_DOCUMENT_SURFACE_INVALID",
    publicMessage: "Plugin configuration is invalid.",
    logMessage: `Plugin "${pluginName}" ${reason}.`,
    logContext: { plugin: pluginName, ...context },
  });
}

/** Every override one plugin declares, on the slugs they apply to. */
function overridesOf(plugin: PluginDefinition): DeclaredOverride[] {
  const views = plugin.contributes?.admin?.views ?? {};
  return Object.entries(views).flatMap(([declared, view]) =>
    Object.entries(view.documentActions ?? {}).map(([action, override]) => ({
      slug: renamedSlug(plugin, declared),
      action,
      override: override as unknown,
      plugin: plugin.name,
    }))
  );
}

/** Every panel section one plugin declares, on the slugs they apply to. */
function sectionsOf(plugin: PluginDefinition): PublishedPanelSection[] {
  const views = plugin.contributes?.admin?.views ?? {};
  return Object.entries(views).flatMap(([declared, view]) =>
    (view.panelSections ?? []).map(section => ({
      slug: renamedSlug(plugin, declared),
      title: section.title,
      component: section.component,
    }))
  );
}

/** Whether a value is text with something in it. */
function filled(value: unknown): value is string {
  return typeof value === "string" && value.trim() !== "";
}

function isKnownAction(action: string): action is OverridableDocumentAction {
  return (OVERRIDABLE_DOCUMENT_ACTIONS as readonly string[]).includes(action);
}

/** Why one override cannot be drawn, or `undefined` when it can. */
function overrideReason(declared: DeclaredOverride): string | undefined {
  const where = `the "${declared.action}" action on "${declared.slug}"`;
  if (!isKnownAction(declared.action)) {
    return (
      `overrides ${where}, which is not one a plugin may override ` +
      `(${OVERRIDABLE_DOCUMENT_ACTIONS.join(", ")})`
    );
  }
  const { override } = declared;
  if (override === "hidden") return undefined;
  if (typeof override !== "object" || override === null) {
    return `overrides ${where} with neither "hidden" nor a component`;
  }
  const { component, label } = override as {
    component?: unknown;
    label?: unknown;
  };
  if (!filled(component)) {
    return `replaces ${where} with no component to open`;
  }
  // Published in the admin metadata, sent as JSON, where anything but text
  // would fail the whole response rather than this override.
  if (label !== undefined && !filled(label)) {
    return `replaces ${where} with a label that is not text`;
  }
  return undefined;
}

/** Why one panel section cannot be drawn, or `undefined` when it can. */
function sectionReason(section: PublishedPanelSection): string | undefined {
  // Read through `unknown`: a JavaScript plugin is not held to the type.
  const title: unknown = section.title;
  const component: unknown = section.component;
  if (!filled(title)) {
    return `adds a document panel section on "${section.slug}" with no title`;
  }
  if (!filled(component)) {
    return `adds the document panel section "${title}" on "${section.slug}" with no component to draw`;
  }
  return undefined;
}

/** Whether a value is an object that is not a list: a map of named entries. */
function isMap(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Why one collection's declarations are not of a shape the checks below can
 * read, or `undefined` when they are. Read as `unknown`: a JavaScript plugin
 * or a setup transformer is not held to the type, and walking a malformed
 * declaration would end the boot in a TypeError that names no plugin.
 */
function shapeReason(slug: string, view: unknown): string | undefined {
  if (!isMap(view)) return undefined;
  const { documentActions, panelSections, foldedPanel } = view;
  // Read by the prebuilt admin page as well as the admin, so anything but a
  // yes or a no is refused here rather than read two ways.
  if (foldedPanel !== undefined && typeof foldedPanel !== "boolean") {
    return `declares foldedPanel on "${slug}" that is neither true nor false`;
  }
  if (documentActions !== undefined && !isMap(documentActions)) {
    return `declares documentActions on "${slug}" that is not a map of actions to overrides`;
  }
  if (panelSections === undefined) return undefined;
  if (!Array.isArray(panelSections)) {
    return `declares panelSections on "${slug}" that is not a list`;
  }
  if (!panelSections.every(isMap)) {
    return `declares a document panel section on "${slug}" that is not an object`;
  }
  return undefined;
}

/** One plugin's declarations, refused by name when not of a readable shape. */
function assertSurfaceShapes(plugin: PluginDefinition): void {
  const views: unknown = plugin.contributes?.admin?.views;
  if (!isMap(views)) return;
  for (const [declared, view] of Object.entries(views)) {
    const slug = renamedSlug(plugin, declared);
    const reason = shapeReason(slug, view);
    if (reason !== undefined) {
      throw surfaceError(plugin.name, reason, { collection: slug });
    }
  }
}

/** One plugin's surfaces checked on their own, before any comparison. */
function assertOwnSurfaces(plugin: PluginDefinition): DeclaredOverride[] {
  // Before anything walks them, so a malformed one is refused by name.
  assertSurfaceShapes(plugin);
  const overrides = overridesOf(plugin);
  for (const declared of overrides) {
    const reason = overrideReason(declared);
    if (reason !== undefined) {
      throw surfaceError(plugin.name, reason, {
        collection: declared.slug,
        action: declared.action,
      });
    }
  }
  for (const section of sectionsOf(plugin)) {
    const reason = sectionReason(section);
    if (reason !== undefined) {
      throw surfaceError(plugin.name, reason, { collection: section.slug });
    }
  }
  return overrides;
}

/**
 * Boot-time check over every plugin, disabled ones included: enabling one is
 * a config edit, and that edit must not be what stops an install starting.
 */
export function assertDocumentSurfaces(plugins: PluginDefinition[]): void {
  const claimed: DeclaredOverride[] = [];
  for (const declared of plugins.flatMap(assertOwnSurfaces)) {
    const earlier = claimed.find(
      each => each.slug === declared.slug && each.action === declared.action
    );
    if (earlier !== undefined) {
      throw surfaceError(
        declared.plugin,
        `overrides the "${declared.action}" action on "${declared.slug}", ` +
          `which "${earlier.plugin}" already overrides. One action can be ` +
          "drawn one way: drop one of the two overrides",
        {
          collection: declared.slug,
          action: declared.action,
          other: earlier.plugin,
        }
      );
    }
    claimed.push(declared);
  }
}

/**
 * An override as the admin is given it: `"hidden"`, or a new object holding
 * only the component and label the boot check judged. The declaration itself
 * is not passed on, so nothing else on it (a value that does not survive
 * JSON, a `toJSON` that rewrites it) reaches the metadata every signed-in
 * request serializes.
 */
function publishedOverride(override: unknown): PluginDocumentActionOverride {
  if (override === "hidden") return "hidden";
  const { component, label } = override as {
    component: ComponentPath;
    label?: string;
  };
  return label === undefined ? { component } : { component, label };
}

/**
 * The document surfaces one ENABLED plugin gives the admin, on the slugs they
 * apply to. Read after `assertDocumentSurfaces` has passed, so every entry
 * names an action this version knows and something to draw.
 */
export function publishedDocumentSurfaces(plugin: PluginDefinition): {
  documentActions: PublishedDocumentActionOverride[];
  panelSections: PublishedPanelSection[];
} {
  if (plugin.enabled === false) {
    return { documentActions: [], panelSections: [] };
  }
  const documentActions = overridesOf(plugin).flatMap(declared =>
    isKnownAction(declared.action)
      ? [
          {
            slug: declared.slug,
            action: declared.action,
            override: publishedOverride(declared.override),
          },
        ]
      : []
  );
  return { documentActions, panelSections: sectionsOf(plugin) };
}
