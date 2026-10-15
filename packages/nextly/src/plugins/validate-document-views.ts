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

/** One plugin document view, on the slug the admin routes it under. */
export interface ContributedDocumentView {
  /** The collection's or Single's slug, after the plugin's rename map. */
  slug: string;
  path: string;
  component: ComponentPath;
  label?: string;
  /** The contributing plugin's name, for the admin's diagnostics. */
  plugin: string;
}

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

/** Every view one plugin declares, on its resolved slugs. */
function viewsOf(plugin: PluginDefinition): ContributedDocumentView[] {
  const views = plugin.contributes?.admin?.views ?? {};
  return Object.entries(views).flatMap(([declared, view]) =>
    (view.documentViews ?? []).map(documentView => ({
      slug: plugin.renameMap?.[declared] ?? declared,
      path: documentView.path,
      component: documentView.component,
      ...(documentView.label === undefined
        ? {}
        : { label: documentView.label }),
      plugin: plugin.name,
    }))
  );
}

/** Why one view cannot be routed on its own, or `undefined` when it can. */
function unroutableReason(view: ContributedDocumentView): string | undefined {
  if (typeof view.component !== "string" || view.component === "") {
    return `on "${view.slug}" at "${view.path}" names no component to draw`;
  }
  if (typeof view.path !== "string" || !VIEW_PATH.test(view.path)) {
    return (
      `on "${view.slug}" has the path ${JSON.stringify(view.path)}, which is ` +
      "not one address segment of lowercase letters, digits and single dashes"
    );
  }
  if (RESERVED_PATHS.has(view.path)) {
    return `on "${view.slug}" at "${view.path}", which the document already uses`;
  }
  return undefined;
}

/**
 * Boot-time check over every plugin, disabled ones included.
 *
 * A disabled plugin's views are withheld from the admin, but enabling it is a
 * config edit, and that edit must not be what turns a healthy install into
 * one that will not start. So its declarations are judged now.
 */
export function assertDocumentViews(plugins: PluginDefinition[]): void {
  const claimed = new Map<string, ContributedDocumentView>();
  for (const view of plugins.flatMap(viewsOf)) {
    const reason = unroutableReason(view);
    if (reason !== undefined) {
      throw documentViewError(view.plugin, reason, {
        slug: view.slug,
        path: view.path,
      });
    }
    const key = `${view.slug}\u0000${view.path}`;
    const earlier = claimed.get(key);
    if (earlier !== undefined) {
      throw documentViewError(
        view.plugin,
        `on "${view.slug}" at "${view.path}", which "${earlier.plugin}" ` +
          "already declares there. One address can draw one screen: rename " +
          "one of the two paths",
        { slug: view.slug, path: view.path, other: earlier.plugin }
      );
    }
    claimed.set(key, view);
  }
}

/**
 * The document views the admin is given: enabled plugins' only, each on the
 * slug it is routed under. Read after `assertDocumentViews` has passed, so
 * every entry here can be routed.
 */
export function contributedDocumentViews(
  plugins: PluginDefinition[]
): ContributedDocumentView[] {
  return plugins.filter(plugin => plugin.enabled !== false).flatMap(viewsOf);
}
