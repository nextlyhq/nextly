/**
 * Every setting the panel offers for the selected block, as one list an author
 * can search by name and filter to what they changed.
 *
 * Built from what the panel already reads for the selection (the block's
 * inspection, the Style tab's sections, the built-in Advanced rows), so a
 * setting is found under the words it is drawn with. Pure: no document, no
 * DOM, so a tool reaches the same answers the panel does.
 *
 * - **Matching** goes by a setting's plain label, its section, its options'
 *   labels, the CSS names it writes and a few other words for it
 *   ({@link SYNONYMS}), ignoring case, accents, hyphens, underscores and camel
 *   case: "zindex", "z-index" and "zIndex" are one word.
 * - **Order** stays the panel's: a match never moves a setting, so the panel
 *   does not rearrange itself while the author types.
 * - **Only changed** keeps the settings holding a value of their own for what
 *   is being edited.
 *
 * @module settings-index
 */

/** The panel's three tabs. */
export type SettingTab = "content" | "style" | "advanced";

/** The tabs in the panel's order. */
export const SETTING_TABS: readonly SettingTab[] = [
  "content",
  "style",
  "advanced",
];

/** One setting, as the search and the filter read it. */
export interface SettingEntry {
  readonly tab: SettingTab;
  /** The section it is drawn in: its key in the tab's accordion. */
  readonly section: string;
  /** The section's plain label. */
  readonly sectionLabel: string;
  /** The prop name, catalog key or built-in id the row is drawn for. */
  readonly id: string;
  /** Its plain label. */
  readonly label: string;
  /** Its options' labels. */
  readonly options: readonly string[];
  /** The CSS properties or HTML attributes it writes. */
  readonly css: readonly string[];
  /** Whether it holds its own value for what is being edited. */
  readonly set: boolean;
}

/** What the panel is filtered by. Empty and off: nothing is filtered. */
export interface SettingsFilter {
  readonly query: string;
  readonly onlyChanged: boolean;
}

/**
 * The other words authors use for a setting, each group read as one: typing
 * any word of a group finds what any other word of it would. Small and kept
 * by hand, so each pair is one an author would say.
 */
const SYNONYMS: readonly (readonly string[])[] = [
  ["colour", "color"],
  ["corners", "radius", "rounded"],
  ["z-index", "layer order", "stacking"],
  // Not "rel" alone: it is the start of "Relative", Position's choice.
  ["nofollow", "link relationship"],
  ["hide", "hide on", "visible on"],
  ["padding", "spacing"],
  ["margin", "spacing"],
  ["font", "typeface"],
];

/**
 * Text as the matcher reads it: lower case, accents gone, camel case,
 * hyphens and underscores split into words, one space between words.
 */
