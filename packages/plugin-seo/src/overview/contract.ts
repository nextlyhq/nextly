/**
 * What the SEO section's Overview and the routes behind it agree on: where
 * the section's screens are, the setup checklist's items and what its route
 * answers, and how the optional connections and the recent addresses not
 * found are read for the screen. Plain data and pure functions only, importing
 * nothing but other contracts, so the admin's client bundle takes it without
 * bringing server code along.
 *
 * The section's screens, each under `/admin/plugins/<slug>/`:
 *
 * | Path            | Screen                                             |
 * | --------------- | -------------------------------------------------- |
 * | `overview`      | Overview, the section's landing                    |
 * | `pages`         | Pages                                              |
 * | `pages/import`  | Import, reached from Pages                         |
 * | `pages/inspect` | Inspect a page; `?address=` names it               |
 * | `bulk`          | Bulk edit, until Pages' Edit mode takes it over    |
 * | `problems`      | Problems; `?severity=` narrows it to one severity  |
 * | `redirects`     | Redirects; `?tab=notfound` opens Not found, and     |
 * |                 | `?from=` (with `&to=`) opens a new redirect        |
 * | `settings`      | Settings; `?tab=` opens one of its tabs            |
 *
 * @module overview/contract
 */
import type {
  ConnectionAttempt,
  ConnectionsBody,
} from "../connections/contract";
import {
  REDIRECTS_PAGE_HREF,
  type NotFoundView,
  type ProxyStatus,
} from "../redirects/contract";
import { SEO_ADMIN_SLUG, SETTINGS_PAGE_HREF } from "../settings/contract";

/** Where the section's screens are mounted. */
const SECTION_BASE = `/admin/plugins/${SEO_ADMIN_SLUG}`;

/** The Overview: its path under the plugin, and its component. */
export const OVERVIEW_PAGE: {
  readonly path: "overview";
  readonly component: "@nextlyhq/plugin-seo/admin#SeoOverviewPage";
} = {
  path: "overview",
  component: "@nextlyhq/plugin-seo/admin#SeoOverviewPage",
};

/** Where the Overview is: the section's landing, and its trail's first step. */
export const OVERVIEW_PAGE_HREF: string = `${SECTION_BASE}/${OVERVIEW_PAGE.path}`;

/** Import, reached from Pages: its path under the plugin, and its component. */
export const IMPORT_PAGE: {
  readonly path: "pages/import";
  readonly component: "@nextlyhq/plugin-seo/admin#SeoImportPage";
} = {
  path: "pages/import",
  component: "@nextlyhq/plugin-seo/admin#SeoImportPage",
};

/** Where Import is. */
export const IMPORT_PAGE_HREF: string = `${SECTION_BASE}/${IMPORT_PAGE.path}`;

/** Inspect, a page's row action on Pages: its path, and its component. */
export const INSPECT_PAGE: {
  readonly path: "pages/inspect";
  readonly component: "@nextlyhq/plugin-seo/admin#SeoInspectPage";
} = {
  path: "pages/inspect",
  component: "@nextlyhq/plugin-seo/admin#SeoInspectPage",
};

/** Where Inspect is; `?address=` names the page. */
export const INSPECT_PAGE_HREF: string = `${SECTION_BASE}/${INSPECT_PAGE.path}`;

/** Where the checklist is read, and hidden or shown, under the plugin's routes. */
export const CHECKLIST_ROUTE_PATH = "/overview/checklist";

/** The checklist's items, in the order the Overview lists them. */
export const CHECKLIST_ITEMS = [
  "site",
  "patterns",
  "shareImage",
  "brand",
  "import",
  "searchConsole",
] as const;

/** One of the checklist's items. */
export type ChecklistItemId = (typeof CHECKLIST_ITEMS)[number];

/** One item as the route answers it: whether it is done, from stored state. */
export interface ChecklistItemState {
  id: ChecklistItemId;
  done: boolean;
  /** For `patterns`: how many content types SEO is added to. */
  types?: number;
}

/** What the checklist route answers. */
export interface ChecklistBody {
  /**
   * Whether first-time setup still waits to be asked, which a first visit
   * to the Overview is sent on to.
   */
  setupWaiting: boolean;
  /** Whether someone hid the checklist; it stays hidden until shown again. */
  hidden: boolean;
  /** The items that apply to this site, in order: `import` only where a source exists. */
  items: ChecklistItemState[];
}

/** What a hide or show sends. */
export interface ChecklistVisibility {
  hidden: boolean;
}

/** An item's name and the link to where it is done. */
export interface ChecklistItemText {
  label: string;
  action: string;
  href: string;
}

