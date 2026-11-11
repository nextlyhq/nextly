import type {
  PluginMetadata,
  PluginUserMenuItemMeta,
} from "@admin/types/branding";

/**
 * Built-in admin header buttons a plugin may hide. The user/account dropdown is
 * intentionally not controllable (logout must stay reachable). Mirrors the core
 * `HeaderButtonId` (contributes.admin.header).
 */
export type HeaderButtonId = "github" | "discord" | "docs" | "notifications";

const ALL_BUTTONS: readonly HeaderButtonId[] = [
  "github",
  "discord",
  "docs",
  "notifications",
];

/**
 * Resolve which built-in header buttons are hidden, union-merged across plugins:
 * a button is hidden if ANY plugin sets `hideDefaults` or lists it in `hide`.
 *
 * Branding only carries enabled plugins' contributions (the server omits header
 * for disabled plugins), so no enabled-check is needed here.
 */
export function computeHiddenHeaderButtons(
  plugins: PluginMetadata[] | undefined
): Set<HeaderButtonId> {
  const hidden = new Set<HeaderButtonId>();
  for (const plugin of plugins ?? []) {
    const header = plugin.header;
    if (!header) continue;
    if (header.hideDefaults) {
      for (const id of ALL_BUTTONS) hidden.add(id);
    }
    for (const id of header.hide ?? []) hidden.add(id);
  }
  return hidden;
}

/**
 * Where a plugin's own item goes: the bar's right end (the default), the
 * rail's foot above the Inbox, or the person's menu.
 */
export type PluginItemPlace = "bar" | "rail-foot" | "menu";

/** The place a plugin's own item goes; the bar's right end unless it says. */
export function pluginItemPlace(plugin: PluginMetadata): PluginItemPlace {
  return plugin.header?.place ?? "bar";
}

const DEFAULT_ORDER = 100;

/**
 * The plugins whose own item goes to `place`, by their admin order. Plugins of
 * equal order keep the order they were configured in, as the bar always drew
 * them.
 */
function pluginsAt(
  plugins: PluginMetadata[] | undefined,
  place: PluginItemPlace
): PluginMetadata[] {
  return (plugins ?? [])
    .filter(plugin => pluginItemPlace(plugin) === place)
    .sort((a, b) => (a.order ?? DEFAULT_ORDER) - (b.order ?? DEFAULT_ORDER));
}

/** One plugin's own mounted item: the component path its config names. */
export interface PluginHeaderItem {
  name: string;
  slot: string;
}

/**
 * The plugins' own mounted items at the bar's right end or the rail's foot,
 * in plugin order. `header.slot` is the current spelling and wins over the
 * deprecated `headerSlot`. An item that chose another place is not drawn here.
 */
export function pluginHeaderItems(
  plugins: PluginMetadata[] | undefined,
  place: "bar" | "rail-foot" = "bar"
): PluginHeaderItem[] {
  return pluginsAt(plugins, place)
    .map(plugin => ({
      name: plugin.name,
      slot: plugin.header?.slot ?? plugin.headerSlot,
    }))
    .filter((item): item is PluginHeaderItem => Boolean(item.slot));
}

/** One plugin's item in the person's menu, with the plugin it belongs to. */
export type PluginUserMenuEntry = PluginUserMenuItemMeta & { plugin: string };

/** Whether an item goes somewhere or does something, and not both. */
function hasOneTarget(item: PluginUserMenuItemMeta): boolean {
  return (item.to === undefined) !== (item.action === undefined);
}

/**
 * The plugins' items in the person's menu, by plugin order, then label. One
 * with neither a link nor an action, or both, is left out.
 */
export function pluginUserMenuItems(
  plugins: PluginMetadata[] | undefined
): PluginUserMenuEntry[] {
  return pluginsAt(plugins, "menu")
    .flatMap(plugin => {
      const item = plugin.header?.item;
      if (!item || !hasOneTarget(item)) return [];
      const order = plugin.order ?? DEFAULT_ORDER;
      return [{ order, entry: { ...item, plugin: plugin.name } }];
    })
    .sort(
      (a, b) => a.order - b.order || a.entry.label.localeCompare(b.entry.label)
    )
    .map(({ entry }) => entry);
}

/**
 * Whether the person's menu draws its "Help and community" group: while a
 * built-in help link is left, or a plugin put an item there. A plugin hiding
 * the built-in links hides only those.
 */
export function helpGroupShown(
  hidden: ReadonlySet<string>,
  pluginItemCount: number
): boolean {
  const builtInLeft = ALL_BUTTONS.some(
    id => id !== "notifications" && !hidden.has(id)
  );
  return builtInLeft || pluginItemCount > 0;
}

/** Which of the answers the header's account controls wait on are still unanswered. */
export interface HeaderAnswersPending {
  /** The workspace answer: the plugins (what they hide and add) and whether the builder runs. */
  workspace: boolean;
  /** The reader's permissions, which decide whether the notification bell is theirs. */
  permissions: boolean;
}

/**
 * Whether the controls left of the account menu are decided, so the row can be drawn whole.
 *
 * The row is right-aligned, so a control that appears after the first paint pushes every control
 * to its LEFT sideways, while the account menu at the right end holds still whatever arrives
 * beside it. The menu is therefore drawn from the first paint, and the rest of the row once the
 * answers deciding it are in: the workspace answer for the links, the plugins' controls and the
 * bell, and the permissions for the bell where it may be offered. Nothing is drawn on a guess, as
 * a control drawn and then taken back moves its neighbours just the same.
 *
 * `bellOffered` is read only once the workspace answer is in: whether the bell can show at all
 * (no plugin hides it, and the builder runs).
 */
export function headerControlsSettled(
  pending: HeaderAnswersPending,
  bellOffered: boolean
): boolean {
  if (pending.workspace) return false;
  return !(bellOffered && pending.permissions);
}
