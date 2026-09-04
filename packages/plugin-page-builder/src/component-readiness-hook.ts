/**
 * Telling an author that a page went live pointing at components that did not.
 *
 * A page and the components it embeds are separate documents with separate
 * lifecycles, so publishing the page says nothing about them. The page then
 * renders a missing-component marker exactly where the author expected content,
 * and nothing said so — the save reported plain success.
 *
 * ## It reports; it never refuses
 *
 * The write has already committed when this runs, and it would not refuse even
 * if it could. Publishing a page before its components is an ordinary order of
 * work — an author building both often publishes the container first — so
 * blocking it would refuse a legitimate sequence to prevent a state the author
 * is about to leave anyway. The notice states what is true and gets out of the
 * way.
 *
 * ## Why it asks the store instead of reading a status
 *
 * "Published" is the workflow's word, not this module's: a project can declare
 * public states beyond the built-in one. So this reads the components under a
 * PUBLISHED scope and treats the ids that do not come back as the answer. The
 * query service applies the rule, and there is no second copy here to drift
 * from it.
 *
 * That also collapses two cases that deserve collapsing: an id that is
 * unpublished and an id that no longer exists both leave the same hole on the
 * page, and the author's next action is the same for either.
 *
 * ## Where it stays silent
 *
 * A LOCALIZED component store. Publishing is per language on a companion row
 * there, so a published-scoped read answers for no language in particular and
 * would report live components as missing. A notice that fires on a case it
 * cannot decide teaches authors to dismiss it, which costs more than the case
 * it was meant to catch. This module only ever reports, so a notice nobody
 * believes is the only failure mode it has.
 *
 * @module component-readiness-hook
 */
import {
  MAX_COMPOSED_DEPTH,
  type DocumentLimits,
} from "@nextlyhq/blocks-engine";
import type { HookContext } from "nextly";
import { recordAdvisoryNotice } from "nextly";

import { blocksFieldsOf } from "./class-usage-blocks-fields";
import { embeddedComponentIds } from "./component-readiness";
import { requestContextFor, writeTargetOf } from "./write-target";

/** The phases a document can become published in. */
const PUBLISHING_PHASES = ["afterCreate", "afterUpdate"] as const;

/** The canonical code a consumer branches on. */
export const COMPONENTS_NOT_PUBLISHED_CODE = "COMPONENTS_NOT_PUBLISHED";

/**
 * How many ids one readiness query may ask about.
 *
 * A collection query is CLAMPED to `PAGINATION_DEFAULTS.maxLimit` (500) and
 * returns a subset silently, while a document may reference far more component
 * instances than that — the default node cap is 5,000. Asking for all of them
 * at once returns the first page, and every published component missing from it
 * is then reported as unpublished: a false warning, produced by the read rather
 * than by the data. Under the cap the answer is the whole answer.
 */
const READINESS_BATCH_SIZE = 128;

/** The reads this notice makes on its own behalf. */
export interface ReadinessDirectApi {
  find(args: {
    collection: string;
    where?: Record<string, unknown>;
    limit?: number;
    status?: "published" | "draft" | "all";
    overrideAccess?: boolean;
    depth?: number;
  }): Promise<{ items: unknown[] }>;
}

/** The plugin capabilities this needs, named structurally. */
export interface ReadinessPluginContext {
  hooks: {
    on(
      type: string,
      collection: string,
      handler: (context: HookContext<unknown>) => unknown
    ): void;
  };
  services: {
    collections: {
      getCollection(name: string, context: unknown): Promise<unknown>;
    };
  };
}

/**
 * Wire the notice to every write, on the wildcard.
 *
 * One registration rather than one per collection, for the reason class-usage
 * gives: the set of collections is not known when a plugin is wired, and a
 * blocks field can be added to an existing one, so a list captured here would
 * quietly stop covering the collections that matter most.
 */
export function registerComponentReadinessNotice(args: {
  ctx: ReadinessPluginContext;
  /** The RESOLVED slug component definitions are stored under. */
  componentCollection: string;
  /** The bounds documents are read under, asked per call. */
  limits: () => DocumentLimits;
}): void {
  for (const phase of PUBLISHING_PHASES) {
    // Closed over at REGISTRATION, because the context does not carry it. A
    // `HookContext` names its `operation` ("create" / "update"), not the phase,
    // so reading a phase off it yields nothing and every advisory would report
    // the same lifecycle metadata whichever phase produced it.
    args.ctx.hooks.on(phase, "*", (context: HookContext<unknown>) =>
      report(args, context, phase)
    );
  }
}

