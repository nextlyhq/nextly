/**
 * A component save judged inside every document that places it: the hosts
 * the usage index lists, each judged before and after the save, with only
 * the faults this save introduces refused, and the hosts it could not judge
 * reported for the site's operators.
 *
 * Part of the blocks field's composition checks. `blocks-composition.ts` is
 * the entry, and its header explains the rules.
 *
 * @module fields/blocks-composition-hosts
 */
import {
  MAX_COMPOSED_DEPTH,
  type BlockDocument,
  type ComponentLookup,
  type WorkAllowance,
} from "@nextlyhq/blocks-engine";
import type {
  PluginFieldWrite,
  PluginStoredValueTarget,
} from "@nextlyhq/plugin-sdk";

import {
  composeWithReads,
  heldLibrary,
  type BoundedReader,
  type ComponentSource,
  type ReadComposition,
} from "../composition-reading";

import {
  type Report,
  lookupOf,
  faultsIn,
  type HostFault,
  faultIdentity,
  faultCounts,
  LOCK_FAULTS,
} from "./blocks-composition-faults";
import { footprintOf, mayWorsen } from "./blocks-composition-footprint";
import type {
  HostRef,
  CompositionSetup,
  BrokenHosts,
} from "./blocks-composition-setup";
import { isForest } from "./blocks-document";
import {
  composedConditionIssues,
  composedListQueryIssues,
  isStoredTemplate,
  TEMPLATE_TARGET_UNKNOWN,
  type ComposedListIssue,
  type ListFieldsReader,
} from "./list-query-judgement";

/**
 * How many documents one component save will judge itself inside.
 *
 * Reached only by a change that could make a host worse, which is rare. Past
 * it the remaining hosts are reported as unjudged.
 */
const MOST_HOSTS_JUDGED = 1000;

/**
 * Judge a component save inside every document that places it, in one form.
 *
 * Only a change that can make a host worse reaches the hosts at all, and then
 * only the faults this save INTRODUCES are reported: a host already broken is
 * its own document's problem, and refusing an unrelated component save for it
 * would block the one author who did not cause it.
 */
export async function judgeHosts(args: {
  self: string;
  document: BlockDocument;
  draft: boolean;
  source: ComponentSource;
  read: BoundedReader;
  write: PluginFieldWrite;
  setup: CompositionSetup;
  work: WorkAllowance;
  tally: Tally;
  /**
   * The component as it stood before this write, for a judgement made after
   * the write stored it, when the store already holds the new document.
   * Absent, it is read from the store.
   */
  stored?: { readonly document: BlockDocument | undefined };
}): Promise<void> {
  const { self, document, draft, source, read, write, setup, work, tally } =
    args;
  const before = args.stored ?? (await storedBefore(source, self, draft));
  // Not stored in this form yet: a create under a caller's own id, which pages
  // may already place. Nothing to compare against, so every host is judged.
  const was =
    before.document === undefined
      ? undefined
      : await footprintOf(self, before.document, read, setup, work);
  const now = await footprintOf(self, document, read, setup, work);
  if (was !== undefined && !mayWorsen(was, now)) return;

  // Unless the index is read on this transaction, it is read on a connection
  // of its own. Inside a transaction that read can wait on the connection the
  // transaction holds, and the rows the batch wrote are not in it anyway.
  if (write.inTransaction && setup.hostsInTransaction !== true) {
    tally.incomplete(
      "it was saved inside a transaction, where the usage index is not read"
    );
    return;
  }
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
  // And the collections the template hosts draw, in one read for them all.
  const templateTargets = await templateHostTargets(listed.hosts, write, setup);
  for (const host of listed.hosts) {
    await judgeOneHost({
      host,
      self,
      document,
      was: before.document,
      draft,
      read,
      write,
      setup,
      work,
      tally,
      listFields,
      templateTargets,
    });
  }
}

/**
 * The collections the hosts stored in the templates collection draw, by
 * host id, read in ONE read for every such host rather than one per host.
 * Nothing is read inside a caller's transaction, where a read on another
 * connection can wait on the one the transaction holds: those hosts are
 * then left unjudged (`hostSettingOf`).
 */
async function templateHostTargets(
  hosts: readonly HostRef[],
  write: PluginFieldWrite,
  setup: CompositionSetup
): Promise<ReadonlyMap<string, string>> {
  const templates = setup.templates;
  if (templates === undefined || write.inTransaction) return new Map();
  const ids = [
    ...new Set(
      hosts
        .filter(host => !host.single && host.slug === templates.collection)
        .map(host => host.id)
    ),
  ];
  return ids.length === 0 ? new Map() : templates.storedTargetsOf(ids);
}

