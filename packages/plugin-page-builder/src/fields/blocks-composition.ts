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
  contentOnlyExposures,
  MAX_COMPOSED_DEPTH,
  nodeLocks,
  registryBlockSource,
  registryNestingSource,
  resolveComponentInstances,
  variantNamesIn,
  type BlockDocument,
  type BlockNode,
  type ComponentDocument,
  type CompositionFault,
  type DocumentLimits,
  type LockedExposure,
  type NodeLock,
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
  type ReadComposition,
} from "../composition-reading";

import { isForest } from "./blocks-document";
import { lockBaselines, storedFormsOf } from "./lock-baselines";

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

/** Who places a component, as the usage index answers it. */
export interface HostFinder {
  /**
   * Whether the index covers every document it is meant to — false while a
   * backfill has not finished, or where content exists it cannot index at all.
   * Read once per host walk.
   */
  whole(): Promise<boolean>;
  /**
   * The documents placing any of these components, and whether this lookup
   * read every row there was (false where the index held more than one save
   * reads).
   */
  placing(componentIds: readonly string[]): Promise<{
    readonly hosts: readonly HostRef[];
    readonly complete: boolean;
  }>;
}

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
  /**
   * Told which hosts a refused component save would have broken. The refusal
   * itself names none of them: the hosts were found and read as the system,
   * and the author saving the component may not be allowed to see them.
   */
  readonly onHostsBroken?: (broken: BrokenHosts) => void;
  /**
   * Told of the exposures a component already stores that drive something a
   * `contentOnly` lock holds. Kept, not refused, so the server log is where
   * an operator learns of them.
   */
  readonly onLockedExposures?: (found: LockedExposures) => void;
  /**
   * Told of the hosts whose lock was already broken before a component save
   * and is no worse after it. Kept, not refused, so the server log is where an
   * operator learns of them.
   */
  readonly onHostsStillBroken?: (found: StillBrokenHosts) => void;
  /**
   * Whether documents are composed against this store at all. `false` where
   * the renderer draws components from somewhere no collection can stand for
   * (a route's own `resolveComponents`): composing against this store would
   * judge a page by definitions it is not drawn with. A component saved to the
   * store is still refused for containing itself.
   */
  readonly composesDocuments: boolean;
}

/**
 * A component's stored exposures that drive something a `contentOnly` lock
 * holds, for the server log. Kept rather than refused, so an edit unrelated to
 * them still saves; each one is the designer's to remove, or the lock's to
 * loosen.
 */
export interface LockedExposures {
  readonly componentId: string;
  readonly exposures: readonly LockedExposure[];
}

/**
 * The hosts a component save found already breaking a lock and left no
 * worse, for the server log. Not this save's to refuse; each one is the
 * host's to repair.
 */
export type StillBrokenHosts = BrokenHosts;

/** The hosts a refused component save would have broken, for the server log. */
export interface BrokenHosts {
  readonly componentId: string;
  /** One entry per document, with the blocks fields it places the component in. */
  readonly hosts: readonly {
    readonly slug: string;
    readonly id: string;
    readonly fields: readonly string[];
    readonly messages: readonly string[];
  }[];
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
  if (savesComponent(write, args.path, setup.store)) {
    await judgeLockedExposures(document, write, setup, report);
  }
  // ONE allowance for every composition this save performs, the loop check
  // included, so the bound is on the save rather than on each check.
  const work: WorkAllowance = { left: MOST_COMPOSED_NODES };

  if (self !== undefined) {
    const cycle = await componentCycleRefusal({
      self,
      document,
      nextStatus,
      source,
      limits: setup.limits,
      work,
    });
    // A loop makes the composition a placeholder where it closes; judging the
    // rest of it would report the symptom of the one thing to fix.
    if (cycle !== null) {
      report.add("COMPONENT_CYCLE", cycle);
      return report.issues;
    }
  }

  if (!setup.composesDocuments) return report.issues;

