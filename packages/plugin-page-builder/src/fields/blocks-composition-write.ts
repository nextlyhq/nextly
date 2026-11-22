/**
 * The two judgements a blocks write runs: the composed document's issues
 * before the write's transaction opens, and the graph's rules again inside
 * it, under the graph lock. Each composes the checks of the other parts.
 *
 * Part of the blocks field's composition checks. `blocks-composition.ts` is
 * the entry, and its header explains the rules.
 *
 * @module fields/blocks-composition-write
 */
import type { BlockDocument, WorkAllowance } from "@nextlyhq/blocks-engine";
import type {
  PluginFieldValidateArgs,
  PluginFieldWrite,
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
  type BoundedReader,
} from "../composition-reading";
import { fenceIssues } from "../host-rewrite/fence";

import {
  judgeVariantLocks,
  judgeLockedExposures,
} from "./blocks-composition-component-locks";
import {
  issueReport,
  type Report,
  lookupOf,
  faultsIn,
} from "./blocks-composition-faults";
import { judgeHosts, hostTally } from "./blocks-composition-hosts";
import {
  judgeOwnComposition,
  OUTGROWN,
  measuredAgainstStored,
  type StoredRead,
} from "./blocks-composition-own-document";
import {
  type Issue,
  type CompositionSetup,
  documentOf,
} from "./blocks-composition-setup";
import { isForest } from "./blocks-document";
import { readStoredForms } from "./lock-baselines";

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
      data: args.data,
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
 * The composition graph's rules judged again on a value already stored, from
 * inside the write's transaction while it holds the graph lock
 * (`composition-graph-lock`): no component loop, the composed nesting and
 * depth of the document, and, for a component, of every document the index
 * lists as placing it.
 *
 * {@link compositionIssues} judges the write before its transaction opens, so
 * two writes can each pass against the graph as it stood before the other.
 * Under the lock every definition is read as last committed, through `write`
 * (bound to the transaction), and this write's own value is the one stored.
 *
 * `before` is the value as it stood before this write, which the store no
 * longer holds: a nesting break it already composed to is kept, as the first
 * judgement keeps one the stored forms hold, and a component's hosts are
 * judged against it. A slot lock a placed component holds is judged here too,
 * measured against the same value: a component can tighten one while a page
 * fills that slot. Nothing that does not depend on other documents is judged
 * again.
 */
export async function compositionGraphIssues(
  value: unknown,
  args: {
    /** The write, bound to its transaction. */
    readonly write: PluginFieldWrite;
    /** The blocks field's path. */
    readonly path: string;
    /** The status the stored document is in, deciding the forms judged. */
    readonly nextStatus: string | undefined;
    /** The value before this write; undefined for a create. */
    readonly before: unknown;
  },
  setup: CompositionSetup
): Promise<Issue[]> {
  if (!isForest(value)) return [];
  const { write, nextStatus } = args;
  const document = value as BlockDocument;
  const source = storedComponentSource(write, setup.store);
  const self = componentSaved(write, args.path, setup.store);
  const report = issueReport(args.path);
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
    if (cycle !== null) {
      report.add("COMPONENT_CYCLE", cycle);
      return report.issues;
    }
  }
  if (!setup.composesDocuments) return report.issues;

  const before = isForest(args.before)
    ? (args.before as BlockDocument)
    : undefined;
  const stored = (): Promise<StoredRead> =>
    Promise.resolve({
      forms: before === undefined ? [] : [before],
      readable: true,
    });
  const tally = hostTally(self ?? "", setup);
  for (const draft of formsChangedBy(nextStatus)) {
    const read = documentReader(source, draft);
    await judgeGraph({ document, self, read, setup, work, report, stored });
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
        stored: { document: before },
      });
    }
  }
  tally.flush(report);
  return report.issues;
}

/**
 * The graph half of {@link judgeOwnComposition}: the document's composed
 * nesting, depth and slot locks, a nesting or lock break measured against
 * `stored`.
 */
async function judgeGraph(args: {
  document: BlockDocument;
  self: string | undefined;
  read: BoundedReader;
  setup: CompositionSetup;
  work: WorkAllowance;
  report: Report;
  stored: () => Promise<StoredRead>;
}): Promise<void> {
  const { document, self, read, setup, work, report } = args;
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
      field: undefined,
      writtenTo: undefined,
    }
  );
  for (const fault of faults) report.add(fault.code, fault.message);
}

/**
 * What a rewrite of every host adds to a write's judgement, on every write:
 * any write adding a reference to a component being deleted is refused (see
 * `host-rewrite/fence`). A rewrite's own write is checked against what it
 * read by core's conditional write, under the write's own row lock.
 */
async function judgeHostRewrite(
  document: BlockDocument,
  args: Pick<PluginFieldValidateArgs, "data" | "path"> &
    Partial<Pick<PluginFieldValidateArgs, "field">>,
  write: PluginFieldWrite,
  setup: CompositionSetup,
  report: Report
): Promise<void> {
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