/**
 * One write's notice.
 *
 * Never throws. A raise from an `after*` phase is how a hook reports that a
 * side effect BROKE, and the registry files it as exactly that — so a failure
 * to compose an advisory would reach the caller wearing a failure's code, about
 * a write that succeeded. There is nothing to remediate either: the notice is
 * the whole product, and an author who does not receive it is where they were
 * before it existed.
 */
async function report(
  args: Parameters<typeof registerComponentReadinessNotice>[0],
  context: HookContext<unknown>,
  phase: string
): Promise<void> {
  try {
    const notice = await composeNotice(args, context, phase);
    if (notice === null) return;
    recordAdvisoryNotice(notice);
  } catch {
    // Deliberately silent. See the docblock above: an advisory that cannot be
    // composed is an advisory that is not shown, and turning that into a
    // warning would report a clean publish as a broken one.
  }
}

/** The notice this write earns, or `null` when it earns none. */
async function composeNotice(
  args: Parameters<typeof registerComponentReadinessNotice>[0],
  context: HookContext<unknown>,
  phase: string
): Promise<Parameters<typeof recordAdvisoryNotice>[0] | null> {
  const target = writeTargetOf<ReadinessDirectApi>(context, {
    // The component store itself is NOT excluded: a component embedding another
    // component has the same hole for the same reason, and an author publishing
    // it wants the same sentence.
    excluded: [],
  });
  if (target === null) return null;

  const collection = await args.ctx.services.collections.getCollection(
    target.slug,
    requestContextFor(context)
  );
  if (!leavesDocumentPublished(context, collection)) return null;
  // No early return for a collection without blocks fields: it would be a
  // second spelling of the check below, since a document with no such field
  // references no components. One question, one branch.
  const embedded = embeddedIn(
    context,
    blocksFieldsOf(collection as never),
    args.limits()
  );
  if (embedded.length === 0) return null;

  const store = await args.ctx.services.collections.getCollection(
    args.componentCollection,
    requestContextFor(context)
  );
  if ((store as { localized?: unknown } | null)?.localized === true) {
    return null;
  }

  const missing = await missingAcrossGraph(
    args,
    target.nextly,
    store,
    embedded
  );
  if (missing.length === 0) return null;

  return {
    phase,
    collection: target.slug,
    code: COMPONENTS_NOT_PUBLISHED_CODE,
    message: describe(missing.length),
    entryId: target.documentId,
  };
}

/**
 * Whether this write leaves a document VISITORS can load, with this content.
 *
 * Three conditions, and each rules out a different way of being wrong.
 *
 * **The collection must own the lifecycle.** `status` is an ordinary field name
 * a project may use for its own vocabulary, so the name answers nothing: a
 * collection without the Draft/Published lifecycle whose rows say
 * `status: "published"` has published nothing. Core draws exactly this
 * distinction with `status === true` on the collection, and asking it here is
 * what keeps one reading of the field rather than inventing a second.
 *
 * **The document must be published**, judged on the state the write LEAVES
 * BEHIND rather than the transition into it. The admin sends `status` on every
 * save, so a rule watching for a change fires only on the save that flipped it,
 * and an author who later drops an unpublished component into an already-live
 * page would be told nothing — the case most worth catching.
 *
 * **It must not be a working-draft save.** A pending draft on a published,
 * drafts-enabled document leaves `status` at the live parent's value, so by its
 * own fields it is indistinguishable from a real publish — while the live
 * document a visitor loads did not change at all. Warning there would fire on
 * ordinary drafting of a live page, which is most of an author's day, and a
 * notice that cries wolf is one nobody reads by the time it is right.
 */
function leavesDocumentPublished(
  context: HookContext<unknown>,
  collection: unknown
): boolean {
  if ((collection as { status?: unknown } | null)?.status !== true)
    return false;
  const data = (context as unknown as Record<string, unknown>).data;
  if (typeof data !== "object" || data === null) return false;
  const document = data as { status?: unknown; _isWorkingDraft?: unknown };
  if (document._isWorkingDraft === true) return false;
  return document.status === "published";
}

/** Every component id the written document references, across its blocks fields. */
function embeddedIn(
  context: HookContext<unknown>,
  fields: readonly { name: string }[],
  limits: DocumentLimits
): string[] {
  const data = (context as unknown as Record<string, unknown>).data as
    | Record<string, unknown>
    | undefined;
  const found = new Set<string>();
  for (const field of fields) {
    const nodes = (data?.[field.name] as { nodes?: unknown } | undefined)
      ?.nodes;
    if (!Array.isArray(nodes)) continue;
    for (const id of embeddedComponentIds(nodes, limits)) found.add(id);
  }
  return [...found];
}