  const tally = hostTally(self ?? "", setup);
  // Read once for the save, and only if a lock is found broken.
  let storedRead: Promise<readonly BlockDocument[]> | undefined;
  const stored = () => (storedRead ??= storedFormsOf(write, args.path));
  for (const draft of formsChangedBy(nextStatus)) {
    const read = documentReader(source, draft);
    await judgeOwnComposition({
      document,
      self,
      read,
      setup,
      work,
      report,
      stored,
    });
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
        tally,
      });
    }
  }
  tally.flush(report);
  return report.issues;
}

/**
 * Whether this value is a component's own document, created or updated.
 *
 * Wider than {@link componentSaved}, which only answers for a save that has an
 * id: an exposure a new component makes is as new as one an edit adds.
 */
function savesComponent(
  write: PluginFieldWrite,
  path: string,
  store: ComponentStoreAddress
): boolean {
  return (
    write.kind === "collection" &&
    write.slug === store.collection &&
    path === store.field
  );
}

/**
 * Refuse an exposure this save adds that drives something a `contentOnly` lock
 * holds, and report the ones the component already stored.
 *
 * Refused where it is MADE, so the designer meets the lock in the component
 * rather than on every page that places it. One the stored version already
 * held is kept: refusing it would make the component unsavable for an edit
 * unrelated to it. "Added" covers a lock that tightens around an exposure too,
 * by moving its node into a locked slot: before the save it was not among
 * these. A lock tightened by a block's own new definition reaches both sides
 * of the comparison, so it warns rather than refuses.
 */
async function judgeLockedExposures(
  document: BlockDocument,
  write: PluginFieldWrite,
  setup: CompositionSetup,
  report: ReturnType<typeof issueReport>
): Promise<void> {
  const sources = {
    definitions: registryBlockSource(),
    nesting: registryNestingSource(),
  };
  const after = contentOnlyExposures(document as ComponentDocument, sources);
  if (after.length === 0) return;
  const stored = await storedOwnDocument(write, setup.store);
  const before = new Set(
    (stored === undefined
      ? []
      : contentOnlyExposures(stored as ComponentDocument, sources)
    ).map(exposureKey)
  );
  const kept = after.filter(entry => before.has(exposureKey(entry)));
  for (const entry of after) {
    if (before.has(exposureKey(entry))) continue;
    report.add(
      "COMPONENT_EXPOSURE_LOCKED",
      lockedExposureMessage(entry, write.id)
    );
  }
  if (kept.length > 0 && write.id !== undefined) {
    setup.onLockedExposures?.({ componentId: write.id, exposures: kept });
  }
}

/** An exposure as the comparison knows it: what it drives, wherever it is. */
function exposureKey(entry: LockedExposure): string {
  return [entry.exposureId, entry.nodeId, entry.propPath].join("\u0000");
}

/** The component's own document as stored before this save, if it has one. */
async function storedOwnDocument(
  write: PluginFieldWrite,
  store: ComponentStoreAddress
): Promise<BlockDocument | undefined> {
  if (write.id === undefined) return undefined;
  const read = await write.readStored({
    collection: store.collection,
    id: write.id,
    field: store.field,
    form: "draft",
  });
  return read.kind === "value" && isForest(read.value)
    ? (read.value as BlockDocument)
    : undefined;
}

/** The refusal for one exposure, naming what to do about it. */
function lockedExposureMessage(
  entry: LockedExposure,
  componentId?: string
): string {
  const component =
    componentId === undefined ? "This component" : `Component "${componentId}"`;
  return `${component} exposes "${entry.label}" (${entry.propPath}), which sits in the "${entry.slot}" slot of a "${entry.holderType}" locked "contentOnly", where only content can change. Expose a content field instead, remove this exposure, or loosen the lock on that slot.`;
}

