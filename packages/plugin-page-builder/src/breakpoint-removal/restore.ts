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
  /** Values that could not go back: changed or deleted since. */
  readonly skipped: number;
}

/** Counts while putting values back. */
interface Tally {
  restored: number;
  skipped: number;
}

/**
 * A style envelope with `removed` put back where it holds nothing under each
 * breakpoint, counting into `tally`; the same envelope when nothing goes back.
 */
function restoreEnvelope(
  styles: unknown,
  removed: RemovedStyles,
  tally: Tally
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
      if (!Object.hasOwn(held, id)) {
        held[id] = value;
        tally.restored += 1;
        stateChanged = true;
      } else if (!sameStoredValue(held[id], value)) {
        tally.skipped += 1;
      }
    }
    if (stateChanged) {
      base[state] = held;
      changed = true;
    }
  }
  return changed ? base : styles;
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
  tally: Tally
): unknown {
  // Still exactly what the strip left: the whole visibility goes back.
  if (sameStoredValue(now, stripped.after)) {
    if (sameStoredValue(now, stripped.before)) return now;
    tally.restored += 1;
    return stripped.before;
  }
  // Changed since: only the removed breakpoints' own entries, where absent.
  const record: Record<string, unknown> = isPlainRecord(now) ? { ...now } : {};
  const devices: Record<string, unknown> = isPlainRecord(record.devices)
    ? { ...record.devices }
    : {};
  let changed = false;
  for (const [id, value] of Object.entries(removedDevices(stripped))) {
    if (!Object.hasOwn(devices, id)) {
      devices[id] = value;
      tally.restored += 1;
      changed = true;
    } else if (!sameStoredValue(devices[id], value)) {
      tally.skipped += 1;
    }
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
    const styles = restoreEnvelope(node.styles, fragment.styles, tally);
    if (styles !== node.styles) next = { ...node, styles };
  }
  if (fragment.visibility !== undefined) {
    const visibility = restoreVisibility(
      node.visibility,
      fragment.visibility,
      tally
    );
    if (visibility !== node.visibility) {
      next = { ...(next ?? node), visibility };
    }
  }
  return (next as BlockNode | undefined) ?? node;
}

/** How many values a fragment holds for one block, for a block gone since. */
function valuesIn(fragment: NodeFragment): number {
  return (
    valuesInStyles(fragment.styles) +
    (fragment.visibility === undefined ? 0 : 1)
  );
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
  const styles = restoreEnvelope(record.styles, removed, tally);
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
    if (!present.has(id)) tally.skipped += valuesIn(nodeFragment);
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
  const tally: Tally = { restored: 0, skipped: 0 };
  let current = document;
  for (const fragment of fragments) {
    current = applyFragment(current, fragment, tally);
  }
  return { value: current, ...tally };
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
 */
function restoredClass(
  entry: unknown,
  removed: RemovedStyles,
  tally: Tally,
  strip: {
    readonly coded: NamedClass | undefined;
    readonly overridden: boolean;
    readonly ids: ReadonlySet<string>;
  }
): unknown {
  if (
    strip.overridden &&
    strip.coded !== undefined &&
    sameStoredValue(entry, stripClass(strip.coded, strip.ids))
  ) {
    tally.restored += valuesInStyles(removed);
    return undefined;
  }
  const record = isPlainRecord(entry) ? entry : {};
  const styles = restoreEnvelope(record.styles, removed, tally);
  return styles === record.styles ? entry : { ...record, styles };
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
  const tally: Tally = { restored: 0, skipped: 0 };
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
      ids,
    });
    if (restored !== undefined) next.push(restored);
  }
  for (const id of Object.keys(fragment.classes)) {
    // Gone since, and not a code class whose override was taken out.
    if (!seen.has(id) && !(overridden.has(id) && code.has(id))) {
      tally.skipped += 1;
    }
  }
  return { value: next, ...tally };
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

/**
 * The documents an undo walks: only those the removal kept something for,
 * each with every host it kept something for, in a stable order by document.
 */
export function fragmentSource(rows: readonly StoredFragment[]): HostSource {
  const byDocument = new Map<string, Map<string, HostAddress>>();
  for (const row of rows) {
    if (!isValueFragment(row)) continue;
    const key = documentKeyOf(row.host);
    const hosts = byDocument.get(key) ?? new Map<string, HostAddress>();
    hosts.set(hostKey(row.host), row.host);
    byDocument.set(key, hosts);
  }
  const documents: HostDocument[] = [...byDocument]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([key, hosts]) => ({
      key,
      hosts: [...hosts.values()].map(host => ({
        host,
        access: "write" as const,
      })),
    }));
  return {
    async *documents(cursor) {
      for (const document of documents) {
        if (cursor === null || document.key > cursor) yield document;
      }
    },
    cursorOf: document => document.key,
    hinted: () => Promise.resolve([]),
    outside: () => Promise.resolve([]),
  };
}