/**
 * Every component the page cannot show, following the graph the renderer does.
 *
 * The page's own instances are not the whole question. A published component may
 * itself embed one that is not published, and the renderer inlines the outer
 * definition and then meets the same hole one level down — so a check that
 * stopped at the ids stored in the page would verify the outer component, find
 * it live, and stay silent about a marker a visitor can see.
 *
 * Descends only through definitions that came back PUBLISHED, which is exactly
 * how far the renderer gets: an unpublished component is never inlined, so what
 * it references in turn is unreachable, and naming those would report
 * components no visitor could encounter. Its own id is already in the answer.
 *
 * Bounded by the depth the engine composes to, and by a visited set. The set
 * alone makes the walk finite over authored data that may contain a cycle; the
 * depth bound keeps the question inside the tree the renderer would build.
 */
async function missingAcrossGraph(
  args: Parameters<typeof registerComponentReadinessNotice>[0],
  nextly: ReadinessDirectApi,
  store: unknown,
  rootIds: readonly string[]
): Promise<string[]> {
  const documentFields = blocksFieldsOf(store as never);
  const missing: string[] = [];
  const asked = new Set<string>();
  let frontier = [...rootIds];

  for (let depth = 0; depth < MAX_COMPOSED_DEPTH; depth++) {
    if (frontier.length === 0) break;
    for (const id of frontier) asked.add(id);

    const round = await resolveRound(args, nextly, frontier, documentFields);
    missing.push(...round.missing);
    // The ONE visited guard. An id already asked about is never queued again,
    // which is what makes the walk finite over a component graph that may
    // legally contain a cycle; the depth bound is a second, independent limit
    // rather than the thing keeping it terminating.
    frontier = round.nested.filter(id => !asked.has(id));
  }

  return missing;
}

/**
 * One level of the walk: which of these ids are not live, and what the live
 * ones embed in turn.
 *
 * Split out because the round is a whole question on its own — a batch of ids
 * in, a partition and a next frontier out — and reading it inside the loop
 * meant holding the loop's bookkeeping in mind to see it.
 */
async function resolveRound(
  args: Parameters<typeof registerComponentReadinessNotice>[0],
  nextly: ReadinessDirectApi,
  wanted: readonly string[],
  documentFields: readonly { name: string }[]
): Promise<{ missing: string[]; nested: string[] }> {
  const rows = await publishedRows(nextly, args.componentCollection, wanted);
  const missing: string[] = [];
  const nested = new Set<string>();

  for (const id of wanted) {
    const row = rows.get(id);
    if (row === undefined) {
      missing.push(id);
      continue;
    }
    for (const child of componentsWithin(row, documentFields, args.limits())) {
      nested.add(child);
    }
  }

  return { missing, nested: [...nested] };
}

/** The component ids one stored definition references. */
function componentsWithin(
  row: Record<string, unknown>,
  fields: readonly { name: string }[],
  limits: DocumentLimits
): string[] {
  const found = new Set<string>();
  for (const field of fields) {
    const nodes = (row[field.name] as { nodes?: unknown } | undefined)?.nodes;
    if (!Array.isArray(nodes)) continue;
    for (const id of embeddedComponentIds(nodes, limits)) found.add(id);
  }
  return [...found];
}

/**
 * Which of the wanted ids the store answers for under a PUBLISHED scope.
 *
 * `overrideAccess` because the question is about the document's lifecycle, not
 * about what this caller may read: an author who cannot read a component still
 * needs to be told the page they just published has a hole in it, and judging
 * it by their permissions would answer "missing" for a component that is
 * perfectly live.
 */
async function publishedRows(
  nextly: ReadinessDirectApi,
  collection: string,
  wanted: readonly string[]
): Promise<Map<string, Record<string, unknown>>> {
  const live = new Map<string, Record<string, unknown>>();
  for (const chunk of chunked(wanted, READINESS_BATCH_SIZE)) {
    const page = await nextly.find({
      collection,
      where: { id: { in: [...chunk] } },
      limit: chunk.length,
      status: "published",
      overrideAccess: true,
      depth: 0,
    });
    for (const item of page.items) {
      const row = item as Record<string, unknown> | null;
      const id = row?.id;
      if (typeof id === "string" && row !== null) live.set(id, row);
    }
  }
  return live;
}

/** Successive slices of at most `size`. */
function chunked<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size)
    out.push(items.slice(i, i + size));
  return out;
}

/**
 * The sentence an author reads.
 *
 * States the fact and stops. It offers no action on purpose: publishing the
 * components alongside the page is a separate capability that does not exist
 * yet, and copy that promises an affordance nobody can reach is worse than copy
 * that promises nothing.
 */
function describe(count: number): string {
  return count === 1
    ? "This page embeds 1 component that is not published, so it will not appear for visitors."
    : `This page embeds ${String(count)} components that are not published, so they will not appear for visitors.`;
}
