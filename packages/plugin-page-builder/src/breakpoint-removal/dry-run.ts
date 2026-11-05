/**
 * What removing breakpoints would drop across the site, counted before the
 * author confirms it, and nothing written.
 *
 * Every document holding blocks is walked by the same walk a rewrite uses
 * (`host-rewrite/site`), and read as the system: a page the person removing
 * the breakpoint cannot open still loses its styles, so it is counted. It is
 * NAMED only to someone who may read it; the rest are counted and not named.
 *
 * Doubt is never reported as nothing to drop. A document that cannot be read
 * is counted as unreadable, a value no write can reach (inside a repeater or a
 * named group) as unaddressable, and a walk stopped by its deadline answers
 * `complete: false`.
 *
 * @module breakpoint-removal/dry-run
 * @experimental
 */
import type { DocumentLimits, NamedClass } from "@nextlyhq/blocks-engine";

import type { HostAddress } from "../host-rewrite/contract";
import type {
  HostDocument,
  HostRead,
  HostReader,
  ReadValue,
} from "../host-rewrite/rewrite";
import { scannedOutcomes } from "../host-rewrite/scan";

import {
  breakpointUsesIn,
  sharedStyleUses,
  type SharedStyleUse,
} from "./usage";

/** Where a document holding blocks sits, as a confirmation names it. */
export type RemovalPlace =
  | "pages"
  | "singles"
  | "components"
  | "patterns"
  | "layouts"
  | "entries";

/** Every place, in the order a confirmation lists them. */
export const REMOVAL_PLACES: readonly RemovalPlace[] = [
  "pages",
  "singles",
  "components",
  "patterns",
  "layouts",
  "entries",
];

/** What one place keeps under a breakpoint. */
export interface PlaceCount {
  /** Documents holding a style or a hide there, in any stored form. */
  documents: number;
  /** Of those, the ones whose pending working draft holds one. */
  drafts: number;
  /**
   * Style property values, every stored form counted: a value the live row
   * and the working draft both hold is dropped from each.
   */
  styles: number;
  /** Blocks storing their own visibility there, counted the same way. */
  hides: number;
}

/** Documents, named where the caller may read them and counted where not. */
export interface NamedDocuments {
  /** What the caller knows them by, at most {@link NAMED_AT_MOST}. */
  named: string[];
  /** The rest: past the cap, or ones the caller may not read. */
  unnamed: number;
}

/** What removing one breakpoint would drop. */
export interface RemovedBreakpoint {
  id: string;
  /** What the author knows it by. */
  label: string;
  places: Record<RemovalPlace, PlaceCount>;
  sharedStyles: SharedStyleUse;
  /** The documents holding something there. */
  documents: NamedDocuments;
  /** The documents where a Layers lock holds some of it. */
  locked: NamedDocuments;
  /** Documents holding something there no write can reach. */
  unaddressable: number;
}

/** The whole dry run. */
export interface RemovalDryRun {
  removed: RemovedBreakpoint[];
  /** Documents that could not be read, and so were not counted. */
  unreadable: number;
  /** Whether every document was walked; false when the deadline stopped it. */
  complete: boolean;
}

/** How many documents one list names; the rest are counted. */
export const NAMED_AT_MOST = 10;

/** What the dry run reads the site through. */
export interface DryRunDeps {
  /** Every document holding blocks, as the shared walk yields them. */
  readonly documents: () => AsyncIterable<HostDocument>;
  /** One host's stored forms, read as the system. */
  readonly read: HostReader;
  /** Which place a document is in, by its first host. */
  readonly placeOf: (host: HostAddress) => RemovalPlace;
  /**
   * What the caller knows a document by, or `null` when the caller may not
   * read it. Asked only for documents that would be named.
   */
  readonly nameFor: (host: HostAddress) => Promise<string | null>;
  /** The bounds the compiler reads a document within. */
  readonly limits: DocumentLimits;
  /** The site's shared styles, as stored and defaulted. */
  readonly classes: readonly NamedClass[];
  /** When the walk stops, answering `complete: false`. */
  readonly deadline?: Date;
}