/**
 * The step an undo's walk writes each value with: its kept fragments for that
 * host and form put back, newest first (`rows` come newest first), and
 * `unchanged` when nothing goes back, which makes it idempotent. A value this
 * version cannot read is left, as the strip leaves one.
 */
export function restoreStep(rows: readonly StoredFragment[]): HostStep {
  const byForm = new Map<string, DocumentFragment[]>();
  for (const row of rows) {
    if (!isValueFragment(row)) continue;
    const key = formKey(row.host, row.form);
    byForm.set(key, [...(byForm.get(key) ?? []), row.fragment]);
  }
  return (doc, form) => {
    const fragments = byForm.get(formKey(form.host, form.form));
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
 * The kept fragments of one stored value, per stored form, newest first
 * within each: what a lock accepts an undo putting back into it. A row's
 * language and the value's are the same language when both name it, or when
 * one is absent and the other is the default one.
 */
export function fragmentsForValue(
  rows: readonly StoredFragment[],
  defaultLocale: string | undefined
): (value: ValueAddress) => readonly (readonly DocumentFragment[])[] {
  const languageOf = (locale: string | undefined) => locale ?? defaultLocale;
  return value => {
    const byForm = new Map<string, DocumentFragment[]>();
    for (const row of rows) {
      if (!isValueFragment(row)) continue;
      const host = row.host;
      if (
        documentKeyOf(host) !== documentKeyOf(value) ||
        host.path.length !== 1 ||
        host.path[0] !== value.field ||
        languageOf(host.locale) !== languageOf(value.locale)
      ) {
        continue;
      }
      byForm.set(row.form, [...(byForm.get(row.form) ?? []), row.fragment]);
    }
    return [...byForm.values()];
  };
}

/** How many values a document's fragments hold: what is lost with it. */
function valuesInDocument(fragments: readonly DocumentFragment[]): number {
  let count = 0;
  for (const fragment of fragments) {
    for (const node of Object.values(fragment.nodes)) count += valuesIn(node);
    count += valuesInStyles(fragment.settingsStyles);
  }
  return count;
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

/**
 * What an undo could not put back, per document, read once its walk is
 * finished: each kept value is put back again, without writing, into the
 * stored form as it is now. A value back in place is neither restored nor
 * skipped; one that differs, or whose block is gone, is skipped as changed
 * since; and every value of a form that is gone is skipped with it. A host
 * that cannot be read is counted as changed, since nothing can be said of it.
 */
export async function skippedDocuments(
  rows: readonly StoredFragment[],
  read: (host: HostAddress) => Promise<HostRead>
): Promise<SiteBreakpointUndoSkipped[]> {
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
  const byDocument = new Map<string, SiteBreakpointUndoSkipped>();
  for (const { host, form, fragments } of groups.values()) {
    const skipped = await skippedIn(host, form, fragments, read);
    if (skipped === undefined) continue;
    const key = documentKeyOf(host);
    const before = byDocument.get(key);
    byDocument.set(key, {
      kind: host.kind,
      slug: host.slug,
      ...(host.id === undefined ? {} : { id: host.id }),
      values: (before?.values ?? 0) + skipped.values,
      reason: before?.reason === "gone" ? "gone" : skipped.reason,
    });
  }
  return [...byDocument.values()];
}

/** What one stored form could not take back; `undefined` when it took all. */
async function skippedIn(
  host: HostAddress,
  form: "published" | "draft",
  fragments: readonly DocumentFragment[],
  read: (host: HostAddress) => Promise<HostRead>
): Promise<{ values: number; reason: SkippedReason } | undefined> {
  let value: ReadValue | null;
  try {
    value = formValue(await read(host), form);
  } catch {
    return { values: valuesInDocument(fragments), reason: "changed" };
  }
  if (value === null || value.kind === "absent") {
    return { values: valuesInDocument(fragments), reason: "gone" };
  }
  const document = readStoredJson(value.value);
  if (!isDocument(document)) {
    return { values: valuesInDocument(fragments), reason: "changed" };
  }
  const { skipped } = restoreDocument(document, fragments);
  return skipped === 0 ? undefined : { values: skipped, reason: "changed" };
}
