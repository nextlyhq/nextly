/**
 * What the blocks field refuses about a document AS A READER RECEIVES IT.
 *
 * The field's own rules judge the stored document. A document holding a
 * component placement is drawn as something else — the definition's tree in
 * the placement's place — and three rules are about that composed tree:
 *
 * - a component may not end up containing itself;
 * - every block of it must sit where it is allowed to, the definition's roots
 *   and the page content a placement fills it with included;
 * - and it may not be nested deeper than the limit, counted from the top of the
 *   document rather than from each definition's own top.
 *
 * And one is about the documents a component is composed INTO: saving a
 * component must not break a page, a Layout or another component that places
 * it.
 *
 * ## Why validation, and what it reads
 *
 * Validation is the one phase every write path runs — the editor, the API, a
 * batch, an import that skips hooks — so a rule judged here holds on all of
 * them. Core hands the validator the write's id and `readStored`, a read of
 * stored values of this field type on the write's own connection. So the
 * library judged is the one the write sees: inside a batch, the rows the batch
 * wrote before this one are in it; and no read hook or access rule hides a
 * component that still renders.
 *
 * The usage index is how a component's HOSTS are found, and it is a hint: it is
 * maintained after commit. A change that cannot make any host worse — the same
 * roots, no deeper, the same slots — needs no hosts at all, which is what lets
 * an ordinary edit to a component on a thousand pages save without reading
 * them. A change that could is judged inside every host the index lists, and
 * refused where one would break. A host it cannot judge — the index cannot
 * vouch for its whole population, a host cannot be read, there are more than
 * one save can judge — is REPORTED as unjudged rather than passed over in
 * silence, and does not refuse the save: refusing would leave a designer no
 * way at all to change a component the index cannot fully account for.
 *
 * @module fields/blocks-composition
 */
import {
  compositionFaults,
  MAX_COMPOSED_DEPTH,
  registryNestingSource,
  resolveComponentInstances,
  variantNamesIn,
  type BlockDocument,
  type BlockNode,
  type CompositionFault,
  type DocumentLimits,
  type WorkAllowance,
} from "@nextlyhq/blocks-engine";
import type {
  PluginFieldValidateArgs,
  PluginFieldWrite,
  PluginStoredValueTarget,
} from "@nextlyhq/plugin-sdk";

import {
  componentCycleRefusal,
  formsChangedBy,
  MOST_COMPOSED_NODES,
  storedComponentSource,
  type ComponentStoreAddress,
} from "../component-cycle-guard";
import {
  composeWithReads,
  documentReader,
  heldLibrary,
  hostPlacing,
  type BoundedReader,
  type ComponentSource,
} from "../composition-reading";

/** The issue shape core's validation envelope carries. */
interface Issue {
  path: string;
  code: string;
  message: string;
}

/** One collection entry that places a component, as the usage index records it. */
export interface HostRef {
  /** The collection's slug. */
  readonly slug: string;
  /** The entry's id. */
  readonly id: string;
  /** The blocks field the placement is in. */
  readonly field: string;
  /** Whether the reference was recorded in one language of a localized field. */
  readonly localized: boolean;
}

/** The documents that place one component, and whether that is all of them. */
export type HostFinder = (componentId: string) => Promise<{
  readonly hosts: readonly HostRef[];
  /**
   * `false` where the list is a floor: the index held more than was read, or
   * cannot vouch that it covers every document (a backfill not finished, or
   * content it cannot index at all).
   */
  readonly complete: boolean;
}>;

/** Hosts a component save could not judge, and why, for the site's operators. */
export interface UnjudgedHosts {
  readonly componentId: string;
  /** Hosts the index listed that could not be judged. */
  readonly count: number;
  /**
   * Whether the index could not vouch for listing every host, so there may be
   * more than `count` unjudged — how many is not known.
   */
  readonly listIncomplete: boolean;
  /** One sentence per cause, without repeats. */
  readonly reasons: readonly string[];
}

