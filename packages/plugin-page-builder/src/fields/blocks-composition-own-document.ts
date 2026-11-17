/**
 * The written document's own composition: its nesting and depth across
 * what it places, its collection lists, the slot locks its placements fill,
 * its placements' values and variants, and a break the stored forms already
 * held, which is kept rather than refused.
 *
 * Part of the blocks field's composition checks. `blocks-composition.ts` is
 * the entry, and its header explains the rules.
 *
 * @module fields/blocks-composition-own-document
 */
import {
  componentIdsIn,
  MAX_COMPOSED_DEPTH,
  placementValueIssues,
  placementVariantIssues,
  type BlockDocument,
  type ComponentLookup,
  type compositionFaults,
  type CompositionFault,
  type DocumentLimits,
  type PlacementValueProblem,
  type WorkAllowance,
} from "@nextlyhq/blocks-engine";
import type { PluginFieldWrite } from "@nextlyhq/plugin-sdk";

import {
  composeWithReads,
  heldLibrary,
  type BoundedReader,
  type HeldLibrary,
} from "../composition-reading";

import type { StoredForms } from "./added-undefined-ids";
import { composedBindingIssues } from "./binding-judgement";
import {
  type Report,
  lookupOf,
  faultsIn,
  PLACEMENT_FAULTS,
  LOCK_FAULTS,
} from "./blocks-composition-faults";
import type {
  CompositionSetup,
  WrittenTo,
  PlacementUnjudged,
  LayersLockUnjudged,
} from "./blocks-composition-setup";
import { isForest } from "./blocks-document";
import { LAYERS_LOCK_CHANGED, placedLockMessage } from "./layers-lock-wording";
import {
  composedConditionIssues,
  composedListQueryIssues,
  TEMPLATE_TARGET_UNKNOWN,
  writeSettingOf,
} from "./list-query-judgement";
import {
  composedFormsRead,
  lockBaselines,
  type readStoredForms,
} from "./lock-baselines";
import { placedLayersLocks } from "./placement-layers-locks";

/** The document's own composition: nesting and depth across what it places. */
export async function judgeOwnComposition(args: {
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
  /** The write's payload, for the collection a template draws. */
  data: Readonly<Record<string, unknown>>;
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
    data: args.data,
    report,
    unjudged: { field: args.field ?? "", ...args.writtenTo },
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
 * to is kept. A placed block's visibility conditions are judged the same way,
 * against the entry or list item they read where the page places them.
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
  /** The write's payload, for the collection a template draws. */
  data: Readonly<Record<string, unknown>>;
  report: Report;
  /** Which document is written, for the server log of problems kept. */
  unjudged: Omit<PlacementUnjudged, "breaks">;
}): Promise<void> {
  const fieldsOf = args.setup.listFields;
  // The stored forms composed as this page is, so a list or a condition they
  // already composed to keeps its problem as a warning. Composed once, for
  // both judgements, and only once one of them finds a problem. Composed only
  // in part, they may lack a problem the stored page holds, so they count as
  // unreadable: the problem is kept rather than blamed on this write.
  let storedForms: Promise<StoredForms> | undefined;
  const composeStored = async (): Promise<StoredForms> => {
    const stored = await args.stored();
    if (!stored.readable) return { forms: [], readable: false };
    const composed = await composedFormsRead({
      ...args.reading,
      hosts: stored.forms,
    });
    return {
      forms: composed.forms as BlockDocument[],
      readable: composed.complete,
    };
  };
  const site = {
    ...(fieldsOf === undefined ? {} : { fieldsOf }),
    ...(args.setup.namedQueries === undefined
      ? {}
      : { namedQueries: args.setup.namedQueries }),
    maxNodes: args.setup.limits.maxNodes,
    storedForms: () => (storedForms ??= composeStored()),
    // A placement's value or variant made each such problem, so it is logged
    // as the placement breaks a write keeps are.
    onUnjudged: (breaks: number) =>
      args.setup.onPlacementUnjudged?.({ ...args.unjudged, breaks }),
  };
  // A component's own save leaves the entry unknown: its lists and
  // conditions read the entries of the pages placing it. A template's read
  // the entry of the collection it draws.
  const setting = await writeSettingOf(
    args.write,
    args.document,
    args.data,
    args.setup.templates
  );
  // A template whose collection cannot be known is refused by the field's
  // own judgement of its lists, which runs on the same write; judging its
  // composed lists by their shape here would only weaken that refusal.
  if (setting === TEMPLATE_TARGET_UNKNOWN) return;
  const found = [
    ...(await composedListQueryIssues(
      args.composed,
      args.document,
      setting,
      site
    )),
    ...(await composedConditionIssues(
      args.composed,
      args.document,
      setting,
      site
    )),
  ];
  for (const issue of found) args.report.add(issue.code, issue.message);
  // And the bindings its placed components bring, against this page's entry.
  const bindingShapes = args.setup.bindingShapes;
  if (bindingShapes === undefined) return;
  const bound = await composedBindingIssues(
    args.composed,
    args.document,
    args.write,
    {
      shapesOf: bindingShapes,
      storedForms: site.storedForms,
      maxNodes: site.maxNodes,
      blocks: args.setup.blocks,
      onUnjudged: (bindings: number) =>
        args.setup.onBindingsUnjudged?.({ ...args.unjudged, bindings }),
      // A placed list's item bindings, against its query's rows.
      ...(args.setup.namedQueries === undefined
        ? {}
        : { namedQueries: args.setup.namedQueries }),
      // A template's, against the collection it draws.
      ...(args.setup.templates === undefined
        ? {}
        : { templates: args.setup.templates }),
    },
    args.data
  );
  for (const issue of bound) args.report.add(issue.code, issue.message);
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
export async function readEveryPlacedDefinition(
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

export const OUTGROWN: string =
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
export async function measuredAgainstStored(
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

/** What reading the stored forms found. */
export type StoredRead = Awaited<ReturnType<typeof readStoredForms>>;