/** The component's id when this value is a component's own document. */
function componentSaved(
  write: PluginFieldWrite,
  path: string,
  store: ComponentStoreAddress
): string | undefined {
  // A create whose id the write mints has nothing referencing it yet: no loop
  // it can close and no host it can break. A create under a caller's own id
  // carries it, and is judged like an update.
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
  /** The document's stored forms, read only once a lock is found broken. */
  stored: () => Promise<readonly BlockDocument[]>;
}): Promise<void> {
  const { document, self, read, setup, work, report } = args;
  // A component's own document under its own id, so a placement leading back
  // to it meets what is being saved.
  const library = heldLibrary(
    self === undefined ? undefined : new Map([[self, document]])
  );
  const composed = await composeWithReads({
    host: document,
    library,
    read,
    limits: setup.limits,
    work,
  });
  if (read.exhausted() || work.left <= 0) {
    report.add("COMPOSITION_UNCHECKED", OUTGROWN);
    return;
  }
  let faults = faultsIn(document, composed.composition, setup);
  // A broken lock is judged again against what the page and its components
  // already hold, which a part may keep; composed only now, so a save breaking
  // no lock composes nothing more.
  if (faults.some(fault => LOCK_FAULTS.has(fault.code))) {
    const baselines = await lockBaselines({
      document,
      stored: await args.stored(),
      library,
      read,
      limits: setup.limits,
      work,
    });
    faults = faultsIn(document, composed.composition, setup, baselines);
  }
  for (const fault of faults) {
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
  setup: CompositionSetup,
  baselines?: readonly unknown[]
): readonly CompositionFault[] {
  return compositionFaults(host, composition, {
    ...(baselines === undefined ? {} : { baselines }),
    limits: setup.limits,
    // Read through to the live registry, as the field's own nesting rule is.
    nesting: registryNestingSource(),
    // The locks the blocks' slots declare hold in the composed page too: a
    // placement's values and slot content land inside the component's nodes,
    // which neither document shows on its own.
    definitions: registryBlockSource(),
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
  tally: Tally;
}): Promise<void> {
  const { self, document, draft, source, read, write, setup, work, tally } =
    args;
  const before = await source(self, draft);
  // Not stored in this form yet: a create under a caller's own id, which pages
  // may already place. Nothing to compare against, so every host is judged.
  const was =
    before.kind === "document" && isForest(before.document)
      ? await footprintOf(
          self,
          before.document as BlockDocument,
          read,
          setup,
          work
        )
      : undefined;
  const now = await footprintOf(self, document, read, setup, work);
  if (was !== undefined && !mayWorsen(was, now)) return;

  // The index is read through the Direct API, on a connection of its own. Inside
  // a transaction that read can wait on the connection the transaction holds,
  // and the rows the batch wrote are not in it anyway.
  if (write.inTransaction) {
    tally.incomplete(
      "it was saved inside a transaction, where the usage index is not read"
    );
    return;
  }
  // Said whenever hosts are looked for, because it is true of every lookup: the
  // index records the components a document names, not one a placement's
  // override chooses inside the component it places.
  tally.incomplete(
    "a document that reaches it only through a placement's override is not in the usage index"
  );
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
      tally,
    });
  }
}

type Tally = ReturnType<typeof hostTally>;

/**
 * What one save found about the documents placing it, told once.
 *
 * One report per save rather than per host or per form, so a component on a
 * thousand unreadable pages is one warning an operator can read, and a host a
 * publish breaks in both forms is one host.
 */
