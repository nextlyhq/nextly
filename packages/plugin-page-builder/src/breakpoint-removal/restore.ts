/**
 * Putting back what a breakpoint removal took out (`fragments`), into each
 * value as it is now.
 *
 * The removal is undone into a site that may have moved on, so nothing an
 * author did since is overwritten:
 * - a style value goes back only where its block holds none under that
 *   breakpoint now; a different value there is the author's, and stays;
 * - a hide carried by the strip goes back whole only while the block's
 *   visibility is still exactly what the strip left; otherwise only the
 *   removed breakpoints' own device entries go back, where absent;
 * - a block deleted since has nothing to go back into.
 * What could not go back is counted as skipped, which the undo reports as
 * changed since the removal.
 *
 * A value's fragments are applied newest first, so a value stripped twice (a
 * write brought values back) gets its latest. A value an earlier fragment
 * already put back, equal to an older fragment's, is neither restored again
 * nor counted as skipped.
 *
 * @module breakpoint-removal/restore
 * @experimental
 */
import {
  isPlainRecord,
  mapForest,
  type BlockDocument,
  type BlockNode,
  type NamedClass,
} from "@nextlyhq/blocks-engine";

import {
  documentKeyOf,
  formKey,
  type HostAddress,
  type HostStep,
} from "../host-rewrite/contract";
import type {
  HostDocument,
  HostRead,
  HostSource,
  ReadValue,
} from "../host-rewrite/rewrite";
import type { SiteBreakpointUndoSkipped } from "../library-contract";
import { readStoredJson, sameStoredValue } from "../stored-json";

import type { ClassesFragment, StoredFragment } from "./fragments";
import {
  isDocument,
  stripClass,
  type DocumentFragment,
  type NodeFragment,
  type RemovedStyles,
} from "./strip";

/** What putting fragments back did to one value or the shared styles. */
export interface Restored<T> {
  readonly value: T;
  /** Values put back. */
  readonly restored: number;
  /** Values that could not go back: something else is set there since. */
  readonly skipped: number;
  /** Values that could not go back: their block or style is deleted since. */
  readonly deleted: number;
}

/**
 * Counts while putting values back. Each value is decided once, by the newest
 * fragment that holds it (`decided`, by where it sits): a value a removal
 * stripped twice is one value, put back or kept out once.
 */
interface Tally {
  restored: number;
  skipped: number;
  deleted: number;
  readonly decided: Set<string>;
}

/** A fresh tally. */
function tallyOf(): Tally {
  return { restored: 0, skipped: 0, deleted: 0, decided: new Set() };
}

/** What a tally counted, as a restore answers it. */
function countsOf(tally: Tally): Omit<Restored<unknown>, "value"> {
  return {
    restored: tally.restored,
    skipped: tally.skipped,
    deleted: tally.deleted,
  };
}

/** Where a value sits: a block's or class's (`scope`), by state and breakpoint. */
function keyOf(scope: string, ...at: readonly string[]): string {
  return JSON.stringify([scope, ...at]);
}

/** Decide `key` now, unless a newer fragment already did. */
function decide(tally: Tally, key: string): boolean {
  if (tally.decided.has(key)) return false;
  tally.decided.add(key);
  return true;
}

/**
 * A style envelope with `removed` put back where it holds nothing under each
 * breakpoint, counting into `tally`; the same envelope when nothing goes back.
 */
function restoreEnvelope(
  styles: unknown,
  removed: RemovedStyles,
  tally: Tally,
  /** Where the envelope sits, for each value's place in `tally`. */
  scope: string
): unknown {
  const base: Record<string, unknown> = isPlainRecord(styles)
    ? { ...styles }
    : {};
  let changed = false;
  for (const [state, byBreakpoint] of Object.entries(removed)) {
    const now = base[state];
    const held: Record<string, unknown> = isPlainRecord(now) ? { ...now } : {};
    let stateChanged = false;
    for (const [id, value] of Object.entries(byBreakpoint)) {
      if (!decide(tally, keyOf(scope, state, id))) continue;
      if (putBack(held, id, value, tally)) stateChanged = true;
    }
    if (stateChanged) {
      base[state] = held;
      changed = true;
    }
  }
  return changed ? base : styles;
}

/**
 * One value back into `held` where it holds none under that breakpoint,
 * counting it restored; one set there since is counted skipped. Whether
 * `held` changed.
 */
