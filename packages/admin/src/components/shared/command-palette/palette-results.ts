/**
 * What the command palette offers one reader, worked out from the same
 * sources the menus draw from: the Content panel's collections and Singles,
 * the Settings panel's table, the Builders pages, the plugins' menu items, the
 * types the reader may create, and the help links no plugin hides.
 *
 * Pure, so what a reader is offered is decided in one place and can be read
 * without rendering: the palette only draws what this returns.
 *
 * @module components/shared/command-palette/palette-results
 */

import { computeHiddenHeaderButtons } from "@admin/components/layout/header/header-visibility";
import {
  canAccessApiKeys,
  canAccessWebhooks,
} from "@admin/components/layout/sidebar/lib/has-settings-section";
import { mayOpen } from "@admin/components/layout/sidebar/lib/resolve-settings-landing";
import {
  SETTINGS_NAV,
  visibleSettingsNav,
  type SettingsNavAccess,
  type SettingsNavGroup,
} from "@admin/components/layout/sidebar/lib/settings-nav";
import { isExternalHref } from "@admin/components/ui/link";
import { ROUTES, buildRoute } from "@admin/constants/routes";
import { collectionSingularLabel } from "@admin/lib/collection-label";
import { resolveVisibleMenuItems } from "@admin/lib/plugins/menu";
import { openablePluginSettings } from "@admin/lib/plugins/plugin-settings-permission";
import {
  collectionDisplayName,
  singleDisplayName,
} from "@admin/lib/sidebar-landing";
import type { PluginMetadata } from "@admin/types/branding";
import type { ApiCollection, ApiSingle } from "@admin/types/entities";

import { visibleHelpLinks } from "./help-links";

export interface PaletteSources {
  /** The collections the Content panel lists for this reader, in its order. */
  collections: readonly ApiCollection[];
  /** The Singles the Content panel lists for this reader, in its order. */
  singles: readonly ApiSingle[];
  /** Where a Single opens, by the rule the Content panel's link follows. */
  singleHref: (single: ApiSingle) => string;
  /** The collections this reader may create entries in. */
  creatable: readonly ApiCollection[];
  hasPermission: (slug: string) => boolean;
  plugins: PluginMetadata[] | undefined;
  /** Whether the site shows the Builders (`admin.branding.showBuilder`). */
  showBuilder: boolean;
}

export interface PaletteRow {
  /** Unique across every group, so the list can tell two rows apart. */
  id: string;
  label: string;
  /**
   * What the list's filter matches, and how it tells rows apart: unique
   * across every group, or the list would highlight two rows as one. The
   * label, then what sets the row apart from one of the same label.
   */
  value: string;
  href: string;
  /** Where the destination sits, drawn beside the label ("Settings", a plugin's name). */
  hint?: string;
  /** Opens outside the admin, in a new tab. */
  external?: boolean;
  /** Other words that find the row. */
  keywords?: string[];
}

export interface PaletteResults {
  collections: PaletteRow[];
  singles: PaletteRow[];
  pages: PaletteRow[];
  actions: PaletteRow[];
}

/**
 * The Builders pages, as the Builders panel lists them. Who may see them is
 * the panel's rule too: shown unless the site turns the builder off.
 */
const BUILDER_PAGES: readonly { id: string; label: string; href: string }[] = [
  { id: "collections", label: "Collections", href: ROUTES.BUILDER_COLLECTIONS },
  { id: "singles", label: "Singles", href: ROUTES.BUILDER_SINGLES },
  {
    id: "field-groups",
    label: "Field Groups",
    href: ROUTES.BUILDER_FIELD_GROUPS,
  },
];

/** The help links as the palette words them: an action names what it does. */
const HELP_ACTION_LABEL: Record<string, string> = {
  docs: "Open documentation",
};