function hostTally(componentId: string, setup: CompositionSetup) {
  const unjudged = new Set<string>();
  let listIncomplete = false;
  const reasons = new Set<string>();
  // Keyed by DOCUMENT: the index lists one host per field, and a page placing
  // the component in two fields is still one page an operator has to open.
  const broken = new Map<string, HostDamage>();
  const stillBroken = new Map<string, HostDamage>();
  return {
    host(host: HostRef, reason: string): void {
      unjudged.add(documentKey(host));
      reasons.add(reason);
    },
    incomplete(reason: string): void {
      listIncomplete = true;
      reasons.add(reason);
    },
    broke(host: HostRef, fault: HostFault): void {
      addDamage(broken, host, fault);
    },
    stillBroken(host: HostRef, fault: HostFault): void {
      addDamage(stillBroken, host, fault);
    },
    flush(report: Report): void {
      if (broken.size > 0) {
        report.add(
          "COMPONENT_HOST_BROKEN",
          brokenMessage([...broken.values()], setup)
        );
        setup.onHostsBroken?.({ componentId, hosts: hostsOf(broken) });
      }
      if (stillBroken.size > 0) {
        setup.onHostsStillBroken?.({
          componentId,
          hosts: hostsOf(stillBroken),
        });
      }
      if (unjudged.size === 0 && !listIncomplete) return;
      setup.onUnjudged?.({
        componentId,
        count: unjudged.size,
        listIncomplete,
        reasons: [...reasons],
      });
    },
  };
}

/** Each damaged document, as the server log names it. */
function hostsOf(
  damaged: ReadonlyMap<string, HostDamage>
): BrokenHosts["hosts"] {
  return [...damaged.values()].map(({ host, fields, faults }) => ({
    slug: host.slug,
    id: host.id,
    fields: [...fields],
    messages: faults.map(f => f.message),
  }));
}

/** Record one fault against its document, once per field and fault identity. */
function addDamage(
  damaged: Map<string, HostDamage>,
  host: HostRef,
  fault: HostFault
): void {
  const entry = damaged.get(documentKey(host)) ?? {
    host,
    fields: new Set<string>(),
    faults: [],
  };
  entry.fields.add(host.field);
  // Once per field and fault, as the before/after comparison identifies
  // faults: a publish judges both forms, and they usually agree, while two
  // locked slots broken at one placement are two slots to repair.
  const same = (f: HostFault & { field: string }) =>
    f.field === host.field && faultIdentity(f) === faultIdentity(fault);
  if (!entry.faults.some(same))
    entry.faults.push({ ...fault, field: host.field });
  damaged.set(documentKey(host), entry);
}

/** One document, whichever of its fields placed the component. */
function documentKey(host: HostRef): string {
  return `${host.slug}\u0000${host.id}`;
}

/** What one host is broken by: a composition fault, or a loop it now closes. */
interface HostFault {
  readonly code: string;
  readonly instanceId: string;
  readonly message: string;
}

/** Everything one document would suffer from the save. */
interface HostDamage {
  readonly host: HostRef;
  readonly fields: Set<string>;
  readonly faults: (HostFault & { field: string })[];
}

/**
 * The refusal for a save that would break documents placing it.
 *
 * Says HOW MANY and WHICH RULE, and names none of them: the documents were
 * found and read as the system, and naming them would hand an author who may
 * update components the ids of pages they may not open. The ids go to the
 * server log instead ({@link CompositionSetup.onHostsBroken}).
 */
function brokenMessage(
  broken: readonly { faults: readonly HostFault[] }[],
  setup: CompositionSetup
): string {
  const rules = new Set<string>();
  for (const { faults } of broken) {
    for (const fault of faults) rules.add(ruleBroken(fault.code, setup));
  }
  const count = broken.length;
  return (
    `Saving this component would break ${String(count)} document${count === 1 ? "" : "s"} ` +
    `that place${count === 1 ? "s" : ""} it: ${[...rules].join("; ")}. ` +
    `Make the change in a new component, or ask someone who can open those documents to adjust them first.`
  );
}