/** The component as the store holds it in one form, where it holds a forest. */
async function storedBefore(
  source: ComponentSource,
  self: string,
  draft: boolean
): Promise<{ readonly document: BlockDocument | undefined }> {
  const before = await source(self, draft);
  return {
    document:
      before.kind === "document" && isForest(before.document)
        ? (before.document as BlockDocument)
        : undefined,
  };
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
export function hostTally(componentId: string, setup: CompositionSetup) {
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
  return `${host.single === true ? "single" : "collection"}\u0000${host.slug}\u0000${host.id}`;
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
    case CONDITION_BROKEN:
      return "a block's visibility condition would check a field it can't use there";
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
    const key = `${documentKey(host)}\u0000${host.field}`;
    const isComponent =
      host.single !== true && host.slug === setup.store.collection;
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
  /** The component before this save, or undefined where it held none. */
  was: BlockDocument | undefined;
  draft: boolean;
  read: BoundedReader;
  write: PluginFieldWrite;
  setup: CompositionSetup;
  work: WorkAllowance;
  tally: Tally;
  /** The schema the host's lists are judged against, read once per save. */
  listFields: ListFieldsReader | undefined;
  /** The collections the template hosts draw, read once per save. */
  templateTargets: ReadonlyMap<string, string>;
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
  // Seeded with the component as it was, which the store no longer holds once
  // the write has stored it; where it held none, the host composes without it.
  const before = await compose(
    args.was === undefined ? undefined : new Map([[self, args.was]])
  );
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
    templateTargets: args.templateTargets,
  });
}

/**
 * The collection lists, and the visibility conditions, the save would newly
 * break in one host, as the host
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
  templateTargets: ReadonlyMap<string, string>;
}): Promise<void> {
  const { host, stored, before, after, setup, tally, listFields } = args;
  const setting = hostSettingOf(host, stored, setup, args.templateTargets);
  if (setting === TEMPLATE_TARGET_UNKNOWN) {
    // Never judged by shape instead: the operator is told which template
    // went unjudged, as for any host this save could not vouch for.
    tally.host(
      host,
      `${describeHost(host)} is a template whose collection could not be read`
    );
    return;
  }
  const site = {
    ...(listFields === undefined ? {} : { fieldsOf: listFields }),
    ...(setup.namedQueries === undefined
      ? {}
      : { namedQueries: setup.namedQueries }),
    maxNodes: setup.limits.maxNodes,
    // What the host composed to before this save stands for its stored
    // form: a problem it held there is kept.
    storedForms: () =>
      Promise.resolve({
        forms: [before.composition.document],
        readable: true,
      }),
  };
  // A placed block's visibility conditions read the host's entry, or the
  // item of a list they land in, so they are judged the same way.
  const judged = [
    { code: LIST_BROKEN, judge: composedListQueryIssues },
    { code: CONDITION_BROKEN, judge: composedConditionIssues },
  ];
  for (const { code, judge } of judged) {
    const found = await judge(
      after.composition.document,
      stored,
      setting,
      site
    );
    reportHostIssues(host, tally, code, found);
  }
}

/**
 * The setting a host's lists are judged in when a component it places is
 * saved: no entry for a host that is itself a component, the collection a
 * template draws for a template (as its own save judges it, from the template
 * as stored), and the host's own collection for any other entry.
 */
function hostSettingOf(
  host: HostRef,
  stored: BlockDocument,
  setup: CompositionSetup,
  templateTargets: ReadonlyMap<string, string>
):
  | { readonly entryCollection?: string | null }
  | typeof TEMPLATE_TARGET_UNKNOWN {
  if (host.slug === setup.store.collection) return {};
  // Judged as a save of the template is: against the collection it draws,
  // from the template as stored, read for every template host at once.
  if (!host.single && isStoredTemplate(host.slug, stored, setup.templates)) {
    const target = templateTargets.get(host.id);
    return target === undefined
      ? TEMPLATE_TARGET_UNKNOWN
      : { entryCollection: target };
  }
  return { entryCollection: host.slug };
}

/** Each issue a save would bring to one host, as that host's fault. */
function reportHostIssues(
  host: HostRef,
  tally: Tally,
  code: string,
  found: readonly ComposedListIssue[]
): void {
  for (const issue of found) {
    tally.broke(host, {
      code,
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

/** The host fault of a visibility condition a component save would break. */
const CONDITION_BROKEN = "visibility-condition";

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
 * A host's stored document in one form: the document, `undefined` where there
 * is none to judge, or `null` where it could not be read.
 */
async function hostDocument(
  host: HostRef,
  draft: boolean,
  write: PluginFieldWrite
): Promise<BlockDocument | undefined | null> {
  const form = draft ? "draft" : "published";
  const target: PluginStoredValueTarget =
    host.single === true
      ? { single: host.slug, field: host.field, form }
      : { collection: host.slug, id: host.id, field: host.field, form };
  try {
    const read = await write.readStored(target);
    if (read.kind === "absent") return undefined;
    return isForest(read.value) ? (read.value as BlockDocument) : undefined;
  } catch {
    return null;
  }
}

/** A host as an operator finds it in the log: its entry id in its collection, or the Single. */
function describeHost(host: HostRef): string {
  return host.single === true
    ? `the Single "${host.slug}"`
    : `"${host.id}" in "${host.slug}"`;
}