/** One document's use of each removed breakpoint, across its hosts and forms. */
interface DocumentTally {
  styles: number;
  hides: number;
  locked: boolean;
  draft: boolean;
  unaddressable: boolean;
}

/** A zeroed count for every place. */
function emptyPlaces(): Record<RemovalPlace, PlaceCount> {
  return Object.fromEntries(
    REMOVAL_PLACES.map(place => [
      place,
      { documents: 0, drafts: 0, styles: 0, hides: 0 },
    ])
  ) as Record<RemovalPlace, PlaceCount>;
}

/** The tally for `id` in `tallies`, made when first asked for. */
function tallyOf(
  tallies: Map<string, DocumentTally>,
  id: string
): DocumentTally {
  let tally = tallies.get(id);
  if (tally === undefined) {
    tally = {
      styles: 0,
      hides: 0,
      locked: false,
      draft: false,
      unaddressable: false,
    };
    tallies.set(id, tally);
  }
  return tally;
}

/** The value of a form as read, or nothing. */
function valueOf(read: ReadValue | null): unknown {
  return read !== null && read.kind === "value" ? read.value : undefined;
}

/** One stored form of a host, as the walk reads it. */
interface ReadForm {
  readonly value: unknown;
  readonly draft: boolean;
}

/**
 * The breakpoints of `ids` used by any blocks value a row holds, found by
 * scanning it; `null` when the row could not be scanned to the end.
 */
async function scannedIds(
  candidate: HostDocument["hosts"][number],
  form: ReadForm,
  ids: ReadonlySet<string>,
  limits: DryRunDeps["limits"]
): Promise<Set<string> | null> {
  const found = new Set<string>();
  const outcome = await scannedOutcomes(
    value => {
      for (const id of breakpointUsesIn(value, ids, limits).uses.keys()) {
        found.add(id);
      }
      return { kind: "unchanged" };
    },
    form.value,
    { host: candidate.host, form: form.draft ? "draft" : "published" },
    candidate.excluded
  );
  return outcome === "unreadable" ? null : found;
}

/**
 * Add one stored form's use of `ids` to the document's tallies; false when
 * it could not be read to the end.
 *
 * A host at a top-level field is counted; one under a named group, or found
 * only by scanning the row, holds what no write can reach, so a use there
 * marks the document unaddressable for that breakpoint instead.
 */
async function addForm(
  tallies: Map<string, DocumentTally>,
  candidate: HostDocument["hosts"][number],
  form: ReadForm,
  ids: ReadonlySet<string>,
  limits: DryRunDeps["limits"]
): Promise<boolean> {
  if (candidate.access === "scan") {
    const found = await scannedIds(candidate, form, ids, limits);
    if (found === null) return false;
    for (const id of found) tallyOf(tallies, id).unaddressable = true;
    return true;
  }
  const { uses, complete } = breakpointUsesIn(form.value, ids, limits);
  if (!complete) return false;
  for (const [id, use] of uses) {
    const tally = tallyOf(tallies, id);
    if (candidate.access === "read") {
      tally.unaddressable = true;
      continue;
    }
    tally.styles += use.styles;
    tally.hides += use.hides;
    tally.locked ||= use.locked;
    tally.draft ||= form.draft;
  }
  return true;
}

/**
 * One document's use of each of `ids`, across its hosts and their stored
 * forms, or `null` when it could not be read.
 */
async function documentUses(
  document: HostDocument,
  ids: ReadonlySet<string>,
  deps: DryRunDeps
): Promise<Map<string, DocumentTally> | null> {
  const tallies = new Map<string, DocumentTally>();
  for (const candidate of document.hosts) {
    let read: HostRead;
    try {
      read = await deps.read(candidate.host);
    } catch {
      return null;
    }
    const forms: ReadForm[] = [
      { value: valueOf(read.published), draft: false },
      { value: valueOf(read.draft), draft: true },
    ];
    for (const form of forms) {
      if (form.value === undefined) continue;
      if (!(await addForm(tallies, candidate, form, ids, deps.limits))) {
        return null;
      }
    }
  }
  return tallies;
}