/** One rule, said without naming any document or component. */
function ruleBroken(code: string, setup: CompositionSetup): string {
  switch (code) {
    case "depth-exceeded":
    case "node-depth":
      return `content would be nested deeper than the maximum of ${String(setup.limits.maxDepth)} levels`;
    case "composed-depth":
      return "components would be nested inside one another too deeply";
    case "cycle":
      return "a component would end up containing itself";
    case "locked-slot-altered":
      return "a locked slot would hold other blocks than it starts with";
    case "locked-slot-content-only":
      return "a locked slot that allows only content changes would have its design or settings changed";
    default:
      return "a block would sit where it is not allowed to";
  }
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
  const listing: HostListing = {
    found: new Map(),
    whole: await hostsOf.whole(),
  };
  let frontier = [self];
  // Components nest at most this deep, so a host further out composes this one
  // nowhere a reader receives it.
  for (
    let level = 0;
    level < MAX_COMPOSED_DEPTH && frontier.length > 0;
    level += 1
  ) {
    const answer = await hostsOf.placing(frontier);
    if (!answer.complete) listing.whole = false;
    frontier = admitHosts(answer.hosts, self, setup, listing);
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
  tally: Tally;
}): Promise<void> {
  const { host, self, document, draft, read, write, setup, work, tally } = args;
  // A localized field holds a document per language, and the read is refused
  // for one, so its placements cannot be composed here.
  const stored = host.localized ? null : await hostDocument(host, draft, write);
  if (stored === null) {
    tally.host(host, `${describeHost(host)} could not be read`);
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
    tally.host(
      host,
      `${describeHost(host)} composes more than one save can check`
    );
    return;
  }
  reportWhatBroke({ host, stored, before, after, setup, tally });
}

/**
 * What the save does to one host that was not wrong with it already.
 *
 * A loop the HOST's own overrides close once the component changes is among
 * them: the component composed alone shows none, because the host's placement
 * is what re-points the nested reference back at it.
 */
function reportWhatBroke(args: {
  host: HostRef;
  stored: BlockDocument;
  before: ReadComposition;
  after: ReadComposition;
  setup: CompositionSetup;
  tally: Tally;
}): void {
  const { host, stored, before, after, setup, tally } = args;
  // By where each loop closes, not whether one does: a host that already
  // holds an unrelated loop would otherwise hide the one this save adds.
  if ([...after.loopsClosed].some(id => !before.loopsClosed.has(id))) {
    tally.broke(host, {
      code: "cycle",
      instanceId: "",
      message: `With this change, ${describeHost(host)} would place a component inside itself.`,
    });
  }
  const had = new Set(
    faultsIn(stored, before.composition, setup).map(faultIdentity)
  );
  for (const fault of faultsIn(stored, after.composition, setup)) {
    if (had.has(faultIdentity(fault))) {
      // Broken before this save and no worse after it: not this save's to
      // refuse, and still worth an operator's attention when it is a lock.
      if (LOCK_FAULTS.has(fault.code)) tally.stillBroken(host, fault);
      continue;
    }
    tally.broke(host, fault);
  }
}

/**
 * A fault as the before/after comparison knows it: its rule and placement,
 * and, for a lock, the slot and what changed, which its message names. Two
 * locked slots broken at one placement are two faults, so a save that breaks a
 * second is not taken for one leaving the first as it was.
 */
function faultIdentity(fault: HostFault): string {
  const base = `${fault.code}\u0000${fault.instanceId}`;
  return LOCK_FAULTS.has(fault.code) ? `${base}\u0000${fault.message}` : base;
}

/** The faults that are a lock broken in the composed host. */
const LOCK_FAULTS: ReadonlySet<string> = new Set([
  "locked-slot-altered",
  "locked-slot-content-only",
]);

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

/** A host as an operator finds it in the log: its entry id in its collection. */
function describeHost(host: HostRef): string {
  return `"${host.id}" in "${host.slug}"`;
}

/**
 * What a host's composition can see of a component: for EACH selection a
 * placement can make, what it draws at the top, how deep it is and how deeply
 * it nests other components; and where the content a placement supplies lands.
 *
 * Per selection, because a host picks one: a change that makes the default
 * shallower and a variant deeper leaves the maximum unchanged while breaking
 * every page that picks the variant.
 */