function putBack(
  held: Record<string, unknown>,
  id: string,
  value: unknown,
  tally: Tally
): boolean {
  if (!Object.hasOwn(held, id)) {
    held[id] = value;
    tally.restored += 1;
    return true;
  }
  if (!sameStoredValue(held[id], value)) tally.skipped += 1;
  return false;
}

/** The device entries a strip took out of a visibility: in before, not after. */
function removedDevices(
  visibility: NonNullable<NodeFragment["visibility"]>
): Record<string, unknown> {
  const before = isPlainRecord(visibility.before)
    ? visibility.before.devices
    : undefined;
  const after = isPlainRecord(visibility.after)
    ? visibility.after.devices
    : undefined;
  if (!isPlainRecord(before)) return {};
  const kept = isPlainRecord(after) ? after : {};
  return Object.fromEntries(
    Object.entries(before).filter(([id]) => !Object.hasOwn(kept, id))
  );
}

/** A block's visibility with what the strip changed put back, counting. */
function restoreVisibility(
  now: unknown,
  stripped: NonNullable<NodeFragment["visibility"]>,
  tally: Tally,
  scope: string
): unknown {
  const removed = removedDevices(stripped);
  // Still exactly what the strip left, and no newer fragment decided it: the
  // whole visibility goes back, deciding each device it took out.
  if (
    !tally.decided.has(keyOf(scope, VISIBILITY)) &&
    sameStoredValue(now, stripped.after)
  ) {
    tally.decided.add(keyOf(scope, VISIBILITY));
    for (const id of Object.keys(removed)) {
      tally.decided.add(keyOf(scope, VISIBILITY, id));
    }
    if (sameStoredValue(now, stripped.before)) return now;
    tally.restored += 1;
    return stripped.before;
  }
  // Changed since, or put back by a newer fragment: each removed device's
  // entry, where absent, decided device by device, so an older fragment's
  // device a newer one did not hold still goes back.
  tally.decided.add(keyOf(scope, VISIBILITY));
  const record: Record<string, unknown> = isPlainRecord(now) ? { ...now } : {};
  const devices: Record<string, unknown> = isPlainRecord(record.devices)
    ? { ...record.devices }
    : {};
  let changed = false;
  for (const [id, value] of Object.entries(removed)) {
    if (!decide(tally, keyOf(scope, VISIBILITY, id))) continue;
    if (putBack(devices, id, value, tally)) changed = true;
  }
  return changed ? { ...record, devices } : now;
}

/** One block with its fragment put back, counting. */
function restoreNode(
  node: BlockNode,
  fragment: NodeFragment,
  tally: Tally
): BlockNode {
  let next: Record<string, unknown> | undefined;
  if (fragment.styles !== undefined) {
    const styles = restoreEnvelope(
      node.styles,
      fragment.styles,
      tally,
      nodeScope(node.id)
    );
    if (styles !== node.styles) next = { ...node, styles };
  }
  if (fragment.visibility !== undefined) {
    const visibility = restoreVisibility(
      node.visibility,
      fragment.visibility,
      tally,
      nodeScope(node.id)
    );
    if (visibility !== node.visibility) {
      next = { ...(next ?? node), visibility };
    }
  }
  return (next as BlockNode | undefined) ?? node;
}

/** Where a visibility sits within its block's scope. */
const VISIBILITY = "visibility";

/** A block's scope in a tally. */
function nodeScope(id: string): string {
  return keyOf("node", id);
}

/** A document's own settings' scope in a tally. */
const SETTINGS_SCOPE = keyOf("settings");

/** Where each of an envelope's values sits, in `scope`. */
function envelopeKeys(
  removed: RemovedStyles | undefined,
  scope: string
): string[] {
  return Object.entries(removed ?? {}).flatMap(([state, byBreakpoint]) =>
    Object.keys(byBreakpoint).map(id => keyOf(scope, state, id))
  );
}

/** Where each value a fragment holds for one block sits. */
function nodeKeys(id: string, fragment: NodeFragment): string[] {
  const scope = nodeScope(id);
  return [
    ...envelopeKeys(fragment.styles, scope),
    ...(fragment.visibility === undefined ? [] : [keyOf(scope, VISIBILITY)]),
  ];
}

