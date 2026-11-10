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
  COLLECTION_LIST_TYPE,
  componentIdsIn,
  compositionFaults,
  contentOnlyExposures,
  MAX_COMPOSED_DEPTH,
  contentModelKeyOf,
  nodeLocks,
  placementValueIssues,
  placementVariantIssues,
  readListQuery,
  registryBlockSource,
  registryNestingSource,
  resolveComponentInstances,
  variantLockChanges,
  variantNamesIn,
  type BlockDocument,
  type BlockNode,
  type ComponentDocument,
  type ComponentLookup,
  type CompositionFault,
  type DocumentLimits,
  type LockedExposure,
  type NodeLock,
  type PlacementValueProblem,
  type WorkAllowance,
} from "@nextlyhq/blocks-engine";
import type {
  PluginFieldValidateArgs,
  PluginFieldWrite,
  PluginStoredValueTarget,
} from "@nextlyhq/plugin-sdk";

import type { OpenRemovalReader } from "../breakpoint-removal/lock-acceptance";
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
  type HeldLibrary,
  type ReadComposition,
} from "../composition-reading";
import { changedSinceRead } from "../host-rewrite/expectations";
import { fenceIssues, type FencedComponents } from "../host-rewrite/fence";

import { isForest } from "./blocks-document";
import {
  LAYERS_LOCK_CHANGED,
  placedLockMessage,
  variantLockMessage,
} from "./layers-lock-wording";
import {
  composedListQueryIssues,
  listSettingOf,
  type ListFieldsReader,
} from "./list-query-judgement";
import {
  composedFormsRead,
  lockBaselines,
  readStoredForms,
} from "./lock-baselines";
import { placedLayersLocks } from "./placement-layers-locks";

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
   * Told of placement breaks a write kept because the stored value they may
   * already be part of could not be read (a single, a localized field). Kept,
   * not refused, so the server log is where an operator learns of them.
   */
  readonly onPlacementUnjudged?: (found: PlacementUnjudged) => void;
  /**
   * Told of a write whose Layers locks could not be judged, because the
   * stored value they would be judged against could not be read (see
   * `LayersLockUnjudged.reason`). Kept, not refused, so the server log is
   * where an operator learns of it.
   */
  readonly onLayersLockUnjudged?: (found: LayersLockUnjudged) => void;
  /**
   * Whether documents are composed against this store at all. `false` where
   * the renderer draws components from somewhere no collection can stand for
   * (a route's own `resolveComponents`): composing against this store would
   * judge a page by definitions it is not drawn with. A component saved to the
   * store is still refused for containing itself.
   */
  readonly composesDocuments: boolean;
  /**
   * The components being deleted. A write adding a reference to one is
   * refused, judged against what the document stores now; absent where no
   * fence is installed.
   */
  readonly fencedComponents?: () => Promise<FencedComponents>;
  /**
   * The breakpoint removal that is open, if any: while one is, a Layers or
   * `contentOnly` lock accepts exactly the stored value with the removed
   * breakpoints' values stripped (`breakpoint-removal/lock-acceptance`).
   * Absent, no lock accepts anything more than it always did.
   */
  readonly openBreakpointRemoval?: OpenRemovalReader;
  /**
   * What the site defines that a page refers to by id, from ONE read of its
   * style, so every reference in a write is judged against the same version
   * of it. Asked at most once per write, and only when a reference needs it.
   * A write adding a reference to anything else is refused. Absent where the
   * site style cannot be read, and then nothing is refused.
   */
  readonly siteDefinitions?: () => Promise<SiteDefinitions>;
  /**
   * The fields a collection declares and the public may read, for judging
   * what a page's collection lists filter and sort by. Absent where the
   * schema cannot be read, and then lists are judged by their shape alone.
   */
  readonly listFields?: ListFieldsReader;
}

/** What the site defines that a page refers to by id. */
export interface SiteDefinitions {
  /** The classes the compiler applies: the code's and the stored ones. */
  readonly classIds: ReadonlySet<string>;
  /** The breakpoints the stylesheet is emitted under, the base included. */
  readonly breakpointIds: ReadonlySet<string>;
}

