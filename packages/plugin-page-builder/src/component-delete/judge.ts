/**
 * The check a component delete makes before it converts anything, over one
 * slice of the site's documents: what each document would come to, and
 * whether the person may make every write the delete needs there.
 *
 * Every host is judged as the conversion would judge it, writing nothing.
 * Anything that would stop the delete part way stops it here, with no host
 * changed:
 *
 * - a copy that can't be converted (a locked area's starting blocks, a setting
 *   that installs the component), or a host that can't be read, or written
 *   where it is;
 * - a Layout using the component;
 * - a document the person may not write as the conversion will: its update
 *   gate for that row, the update rule of each field the conversion sets, and
 *   the lifecycle gate only where the status the write names moves the row
 *   into or out of published, asked of core's own gates (`mayWriteEntry`), so
 *   the check asks what the write asks, no more. The conversion names the
 *   state it read the live row in, so it never moves one. A document whose
 *   gates cannot be asked counts as one they may not write.
 *
 * @module component-delete/judge
 */
import type { PluginWriteCheck } from "@nextlyhq/plugin-sdk";

import {
  documentAddressOf,
  documentKeyOf,
  type HostAddress,
  type LeftReason,
  type RewriteReport,
} from "../host-rewrite/contract";
import type { HostProgress } from "../host-rewrite/progress";
import type {
  ComponentDeleteRewriteService,
  PlanSlice,
  RewriteCaller,
} from "../host-rewrite/service";

import type {
  DeletePlan,
  DocumentList,
  LeftDocument,
  LeftDocumentReason,
} from "./contract";
import { MOST_NAMED, namedDocuments, type NamingDeps } from "./hosts";
import { leftWords } from "./words";

/** How many documents one step judges or converts at most. */
export const STEP_DOCUMENTS = 25;

/** How long one step judges or converts for at most. */
export const STEP_MS = 8000;

/** What judging needs. */
export interface JudgeDeps extends NamingDeps {
  readonly componentId: string;
  readonly caller: RewriteCaller;
  readonly rewrite: Pick<ComponentDeleteRewriteService, "plan">;
  /** Whether the caller may make this write, asked of core's own gates. */
  readonly mayWrite: (check: PluginWriteCheck) => Promise<boolean>;
  readonly now: () => Date;
}

/** What the check found, over one slice. */
export interface Judged {
  readonly plan: DeletePlan;
  readonly layouts?: DocumentList;
  readonly left: readonly LeftDocument[];
  /** How many more documents stop it than `left` lists. */
  readonly leftMore: number;
  readonly blocked: boolean;
}

/** The reasons a document left by the check stops the delete before it starts. */
const STOPS: ReadonlySet<LeftReason> = new Set<LeftReason>([
  "refused",
  "unreadable",
  "unaddressable",
  "write-refused",
  "changed",
  "not-permitted",
  "layout",
]);

/** Judge one slice of the hosts, after `after`, as the delete would, writing nothing. */
export async function judge(
  deps: JudgeDeps,
  after: string | null
): Promise<Judged> {
  const slice: PlanSlice = await deps.rewrite.plan({
    componentId: deps.componentId,
    caller: deps.caller,
    after,
    maxDocuments: STEP_DOCUMENTS,
    deadline: new Date(deps.now().getTime() + STEP_MS),
  });
  const { report } = slice;
  const drafted = report.left
    .filter(left => left.reason === "pending-draft")
    .map(left => left.host);
  const stopping = stoppingDocuments(report);
  for (const key of await writesRefused(deps, report, drafted)) {
    if (!stopping.has(key)) stopping.set(key, "not-permitted");
  }
  const layoutKeys = [...stopping]
    .filter(([, reason]) => reason === "layout")
    .map(([key]) => key);
  const others = [...stopping]
    .filter(([, reason]) => reason !== "layout")
    .map(([key, reason]) => ({ key, reason }));
  return {
    plan: {
      complete: slice.complete,
      next: slice.next,
      convert: await namedDocuments(deps, keysOf(report.rewritten)),
      drafts: await namedDocuments(deps, keysOf(drafted)),
    },
    ...(layoutKeys.length === 0
      ? {}
      : { layouts: await namedDocuments(deps, layoutKeys) }),
    left: await leftDocumentsOf(deps, others.slice(0, MOST_NAMED)),
    leftMore: Math.max(0, others.length - MOST_NAMED),
    blocked: stopping.size > 0,
  };
}

/**
 * The documents the walk itself would leave, and why: one entry per document
 * and reason, since a document with two hosts left for one reason is one
 * place to go.
 */