/** How many values a style envelope's fragment holds. */
function valuesInStyles(removed: RemovedStyles | undefined): number {
  return Object.values(removed ?? {}).reduce(
    (sum, byBreakpoint) => sum + Object.keys(byBreakpoint).length,
    0
  );
}

/** A document's own settings with their styles' fragment put back. */
function restoreSettings(
  settings: unknown,
  removed: RemovedStyles,
  tally: Tally
): unknown {
  const record: Record<string, unknown> = isPlainRecord(settings)
    ? settings
    : {};
  const styles = restoreEnvelope(record.styles, removed, tally, SETTINGS_SCOPE);
  return styles === record.styles ? settings : { ...record, styles };
}

/**
 * A document with one fragment put back: into each block still in it, a
 * block gone since counted skipped, and into its own settings' styles.
 */
function applyFragment(
  current: BlockDocument,
  fragment: DocumentFragment,
  tally: Tally
): BlockDocument {
  const present = new Set<string>();
  mapForest(current.nodes, node => {
    present.add(node.id);
    return node;
  });
  for (const [id, nodeFragment] of Object.entries(fragment.nodes)) {
    if (present.has(id)) continue;
    for (const key of nodeKeys(id, nodeFragment)) {
      if (decide(tally, key)) tally.deleted += 1;
    }
  }
  let changed = false;
  const nodes = mapForest(current.nodes, node => {
    if (!Object.hasOwn(fragment.nodes, node.id)) return node;
    const nodeFragment = fragment.nodes[node.id];
    if (nodeFragment === undefined) return node;
    const next = restoreNode(node, nodeFragment, tally);
    if (next !== node) changed = true;
    return next;
  });
  const settings =
    fragment.settingsStyles === undefined
      ? current.settings
      : restoreSettings(current.settings, fragment.settingsStyles, tally);
  if (!changed && settings === current.settings) return current;
  return {
    ...current,
    nodes: changed ? nodes : current.nodes,
    ...(settings === current.settings
      ? {}
      : { settings: settings as BlockDocument["settings"] }),
  };
}

/**
 * A document with its fragments put back, newest first, into each block
 * still in it and its own settings' styles.
 */
export function restoreDocument(
  document: BlockDocument,
  fragments: readonly DocumentFragment[]
): Restored<BlockDocument> {
  const tally = tallyOf();
  let current = document;
  for (const fragment of fragments) {
    current = applyFragment(current, fragment, tally);
  }
  return { value: current, ...countsOf(tally) };
}

/** A stored shared style's id, or `undefined` for an entry that names none. */
function classIdOf(entry: unknown): string | undefined {
  return isPlainRecord(entry) && typeof entry.id === "string"
    ? entry.id
    : undefined;
}

/**
 * One stored class with its fragment put back where it holds nothing;
 * `undefined` when it is the override the strip stored of a code class,
 * untouched since, which is taken out so the code's class applies again.
 * Untouched means equal to the override the strip recorded, or, for a row
 * kept before that was recorded, to the code's class as it is now stripped.
 */
function restoredClass(
  entry: unknown,
  removed: RemovedStyles,
  tally: Tally,
  strip: {
    readonly coded: NamedClass | undefined;
    readonly overridden: boolean;
    /** The override recorded, when the row records one. */
    readonly generated: { readonly entry: unknown } | undefined;
    readonly ids: ReadonlySet<string>;
    /** The class's id. */
    readonly id: string;
  }
): unknown {
  if (strip.overridden && untouchedOverride(entry, strip)) {
    // Taken out, so the code's class applies again with its values; where
    // the code supplies the class no longer, those values are gone with it.
    if (strip.coded === undefined) tally.deleted += valuesInStyles(removed);
    else tally.restored += valuesInStyles(removed);
    return undefined;
  }
  const record = isPlainRecord(entry) ? entry : {};
  const styles = restoreEnvelope(
    record.styles,
    removed,
    tally,
    keyOf("class", strip.id)
  );
  return styles === record.styles ? entry : { ...record, styles };
}

/** Whether a stored entry is still the override the strip stored. */
function untouchedOverride(
  entry: unknown,
  strip: {
    readonly coded: NamedClass | undefined;
    readonly generated: { readonly entry: unknown } | undefined;
    readonly ids: ReadonlySet<string>;
  }
): boolean {
  if (strip.generated !== undefined) {
    return sameStoredValue(entry, strip.generated.entry);
  }
  return (
    strip.coded !== undefined &&
    sameStoredValue(entry, stripClass(strip.coded, strip.ids))
  );
}