/** What judging a composition needs to know about the site. */
export interface CompositionSetup {
  /** Where components live, so a write to one is known for what it is. */
  readonly store: ComponentStoreAddress;
  /** The caps the renderer draws under. */
  readonly limits: DocumentLimits;
  /** Who places a component; absent where the index cannot be reached. */
  readonly hostsOf?: HostFinder;
  /** Told about hosts a component save could not judge. */
  readonly onUnjudged?: (unjudged: UnjudgedHosts) => void;
}

/**
 * How many documents one component save will judge itself inside.
 *
 * Reached only by a change that could make a host worse, which is rare. Past
 * it the remaining hosts are reported as unjudged.
 */
const MOST_HOSTS_JUDGED = 1000;

/**
 * Every issue the composed document raises, for one blocks value of one write.
 *
 * Nothing is judged where no entry write is behind the validation: there is no
 * connection to read the library through, and what such a caller validates — a
 * default value, a standalone check — is not a document any reader is served.
 */
export async function compositionIssues(
  value: unknown,
  args: Pick<PluginFieldValidateArgs, "data" | "path" | "write">,
  setup: CompositionSetup
): Promise<Issue[]> {
  const write = args.write;
  if (write === undefined || !isForest(value)) return [];
  const document = value as BlockDocument;
  const nextStatus =
    typeof args.data.status === "string" ? args.data.status : undefined;
  const source = storedComponentSource(write, setup.store);
  const self = componentSaved(write, args.path, setup.store);
  const report = issueReport(args.path);

  if (self !== undefined) {
    const cycle = await componentCycleRefusal({
      self,
      document,
      nextStatus,
      source,
      limits: setup.limits,
    });
    // A loop makes the composition a placeholder where it closes; judging the
    // rest of it would report the symptom of the one thing to fix.
    if (cycle !== null) {
      report.add("COMPONENT_CYCLE", cycle);
      return report.issues;
    }
  }

  const work: WorkAllowance = { left: MOST_COMPOSED_NODES };
  const tally = unjudgedTally(self ?? "", setup);
  for (const draft of formsChangedBy(nextStatus)) {
    const read = documentReader(source, draft);
    await judgeOwnComposition({ document, self, read, setup, work, report });
    if (self !== undefined) {
      await judgeHosts({
        self,
        document,
        draft,
        source,
        read,
        write,
        setup,
        work,
        report,
        tally,
      });
    }
  }
  tally.flush();
  return report.issues;
}

/** The component's id when this value is a component's own document. */
function componentSaved(
  write: PluginFieldWrite,
  path: string,
  store: ComponentStoreAddress
): string | undefined {
  // A create mints its id in the write itself, so nothing can reference it
  // yet: there is no loop it can close and no host it can break.
  if (write.kind !== "collection" || write.id === undefined) return undefined;
  if (write.slug !== store.collection || path !== store.field) return undefined;
  return write.id;
}

/** Issues addressed to the field, each said once. */
function issueReport(path: string) {
  const seen = new Set<string>();
  const issues: Issue[] = [];
  return {
    issues,
    add(code: string, message: string): void {
      // The forms a publish judges usually agree; one defect is one issue.
      const key = `${code}\u0000${message}`;
      if (seen.has(key)) return;
      seen.add(key);
      issues.push({ path, code, message });
    },
  };
}

type Report = ReturnType<typeof issueReport>;

/** The document's own composition: nesting and depth across what it places. */
async function judgeOwnComposition(args: {
  document: BlockDocument;
  self: string | undefined;
  read: BoundedReader;
  setup: CompositionSetup;
  work: WorkAllowance;
  report: Report;
}): Promise<void> {
  const { document, self, read, setup, work, report } = args;
  const composed = await composeWithReads({
    host: document,
    // A component's own document under its own id, so a placement leading back
    // to it meets what is being saved.
    library: heldLibrary(
      self === undefined ? undefined : new Map([[self, document]])
    ),
    read,
    limits: setup.limits,
    work,
  });
  if (read.exhausted() || work.left <= 0) {
    report.add("COMPOSITION_UNCHECKED", OUTGROWN);
    return;
  }
  for (const fault of faultsIn(document, composed.composition, setup)) {
    report.add(fault.code, fault.message);
  }
}

const OUTGROWN =
  "This document places more components than one save can check, so " +
  "whether its blocks sit where they are allowed and within the depth limit " +
  "could not be established. Place fewer different components in it.";

