/**
 * Plugin document views: the boot check that every one can be routed, and the
 * list the admin is given.
 *
 * A document view lives at an address under its document's own, so two
 * declarations of one path on one document are two screens behind one URL —
 * and whichever the admin's lookup reaches first is drawn, silently, with
 * nothing on screen to say the other exists. Registration is the last moment
 * that ambiguity is still visible, so the check is here and refuses boot,
 * naming both claimants. The same holds for a path the document already uses
 * for its own screens.
 *
 * A view is declared on named documents (`views[slug].documentViews`) or on
 * every document that has one of the plugin's own field types
 * (`documentViews` with a `fieldType`). Which documents carry a field is not
 * known at boot — the Schema Builder adds collections later — so a field-type
 * view's path is held unique among every view declared anywhere.
 *
 * @module plugins/validate-document-views
 */
import { NextlyError } from "../errors/nextly-error";

import type { ComponentPath } from "./admin-contributions";
import type { PluginDefinition } from "./plugin-context";

/**
 * Paths the document's own screens already use under its address. A view
 * declared on one of them would never be reached, or would shadow the
 * document's history or its API panel.
 */
const RESERVED_PATHS: ReadonlySet<string> = new Set(["versions", "api"]);

/**
 * One address segment: lowercase letters and digits, joined by single dashes.
 * Anything else either cannot be one segment of a path or reads differently
 * from how it routes.
 */
const VIEW_PATH = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** What every contributed view carries, however it is scoped. */
interface ContributedViewBase {
  path: string;
  component: ComponentPath;
  label?: string;
  /** The contributing plugin's name, for the admin's diagnostics. */
  plugin: string;
}

/**
 * One plugin document view as the admin is given it: on the slug it is
 * routed under, after the plugin's rename map, or on a field type.
 */
export type ContributedDocumentView = ContributedViewBase &
  ({ slug: string } | { fieldType: string });

/**
 * A view as the admin receives it, without its owner. Distributed over the
 * two scopes, so each keeps its own key: an `Omit` over the union would keep
 * only the keys both share and drop `slug` and `fieldType` from the type.
 */
export type PublishedDocumentView = ContributedDocumentView extends infer View
  ? View extends ContributedDocumentView
    ? Omit<View, "plugin">
    : never
  : never;

function documentViewError(
  pluginName: string,
  reason: string,
  context: Record<string, unknown>
): NextlyError {
  return new NextlyError({
    code: "NEXTLY_PLUGIN_DOCUMENT_VIEW_INVALID",
    publicMessage: "Plugin configuration is invalid.",
    logMessage: `Plugin "${pluginName}" contributes a document view that ${reason}.`,
    logContext: { plugin: pluginName, ...context },
  });
}

/** The label, carried only when declared. */
function labelOf(view: { label?: string }): { label?: string } {
  return view.label === undefined ? {} : { label: view.label };
}

/**
 * A declared slug after the plugin's rename map, read from the map's OWN
 * keys: `constructor` is a legal slug, and an inherited lookup answers it with
 * a function the admin would receive as no slug at all.
 */
function renamedSlug(plugin: PluginDefinition, declared: string): string {
  const renames = plugin.renameMap ?? {};
  return Object.hasOwn(renames, declared) ? renames[declared] : declared;
}

/** Every view one plugin declares, slug-scoped then field-type-scoped. */
function viewsOf(plugin: PluginDefinition): ContributedDocumentView[] {
  const admin = plugin.contributes?.admin;
  const bySlug = Object.entries(admin?.views ?? {}).flatMap(
    ([declared, view]) =>
      (view.documentViews ?? []).map(documentView => ({
        slug: renamedSlug(plugin, declared),
        path: documentView.path,
        component: documentView.component,
        ...labelOf(documentView),
        plugin: plugin.name,
      }))
  );
  const byFieldType = (admin?.documentViews ?? []).map(documentView => ({
    fieldType: documentView.fieldType,
    path: documentView.path,
    component: documentView.component,
    ...labelOf(documentView),
    plugin: plugin.name,
  }));
  return [...bySlug, ...byFieldType];
}