/** The override the strip recorded for class `id`, when the row has one. */
function generatedOf(
  fragment: ClassesFragment,
  id: string
): { readonly entry: unknown } | undefined {
  const overrides = fragment.overrides;
  return overrides !== undefined && Object.hasOwn(overrides, id)
    ? { entry: overrides[id] }
    : undefined;
}

/**
 * The stored class tier with the shared styles' fragment put back: each
 * class's values where it holds none now, and each override the strip stored
 * of a code-supplied class taken out again while it is still exactly the
 * strip's, so the code's own values apply. A class deleted since is skipped.
 */
export function restoreClasses(
  tier: readonly unknown[],
  supplied: readonly NamedClass[],
  fragment: ClassesFragment,
  ids: ReadonlySet<string>
): Restored<readonly unknown[]> {
  const tally = tallyOf();
  const code = new Map(supplied.map(entry => [entry.id, entry]));
  const overridden = new Set(fragment.overridden);
  const next: unknown[] = [];
  const seen = new Set<string>();
  for (const entry of tier) {
    const id = classIdOf(entry);
    const removed = id === undefined ? undefined : fragment.classes[id];
    if (id === undefined || removed === undefined) {
      next.push(entry);
      continue;
    }
    seen.add(id);
    const restored = restoredClass(entry, removed, tally, {
      coded: code.get(id),
      overridden: overridden.has(id),
      generated: generatedOf(fragment, id),
      ids,
      id,
    });
    if (restored !== undefined) next.push(restored);
  }
  for (const id of Object.keys(fragment.classes)) {
    // Gone since, and not an override taken out: one the strip recorded, or
    // one of a class the code still supplies.
    // Its override taken out while the code supplies the class: back as
    // the code's. With the code's class gone too, its values are lost.
    const takenOut = overridden.has(id) && code.has(id);
    if (!seen.has(id) && !takenOut) {
      tally.deleted += valuesInStyles(fragment.classes[id]);
    }
  }
  return { value: next, ...countsOf(tally) };
}

/** A stored value's fragment rows: every row but the shared styles'. */
type ValueFragment = Extract<
  StoredFragment,
  { readonly form: "published" | "draft" }
>;

/** Whether a kept row is a stored value's, not the shared styles'. */
function isValueFragment(row: StoredFragment): row is ValueFragment {
  return row.host !== null;
}

/** A host as one key, whatever form: the field of one document, in a language. */
function hostKey(host: HostAddress): string {
  return JSON.stringify([
    host.kind,
    host.slug,
    host.id ?? "",
    host.path,
    host.locale ?? "",
  ]);
}

/** What an undo reads its removal's kept rows through, a part at a time. */
export interface KeptRows {
  /** Rows for stored values, by document key after `after`, at most `limit`. */
  valuesAfter(after: string | null, limit: number): Promise<StoredFragment[]>;
  /** One document's rows, the newest first. */
  forDocument(documentKey: string): Promise<StoredFragment[]>;
}

/** How many kept rows one read takes: a page, never the whole removal. */
const ROWS_PER_READ = 100;

/** One document's kept rows, whole, the newest first. */
export interface KeptDocument {
  readonly key: string;
  readonly rows: readonly StoredFragment[];
}

/**
 * The documents a removal kept something for, after `after` in key order,
 * each with all its rows: read a page at a time, so a large removal is never
 * held in memory at once. A page's last document may be cut short, so it is
 * read again from the next page; a document with more rows than a page is
 * read on its own.
 */
export async function* keptDocuments(
  kept: KeptRows,
  after: string | null
): AsyncGenerator<KeptDocument> {
  let cursor = after;
  for (;;) {
    const page = await kept.valuesAfter(cursor, ROWS_PER_READ);
    const { whole, last } = documentsOf(page);
    for (const document of whole) yield document;
    if (last === undefined) return;
    // One document fills the page: read it whole on its own.
    if (whole.length === 0)
      yield { key: last, rows: await kept.forDocument(last) };
    cursor = whole.length === 0 ? last : (whole[whole.length - 1]?.key ?? last);
  }
}

/**
 * A page's rows by document, in order: the documents it holds whole, and the
 * key of its last one when the page is full, which may be cut short and is
 * read again from the next page; `undefined` when the page ends the rows.
 */