/** The composition faults, against the site's own nesting rules. */
function faultsIn(
  host: BlockDocument,
  composition: Parameters<typeof compositionFaults>[1],
  setup: CompositionSetup
): readonly CompositionFault[] {
  return compositionFaults(host, composition, {
    limits: setup.limits,
    // Read through to the live registry, as the field's own nesting rule is.
    nesting: registryNestingSource(),
  });
}

/**
 * Judge a component save inside every document that places it, in one form.
 *
 * Only a change that can make a host worse reaches the hosts at all, and then
 * only the faults this save INTRODUCES are reported: a host already broken is
 * its own document's problem, and refusing an unrelated component save for it
 * would block the one author who did not cause it.
 */
async function judgeHosts(args: {
  self: string;
  document: BlockDocument;
  draft: boolean;
  source: ComponentSource;
  read: BoundedReader;
  write: PluginFieldWrite;
  setup: CompositionSetup;
  work: WorkAllowance;
  report: Report;
  tally: Tally;
}): Promise<void> {
  const { self, document, draft, source, read, write, setup, work, report } =
    args;
  const tally = args.tally;
  const before = await source(self, draft);
  // Not stored in this form yet, so nothing composes it there.
  if (before.kind !== "document" || !isForest(before.document)) return;
  const was = await footprintOf(
    self,
    before.document as BlockDocument,
    read,
    setup,
    work
  );
  const now = await footprintOf(self, document, read, setup, work);
  if (!mayWorsen(was, now)) return;

  const listed = await everyHost(self, setup);
  if (listed === null) {
    tally.incomplete(
      "no usage index is available to list the documents placing it"
    );
    return;
  }
  if (!listed.complete) {
    tally.incomplete(
      "the usage index cannot list every document placing it, so only those it lists were judged"
    );
  }
  for (const host of listed.hosts) {
    await judgeOneHost({
      host,
      self,
      document,
      draft,
      read,
      write,
      setup,
      work,
      report,
      unjudged: reason => tally.host(host, reason),
    });
  }
}

type Tally = ReturnType<typeof unjudgedTally>;

/**
 * The hosts one save could not judge, told once, with how many and why.
 *
 * One report per save rather than one per host, so a component on a thousand
 * unreadable pages is one warning an operator can read rather than a thousand.
 */
function unjudgedTally(componentId: string, setup: CompositionSetup) {
  // Hosts, not attempts: a publish judges two forms, and one host unjudged in
  // both is one host.
  const hosts = new Set<string>();
  let listIncomplete = false;
  const reasons = new Set<string>();
  return {
    host(host: HostRef, reason: string): void {
      hosts.add(`${host.slug}\u0000${host.id}\u0000${host.field}`);
      reasons.add(reason);
    },
    incomplete(reason: string): void {
      listIncomplete = true;
      reasons.add(reason);
    },
    flush(): void {
      if (hosts.size === 0 && !listIncomplete) return;
      setup.onUnjudged?.({
        componentId,
        count: hosts.size,
        listIncomplete,
        reasons: [...reasons],
      });
    },
  };
}

/**
 * Every document placing `self`, directly or through other components, and
 * whether that is all of them; `null` where there is nothing to ask.
 */
async function everyHost(
  self: string,
  setup: CompositionSetup
): Promise<{ hosts: readonly HostRef[]; complete: boolean } | null> {
  const hostsOf = setup.hostsOf;
  if (hostsOf === undefined) return null;
  const listing: HostListing = { found: new Map(), whole: true };
  let frontier = [self];
  // Components nest at most this deep, so a host further out composes this one
  // nowhere a reader receives it.
  for (
    let level = 0;
    level < MAX_COMPOSED_DEPTH && frontier.length > 0;
    level += 1
  ) {
    const next: string[] = [];
    for (const id of frontier) {
      const answer = await hostsOf(id);
      if (!answer.complete) listing.whole = false;
      next.push(...admitHosts(answer.hosts, self, setup, listing));
    }
    frontier = next;
  }
  return { hosts: [...listing.found.values()], complete: listing.whole };
}

/** The hosts found so far, and whether they are all of them. */
interface HostListing {
  readonly found: Map<string, HostRef>;
  whole: boolean;
}