/** Where a view is offered, as an operator reads it. */
function scopeOf(view: ContributedDocumentView): string {
  return "slug" in view
    ? `on "${view.slug}"`
    : `on every document with a "${view.fieldType}" field`;
}

/** Why one view is refused on its own, or `undefined` when it is not. */
function unroutableReason(view: ContributedDocumentView): string | undefined {
  if (typeof view.component !== "string" || view.component === "") {
    return `${scopeOf(view)} at "${view.path}" names no component to draw`;
  }
  // Read through `unknown`: a JavaScript plugin or a setup transformer is not
  // held to the type. The label is published in the admin metadata, sent as
  // JSON, where anything but text fails the whole response, not this view.
  const label: unknown = view.label;
  if (label !== undefined && typeof label !== "string") {
    return `${scopeOf(view)} at "${view.path}" has a label that is not text`;
  }
  if (typeof view.path !== "string" || !VIEW_PATH.test(view.path)) {
    return (
      `${scopeOf(view)} has the path ${JSON.stringify(view.path)}, which is ` +
      "not one address segment of lowercase letters, digits and single dashes"
    );
  }
  if (RESERVED_PATHS.has(view.path)) {
    return `${scopeOf(view)} at "${view.path}", which the document already uses`;
  }
  return undefined;
}

/**
 * Why a field-type view's scope is refused, or `undefined` when it is the
 * plugin's own field type. Scoped to another plugin's type, or a built-in one,
 * a view would add a screen to documents its author never designed for.
 */
function unownedFieldTypeReason(
  plugin: PluginDefinition,
  view: ContributedDocumentView
): string | undefined {
  if (!("fieldType" in view)) return undefined;
  const own = (plugin.contributes?.fieldTypes ?? []).map(type => type.type);
  if (own.includes(view.fieldType)) return undefined;
  return (
    `${scopeOf(view)} at "${view.path}", a field type this plugin does not ` +
    "contribute. A view can be scoped only to one of its own field types"
  );
}

/**
 * Whether two views would answer one address. A field-type view can be on any
 * document, so it meets every other view of its path; two slug views meet only
 * on the same document.
 */
function meet(a: ContributedDocumentView, b: ContributedDocumentView): boolean {
  if (a.path !== b.path) return false;
  if ("slug" in a && "slug" in b) return a.slug === b.slug;
  return true;
}

/** The first view already declared that `view` would collide with. */
function collisionWith(
  view: ContributedDocumentView,
  declared: readonly ContributedDocumentView[]
): ContributedDocumentView | undefined {
  return declared.find(earlier => meet(earlier, view));
}

/** One plugin's views checked on their own, before any comparison. */
function assertOwnViews(plugin: PluginDefinition): ContributedDocumentView[] {
  const views = viewsOf(plugin);
  for (const view of views) {
    const reason =
      unroutableReason(view) ?? unownedFieldTypeReason(plugin, view);
    if (reason !== undefined) {
      throw documentViewError(plugin.name, reason, { path: view.path });
    }
  }
  return views;
}

/**
 * Boot-time check over every plugin, disabled ones included.
 *
 * A disabled plugin's views are withheld from the admin, but enabling it is a
 * config edit, and that edit must not be what turns a healthy install into
 * one that will not start. So its declarations are judged now.
 */
export function assertDocumentViews(plugins: PluginDefinition[]): void {
  const declared: ContributedDocumentView[] = [];
  for (const view of plugins.flatMap(assertOwnViews)) {
    const earlier = collisionWith(view, declared);
    if (earlier !== undefined) {
      throw documentViewError(
        view.plugin,
        `${scopeOf(view)} at "${view.path}", where "${earlier.plugin}" ` +
          `already declares a view ${scopeOf(earlier)}. One address can draw ` +
          "one screen: rename one of the two paths",
        { path: view.path, other: earlier.plugin }
      );
    }
    declared.push(view);
  }
}

/**
 * The document views the admin is given: enabled plugins' only. Read after
 * `assertDocumentViews` has passed, so every entry here can be routed.
 */
export function contributedDocumentViews(
  plugins: PluginDefinition[]
): ContributedDocumentView[] {
  return plugins.filter(plugin => plugin.enabled !== false).flatMap(viewsOf);
}
