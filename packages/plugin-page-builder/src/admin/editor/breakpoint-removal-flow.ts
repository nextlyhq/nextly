/**
 * What Settings says while a breakpoint is removed: which breakpoints a save
 * drops, whether anything is stored under them, and the words of each step,
 * read from the route's dry run (`SiteBreakpointsDryRun`) and from the
 * removals the Site tab's read reports (`SiteBreakpointRemovalStatus`).
 *
 * Pure, so every sentence a step shows is tested apart from React; the steps
 * themselves are `use-breakpoint-removal` and `breakpoint-removal-step`.
 *
 * @module admin/editor/breakpoint-removal-flow
 * @experimental
 */
import {
  breakpointContexts,
  type BreakpointDef,
  type BreakpointSet,
} from "@nextlyhq/blocks-engine";

import type {
  PlaceCount,
  RemovalPlace,
  RemovedBreakpoint,
} from "../../breakpoint-removal/dry-run";
import type {
  SiteBreakpointRemovalStatus,
  SiteBreakpointsDryRun,
} from "../../library-contract";

/** The ids `next` no longer defines that `current` does. */
export function droppedIds(
  current: BreakpointSet | undefined,
  next: BreakpointSet | undefined
): string[] {
  const kept = new Set(breakpointContexts(next).map(context => context.id));
  return breakpointContexts(current)
    .map(context => context.id)
    .filter(id => !kept.has(id));
}

/**
 * Whether the dry run found nothing at all under the breakpoints it removes,
 * so the save goes ahead without asking. Doubt is never nothing: a document
 * it could not read, one it could not reach into, or a count stopped by its
 * deadline is asked about.
 */
export function nothingStored(dryRun: SiteBreakpointsDryRun): boolean {
  return (
    dryRun.complete &&
    dryRun.unreadable === 0 &&
    dryRun.removed.every(
      removed =>
        removed.unaddressable === 0 &&
        removed.sharedStyles.classes === 0 &&
        Object.values(removed.places).every(place => place.documents === 0)
    )
  );
}