/**
 * Add one lookup's hosts to the listing, and return the components among them,
 * whose own hosts compose this one too.
 */
function admitHosts(
  hosts: readonly HostRef[],
  self: string,
  setup: CompositionSetup,
  listing: HostListing
): string[] {
  const components: string[] = [];
  for (const host of hosts) {
    const key = `${host.slug}\u0000${host.id}\u0000${host.field}`;
    const isComponent = host.slug === setup.store.collection;
    if (listing.found.has(key) || (isComponent && host.id === self)) continue;
    if (listing.found.size >= MOST_HOSTS_JUDGED) {
      listing.whole = false;
      break;
    }
    listing.found.set(key, host);
    if (isComponent) components.push(host.id);
  }
  return components;
}

/** One host, judged before and after this save, reporting only what is new. */
async function judgeOneHost(args: {
  host: HostRef;
  self: string;
  document: BlockDocument;
  draft: boolean;
  read: BoundedReader;
  write: PluginFieldWrite;
  setup: CompositionSetup;
  work: WorkAllowance;
  report: Report;
  unjudged: (reason: string) => void;
}): Promise<void> {
  const { host, self, document, draft, read, write, setup, work, report } =
    args;
  // A localized field holds a document per language, and the read is refused
  // for one, so its placements cannot be composed here.
  const stored = host.localized ? null : await hostDocument(host, draft, write);
  if (stored === null) {
    args.unjudged(`${describeHost(host)} could not be read`);
    return;
  }
  if (stored === undefined) return;

  const compose = (seed: ReadonlyMap<string, unknown> | undefined) =>
    composeWithReads({
      host: stored,
      library: heldLibrary(seed),
      read,
      limits: setup.limits,
      work,
    });
  const before = await compose(undefined);
  const after = await compose(new Map([[self, document]]));
  if (read.exhausted() || work.left <= 0) {
    args.unjudged(
      `${describeHost(host)} composes more than one save can check`
    );
    return;
  }
  const had = new Set(
    faultsIn(stored, before.composition, setup).map(
      f => `${f.code}\u0000${f.instanceId}`
    )
  );
  for (const fault of faultsIn(stored, after.composition, setup)) {
    if (had.has(`${fault.code}\u0000${fault.instanceId}`)) continue;
    report.add(
      "COMPONENT_HOST_BROKEN",
      `Saving this component would break ${describeHost(host)}: ${fault.message}`
    );
  }
}

/**
 * A host's stored document in one form: the document, `undefined` where there
 * is none to judge, or `null` where it could not be read.
 */
async function hostDocument(
  host: HostRef,
  draft: boolean,
  write: PluginFieldWrite
): Promise<BlockDocument | undefined | null> {
  const target: PluginStoredValueTarget = {
    collection: host.slug,
    id: host.id,
    field: host.field,
    form: draft ? "draft" : "published",
  };
  try {
    const read = await write.readStored(target);
    if (read.kind === "absent") return undefined;
    return isForest(read.value) ? (read.value as BlockDocument) : undefined;
  } catch {
    return null;
  }
}

/** A host as an author can find it: its entry id in its collection. */
function describeHost(host: HostRef): string {
  return `"${host.id}" in "${host.slug}"`;
}

/**
 * What a host's composition can see of a component: what its placement draws
 * at the top, how deep it is, how deeply it nests other components, and where
 * the content a placement supplies lands.
 */
interface Footprint {
  readonly complete: boolean;
  readonly rootTypes: ReadonlySet<string>;
  readonly depth: number;
  readonly componentDepth: number;
  /** Each exposed slot, as the holder type, its slot and its depth. */
  readonly slots: ReadonlyMap<string, string>;
}