export function normalise(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .replace(/[-_/·.,:()&]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Normalised text without its spaces: "z index" and "zindex" meet. */
function compact(text: string): string {
  return normalise(text).replace(/ /g, "");
}

/** The query, and each other word for it, as the matcher looks for them. */
function searchedFor(query: string): readonly string[] {
  const asked = compact(query);
  const words = new Set([asked]);
  for (const group of SYNONYMS) {
    if (group.some(word => compact(word) === asked)) {
      for (const word of group) words.add(compact(word));
    }
  }
  return [...words];
}

/** Everything an entry can be found by, each compacted. */
function findableBy(entry: SettingEntry): readonly string[] {
  return [entry.label, entry.sectionLabel, ...entry.options, ...entry.css].map(
    compact
  );
}

/** Whether an entry answers a query. An empty query answers every entry. */
export function entryMatches(entry: SettingEntry, query: string): boolean {
  if (compact(query) === "") return true;
  const wanted = searchedFor(query);
  return findableBy(entry).some(text =>
    wanted.some(word => text.includes(word))
  );
}

/** Whether a filter narrows anything. */
export function filtering(filter: SettingsFilter): boolean {
  return filter.onlyChanged || compact(filter.query) !== "";
}

/** The entries a filter keeps, in the panel's order. */
export function filterEntries(
  entries: readonly SettingEntry[],
  filter: SettingsFilter
): SettingEntry[] {
  return entries.filter(
    entry =>
      (!filter.onlyChanged || entry.set) && entryMatches(entry, filter.query)
  );
}

/** How many entries each tab keeps. */
export function tabCounts(
  kept: readonly SettingEntry[]
): Readonly<Record<SettingTab, number>> {
  const counts = { content: 0, style: 0, advanced: 0 };
  for (const entry of kept) counts[entry.tab] += 1;
  return counts;
}

/** The words for each tab, as its label reads. */
export const TAB_WORDS: Readonly<Record<SettingTab, string>> = {
  content: "Content",
  style: "Style",
  advanced: "Advanced",
};

/**
 * What a screen reader is told once the author stops typing: "5 settings
 * found: 3 in Style, 2 in Advanced", or that none is.
 */
export function resultsAnnouncement(
  counts: Readonly<Record<SettingTab, number>>
): string {
  const total = counts.content + counts.style + counts.advanced;
  if (total === 0) return "No setting matches. Try another word.";
  const where = SETTING_TABS.filter(tab => counts[tab] > 0)
    .map(tab => `${String(counts[tab])} in ${TAB_WORDS[tab]}`)
    .join(", ");
  const noun = total === 1 ? "setting" : "settings";
  return `${String(total)} ${noun} found: ${where}`;
}

/** A row of a section, as the index reads it. */
export interface IndexedRow {
  /** The prop name, catalog key or built-in id. */
  readonly id: string;
  readonly label: string;
  readonly options?: readonly string[];
  /** The CSS properties or HTML attributes it writes, where it says. */
  readonly css?: readonly string[];
  readonly set: boolean;
}

/** A section's rows as entries. */
export function sectionEntries(
  tab: SettingTab,
  section: { readonly key: string; readonly label: string },
  rows: readonly IndexedRow[]
): SettingEntry[] {
  return rows.map(row => ({
    tab,
    section: section.key,
    sectionLabel: section.label,
    id: row.id,
    label: row.label,
    options: row.options ?? [],
    css: row.css ?? [],
    set: row.set,
  }));
}

/** One device or state the edited target holds values at, and how many. */
export interface ElsewhereCount {
  readonly id: string;
  readonly label: string;
  readonly count: number;
}

/**
 * Where else the edited target holds values: by device at the edited state,
 * and by state at the edited device, each in the order given.
 */
export interface ElsewhereCounts {
  readonly devices: readonly ElsewhereCount[];
  readonly states: readonly ElsewhereCount[];
}

/** Stored styles: state, then device, then property. */
export type StoredStyles = Readonly<
  Record<string, Readonly<Record<string, Readonly<Record<string, unknown>>>>>
>;

/** How many properties a styles record holds at one state and device. */
function heldAt(styles: StoredStyles, state: string, device: string): number {
  return Object.keys(styles[state]?.[device] ?? {}).length;
}

/**
 * The values the edited target holds at the other devices and states, for
 * "Also changed on Tablet (2) · Hover (1)". Only those holding any are listed.
 */
export function changedElsewhere(
  styles: StoredStyles | undefined,
  at: { readonly state: string; readonly device: string },
  names: {
    readonly devices: readonly { id: string; label: string }[];
    readonly states: readonly { id: string; label: string }[];
  }
): ElsewhereCounts {
  if (styles === undefined) return { devices: [], states: [] };
  return {
    devices: names.devices
      .filter(device => device.id !== at.device)
      .map(device => ({
        ...device,
        count: heldAt(styles, at.state, device.id),
      }))
      .filter(device => device.count > 0),
    states: names.states
      .filter(state => state.id !== at.state)
      .map(state => ({ ...state, count: heldAt(styles, state.id, at.device) }))
      .filter(state => state.count > 0),
  };
}

/** "Also changed on Tablet (2) · Hover (1)", or nothing where none is. */
export function elsewhereLine(counts: ElsewhereCounts): string | undefined {
  const parts = [...counts.devices, ...counts.states].map(
    each => `${each.label} (${String(each.count)})`
  );
  return parts.length === 0
    ? undefined
    : `Also changed on ${parts.join(" · ")}`;
}