/** "A", "A and B", "A, B and C". */
export function joinNames(names: readonly string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/** `n` and its noun, singular for one. */
function count(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** How many names a line lists before counting the rest. */
const NAMES_LISTED = 4;

/** The first names, then how many more: "Home, Pricing and 13 more". */
function namesAndMore(named: readonly string[], unnamed: number): string {
  const listed = named.slice(0, NAMES_LISTED);
  const more = named.length - listed.length + unnamed;
  return joinNames(more > 0 ? [...listed, `${more} more`] : listed);
}

/** What the author calls each place, singular and plural, in list order. */
const PLACE_WORDS: Record<RemovalPlace, readonly [string, string]> = {
  pages: ["page", "pages"],
  singles: ["single", "singles"],
  components: ["component", "components"],
  patterns: ["pattern", "patterns"],
  layouts: ["Layout", "Layouts"],
  entries: ["other entry", "other entries"],
};

/** The places a confirmation always lists; the rest only when they hold some. */
const ALWAYS_LISTED: ReadonlySet<RemovalPlace> = new Set([
  "pages",
  "components",
  "patterns",
]);

/** One row of a confirmation's counts. */
export interface CountRow {
  readonly label: string;
  readonly count: number;
  /** For pages: how many of them have a draft holding some of it. */
  readonly drafts?: number;
}

/** A note a confirmation shows only when it applies. */
export interface RemovalNote {
  readonly lead: string;
  readonly rest: string;
}

/** What a confirmation says about one removed breakpoint. */
export interface RemovedSummary {
  readonly id: string;
  readonly label: string;
  readonly rows: readonly CountRow[];
  /** "38 style values and 6 hidden blocks in all, on Home and 13 more.", or null. */
  readonly totals: string | null;
  readonly notes: readonly RemovalNote[];
}

/** What the confirm step says, every sentence of it. */
export interface ConfirmWords {
  readonly title: string;
  readonly intro: string;
  readonly removed: readonly RemovedSummary[];
  /** Notes about the whole count: what it could not read, or finish. */
  readonly notes: readonly RemovalNote[];
  readonly undo: string;
  readonly confirm: string;
}

/** Capitalised, for a place's word at the start of a row. */
function capital(word: string): string {
  return word.charAt(0).toUpperCase() + word.slice(1);
}

/** The counts a confirmation lists for one breakpoint. */
function rowsOf(removed: RemovedBreakpoint): CountRow[] {
  const rows: CountRow[] = [];
  for (const [place, [, many]] of Object.entries(PLACE_WORDS) as [
    RemovalPlace,
    readonly [string, string],
  ][]) {
    const held: PlaceCount = removed.places[place];
    if (!ALWAYS_LISTED.has(place) && held.documents === 0) continue;
    rows.push({
      label: capital(many),
      count: held.documents,
      ...(place === "pages" && held.drafts > 0 ? { drafts: held.drafts } : {}),
    });
  }
  // Shared styles after the documents, as the prototype lists them.
  rows.push({ label: "Shared styles", count: removed.sharedStyles.classes });
  return rows;
}

/** "38 style values and 6 hidden blocks in all, on …", or null for none. */
function totalsOf(removed: RemovedBreakpoint): string | null {
  const places = Object.values(removed.places);
  const styles =
    places.reduce((sum, place) => sum + place.styles, 0) +
    removed.sharedStyles.styles;
  const hides = places.reduce((sum, place) => sum + place.hides, 0);
  if (styles === 0 && hides === 0) return null;
  const what = [
    ...(styles > 0 ? [count(styles, "style value", "style values")] : []),
    ...(hides > 0 ? [count(hides, "hidden block", "hidden blocks")] : []),
  ].join(" and ");
  const { named, unnamed } = removed.documents;
  // Named only where some are: a list of none but a count would say less
  // than the rows above it already do.
  const where = named.length > 0 ? `, on ${namesAndMore(named, unnamed)}` : "";
  return `${what} in all${where}.`;
}

/** The notes about one breakpoint, each only where it applies. */
function notesOf(removed: RemovedBreakpoint): RemovalNote[] {
  const { label } = removed;
  const notes: RemovalNote[] = [];
  const { locked } = removed;
  if (locked.named.length + locked.unnamed > 0) {
    notes.push({
      lead: "Locked blocks change too.",
      rest: `Their ${label} styles are removed in ${
        locked.named.length > 0
          ? namesAndMore(locked.named, locked.unnamed)
          : count(
              locked.unnamed,
              "entry you can't open",
              "entries you can't open"
            )
      }. Nothing else about them changes.`,
    });
  }
  const lockedStyles = removed.sharedStyles.locked;
  if (lockedStyles.length > 0) {
    const one = lockedStyles.length === 1;
    notes.push({
      lead: "Locked shared styles change too.",
      rest: `${joinNames(lockedStyles)} ${one ? "loses its" : "lose their"} ${label} styles. Nothing else about ${one ? "it" : "them"} changes.`,
    });
  }
  const places = Object.values(removed.places);
  const drafts = places.reduce((sum, place) => sum + place.drafts, 0);
  if (drafts > 0) {
    // Pages, where every draft is a page's; entries where some are not.
    const pagesOnly = removed.places.pages.drafts === drafts;
    notes.push({
      lead: pagesOnly
        ? `${count(drafts, "page has a draft", "pages have drafts")} waiting to be published.`
        : `${count(drafts, "entry has a draft", "entries have drafts")} waiting to be published.`,
      rest: `Their drafts are updated now; each live version keeps ${label}'s styles until its draft is published or discarded.`,
    });
  }
  if (removed.unaddressable > 0) {
    notes.push({
      lead: `${count(removed.unaddressable, "entry keeps", "entries keep")} some of ${label}'s styles.`,
      rest: "They sit inside a group or repeater the removal can't change, so they stay where they are.",
    });
  }
  return notes;
}

/**
 * The breakpoint the pages fall back to at a removed one's width: the next
 * wider one `next` keeps on its axis; where none is wider, the base, by the
 * device buttons' name on the viewport and as "base" on the container axis.
 * A container definition with no width covers every container width, so it
 * is wider than any bounded one, and none is wider than it.
 */
function fallbackLabel(
  removed: BreakpointDef | undefined,
  next: BreakpointSet,
  axis: "viewport" | "container",
  baseLabel: string
): string {
  // The viewport's definition with no width is the base itself, not a
  // breakpoint to fall back to; the container axis's is its widest.
  const widthOf = (def: BreakpointDef | undefined): number | undefined =>
    def?.maxWidth ?? (axis === "container" ? Infinity : undefined);
  const width = widthOf(removed) ?? Infinity;
  const wider = next[axis]
    .map(def => ({ def, width: widthOf(def) }))
    .filter(
      (entry): entry is { def: BreakpointDef; width: number } =>
        entry.width !== undefined && entry.width > width
    )
    .sort((a, b) => a.width - b.width)[0];
  if (wider !== undefined) return wider.def.label;
  return axis === "viewport" ? baseLabel : "base";
}

/** Where a breakpoint is defined in `set`, with its axis. */
function definitionOf(
  set: BreakpointSet,
  id: string
): { def: BreakpointDef; axis: "viewport" | "container" } | undefined {
  const viewport = set.viewport.find(def => def.id === id);
  if (viewport !== undefined) return { def: viewport, axis: "viewport" };
  const container = set.container.find(def => def.id === id);
  return container === undefined
    ? undefined
    : { def: container, axis: "container" };
}

/** What the confirm step says for a dry run of saving `next` over `current`. */
export function confirmWords(
  dryRun: SiteBreakpointsDryRun,
  current: BreakpointSet,
  next: BreakpointSet,
  /** What the base breakpoint is called on the device buttons. */
  baseLabel: string
): ConfirmWords {
  const labels = dryRun.removed.map(removed => removed.label);
  const names = joinNames(labels);
  const one = labels.length === 1;
  let intro: string;
  if (one) {
    const [removed] = dryRun.removed;
    const found = definitionOf(current, removed?.id ?? "");
    const fallback = fallbackLabel(
      found?.def,
      next,
      found?.axis ?? "viewport",
      baseLabel
    );
    intro = `Everything set for ${names} is deleted from the whole site, so the pages show their ${fallback} styles at that width. If you add a ${names} breakpoint again later, it starts empty.`;
  } else {
    intro = `Everything set for ${names} is deleted from the whole site, so the pages show the styles of the next wider breakpoint at those widths. If you add them again later, they start empty.`;
  }
  const notes: RemovalNote[] = [];
  if (!dryRun.complete) {
    notes.push({
      lead: "Counted as much as time allowed.",
      rest: "The removal still covers every page.",
    });
  }
  if (dryRun.unreadable > 0) {
    notes.push({
      lead: `${count(dryRun.unreadable, "entry couldn't", "entries couldn't")} be read`,
      rest: `and ${dryRun.unreadable === 1 ? "isn't" : "aren't"} counted.`,
    });
  }
  return {
    title: `Remove ${names} and the styles set for ${one ? "it" : "them"}?`,
    intro,
    removed: dryRun.removed.map(removed => ({
      id: removed.id,
      label: removed.label,
      rows: rowsOf(removed),
      totals: totalsOf(removed),
      notes: notesOf(removed),
    })),
    notes,
    undo: "This can't be undone.",
    confirm: `Remove ${names} and ${one ? "its" : "their"} styles`,
  };
}

/**
 * What one removed breakpoint's styles were removed from, to say once it is
 * done: "14 pages, 2 components and 4 shared styles"; empty for nothing.
 */
function removedFrom(removed: RemovedBreakpoint): string {
  const parts: string[] = [];
  for (const [place, [one, many]] of Object.entries(PLACE_WORDS) as [
    RemovalPlace,
    readonly [string, string],
  ][]) {
    const documents = removed.places[place].documents;
    if (documents > 0) parts.push(count(documents, one, many));
  }
  if (removed.sharedStyles.classes > 0) {
    parts.push(
      count(removed.sharedStyles.classes, "shared style", "shared styles")
    );
  }
  return joinNames(parts);
}

/** A status row: its title and the line under it. */
export interface StatusWords {
  readonly title: string;
  readonly hint: string;
}

/**
 * What the done row says. `removed` is the dry run's count where this tab
 * made the removal; a removal followed after Settings was opened again has
 * none, and says so more plainly.
 */
export function doneWords(
  labels: readonly string[],
  removed: readonly RemovedBreakpoint[] | undefined
): StatusWords {
  const names = joinNames(labels);
  const one = labels.length === 1;
  const title = `${names} ${one ? "was" : "were"} removed`;
  const only = removed?.length === 1 ? removed[0] : undefined;
  if (only === undefined || !one) {
    return {
      title,
      hint: `${one ? "Its" : "Their"} styles are gone from the site.`,
    };
  }
  const from = removedFrom(only);
  return {
    title,
    hint:
      from === ""
        ? "Nothing was styled for it."
        : `Its styles are gone from ${from}.`,
  };
}

/** What the row says for a removal that finished leaving documents. */
export function leftWords(
  status: Pick<
    SiteBreakpointRemovalStatus,
    "labels" | "left" | "waitingOnDrafts"
  >
): StatusWords {
  const names = joinNames(status.labels);
  const one = status.labels.length === 1;
  const was = one ? "was" : "were";
  // Drafts wait on pages, components, patterns and Layouts alike, so the
  // row speaks of live versions rather than of any one place.
  if (status.waitingOnDrafts) {
    return {
      title: `${names} ${was} removed, except from ${count(status.left, "live version", "live versions")}`,
      hint: `${status.left === 1 ? "It has a draft" : "Each has a draft"} waiting to be published, and keeps ${names}'s styles until that draft is published or discarded; ${names} can't be added back until then.`,
    };
  }
  return {
    title: `${names} ${was} removed, except from ${count(status.left, "entry it couldn't change", "entries it couldn't change")}`,
    hint: `${status.left === 1 ? "It keeps" : "They keep"} ${names}'s styles for now, and ${names} can't be added back until ${status.left === 1 ? "it is" : "they are"} changed.`,
  };
}

/** What the removing step says. */
export function removingWords(labels: readonly string[]): {
  readonly title: string;
  readonly body: string;
  readonly hint: string;
} {
  const names = joinNames(labels);
  const one = labels.length === 1;
  return {
    title: one
      ? `Removing ${names}'s styles`
      : `Removing the styles of ${names}`,
    body: `${names} ${one ? "is" : "are"} gone from the site's breakpoints. ${one ? "Its" : "Their"} styles are being removed from each page, component and pattern.`,
    hint: "On a large site this takes a few minutes. You can close Settings; it carries on in the background.",
  };
}

/** What the row says while a removal opened elsewhere, or earlier, goes on. */
export function resumedWords(labels: readonly string[]): StatusWords {
  const names = joinNames(labels);
  return {
    title: `${names}'s styles are still being removed`,
    hint: "Breakpoints can be changed again once it has finished.",
  };
}

/** The line shown while the dry run is out. */
export function checkingWords(labels: readonly string[]): string {
  return `Checking what uses ${joinNames(labels)} before saving…`;
}