function documentsOf(page: readonly StoredFragment[]): {
  whole: KeptDocument[];
  last: string | undefined;
} {
  const byDocument = new Map<string, StoredFragment[]>();
  for (const row of page) {
    if (!isValueFragment(row)) continue;
    const key = documentKeyOf(row.host);
    byDocument.set(key, [...(byDocument.get(key) ?? []), row]);
  }
  const documents = [...byDocument].map(([key, rows]) => ({ key, rows }));
  if (page.length < ROWS_PER_READ) return { whole: documents, last: undefined };
  return { whole: documents.slice(0, -1), last: documents.at(-1)?.key };
}

/** Each host a document's rows were kept for, once. */
function hostsOf(rows: readonly StoredFragment[]): HostAddress[] {
  const hosts = new Map<string, HostAddress>();
  for (const row of rows) {
    if (isValueFragment(row)) hosts.set(hostKey(row.host), row.host);
  }
  return [...hosts.values()];
}

/**
 * The documents an undo walks: only those the removal kept something for,
 * each with every host it kept something for, in the order of their keys.
 */
export function fragmentSource(kept: KeptRows): HostSource {
  return {
    async *documents(cursor) {
      for await (const { key, rows } of keptDocuments(kept, cursor)) {
        const document: HostDocument = {
          key,
          hosts: hostsOf(rows).map(host => ({
            host,
            access: "write" as const,
          })),
        };
        yield document;
      }
    },
    cursorOf: document => document.key,
    hinted: () => Promise.resolve([]),
    outside: () => Promise.resolve([]),
  };
}

/** A document's kept fragments per host and form, newest first in each. */
function byFormOf(
  rows: readonly StoredFragment[]
): Map<string, DocumentFragment[]> {
  const byForm = new Map<string, DocumentFragment[]>();
  for (const row of rows) {
    if (!isValueFragment(row)) continue;
    const key = formKey(row.host, row.form);
    byForm.set(key, [...(byForm.get(key) ?? []), row.fragment]);
  }
  return byForm;
}

/**
 * The step an undo's walk writes each value with: its kept fragments for that
 * host and form put back, newest first, and `unchanged` when nothing goes
 * back, which makes it idempotent. A document's rows are read when the walk
 * reaches it, and kept while it walks that document's hosts. A value this
 * version cannot read is left, as the strip leaves one.
 */
export function restoreStep(kept: KeptRows): HostStep {
  let last: { key: string; byForm: Map<string, DocumentFragment[]> } | null =
    null;
  return async (doc, form) => {
    const key = documentKeyOf(form.host);
    if (last?.key !== key) {
      last = { key, byForm: byFormOf(await kept.forDocument(key)) };
    }
    const fragments = last.byForm.get(formKey(form.host, form.form));
    if (fragments === undefined) return { kind: "unchanged" };
    const document = readStoredJson(doc);
    if (!isDocument(document)) return { kind: "unchanged" };
    const restored = restoreDocument(document, fragments);
    return restored.value === document
      ? { kind: "unchanged" }
      : { kind: "rewritten", value: restored.value };
  };
}

/**
 * Where one blocks value is stored, as a write names it: the document, the
 * top-level field, and the language (absent for the default one).
 */
export interface ValueAddress {
  readonly kind: "collection" | "single";
  readonly slug: string;
  readonly id?: string;
  readonly field: string;
  readonly locale?: string;
}

/**
 * The rows a document kept for one of its values: the same top-level field,
 * in the same language. A row's language and the value's are the same when
 * both name it, or when one is absent and the other is the default one.
 */
export function keptForValue(
  rows: readonly StoredFragment[],
  value: ValueAddress,
  defaultLocale: string | undefined
): ValueFragment[] {
  const languageOf = (locale: string | undefined) => locale ?? defaultLocale;
  return rows.filter(
    (row): row is ValueFragment =>
      isValueFragment(row) &&
      documentKeyOf(row.host) === documentKeyOf(value) &&
      row.host.path.length === 1 &&
      row.host.path[0] === value.field &&
      languageOf(row.host.locale) === languageOf(value.locale)
  );
}

/**
 * How many values a document's fragments hold: what is lost with it. A value
 * stripped twice is counted once, by where it sits.
 */
