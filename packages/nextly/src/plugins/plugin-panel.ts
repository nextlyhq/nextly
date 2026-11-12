/**
 * What a plugin declares about its own panel, as the admin is sent it: the
 * groups its menu items are listed under, the number each item shows, and
 * which items are kept at all; and what start-up says about it in
 * development.
 *
 * One reading for both. The admin metadata serializes what it keeps, and the
 * start-up report names what it left out, so the value a developer is warned
 * about is exactly the value the admin goes without.
 *
 * @module plugins/plugin-panel
 */
import type { Logger } from "../shared/types";

import type {
  PluginItemCount,
  PluginMenuItem,
  PluginMenuItemFields,
  PluginPanelGroup,
} from "./admin-contributions";
import { pluginCollectionSlugs } from "./plugin-admin-meta";
import type { PluginDefinition } from "./plugin-context";
import { pluginAdminSlug } from "./plugin-slug";
import { renamedSlug } from "./served-collection-slug";

/**
 * Something a plugin's panel declares that the admin is not sent, or that it
 * is sent but can never draw.
 */
export interface PluginPanelProblem {
  readonly kind:
    | "panel-item-unregistered-page"
    | "panel-item-unknown-group"
    | "panel-group-duplicate"
    | "panel-count-unowned-collection"
    | "panel-count-undeclared-attention"
    | "panel-count-attention-never-shown"
    | "panel-count-malformed"
    | "panel-item-count-and-badge"
    | "panel-child-panel-fields";
  /** The item's label, or the group's id for a duplicate group. */
  readonly subject: string;
  /** What was written, where it helps to name it. */
  readonly declared?: string;
}

/** A plugin's panel as the admin is sent it, and what was left out of it. */
export interface PublishedPluginPanel {
  /** The panel's groups, each id once; absent when it declares none. */
  readonly groups?: PluginPanelGroup[];
  /** The menu items kept, with their groups and numbers checked. */
  readonly menu: PluginMenuItem[];
  readonly problems: PluginPanelProblem[];
}

/** The fields a child item may not carry: its parent is what the panel lists. */
const PARENT_ONLY_FIELDS = ["group", "count", "badge"] as const;

/**
 * The plugin's panel, checked against what the plugin registers and owns:
 *
 * - an item addressing one of the plugin's own pages
 *   (`/admin/plugins/<slug>/<path>`) that it does not register is left out,
 *   children included: the admin has nothing to draw there;
 * - an item naming a group the plugin does not declare is listed with the
 *   items naming none;
 * - a count or badge naming a collection the plugin does not contribute, or
 *   an attention item it does not declare, is left out, and so are both where
 *   an item carries the two; a count naming a collection is sent naming the
 *   slug the host registered it under;
 * - a child's group, count and badge are left out: the panel lists its parent.
 *
 * Items addressing anything else, a collection, Settings, another site, are
 * kept as they are.
 */
export function publishedPluginPanel(
  plugin: PluginDefinition
): PublishedPluginPanel {
  const problems: PluginPanelProblem[] = [];
  const groups = uniqueGroups(plugin, problems);
  const known = new Set(groups.map(group => group.id));
  const menu = (plugin.contributes?.admin?.menu ?? []).flatMap(item => {
    if (!pageRegistered(plugin, item, problems)) return [];
    const children = item.children?.flatMap(child =>
      pageRegistered(plugin, child, problems)
        ? [childWithoutPanelFields(child, problems)]
        : []
    );
    return [
      withPanelFields(
        children === undefined ? item : { ...item, children },
        { plugin, known },
        problems
      ),
    ];
  });
  return {
    ...(groups.length > 0 ? { groups } : {}),
    menu,
    problems,
  };
}

/** The declared groups, each id once: a repeated id is reported and dropped. */
function uniqueGroups(
  plugin: PluginDefinition,
  problems: PluginPanelProblem[]
): PluginPanelGroup[] {
  const seen = new Set<string>();
  const groups: PluginPanelGroup[] = [];
  for (const group of plugin.contributes?.admin?.panel?.groups ?? []) {
    if (seen.has(group.id)) {
      problems.push({ kind: "panel-group-duplicate", subject: group.id });
      continue;
    }
    seen.add(group.id);
    groups.push({ id: group.id, label: group.label });
  }
  return groups;
}

/**
 * Whether the plugin registers the page an item addresses, when it addresses
 * one of the plugin's own pages; true for an item addressing anything else.
 * One left out is reported.
 */