function stoppingDocuments(report: RewriteReport): Map<string, LeftReason> {
  const stopping = new Map<string, LeftReason>();
  for (const left of report.left) {
    if (!STOPS.has(left.reason)) continue;
    const key = documentKeyOf(left.host);
    if (!stopping.has(key)) stopping.set(key, left.reason);
  }
  return stopping;
}

/** One write the conversion will make: a document, in one language. */
interface PlannedWrite {
  readonly key: string;
  readonly locale: string | undefined;
  readonly fields: Set<string>;
  /** The status the write names, where it names one. */
  status: string | undefined;
}

/**
 * The documents the person may not write as the conversion will, each asked
 * once per language it is written in: the top-level fields it sets, and the
 * status it names. A check that cannot be asked counts as refused.
 */
async function writesRefused(
  deps: JudgeDeps,
  report: RewriteReport,
  drafted: readonly HostAddress[]
): Promise<string[]> {
  const statuses = new Map(
    (report.statuses ?? []).map(named => [writeKeyOf(named.host), named.status])
  );
  const writes = new Map<string, PlannedWrite>();
  for (const host of [...report.rewritten, ...drafted]) {
    const at = writeKeyOf(host);
    const planned = writes.get(at) ?? {
      key: documentKeyOf(host),
      locale: host.locale,
      fields: new Set<string>(),
      status: undefined,
    };
    const field = host.path[0];
    if (field !== undefined) planned.fields.add(field);
    planned.status ??= statuses.get(at);
    writes.set(at, planned);
  }
  const refused = new Set<string>();
  for (const planned of writes.values()) {
    if (refused.has(planned.key)) continue;
    if (!(await mayMake(deps, planned))) refused.add(planned.key);
  }
  return [...refused];
}

/** Whether the person may make one planned write; `false` where it can't be asked. */
async function mayMake(
  deps: JudgeDeps,
  planned: PlannedWrite
): Promise<boolean> {
  const address = documentAddressOf(planned.key);
  if (address === undefined) return false;
  const target =
    address.kind === "single"
      ? { single: address.slug }
      : { collection: address.slug, id: address.id ?? "" };
  try {
    return await deps.mayWrite({
      ...target,
      ...(planned.status === undefined ? {} : { status: planned.status }),
      fields: [...planned.fields],
      ...(planned.locale === undefined ? {} : { locale: planned.locale }),
    });
  } catch {
    return false;
  }
}

/** A document in one language, as one write makes it. */
function writeKeyOf(host: HostAddress): string {
  return `${documentKeyOf(host)}\u001F${host.locale ?? ""}`;
}

/** The documents the hosts belong to, once each, in the order found. */
function keysOf(hosts: readonly HostAddress[]): string[] {
  return [...new Set(hosts.map(host => documentKeyOf(host)))];
}

/** The first documents a finished run left, named for the person, with why. */
export async function leftDocuments(
  deps: NamingDeps,
  rows: readonly HostProgress[],
  report: RewriteReport
): Promise<LeftDocument[]> {
  // This call's own report knows the reason of a document it left itself;
  // the row holds the first reason recorded for it.
  const fromReport = new Map(
    report.left.map(left => [documentKeyOf(left.host), left.reason] as const)
  );
  return leftDocumentsOf(
    deps,
    rows.map(row => ({
      key: row.documentKey,
      reason: reasonOf(fromReport.get(row.documentKey) ?? row.reason),
    }))
  );
}

/** Left documents, named where the person may read them. */
async function leftDocumentsOf(
  deps: NamingDeps,
  found: readonly {
    readonly key: string;
    readonly reason: LeftDocumentReason;
  }[]
): Promise<LeftDocument[]> {
  const named = await namedDocuments(
    deps,
    found.map(entry => entry.key)
  );
  const byKey = new Map(
    named.named.map(document => [documentKeyOf(document), document] as const)
  );
  return found.map(entry => ({
    document: byKey.get(entry.key) ?? null,
    reason: entry.reason,
    words: leftWords(entry.reason),
  }));
}

/** A recorded reason, read strictly: one nobody can classify was unreadable. */
function reasonOf(value: string | null | undefined): LeftDocumentReason {
  return value !== null && value !== undefined && LEFT_REASONS.has(value)
    ? (value as LeftDocumentReason)
    : "unreadable";
}

const LEFT_REASONS: ReadonlySet<string> = new Set<LeftDocumentReason>([
  "refused",
  "pending-draft",
  "not-permitted",
  "unreadable",
  "unaddressable",
  "changed",
  "write-refused",
  "layout",
]);
