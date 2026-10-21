/**
 * What the Messages list shows about each email, decided apart from how it is
 * drawn: which owner it is grouped under, which state it is in, and whether a
 * search and the filters keep it.
 *
 * @module components/features/email-hub/messages/messages-model
 */

import type {
  EmailTemplateOwner,
  EmailTemplateRecord,
} from "@admin/services/emailTemplateApi";

/** The default layout wraps every email and is never deleted. */
export const DEFAULT_LAYOUT_SLUG = "default-layout";

/** Who an email is grouped under. */
export interface OwnerGroup {
  /** Stable key: `core`, `plugin:<name>` or `site`. */
  key: string;
  label: string;
}

export function ownerGroupOf(owner: EmailTemplateOwner): OwnerGroup {
  switch (owner.kind) {
    case "core":
      return { key: "core", label: "Nextly" };
    case "plugin":
      return { key: `plugin:${owner.name}`, label: owner.name };
    case "site":
      return { key: "site", label: "This site" };
  }
}

/** Core first, then each plugin by name, then the site's own. */
function groupRank(group: OwnerGroup): [number, string] {
  if (group.key === "core") return [0, ""];
  if (group.key === "site") return [2, ""];
  return [1, group.label.toLowerCase()];
}

export function compareGroups(a: OwnerGroup, b: OwnerGroup): number {
  const [ra, la] = groupRank(a);
  const [rb, lb] = groupRank(b);
  return ra - rb || la.localeCompare(lb);
}

/**
 * An email's state, as the list names it.
 *
 * - `default`: an owner's email as its owner wrote it.
 * - `customised`: the site's version of an owner's email.
 * - `update`: the owner changed it since the site customised it.
 * - `kept`: holds text the previous engine sent as written, so it sends as it
 *   always did until someone changes those lines.
 * - `own`: one of the site's own emails.
 *
 * Off is separate: an email that is off says so beside whichever of these it
 * is, because being off is true of it whatever else is.
 */
export type EmailState = "default" | "customised" | "update" | "kept" | "own";

export function stateOf(record: EmailTemplateRecord): EmailState {
  if (record.keptOnOldEngine) return "kept";
  if (record.owner.kind === "site") return "own";
  if (record.ownerChanged) return "update";
  if (record.overridden) return "customised";
  return "default";
}

/** The state filter's choices; `off` matches any email that is off. */
export type StateFilter = "all" | "off" | Exclude<EmailState, "own">;

export const STATE_FILTER_LABELS: Record<StateFilter, string> = {
  all: "Any state",
  default: "Default",
  customised: "Customised",
  update: "Update available",
  kept: "Kept as before",
  off: "Off",
};

export const STATE_LABELS: Record<EmailState, string> = {
  default: "Default",
  customised: "Customised",
  update: "Update available",
  kept: "Kept as before",
  own: "On",
};

export const STATE_HELP: Record<EmailState, string> = {
  default: "The owner's version, kept up to date by the owner.",
  customised: "Your site's version. The owner's updates wait for your review.",
  update: "The owner changed this email since you customised it.",
  kept: "Holds text the previous engine sent as written. It keeps sending exactly as before until someone changes those lines.",
  own: "One of this site's own emails.",
};

export interface MessagesQuery {
  search: string;
  /** `all`, or an owner group's key. */
  owner: string;
  state: StateFilter;
}

/** Whether an email matches the search and both filters. */
export function matchesQuery(
  record: EmailTemplateRecord,
  query: MessagesQuery
): boolean {
  if (query.owner !== "all" && ownerGroupOf(record.owner).key !== query.owner) {
    return false;
  }
  if (query.state === "off") {
    if (record.isActive) return false;
  } else if (query.state !== "all" && stateOf(record) !== query.state) {
    return false;
  }
  const term = query.search.trim().toLowerCase();
  if (!term) return true;
  return [record.name, record.slug, record.subject, record.description ?? ""]
    .join("\n")
    .toLowerCase()
    .includes(term);
}

/** The emails Messages lists: templates, not layouts or partials. */
export function isMessage(record: EmailTemplateRecord): boolean {
  return record.kind === "template";
}

export interface MessageGroup {
  group: OwnerGroup;
  rows: EmailTemplateRecord[];
}

/** Emails grouped by owner, groups in owner order, rows by name. */
export function groupByOwner(records: EmailTemplateRecord[]): MessageGroup[] {
  const groups = new Map<string, MessageGroup>();
  for (const record of records) {
    const group = ownerGroupOf(record.owner);
    const entry = groups.get(group.key) ?? { group, rows: [] };
    entry.rows.push(record);
    groups.set(group.key, entry);
  }
  return [...groups.values()]
    .sort((a, b) => compareGroups(a.group, b.group))
    .map(entry => ({
      ...entry,
      rows: [...entry.rows].sort((a, b) => a.name.localeCompare(b.name)),
    }));
}

/**
 * Whether the server lets this email be deleted: an owner's email belongs to
 * its owner and is reset instead, and the default layout is never deleted. An
 * email whose plugin is no longer installed is the site's to delete.
 */
export function isDeletable(record: EmailTemplateRecord): boolean {
  if (record.slug === DEFAULT_LAYOUT_SLUG) return false;
  if (record.owner.kind === "core") return false;
  if (record.owner.kind === "plugin" && record.owner.installed) return false;
  return true;
}