/** The footprint of `document` stored as `self`, across every selection. */
async function footprintOf(
  self: string,
  document: BlockDocument,
  read: BoundedReader,
  setup: CompositionSetup,
  work: WorkAllowance
): Promise<Footprint> {
  const library = heldLibrary(new Map([[self, document]]));
  const rootTypes = new Set<string>();
  let depth = 0;
  let complete = true;
  for (const variant of [undefined, ...(variantNamesIn(document) ?? [])]) {
    const composed = await composeWithReads({
      host: hostPlacing(self, variant),
      library,
      read,
      limits: setup.limits,
      work,
    });
    if (composed.incomplete) complete = false;
    for (const root of composed.composition.document.nodes)
      rootTypes.add(root.type);
    depth = Math.max(
      depth,
      deepest(composed.composition.document.nodes, setup)
    );
  }
  return {
    complete,
    rootTypes,
    depth,
    componentDepth: componentDepthOf(self, library.held, setup),
    slots: exposedSlots(document, setup),
  };
}

/** The deepest node of a composed forest, counted from its own top. */
function deepest(nodes: readonly BlockNode[], setup: CompositionSetup): number {
  let most = 0;
  const visit = (forest: unknown, at: number): void => {
    if (!Array.isArray(forest) || at > setup.limits.maxDepth + 1) return;
    for (const entry of forest) {
      most = Math.max(most, at);
      const slots = (entry as { slots?: unknown }).slots;
      if (typeof slots !== "object" || slots === null) continue;
      for (const children of Object.values(slots)) visit(children, at + 1);
    }
  };
  visit(nodes, 1);
  return most;
}

/**
 * How many levels of components the definition composes, by asking the
 * resolver itself: the smallest cap under which it refuses nothing for depth.
 */
function componentDepthOf(
  self: string,
  held: ReadonlyMap<string, unknown>,
  setup: CompositionSetup
): number {
  const lookup = {
    has: (id: string) => held.has(id),
    get: (id: string) => held.get(id) as BlockDocument | undefined,
  };
  for (let cap = 1; cap <= MAX_COMPOSED_DEPTH; cap += 1) {
    const { unresolved } = resolveComponentInstances(
      hostPlacing(self),
      lookup,
      {
        limits: setup.limits,
        maxComposedDepth: cap,
      }
    );
    if (!unresolved.some(one => one.reason === "composed-depth")) return cap;
  }
  return MAX_COMPOSED_DEPTH + 1;
}

/** Each exposed slot, keyed by its id, as `type|slot|depth` of its holder. */
function exposedSlots(
  document: BlockDocument,
  setup: CompositionSetup
): ReadonlyMap<string, string> {
  const declared = (document as { slots?: unknown }).slots;
  const out = new Map<string, string>();
  if (typeof declared !== "object" || declared === null) return out;
  const depthOf = new Map<string, { type: string; depth: number }>();
  const visit = (forest: unknown, at: number): void => {
    if (!Array.isArray(forest) || at > setup.limits.maxDepth + 1) return;
    for (const entry of forest as BlockNode[]) {
      if (typeof entry?.id === "string") {
        depthOf.set(entry.id, { type: String(entry.type), depth: at });
      }
      for (const children of Object.values(entry?.slots ?? {})) {
        visit(children, at + 1);
      }
    }
  };
  visit(document.nodes, 1);
  for (const [id, slot] of Object.entries(declared)) {
    const holder = depthOf.get(String((slot as { nodeId?: unknown }).nodeId));
    const name = String((slot as { slot?: unknown }).slot);
    out.set(
      id,
      holder === undefined ? "?" : `${holder.type}|${name}|${holder.depth}`
    );
  }
  return out;
}

/**
 * Whether a host could be judged differently after the change.
 *
 * Conservative in one direction only: a footprint that could not be worked out
 * may worsen, and so does any new root type, any extra depth, and any slot that
 * moved. A slot removed or a root type dropped cannot make a host break a rule
 * it kept before.
 */
function mayWorsen(was: Footprint, now: Footprint): boolean {
  if (!was.complete || !now.complete) return true;
  if (now.depth > was.depth || now.componentDepth > was.componentDepth) {
    return true;
  }
  for (const type of now.rootTypes) if (!was.rootTypes.has(type)) return true;
  for (const [id, where] of now.slots) {
    if (was.slots.get(id) !== where) return true;
  }
  return false;
}

/** Whether a value carries a forest the composition can walk. */
function isForest(value: unknown): boolean {
  return (
    typeof value === "object" &&
    value !== null &&
    Array.isArray((value as { nodes?: unknown }).nodes)
  );
}