function pageRegistered(
  plugin: PluginDefinition,
  item: PluginMenuItem,
  problems: PluginPanelProblem[]
): boolean {
  if (ownPageRegistered(plugin, item.to) !== false) return true;
  problems.push({
    kind: "panel-item-unregistered-page",
    subject: item.label,
    declared: item.to,
  });
  return false;
}

/**
 * Whether `to` names a page the plugin registers, when it addresses the
 * plugin's own pages, `/admin/plugins/<slug>/<path>`: matched by the page's
 * path, as the admin registers it, with a query or hash allowed after it.
 * `undefined` for an address outside them, which is not the plugin's to name.
 */
export function ownPageRegistered(
  plugin: PluginDefinition,
  to: string
): boolean | undefined {
  // The address without a query or hash, which are carried through unchanged.
  const [path = ""] = to.split(/[?#]/, 1);
  // The address the admin mounts the plugin's pages at (`pluginPagePath`).
  const prefix = `/admin/plugins/${pluginAdminSlug(plugin.name)}/`;
  if (!path.startsWith(prefix)) return undefined;
  const named = path.slice(prefix.length);
  const pages = plugin.contributes?.admin?.pages ?? [];
  return pages.some(page => page.path.replace(/^\/+/, "") === named);
}

/** A child item without the fields only a top-level item is drawn with. */
function childWithoutPanelFields(
  child: PluginMenuItem,
  problems: PluginPanelProblem[]
): PluginMenuItem {
  if (!PARENT_ONLY_FIELDS.some(field => child[field] !== undefined)) {
    return child;
  }
  problems.push({ kind: "panel-child-panel-fields", subject: child.label });
  const { group: _group, count: _count, badge: _badge, ...rest } = child;
  return rest;
}

/** What checking an item's panel fields reads of the plugin. */
interface PanelScope {
  readonly plugin: PluginDefinition;
  /** The ids of the plugin's groups. */
  readonly known: ReadonlySet<string>;
}

/** A top-level item with its group and number checked. */
function withPanelFields(
  item: PluginMenuItem,
  scope: PanelScope,
  problems: PluginPanelProblem[]
): PluginMenuItem {
  // Read before the checks below, which narrow `item` by what its type allows.
  const { label } = item;
  const { group, count, badge, ...fields } = item;
  const kept: PluginMenuItemFields = keptGroup(group, scope.known)
    ? { ...fields, group }
    : fields;
  if (group !== undefined && kept.group === undefined) {
    problems.push({
      kind: "panel-item-unknown-group",
      subject: label,
      declared: String(group),
    });
  }
  if (count !== undefined && badge !== undefined) {
    problems.push({ kind: "panel-item-count-and-badge", subject: label });
    return kept;
  }
  const number = count ?? badge;
  if (number === undefined) return kept;
  const resolved = resolvedCount(number, scope.plugin, label, problems);
  if (resolved === undefined) return kept;
  return count === undefined
    ? { ...kept, badge: resolved }
    : { ...kept, count: resolved };
}

/** Whether an item's group is one the plugin declares. */
function keptGroup(
  group: string | undefined,
  known: ReadonlySet<string>
): group is string {
  return group !== undefined && known.has(group);
}

/**
 * A count as the admin asks for it: a collection the plugin contributes,
 * named by the slug the host registered it under, or an attention item the
 * plugin declares. `undefined`, reported, for anything else.
 */
function resolvedCount(
  count: PluginItemCount,
  plugin: PluginDefinition,
  label: string,
  problems: PluginPanelProblem[]
): PluginItemCount | undefined {
  // Configuration is written in plain JavaScript too, where nothing stops a
  // count with both forms, neither, or a value that is not a string.
  const { collection, attention, where } = count as {
    collection?: unknown;
    attention?: unknown;
    where?: PluginItemCount["where"];
  };
  if (typeof collection === "string" && attention === undefined) {
    if (!pluginCollectionSlugs(plugin).includes(collection)) {
      problems.push({
        kind: "panel-count-unowned-collection",
        subject: label,
        declared: collection,
      });
      return undefined;
    }
    const slug = renamedSlug(plugin.renameMap ?? {}, collection);
    return where === undefined
      ? { collection: slug }
      : { collection: slug, where };
  }
  if (typeof attention === "string" && collection === undefined) {
    if (!declaredAttentionIds(plugin).includes(attention)) {
      problems.push({
        kind: "panel-count-undeclared-attention",
        subject: label,
        declared: attention,
      });
      return undefined;
    }
    if (readsOnlyHiddenCollections(plugin, attention)) {
      problems.push({
        kind: "panel-count-attention-never-shown",
        subject: label,
        declared: attention,
      });
    }
    return { attention };
  }
  problems.push({ kind: "panel-count-malformed", subject: label });
  return undefined;
}

/**
 * Whether the plugin's attention item `id` is gated on its collections and
 * every one is one of the plugin's own hidden from the navigation. Needs your
 * attention shows an item gated on collections only to a reader of one of
 * them as the dashboard lists them, and the dashboard leaves out a collection
 * hidden from the navigation, so such an item is shown to nobody and the
 * number read from it is always 0.
 */
function readsOnlyHiddenCollections(
  plugin: PluginDefinition,
  id: string
): boolean {
  const item = (plugin.contributes?.dashboard?.attention ?? []).find(
    candidate => candidate.id === id
  );
  const gated = item?.collections ?? [];
  if (gated.length === 0) return false;
  const hidden = new Set(
    [...(plugin.contributes?.collections ?? []), ...(plugin.collections ?? [])]
      .filter(
        collection =>
          collection.admin?.hidden === true ||
          (collection as { internal?: unknown }).internal === true
      )
      .map(collection => collection.slug)
  );
  return gated.every(slug => hidden.has(slug));
}

/** The ids of the plugin's own dashboard attention items. */
function declaredAttentionIds(plugin: PluginDefinition): string[] {
  return (plugin.contributes?.dashboard?.attention ?? []).map(item => item.id);
}

/** One line of the start-up report about plugins' panels. */
interface PluginPanelWarning {
  readonly kind: PluginPanelProblem["kind"];
  readonly plugin: string;
  readonly message: string;
}

/**
 * What a development start says about the plugins' panels, and nothing
 * anywhere else: everything it reports is already left out of the admin, or
 * can never draw there, in every environment, so a production log would gain
 * a line nobody there can act on. Disabled plugins are skipped: they draw no
 * menu items.
 */
function pluginPanelWarnings(
  plugins: readonly PluginDefinition[],
  nodeEnv: string | undefined
): PluginPanelWarning[] {
  if (nodeEnv !== "development") return [];
  return plugins.flatMap(plugin => {
    if (plugin.enabled === false) return [];
    return publishedPluginPanel(plugin).problems.map(problem => ({
      kind: problem.kind,
      plugin: plugin.name,
      message: `Plugin "${plugin.name}": ${problemSentence(plugin, problem)}`,
    }));
  });
}

/**
 * Writes the development start's report about the plugins' panels to
 * `logger`, the host's own, one warning per line, each with its kind and
 * plugin beside it; nothing outside development.
 */
export function reportPluginPanelWarnings(
  plugins: readonly PluginDefinition[],
  nodeEnv: string | undefined,
  logger: Pick<Logger, "warn">
): void {
  for (const warning of pluginPanelWarnings(plugins, nodeEnv)) {
    logger.warn(warning.message, {
      kind: warning.kind,
      plugin: warning.plugin,
    });
  }
}

/** The report's sentence for one problem, after the plugin's name. */
function problemSentence(
  plugin: PluginDefinition,
  problem: PluginPanelProblem
): string {
  const item = `menu item "${problem.subject}"`;
  const declared = problem.declared ?? "";
  switch (problem.kind) {
    case "panel-item-unregistered-page":
      return (
        `${item} links to "${declared}", which is none of its ` +
        `contributes.admin.pages under /admin/plugins/` +
        `${pluginAdminSlug(plugin.name)}/. It is left out.`
      );
    case "panel-item-unknown-group":
      return (
        `${item} names group "${declared}", which admin.panel.groups does ` +
        `not declare. It is listed with the items naming no group.`
      );
    case "panel-group-duplicate":
      return `admin.panel.groups declares "${problem.subject}" more than once. The first is used.`;
    case "panel-count-unowned-collection":
      return (
        `${item} counts collection "${declared}", which it does not ` +
        `contribute. It is drawn without a number.`
      );
    case "panel-count-undeclared-attention":
      return (
        `${item} counts attention item "${declared}", which ` +
        `contributes.dashboard.attention does not declare. It is drawn ` +
        `without a number.`
      );
    case "panel-count-attention-never-shown":
      return (
        `${item} reads attention item "${declared}", which counts only ` +
        `collections hidden from the navigation. Needs your attention leaves ` +
        `those out, so the item is shown to nobody and its number is always 0.`
      );
    case "panel-count-malformed":
      return (
        `${item} has a count naming neither a collection nor an attention ` +
        `item. It is drawn without a number.`
      );
    case "panel-item-count-and-badge":
      return `${item} has both a count and a badge. It is drawn without a number.`;
    case "panel-child-panel-fields":
      return (
        `${item} is a child item with a group, count or badge, which only a ` +
        `top-level item is drawn with. They are left out.`
      );
  }
}