function valuesInDocument(fragments: readonly DocumentFragment[]): number {
  const keys = new Set<string>();
  for (const fragment of fragments) {
    for (const [id, node] of Object.entries(fragment.nodes)) {
      for (const key of nodeKeys(id, node)) keys.add(key);
    }
    for (const key of envelopeKeys(fragment.settingsStyles, SETTINGS_SCOPE)) {
      keys.add(key);
    }
  }
  return keys.size;
}

/**
 * The value a fragment's form is read back from, as the walk reads it: a row
 * with no lifecycle keeps its one value as `draft`; `null` where that form is
 * gone (a draft published or discarded, a page unpublished since).
 */
function formValue(
  read: HostRead,
  form: "published" | "draft"
): ReadValue | null {
  if (form === "draft") {
    return read.draft ?? (read.liveState === null ? read.published : null);
  }
  return read.liveState === null ? null : read.published;
}

/** Why an undo could not put a document's values back. */
type SkippedReason = SiteBreakpointUndoSkipped["reason"];

/** One stored form's values that did not go back, for one reason. */
interface SkippedValues {
  readonly values: number;
  readonly reason: SkippedReason;
}

/**
 * What an undo could not put back, per document and reason, read once its
 * walk is finished: each kept value is put back again, without writing, into
 * the stored form as it is now. A value back in place is neither restored nor
 * skipped; one set again since is `changed`; one whose block is deleted since
 * is `block-deleted`; every value of a document deleted since is `gone`, of a
 * draft published or discarded since `draft-gone`, and of a document that
 * cannot be read `unreadable`, since nothing can be said of it.
 */
export async function skippedDocuments(
  documents: AsyncIterable<KeptDocument>,
  read: (host: HostAddress) => Promise<HostRead>
): Promise<SiteBreakpointUndoSkipped[]> {
  const byReason = new Map<string, SiteBreakpointUndoSkipped>();
  for await (const { rows } of documents) {
    for (const [key, skipped] of await skippedInDocument(rows, read)) {
      byReason.set(key, {
        ...skipped,
        values: (byReason.get(key)?.values ?? 0) + skipped.values,
      });
    }
  }
  return [...byReason.values()];
}

/** One document's skipped values, by document and reason. */
async function skippedInDocument(
  rows: readonly StoredFragment[],
  read: (host: HostAddress) => Promise<HostRead>
): Promise<Map<string, SiteBreakpointUndoSkipped>> {
  const groups = new Map<
    string,
    {
      host: HostAddress;
      form: "published" | "draft";
      fragments: DocumentFragment[];
    }
  >();
  for (const row of rows) {
    if (!isValueFragment(row)) continue;
    const key = formKey(row.host, row.form);
    const group = groups.get(key) ?? {
      host: row.host,
      form: row.form,
      fragments: [],
    };
    group.fragments.push(row.fragment);
    groups.set(key, group);
  }
  const byReason = new Map<string, SiteBreakpointUndoSkipped>();
  for (const { host, form, fragments } of groups.values()) {
    for (const skipped of await skippedIn(host, form, fragments, read)) {
      const key = JSON.stringify([documentKeyOf(host), skipped.reason]);
      byReason.set(key, {
        kind: host.kind,
        slug: host.slug,
        ...(host.id === undefined ? {} : { id: host.id }),
        values: (byReason.get(key)?.values ?? 0) + skipped.values,
        reason: skipped.reason,
      });
    }
  }
  return byReason;
}

/** What one stored form could not take back, by reason; empty when it took all. */
async function skippedIn(
  host: HostAddress,
  form: "published" | "draft",
  fragments: readonly DocumentFragment[],
  read: (host: HostAddress) => Promise<HostRead>
): Promise<SkippedValues[]> {
  const all = (reason: SkippedReason): SkippedValues[] => [
    { values: valuesInDocument(fragments), reason },
  ];
  let stored: HostRead;
  try {
    stored = await read(host);
  } catch {
    return all("unreadable");
  }
  if (stored.published.kind === "absent" && stored.draft === null) {
    return all("gone");
  }
  const value = formValue(stored, form);
  if (value === null || value.kind === "absent") return all("draft-gone");
  const document = readStoredJson(value.value);
  if (!isDocument(document)) return all("unreadable");
  const { skipped, deleted } = restoreDocument(document, fragments);
  return [
    ...(skipped === 0 ? [] : [{ values: skipped, reason: "changed" as const }]),
    ...(deleted === 0
      ? []
      : [{ values: deleted, reason: "block-deleted" as const }]),
  ];
}