interface Footprint {
  readonly complete: boolean;
  /** Keyed by variant name; the default selection under "". */
  readonly selections: ReadonlyMap<string, SelectionFootprint>;
  /** Each exposed slot, as the holder type, its slot and its depth. */
  readonly slots: ReadonlyMap<string, string>;
  /** Each exposed property, as the node, prop path and type it writes to. */
  readonly exposures: ReadonlyMap<string, string>;
}

interface SelectionFootprint {
  readonly rootTypes: ReadonlySet<string>;
  readonly depth: number;
  readonly componentDepth: number;
  /**
   * The locks the selection itself breaks, placed with no values of its own,
   * by fault identity. A variant's value for an exposure a lock holds changes
   * what every placement picking it draws, with nothing else moved.
   */
  readonly lockFaults: ReadonlySet<string>;
}

/** The footprint of `document` stored as `self`, selection by selection. */
async function footprintOf(
  self: string,
  document: BlockDocument,
  read: BoundedReader,
  setup: CompositionSetup,
  work: WorkAllowance
): Promise<Footprint> {
  // The lock each node sits under, by the rule a save enforces. Part of what
  // a placement's values and slot content are held to, so moving a node under
  // a lock, everything else kept, is a change a host can be judged against.
  const locks = nodeLocks(document.nodes, registryBlockSource());
  const library = heldLibrary(new Map([[self, document]]));
  const selections = new Map<string, SelectionFootprint>();
  let complete = true;
  for (const variant of [undefined, ...(variantNamesIn(document) ?? [])]) {
    const host = hostPlacing(self, variant);
    const composed = await composeWithReads({
      host,
      library,
      read,
      limits: setup.limits,
      work,
    });
    const componentDepth = componentDepthOf(
      self,
      variant,
      library.held,
      setup,
      work
    );
    if (composed.incomplete || componentDepth === undefined) complete = false;
    const nodes = composed.composition.document.nodes;
    selections.set(variant ?? "", {
      rootTypes: new Set(nodes.map(root => root.type)),
      depth: deepest(nodes, setup),
      componentDepth: componentDepth ?? MAX_COMPOSED_DEPTH + 1,
      lockFaults: new Set(
        faultsIn(host, composed.composition, setup)
          .filter(fault => LOCK_FAULTS.has(fault.code))
          .map(faultIdentity)
      ),
    });
  }
  return {
    complete,
    selections,
    slots: exposedSlots(document, setup, locks),
    exposures: exposedProperties(document, locks),
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
 *
 * Each probe is a composition, so each is charged to the save's allowance like
 * any other. `undefined` when the allowance ran out first: a probe stopped by
 * it refuses for the budget rather than for depth, and read as a depth answer
 * that would make the component look shallower than it is.
 */
function componentDepthOf(
  self: string,
  variant: string | undefined,
  held: ReadonlyMap<string, unknown>,
  setup: CompositionSetup,
  work: WorkAllowance
): number | undefined {
  const lookup = {
    has: (id: string) => held.has(id),
    get: (id: string) => held.get(id) as BlockDocument | undefined,
  };
  for (let cap = 1; cap <= MAX_COMPOSED_DEPTH; cap += 1) {
    const { unresolved } = resolveComponentInstances(
      hostPlacing(self, variant),
      lookup,
      {
        limits: setup.limits,
        maxComposedDepth: cap,
        work,
      }
    );
    if (work.left <= 0 || unresolved.some(one => one.reason === "budget")) {
      return undefined;
    }
    if (!unresolved.some(one => one.reason === "composed-depth")) return cap;
  }
  return MAX_COMPOSED_DEPTH + 1;
}

/**
 * Each exposed property, keyed by its id, as `nodeId|propPath|type|lock`, the
 * lock being the one its node sits under.
 */
function exposedProperties(
  document: BlockDocument,
  locks: ReadonlyMap<string, NodeLock>
): ReadonlyMap<string, string> {
  const declared = (document as { exposed?: unknown }).exposed;
  const out = new Map<string, string>();
  if (!Array.isArray(declared)) return out;
  for (const entry of declared as Record<string, unknown>[]) {
    if (typeof entry?.id !== "string") continue;
    out.set(
      entry.id,
      `${String(entry.nodeId)}|${String(entry.propPath)}|${String(entry.type)}|${lockOf(locks, entry.nodeId)}`
    );
  }
  return out;
}

/**
 * Each exposed slot, keyed by its id, as `nodeId|type|slot|depth|lock` of its
 * holder. The node is part of it: two holders of one type, slot and depth can
 * still draw what lands in them differently. So is the lock it sits under,
 * which its slot passes on to what a placement puts there.
 */
function exposedSlots(
  document: BlockDocument,
  setup: CompositionSetup,
  locks: ReadonlyMap<string, NodeLock>
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
    const nodeId = String((slot as { nodeId?: unknown }).nodeId);
    const holder = depthOf.get(nodeId);
    const name = String((slot as { slot?: unknown }).slot);
    out.set(
      id,
      holder === undefined
        ? "?"
        : `${nodeId}|${holder.type}|${name}|${holder.depth}|${lockOf(locks, nodeId)}`
    );
  }
  return out;
}

/** The lock a node sits under, as a footprint records it. */
function lockOf(locks: ReadonlyMap<string, NodeLock>, nodeId: unknown): string {
  return (
    (typeof nodeId === "string" ? locks.get(nodeId)?.lock : undefined) ?? "-"
  );
}

/**
 * Whether a host could be judged differently after the change.
 *
 * Conservative in one direction only: a footprint that could not be worked out
 * may worsen, and so does, in any one selection, a new root type, extra depth
 * or extra component depth, as does a selection that did not exist before, any
 * slot that moved, and any exposure added, re-aimed or removed. A slot removed
 * or a root type dropped cannot make a host break a rule it kept before; an
 * exposure removed can, since the host's override of it falls back to the
 * default, which may draw what the override kept out.
 */
function mayWorsen(was: Footprint, now: Footprint): boolean {
  if (!was.complete || !now.complete) return true;
  return (
    selectionsWorsen(was, now) ||
    removedSelectionsWorsen(was, now) ||
    // What a placement can override: a new or re-aimed exposure lets a host's
    // existing override reach somewhere it could not, a loop included. Read
    // the other way, an exposure that is gone hands the default back.
    moved(was.exposures, now.exposures) ||
    moved(now.exposures, was.exposures) ||
    moved(was.slots, now.slots)
  );
}

/** Whether any selection that exists now is worse than it was, or new. */
function selectionsWorsen(was: Footprint, now: Footprint): boolean {
  for (const [name, after] of now.selections) {
    const before = was.selections.get(name);
    if (before === undefined || selectionWorsens(before, after)) return true;
  }
  return false;
}

/**
 * Whether a selection that went away hands its placements something worse: a
 * placement that picked it now gets the default.
 */
function removedSelectionsWorsen(was: Footprint, now: Footprint): boolean {
  const fallback = now.selections.get("");
  for (const [name, before] of was.selections) {
    if (now.selections.has(name)) continue;
    if (fallback === undefined || selectionWorsens(before, fallback))
      return true;
  }
  return false;
}

/** Whether any entry present now is new or different. Removals do not count. */
function moved(
  before: ReadonlyMap<string, string>,
  after: ReadonlyMap<string, string>
): boolean {
  for (const [key, value] of after) if (before.get(key) !== value) return true;
  return false;
}

function selectionWorsens(
  before: SelectionFootprint,
  after: SelectionFootprint
): boolean {
  if (after.depth > before.depth) return true;
  if (after.componentDepth > before.componentDepth) return true;
  for (const type of after.rootTypes) {
    if (!before.rootTypes.has(type)) return true;
  }
  for (const fault of after.lockFaults) {
    if (!before.lockFaults.has(fault)) return true;
  }
  return false;
}