/** Which document a write is to: a collection or a single, its slug, an id. */
export interface WrittenTo {
  readonly kind?: string;
  readonly slug?: string;
  readonly id?: string;
}

/** Placement breaks a write kept unjudged, for the server log. */
export interface PlacementUnjudged extends WrittenTo {
  /** The blocks field written. */
  readonly field: string;
  /** How many breaks were kept. */
  readonly breaks: number;
}

/** A write whose Layers locks were not judged, for the server log. */
export interface LayersLockUnjudged extends WrittenTo {
  /** The blocks field written. */
  readonly field: string;
  /**
   * Why its stored value could not be read: a translated field whose language
   * store is not ready, or a field inside a group or a repeater.
   */
  readonly reason: "language-not-ready" | "nested-field";
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
  args: Pick<PluginFieldValidateArgs, "data" | "path" | "write"> &
    Partial<Pick<PluginFieldValidateArgs, "field">>,
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
  await judgeHostRewrite(document, args, write, setup, report);
  if (savesComponent(write, args.path, setup.store)) {
    await judgeLockedExposures(document, write, setup, report);
    await judgeVariantLocks({
      document,
      args,
      setup,
      read: documentReader(source, true),
      report,
    });
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
  let storedRead: Promise<StoredRead> | undefined;
  const stored = () =>
    (storedRead ??= readStoredForms(
      write,
      args.path,
      formsChangedBy(nextStatus),
      (args.field as { localized?: unknown } | undefined)?.localized === true
    ));
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
      write,
      field: args.path,
      writtenTo: documentOf(write),
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
 * What a rewrite of every host adds to a write's judgement, on every write:
 * a rewrite's own write is refused when the host changed since the rewrite
 * read it, and any write adding a reference to a component being deleted is
 * refused (see `host-rewrite/fence`).
 */
async function judgeHostRewrite(
  document: BlockDocument,
  args: Pick<PluginFieldValidateArgs, "data" | "path"> &
    Partial<Pick<PluginFieldValidateArgs, "field">>,
  write: PluginFieldWrite,
  setup: CompositionSetup,
  report: Report
): Promise<void> {
  const changed = await changedSinceRead(write, args.path);
  if (changed !== undefined) report.add(changed.code, changed.message);
  if (setup.fencedComponents === undefined) return;
  const refused = await fenceIssues({
    document,
    write,
    path: args.path,
    nextStatus:
      typeof args.data.status === "string" ? args.data.status : undefined,
    localized:
      (args.field as { localized?: unknown } | undefined)?.localized === true,
    maxNodes: setup.limits.maxNodes,
    fenced: setup.fencedComponents,
  });
  for (const issue of refused) report.add(issue.code, issue.message);
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
 * Refuse a component save whose variant changes a block the component locks
 * in Layers (`variantLockChanges`), naming the block and the variant.
 *
 * Judged against the WRITTEN component's locks, so a lock this save adds holds
 * over a variant already stored, and a create is judged as well as an update.
 * Drawn with the library a full composition reads, surveyed through every
 * component the written and stored forms place, so a variant reaching a block
 * locked inside a nested component is seen. A variant the stored component
 * already drew the same way is kept. A localized field whose language store
 * is not ready is kept unjudged, as the page's own locks are.
 */
async function judgeVariantLocks(args: {
  document: BlockDocument;
  args: Pick<PluginFieldValidateArgs, "path" | "write"> &
    Partial<Pick<PluginFieldValidateArgs, "field">>;
  setup: CompositionSetup;
  read: BoundedReader;
  report: Report;
}): Promise<void> {
  const { document, setup, read, report } = args;
  const { path, write, field } = args.args;
  if ((variantNamesIn(document) ?? []).length === 0) return;
  const stored = await readStoredForms(write, path, [true], isLocalized(field));
  if (!stored.readable) return;
  const [newest] = stored.forms;
  const library = await placedLibrary(
    [document, ...(newest === undefined ? [] : [newest])],
    read,
    setup.limits
  );
  const changes = variantLockChanges(document, newest, {
    limits: setup.limits,
    components: lookupOf(library),
  });
  const label = fieldLabel(field, path);
  for (const change of changes) {
    report.add(LAYERS_LOCK_CHANGED, `${label}: ${variantLockMessage(change)}`);
  }
}

/** Whether a field is kept per language. */
function isLocalized(
  field: Partial<Pick<PluginFieldValidateArgs, "field">>["field"]
): boolean {
  return (field as { localized?: unknown } | undefined)?.localized === true;
}

/** A field's label for an issue, or its path where it has none. */
function fieldLabel(
  field: Partial<Pick<PluginFieldValidateArgs, "field">>["field"],
  path: string
): string {
  return typeof field?.label === "string" && field.label !== ""
    ? field.label
    : path;
}

/** Every component the documents place, read into one library. */
async function placedLibrary(
  documents: readonly BlockDocument[],
  read: BoundedReader,
  limits: DocumentLimits
): Promise<HeldLibrary> {
  const library = heldLibrary();
  for (const placing of documents) {
    await readEveryPlacedDefinition(placing, library, read, limits);
  }
  return library;
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
  /**
   * The document's stored forms, read only once a lock or a placement is
   * found broken, and whether they could be read.
   */
  stored: () => Promise<StoredRead>;
  /** The write, for the language and host its lists are judged in. */
  write: PluginFieldWrite;
  /** The blocks field being written, for the server log. */
  field?: string;
  /** Which document is being written, for the server log. */
  writtenTo?: WrittenTo;
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
  // Composed again only once a lock or a placement is found broken, so a save
  // breaking neither composes nothing more.
  const faults = await measuredAgainstStored(
    faultsIn(document, composed.composition, setup, {
      components: lookupOf(library),
    }),
    {
      document,
      composition: composed.composition,
      setup,
      reading: { library, read, limits: setup.limits, work },
      stored: args.stored,
      field: args.field,
      writtenTo: args.writtenTo,
    }
  );
  for (const fault of faults) {
    report.add(fault.code, fault.message);
  }
  await judgeComposedLists({
    document,
    composed: composed.composition.document,
    setup,
    reading: { library, read, limits: setup.limits, work },
    stored: args.stored,
    write: args.write,
    report,
  });
  // Every placement's definition, the ones a condition gates included: the
  // composition never expanded those, and both checks below read them.
  await readEveryPlacedDefinition(document, library, read, setup.limits);
  // Past the reader's bound a definition reads as unreadable and its
  // placement would go unjudged, so the save is refused as unchecked instead.
  if (read.exhausted()) {
    report.add("COMPOSITION_UNCHECKED", OUTGROWN);
    return;
  }
  await judgePlacedLocks({
    document,
    composed: composed.composition.document,
    reading: { library, read, limits: setup.limits, work },
    stored: args.stored,
    report,
    setup,
    unjudged: { field: args.field ?? "", ...args.writtenTo },
  });
  await judgePlacementValues({
    document,
    library,
    limits: setup.limits,
    stored: args.stored,
    report,
  });
  await judgePlacementVariants({
    document,
    components: lookupOf(library),
    limits: setup.limits,
    stored: args.stored,
    report,
  });
}

/**
 * Refuse a list a placed component holds that the page, as composed, makes
 * one the canvas and the published page refuse: a placement's value or
 * variant can change a list's source, filters, sort or bounds, and both read
 * the composed list. Its shape is judged always, and the fields it names
 * where the schema can be read; a problem the stored page already composed
 * to is kept.
 */
async function judgeComposedLists(args: {
  document: BlockDocument;
  composed: unknown;
  setup: CompositionSetup;
  reading: {
    library: HeldLibrary;
    read: BoundedReader;
    limits: DocumentLimits;
    work: WorkAllowance;
  };
  stored: () => Promise<StoredRead>;
  write: PluginFieldWrite;
  report: Report;
}): Promise<void> {
  const fieldsOf = args.setup.listFields;
  const found = await composedListQueryIssues(
    args.composed,
    args.document,
    listSettingOf(args.write),
    {
      ...(fieldsOf === undefined ? {} : { fieldsOf }),
      maxNodes: args.setup.limits.maxNodes,
      // The stored forms composed as this page is, so a list they already
      // composed to keeps its problem as a warning.
      storedForms: async () => {
        const stored = await args.stored();
        if (!stored.readable) return { forms: [], readable: false };
        const composed = await composedFormsRead({
          ...args.reading,
          hosts: stored.forms,
        });
        return { forms: composed.forms as BlockDocument[], readable: true };
      },
    }
  );
  for (const issue of found) args.report.add(issue.code, issue.message);
}

/**
 * Refuse a placement's value or slot content that changes a block its
 * component locks in Layers (`placedLayersLocks`), naming the block. Where the
 * stored page cannot be read (a localized field whose language is not ready),
 * the write is kept and the server log says so, as for the page's own locks.
 */
async function judgePlacedLocks(
  args: Parameters<typeof placedLayersLocks>[0] & {
    report: Report;
    setup: CompositionSetup;
    unjudged: Omit<LayersLockUnjudged, "reason">;
  }
): Promise<void> {
  const answer = await placedLayersLocks(args);
  if (answer.kind === "unchecked") {
    args.report.add("COMPOSITION_UNCHECKED", OUTGROWN);
    return;
  }
  if (answer.kind === "unjudged") {
    args.setup.onLayersLockUnjudged?.({
      ...args.unjudged,
      reason: "language-not-ready",
    });
    return;
  }
  for (const change of answer.changes) {
    args.report.add(LAYERS_LOCK_CHANGED, placedLockMessage(change));
  }
}

/**
 * Read the definition of every component the document places into the library,
 * and of every component those definitions place, as deep as composition goes.
 *
 * A placement the composition never expanded (one a condition gates) still
 * stores its values, and is served with them once the condition lifts, so its
 * component is read too; and a gated placement inside a definition is never
 * expanded either, so the definitions held are surveyed the same way, level by
 * level, to the composed depth. Stops asking once the reader's bound is spent,
 * which the caller then refuses as unchecked.
 */
async function readEveryPlacedDefinition(
  document: BlockDocument,
  library: HeldLibrary,
  read: BoundedReader,
  limits: DocumentLimits
): Promise<void> {
  const surveyed = new Set<string>();
  let level: readonly unknown[] = [document];
  for (let depth = 0; depth <= MAX_COMPOSED_DEPTH; depth += 1) {
    if (level.length === 0 || read.exhausted()) return;
    level = await readPlacedBy(level, { library, read, limits, surveyed });
  }
}

/**
 * One level of {@link readEveryPlacedDefinition}: read what each document
 * places that is not yet surveyed, and answer the definitions held for them,
 * which are the next level down.
 */
async function readPlacedBy(
  documents: readonly unknown[],
  at: {
    library: HeldLibrary;
    read: BoundedReader;
    limits: DocumentLimits;
    surveyed: Set<string>;
  }
): Promise<unknown[]> {
  const { library, surveyed } = at;
  const next: unknown[] = [];
  for (const placing of documents) {
    if (!isForest(placing)) continue;
    const nodes = (placing as BlockDocument).nodes;
    for (const id of componentIdsIn(nodes, at.limits.maxNodes)) {
      if (surveyed.has(id)) continue;
      surveyed.add(id);
      await readInto(library, at.read, id);
      if (library.held.has(id)) next.push(library.held.get(id));
    }
  }
  return next;
}

/** One definition into the library, unless it was already asked for. */
async function readInto(
  library: HeldLibrary,
  read: BoundedReader,
  id: string
): Promise<void> {
  if (library.held.has(id) || library.missing.has(id)) return;
  const answer = await read(id);
  if (answer.kind === "document") library.held.set(id, answer.document);
  else library.missing.add(id);
}

/** The issue code for each way a placement's value is refused. */
const PLACEMENT_VALUE_CODES: Readonly<Record<PlacementValueProblem, string>> = {
  "unknown-field": "PLACEMENT_VALUE_UNKNOWN_FIELD",
  "wrong-type": "PLACEMENT_VALUE_WRONG_TYPE",
  "too-many-values": "PLACEMENT_VALUE_TOO_MANY",
};

/**
 * Refuse a value the write sets on a placement that its component does not
 * accept: an id the component does not expose, or a value of the wrong type
 * for its field. Judged against the definitions this form composes with, so
 * every write path that validates the field, an import included, is held to
 * what the inspector can write.
 *
 * A value the stored document already holds is kept, so a field removed from
 * a component, or one written to under its id with another type, does not
 * make every page placing it unsavable; the stored forms are read only once
 * something is found. Where they cannot be read (a localized field whose
 * language is not ready), any value found may be one the stored document
 * already held, so none is refused, as a placement break there is not.
 */
async function judgePlacementValues(args: {
  document: BlockDocument;
  library: HeldLibrary;
  limits: DocumentLimits;
  stored: () => Promise<StoredRead>;
  report: Report;
}): Promise<void> {
  const { document, library, limits, report } = args;
  const components = lookupOf(library);
  if (placementValueIssues(document, components, [], limits).length === 0) {
    return;
  }
  const stored = await args.stored();
  if (!stored.readable) return;
  const issues = placementValueIssues(
    document,
    components,
    stored.forms,
    limits
  );
  for (const issue of issues) {
    report.add(PLACEMENT_VALUE_CODES[issue.problem], issue.message);
  }
}

/**
 * Refuse a variant the write newly sets on a placement that its component does
 * not define. Judged against the definitions this form composes with, so every
 * write path that validates the field, an import included, is held to what the
 * picker can choose.
 *
 * A key the stored document already holds at that placement is kept: a
 * deleted variant leaves its key on placements, which render the defaults. The
 * stored forms are read only once something is found; where they cannot be
 * read (a localized field whose language is not ready), any key found may be
 * one the stored document already held, so none is refused.
 */
async function judgePlacementVariants(args: {
  document: BlockDocument;
  components: ComponentLookup;
  limits: DocumentLimits;
  stored: () => Promise<StoredRead>;
  report: Report;
}): Promise<void> {
  const { document, components, limits, report } = args;
  if (placementVariantIssues(document, components, [], limits).length === 0) {
    return;
  }
  const stored = await args.stored();
  if (!stored.readable) return;
  for (const issue of placementVariantIssues(
    document,
    components,
    stored.forms,
    limits
  )) {
    report.add("PLACEMENT_VARIANT_UNKNOWN", issue.message);
  }
}

const OUTGROWN =
  "This document places more components than one save can check, so " +
  "whether its blocks sit where they are allowed and within the depth limit " +
  "could not be established. Place fewer different components in it.";

/**
 * The faults judged again against what the page already holds, read only when
 * a lock or a placement is found broken. A broken lock is measured against
 * what the page and its components hold, which a part may keep; a placement
 * break against the stored forms alone, where one already composing to it is
 * kept. A stored value this cannot read may already compose to every
 * placement break found, so none is refused, and the log says what was kept.
 */
async function measuredAgainstStored(
  faults: readonly CompositionFault[],
  args: {
    document: BlockDocument;
    composition: Parameters<typeof compositionFaults>[1];
    setup: CompositionSetup;
    reading: {
      library: HeldLibrary;
      read: BoundedReader;
      limits: DocumentLimits;
      work: WorkAllowance;
    };
    stored: () => Promise<StoredRead>;
    field: string | undefined;
    writtenTo: WrittenTo | undefined;
  }
): Promise<readonly CompositionFault[]> {
  const lockBroken = faults.some(fault => LOCK_FAULTS.has(fault.code));
  const placementBroken = faults.some(fault =>
    PLACEMENT_FAULTS.has(fault.code)
  );
  if (!lockBroken && !placementBroken) return faults;
  const { document, setup, reading } = args;
  const stored = await args.stored();
  const composedStored = placementBroken
    ? await composedFormsRead({ ...reading, hosts: stored.forms })
    : undefined;
  const baselines = lockBroken
    ? await lockBaselines({ ...reading, document, stored: stored.forms })
    : undefined;
  const again = faultsIn(document, args.composition, setup, {
    components: lookupOf(reading.library),
    ...(baselines === undefined ? {} : { baselines }),
    ...(composedStored === undefined
      ? {}
      : {
          storedCompositions: composedStored.forms,
          storedHosts: stored.forms,
        }),
  });
  // Old breaks are known only from a stored page this could read and compose
  // whole; a baseline cut short could miss one and call it new.
  if (stored.readable && composedStored?.complete !== false) return again;
  return keptUnjudged(again, setup, args);
}

/**
 * The faults with every placement break kept unjudged, and the server log
 * told how many, naming the document.
 */
function keptUnjudged(
  faults: readonly CompositionFault[],
  setup: CompositionSetup,
  at: { field: string | undefined; writtenTo: WrittenTo | undefined }
): readonly CompositionFault[] {
  const kept = faults.filter(fault => !PLACEMENT_FAULTS.has(fault.code));
  if (kept.length < faults.length) {
    setup.onPlacementUnjudged?.({
      field: at.field ?? "",
      ...at.writtenTo,
      breaks: faults.length - kept.length,
    });
  }
  return kept;
}

/** A held library as the engine's component lookup. */
function lookupOf(library: HeldLibrary): ComponentLookup {
  return {
    has: id => library.held.has(id),
    get: id => library.held.get(id) as BlockDocument | undefined,
  };
}

/** The composition faults, against the site's own nesting rules. */
function faultsIn(
  host: BlockDocument,
  composition: Parameters<typeof compositionFaults>[1],
  setup: CompositionSetup,
  measuredAgainst: {
    baselines?: readonly unknown[];
    storedCompositions?: readonly unknown[];
    storedHosts?: readonly unknown[];
    components?: ComponentLookup;
  } = {}
): readonly CompositionFault[] {
  return compositionFaults(host, composition, {
    ...measuredAgainst,
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
  // Every host's lists name the same few collections: each is read once.
  const listFields = onceEach(setup.listFields);
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
      listFields,
    });
  }
}

/**
 * A fields reader that reads each collection in each language once, for a
 * save judging many hosts; `undefined` where there is no schema to read.
 */
function onceEach(
  read: ListFieldsReader | undefined
): ListFieldsReader | undefined {
  if (read === undefined) return undefined;
  const asked = new Map<string, ReturnType<ListFieldsReader>>();
  return (collection, locale) => {
    const key = `${collection}\u0000${locale ?? ""}`;
    let answer = asked.get(key);
    if (answer === undefined) {
      answer = read(collection, locale);
      asked.set(key, answer);
    }
    return answer;
  };
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
  /** A placement break's identity, so two of one code are told apart. */
  readonly signature?: string;
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
    case LIST_BROKEN:
      return "a collection list would be given a source, filter or sort it can't use";
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
  /** The schema the host's lists are judged against, read once per save. */
  listFields: ListFieldsReader | undefined;
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

  // The library each composition read is kept with it, so what the host puts
  // in a placement's slots is judged against the slots the component exposes,
  // before and after the save, and not only through the composed tree.
  const compose = async (
    seed: ReadonlyMap<string, unknown> | undefined
  ): Promise<ComposedWithLibrary> => {
    const library = heldLibrary(seed);
    const composed = await composeWithReads({
      host: stored,
      library,
      read,
      limits: setup.limits,
      work,
    });
    return { ...composed, components: lookupOf(library) };
  };
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
  await reportListsBroken({
    host,
    stored,
    before,
    after,
    setup,
    tally,
    listFields: args.listFields,
  });
}

/**
 * The collection lists the save would newly break in one host, as the host
 * composes them before and after it: an edit can aim a placement's existing
 * value at a list's sort or filters, move the list to another collection, or
 * change what a variant sets, and the page is then read with a list the
 * canvas and the published page refuse. A problem the host's lists already
 * composed to before the save is the host's, not this save's.
 *
 * Judged as the host is drawn: in every language, since the reference is not
 * in a localized field, and with the host's collection as the entry its page
 * shows. A host that is itself a component is no page, so an entry's relation
 * there is judged by its shape alone; the pages placing it are judged too.
 */
async function reportListsBroken(args: {
  host: HostRef;
  stored: BlockDocument;
  before: ComposedWithLibrary;
  after: ComposedWithLibrary;
  setup: CompositionSetup;
  tally: Tally;
  listFields: ListFieldsReader | undefined;
}): Promise<void> {
  const { host, stored, before, after, setup, tally, listFields } = args;
  const found = await composedListQueryIssues(
    after.composition.document,
    stored,
    host.slug === setup.store.collection ? {} : { entryCollection: host.slug },
    {
      ...(listFields === undefined ? {} : { fieldsOf: listFields }),
      maxNodes: setup.limits.maxNodes,
      // What the host composed to before this save stands for its stored
      // form: a problem it held there is kept.
      storedForms: () =>
        Promise.resolve({
          forms: [before.composition.document],
          readable: true,
        }),
    }
  );
  for (const issue of found) {
    tally.broke(host, {
      code: LIST_BROKEN,
      instanceId: issue.placement,
      // The log names the placement and the list's problem; the refusal
      // names neither, as for every other host fault.
      message: `Placement "${issue.placement}": ${issue.message}`,
      signature: `${issue.code}\u0000${issue.message}`,
    });
  }
}

/** The host fault of a collection list a component save would break. */
const LIST_BROKEN = "collection-list";

/**
 * What the save does to one host that was not wrong with it already.
 *
 * A loop the HOST's own overrides close once the component changes is among
 * them: the component composed alone shows none, because the host's placement
 * is what re-points the nested reference back at it.
 */
/** A composition with the component lookup it was read with. */
type ComposedWithLibrary = ReadComposition & {
  readonly components: ComponentLookup;
};

function reportWhatBroke(args: {
  host: HostRef;
  stored: BlockDocument;
  before: ComposedWithLibrary;
  after: ComposedWithLibrary;
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
  // Counted, not only named: two locked slots of one block type broken the
  // same way read alike, and a save breaking the second is still a new break.
  const had = faultCounts(
    faultsIn(stored, before.composition, setup, {
      components: before.components,
    })
  );
  for (const fault of faultsIn(stored, after.composition, setup, {
    components: after.components,
  })) {
    const identity = faultIdentity(fault);
    const left = had.get(identity) ?? 0;
    if (left > 0) {
      had.set(identity, left - 1);
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
  if (LOCK_FAULTS.has(fault.code)) return `${base}\u0000${fault.message}`;
  // A placement break is told apart by where it is, so a new one of the same
  // code under the same placement is not counted as the old one.
  return fault.signature === undefined
    ? base
    : `${base}\u0000${fault.signature}`;
}

/** How many faults of each identity a composition holds. */
function faultCounts(faults: readonly HostFault[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const fault of faults) {
    const identity = faultIdentity(fault);
    counts.set(identity, (counts.get(identity) ?? 0) + 1);
  }
  return counts;
}

/** The faults that are a lock broken in the composed host. */
/** The placement rule's faults, measured against the stored forms alone. */
const PLACEMENT_FAULTS: ReadonlySet<string> = new Set([
  "wrong-parent",
  "not-allowed-in-slot",
  "restricted-at-root",
  "undeclared-slot",
  "holds-no-blocks",
  "phrasing-only",
  "content-model",
]);

/** What reading the stored forms found. */
type StoredRead = Awaited<ReturnType<typeof readStoredForms>>;

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
  /** Keyed by variant id; the default selection under "". */
  readonly selections: ReadonlyMap<string, SelectionFootprint>;
  /** Each exposed slot, as the holder type, its slot and its depth. */
  readonly slots: ReadonlyMap<string, string>;
  /** Each exposed property, as the node, prop path and type it writes to. */
  readonly exposures: ReadonlyMap<string, string>;
}

interface SelectionFootprint {
  /**
   * What the placement rule reads of the composed component: each block
   * type with the content model its settings give it. A Card switching its
   * link on, or a Button added inside, changes it with the shape unmoved.
   */
  readonly placement: string;
  readonly rootTypes: ReadonlySet<string>;
  readonly depth: number;
  readonly componentDepth: number;
  /**
   * The locks the selection itself breaks, placed with no values of its own,
   * counted by fault identity: two slots of one block type broken the same
   * way read alike. A variant's value for an exposure a lock holds changes
   * what every placement picking it draws, with nothing else moved.
   */
  readonly lockFaults: ReadonlyMap<string, number>;
  /**
   * Each collection list the selection draws, by id, with its query as the
   * engine reads it. A list moved to another collection, or given other
   * filters or a sort by a variant, can make a host's own values for it
   * name fields it no longer may, with nothing a placement rule reads moved.
   */
  readonly lists: string;
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
      placement: placementFacts(nodes, setup),
      rootTypes: new Set(nodes.map(root => root.type)),
      depth: deepest(nodes, setup),
      componentDepth: componentDepth ?? MAX_COMPOSED_DEPTH + 1,
      lockFaults: faultCounts(
        faultsIn(host, composed.composition, setup).filter(fault =>
          LOCK_FAULTS.has(fault.code)
        )
      ),
      lists: listQueries(nodes, setup),
    });
  }
  return {
    complete,
    selections,
    slots: exposedSlots(document, setup, locks),
    exposures: exposedProperties(document, locks),
  };
}

/**
 * Each collection list of a composed tree, by id, with its query and its
 * problems as {@link readListQuery} reads them, as one comparable string.
 */
function listQueries(
  nodes: readonly BlockNode[],
  setup: CompositionSetup
): string {
  const lists: string[] = [];
  eachComposed(nodes, setup, entry => {
    if (entry?.type !== COLLECTION_LIST_TYPE) return;
    lists.push(
      `${String(entry.id)}|${JSON.stringify(readListQuery(entry.props))}`
    );
  });
  return lists.sort().join("\n");
}

/** The deepest node of a composed forest, counted from its own top. */
/**
 * The placement facts of a composed tree, as one comparable string: every
 * node by id, under its container and slot, with its type and resolved
 * content model, bounded as `deepest` is.
 */
function placementFacts(
  nodes: readonly BlockNode[],
  setup: CompositionSetup
): string {
  const sources = {
    nesting: registryNestingSource(),
    definitions: registryBlockSource(),
  };
  const facts = new Set<string>();
  // Per node, by id and by where it sits: a set of type/model pairs alone
  // would not move when two Cards swap linked and unlinked, nor when an
  // exposed slot's holder moves under a linked Card, and either can break a
  // host filling that slot.
  eachComposed(nodes, setup, (entry, _at, under) => {
    if (typeof entry?.type !== "string") return;
    facts.add(
      `${under}>${String(entry.id)}|${entry.type}|${contentModelKeyOf(entry, sources)}`
    );
  });
  return [...facts].sort().join("\n");
}

function deepest(nodes: readonly BlockNode[], setup: CompositionSetup): number {
  let most = 0;
  eachComposed(nodes, setup, (_entry, at) => {
    most = Math.max(most, at);
  });
  return most;
}

/**
 * Every node of a composed tree with its depth, to one level past the cap:
 * the one walk the footprint's measurements share.
 */
function eachComposed(
  nodes: readonly BlockNode[],
  setup: CompositionSetup,
  visitNode: (entry: BlockNode, at: number, under: string) => void
): void {
  const visit = (forest: unknown, at: number, under: string): void => {
    if (!Array.isArray(forest) || at > setup.limits.maxDepth + 1) return;
    for (const entry of forest as BlockNode[]) {
      visitNode(entry, at, under);
      const slots = (entry as { slots?: unknown }).slots;
      if (typeof slots !== "object" || slots === null) continue;
      for (const [slot, children] of Object.entries(slots)) {
        visit(children, at + 1, `${String(entry?.id)}/${slot}`);
      }
    }
  };
  visit(nodes, 1, "");
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
        : // The allow-list too: narrowing it can refuse content a host
          // already put in the slot, with nothing else about the slot moved.
          `${nodeId}|${holder.type}|${name}|${holder.depth}|${lockOf(locks, nodeId)}|${JSON.stringify((slot as { allow?: unknown }).allow ?? null)}`
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
  // Any change to what the placement rule reads may break a host, in either
  // direction a host cannot be told apart from here, so it is judged.
  if (after.placement !== before.placement) return true;
  // Any list that changed may now refuse what a host gives it.
  if (after.lists !== before.lists) return true;
  if (after.depth > before.depth) return true;
  if (after.componentDepth > before.componentDepth) return true;
  for (const type of after.rootTypes) {
    if (!before.rootTypes.has(type)) return true;
  }
  for (const [fault, count] of after.lockFaults) {
    if (count > (before.lockFaults.get(fault) ?? 0)) return true;
  }
  return false;
}

/** Which document a write is to, for the server log: kind, slug and entry id. */
export function documentOf(write: PluginFieldWrite | undefined): WrittenTo {
  if (write === undefined) return {};
  return {
    kind: write.kind,
    slug: write.slug,
    ...(write.id === undefined ? {} : { id: write.id }),
  };
}