/** Each item's name, and the link to where it is done. */
export function checklistItemText(item: ChecklistItemState): ChecklistItemText {
  switch (item.id) {
    case "site":
      return {
        label: "Name the site and its production address",
        action: "Name it",
        href: `${SETTINGS_PAGE_HREF}?tab=general`,
      };
    case "patterns": {
      const types = item.types ?? 0;
      return {
        label: `Choose title patterns for ${types} content ${types === 1 ? "type" : "types"}`,
        action: "Choose",
        href: `${SETTINGS_PAGE_HREF}?tab=types`,
      };
    }
    case "shareImage":
      return {
        label: "Add a default share image",
        action: "Add",
        href: `${SETTINGS_PAGE_HREF}?tab=general`,
      };
    case "brand":
      return {
        label: "Describe the organization behind the site",
        action: "Describe",
        href: `${SETTINGS_PAGE_HREF}?tab=brand`,
      };
    case "import":
      return {
        label: "Bring in SEO values from the old fields",
        action: "Import",
        href: IMPORT_PAGE_HREF,
      };
    case "searchConsole":
      return {
        label: "Connect Google Search Console",
        action: "Connect",
        href: `${SETTINGS_PAGE_HREF}?tab=connections`,
      };
  }
}

/** How an optional connection stands on the Overview. */
export type ConnectionStanding = "connected" | "not-connected" | "failing";

/** One connection's line on the Overview. */
export interface ConnectionLine {
  name: string;
  standing: ConnectionStanding;
  /** What the line says: `Connected`, `Not connected`, `Failing · reconnect`. */
  text: string;
  /** Where it is set up, where the line links; none where nothing needs doing there. */
  href?: string;
}

/** Where the connections are set up. */
const CONNECTIONS_HREF = `${SETTINGS_PAGE_HREF}?tab=connections`;

/** What to do about IndexNow's last notice, where it failed. */
const INDEXNOW_FIX: Record<
  Exclude<ConnectionAttempt["result"], "sent">,
  string
> = {
  "refused-key": "check the key",
  "rate-limited": "slowed down",
  "no-address": "set the address",
  refused: "check the settings",
  failed: "check the settings",
};

/** Search Console's line, from what the connections route answers. */
export function searchConsoleConnection(
  state: ConnectionsBody["searchConsole"]
): ConnectionLine {
  const base = { name: "Search Console", href: CONNECTIONS_HREF };
  if (state.failed !== undefined) {
    return { ...base, standing: "failing", text: "Failing · reconnect" };
  }
  if (state.connected !== undefined) {
    return { ...base, standing: "connected", text: "Connected" };
  }
  return { ...base, standing: "not-connected", text: "Not connected" };
}

/** IndexNow's line: switched on or off, and how its last notice went. */
export function indexNowConnection(
  state: ConnectionsBody["indexNow"]
): ConnectionLine {
  const base = { name: "IndexNow", href: CONNECTIONS_HREF };
  if (state.switchedOn !== true) {
    return { ...base, standing: "not-connected", text: "Not connected" };
  }
  const result = state.last?.result;
  if (result === undefined || result === "sent") {
    return { ...base, standing: "connected", text: "Connected" };
  }
  return {
    ...base,
    standing: "failing",
    text: `Failing · ${INDEXNOW_FIX[result]}`,
  };
}

/** The line for the site's Proxy, which serves the redirects. */
export function redirectsConnection(status: ProxyStatus): ConnectionLine {
  const base = { name: "Redirects on the site", href: REDIRECTS_PAGE_HREF };
  switch (status.state) {
    case "running":
      return { name: base.name, standing: "connected", text: "Running" };
    case "quiet":
      return { ...base, standing: "failing", text: "Failing · not running" };
    case "not-wired":
      return { ...base, standing: "not-connected", text: "Not connected" };
  }
}

/** How far back the Overview lists addresses not found. */
const RECENT_NOT_FOUND_DAYS = 7;

/** How many addresses not found the Overview lists at most. */
const RECENT_NOT_FOUND_SHOWN = 3;

/**
 * The addresses not found in the last week, most recent first, as many as
 * the Overview lists; one someone chose to ignore is left out.
 */
export function recentNotFound(
  rows: readonly NotFoundView[],
  now: number = Date.now()
): NotFoundView[] {
  const since = now - RECENT_NOT_FOUND_DAYS * 24 * 60 * 60 * 1000;
  return rows
    .filter(row => {
      if (row.ignored) return false;
      const seen = Date.parse(row.lastSeen);
      return Number.isFinite(seen) && seen >= since;
    })
    .sort((a, b) => Date.parse(b.lastSeen) - Date.parse(a.lastSeen))
    .slice(0, RECENT_NOT_FOUND_SHOWN);
}