/** A list being named as it fills, past the cap only counted. */
interface Naming {
  readonly hosts: HostAddress[];
  unnamed: number;
}

/** Add a document to a list, holding its address while there is room to name it. */
function addTo(naming: Naming, host: HostAddress): void {
  if (naming.hosts.length < NAMED_AT_MOST) naming.hosts.push(host);
  else naming.unnamed += 1;
}

/** A list's names, asked of the caller: one they may not read is counted. */
async function named(
  naming: Naming,
  deps: DryRunDeps
): Promise<NamedDocuments> {
  const names: string[] = [];
  let unnamed = naming.unnamed;
  for (const host of naming.hosts) {
    const name = await deps.nameFor(host);
    if (name === null) unnamed += 1;
    else names.push(name);
  }
  return { named: names, unnamed };
}

/** What one removed breakpoint has gathered while the site is walked. */
interface Gathered {
  readonly places: Record<RemovalPlace, PlaceCount>;
  readonly documents: Naming;
  readonly locked: Naming;
  unaddressable: number;
}

/** Add one document's tallies to what each breakpoint has gathered. */
function gather(
  per: ReadonlyMap<string, Gathered>,
  tallies: ReadonlyMap<string, DocumentTally>,
  place: RemovalPlace,
  host: HostAddress
): void {
  for (const [id, tally] of tallies) {
    const entry = per.get(id);
    if (entry === undefined) continue;
    if (tally.unaddressable) entry.unaddressable += 1;
    if (tally.styles + tally.hides === 0) continue;
    const count = entry.places[place];
    count.documents += 1;
    if (tally.draft) count.drafts += 1;
    count.styles += tally.styles;
    count.hides += tally.hides;
    addTo(entry.documents, host);
    if (tally.locked) addTo(entry.locked, host);
  }
}

/** Whether the walk's deadline has passed. */
function pastDeadline(deps: DryRunDeps): boolean {
  return deps.deadline !== undefined && Date.now() >= deps.deadline.getTime();
}

/**
 * Walk every document, gathering what each of `ids` holds; answers how many
 * could not be read, and whether the walk reached the end.
 */
async function walkSite(
  ids: ReadonlySet<string>,
  per: ReadonlyMap<string, Gathered>,
  deps: DryRunDeps
): Promise<{ unreadable: number; complete: boolean }> {
  let unreadable = 0;
  for await (const document of deps.documents()) {
    if (pastDeadline(deps)) return { unreadable, complete: false };
    const first = document.hosts[0]?.host;
    if (first === undefined) continue;
    const tallies = await documentUses(document, ids, deps);
    if (tallies === null) unreadable += 1;
    else gather(per, tallies, deps.placeOf(first), first);
  }
  return { unreadable, complete: true };
}

/**
 * What removing each of `removed` (id to label) would drop, walked across the
 * whole site and its shared styles. Nothing removed walks nothing.
 */
export async function countRemoval(
  removed: ReadonlyMap<string, string>,
  deps: DryRunDeps
): Promise<RemovalDryRun> {
  const ids = new Set(removed.keys());
  const shared = sharedStyleUses(deps.classes, ids);
  const per = new Map<string, Gathered>(
    [...ids].map(id => [
      id,
      {
        places: emptyPlaces(),
        documents: { hosts: [], unnamed: 0 },
        locked: { hosts: [], unnamed: 0 },
        unaddressable: 0,
      },
    ])
  );
  const walked =
    ids.size === 0
      ? { unreadable: 0, complete: true }
      : await walkSite(ids, per, deps);
  const out: RemovedBreakpoint[] = [];
  for (const [id, entry] of per) {
    out.push({
      id,
      label: removed.get(id) ?? id,
      places: entry.places,
      sharedStyles: shared.get(id) ?? { classes: 0, styles: 0, locked: [] },
      documents: await named(entry.documents, deps),
      locked: await named(entry.locked, deps),
      unaddressable: entry.unaddressable,
    });
  }
  return { removed: out, ...walked };
}