export function paletteResults(
  sources: PaletteSources,
  nav: readonly SettingsNavGroup[] = SETTINGS_NAV
): PaletteResults {
  const { hasPermission } = sources;
  return withUniqueValues({
    collections: sources.collections.map(collection => ({
      id: `collection:${collection.name}`,
      label: collectionDisplayName(collection),
      value: `${collectionDisplayName(collection)} ${collection.name}`,
      href: buildRoute(ROUTES.COLLECTION_ENTRIES, { slug: collection.name }),
      keywords: [collection.name],
    })),
    singles: sources.singles.map(single => ({
      id: `single:${single.slug}`,
      label: singleDisplayName(single),
      value: `${singleDisplayName(single)} ${single.slug}`,
      href: sources.singleHref(single),
      keywords: [single.slug],
    })),
    pages: [
      {
        id: "page:dashboard",
        label: "Dashboard",
        value: "Dashboard",
        href: ROUTES.DASHBOARD,
        keywords: ["home", "overview"],
      },
      ...settingsPages(hasPermission, nav),
      // Every one the reader may open, a settings manager's included: the
      // palette is where a page is searched for by name, whatever other way
      // to it the menus give.
      ...openablePluginSettings(sources.plugins, hasPermission).map(link => ({
        id: `page:plugin-settings:${link.slug}`,
        label: link.label,
        value: `${link.label} Settings ${link.slug}`,
        href: link.href,
        hint: "Settings",
      })),
      ...(sources.showBuilder
        ? BUILDER_PAGES.map(page => ({
            id: `page:builder:${page.id}`,
            label: page.label,
            value: `${page.label} Builders`,
            href: page.href,
            hint: "Builders",
            keywords: ["schema", "builder"],
          }))
        : []),
      ...pluginPages(sources.plugins, hasPermission),
      {
        id: "page:account",
        label: "Account settings",
        value: "Account settings",
        href: ROUTES.ACCOUNT,
        keywords: ["my account", "profile", "password"],
      },
    ],
    actions: [
      ...sources.creatable.map(collection => ({
        id: `action:new:${collection.name}`,
        label: `New ${collectionSingularLabel(collection)}`,
        value: `New ${collectionSingularLabel(collection)} ${collection.name}`,
        href: buildRoute(ROUTES.COLLECTION_ENTRY_CREATE, {
          slug: collection.name,
        }),
        keywords: ["create", "add", collection.name],
      })),
      ...(hasPermission("create-users")
        ? [
            {
              id: "action:create-user",
              label: "Create user",
              value: "Create user",
              href: ROUTES.USERS_CREATE,
              keywords: ["new user", "invite", "add"],
            },
          ]
        : []),
      ...(hasPermission("create-roles")
        ? [
            {
              id: "action:create-role",
              label: "Create role",
              value: "Create role",
              href: ROUTES.SECURITY_ROLES_CREATE,
              keywords: ["new role", "permissions", "add"],
            },
          ]
        : []),
      ...visibleHelpLinks(computeHiddenHeaderButtons(sources.plugins)).map(
        link => ({
          id: `action:help:${link.id}`,
          label: HELP_ACTION_LABEL[link.id] ?? link.label,
          value: HELP_ACTION_LABEL[link.id] ?? link.label,
          href: link.href,
          external: true,
          keywords: ["help", link.label],
        })
      ),
    ],
  });
}

/**
 * The rows with no search value shared. The palette's list selects rows by
 * value, so two rows sharing one (a Single named "Account" with the slug
 * `settings`, and the Account settings page) would be selected together and
 * only the first could be chosen by keyboard. A repeat takes its row's id,
 * which no other row has; a value seen first keeps its words as they are.
 */
function withUniqueValues(results: PaletteResults): PaletteResults {
  const seen = new Set<string>();
  const unique = (rows: PaletteRow[]) =>
    rows.map(row => {
      const key = row.value.trim().toLowerCase();
      if (!seen.has(key)) {
        seen.add(key);
        return row;
      }
      const value = `${row.value} ${row.id}`;
      seen.add(value.trim().toLowerCase());
      return { ...row, value };
    });
  return {
    collections: unique(results.collections),
    singles: unique(results.singles),
    pages: unique(results.pages),
    actions: unique(results.actions),
  };
}

/**
 * Where each Settings page the palette offers this reader leads, for the
 * go-to key sequences (`g u`, `g r`, `g s`): derived from the palette's own
 * Settings rows, so a sequence never leads where the palette would not.
 */
export function openableSettingsHrefs(
  hasPermission: (slug: string) => boolean,
  nav: readonly SettingsNavGroup[] = SETTINGS_NAV
): Set<string> {
  return new Set(settingsPages(hasPermission, nav).map(page => page.href));
}

/**
 * Every Settings destination the reader may both see and open: the Settings
 * panel's own visibility rule, then the route's grant where it asks more.
 */
function settingsPages(
  hasPermission: (slug: string) => boolean,
  nav: readonly SettingsNavGroup[]
): PaletteRow[] {
  const access: SettingsNavAccess = {
    hasPermission,
    canAccessApiKeys: canAccessApiKeys(hasPermission),
    canAccessWebhooks: canAccessWebhooks(hasPermission),
  };
  return visibleSettingsNav(access, nav).flatMap(group =>
    group.items
      .filter(item => mayOpen(item, access))
      .map(item => ({
        id: `page:settings:${item.id}`,
        label: item.label,
        value: `${item.label} Settings`,
        href: item.href,
        hint: "Settings",
        keywords: [group.label],
      }))
  );
}

/**
 * Every page a plugin adds to the menus that the reader may open, children
 * included, each named after its plugin's item. Read through the menus' own
 * resolver, so an item hidden from the reader there is hidden here.
 */
function pluginPages(
  plugins: PluginMetadata[] | undefined,
  hasPermission: (slug: string) => boolean
): PaletteRow[] {
  const rows: PaletteRow[] = [];
  const seen = new Set<string>();
  const add = (label: string, to: string, hint?: string) => {
    if (seen.has(to)) return;
    seen.add(to);
    rows.push({
      id: `page:plugin:${to}`,
      label,
      // Two plugins may name an item alike; where each leads never repeats.
      value: `${label} ${hint ?? ""} ${to}`,
      href: to,
      ...(hint ? { hint } : {}),
      // An item may lead away from the admin (another site, a mail address):
      // the browser opens it, by the menus' own test, never the admin's
      // router, which would read it as an admin path.
      ...(isExternalHref(to) ? { external: true } : {}),
    });
  };
  for (const item of resolveVisibleMenuItems(plugins, hasPermission)) {
    add(item.label, item.to);
    for (const child of item.children ?? [])
      add(child.label, child.to, item.label);
  }
  return rows;
}
