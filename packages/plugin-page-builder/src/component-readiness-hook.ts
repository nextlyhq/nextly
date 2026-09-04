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
import type { DocumentLimits } from "@nextlyhq/blocks-engine";
import type { HookContext } from "nextly";
import { recordAdvisoryNotice } from "nextly";

import { blocksFieldsOf } from "./class-usage-blocks-fields";
import { embeddedComponentIds, unpublishedAmong } from "./component-readiness";
import { requestContextFor, writeTargetOf } from "./write-target";

/** The phases a document can become published in. */
const PUBLISHING_PHASES = ["afterCreate", "afterUpdate"] as const;

/** The canonical code a consumer branches on. */
export const COMPONENTS_NOT_PUBLISHED_CODE = "COMPONENTS_NOT_PUBLISHED";

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
  const handler = (context: HookContext<unknown>): Promise<void> =>
    report(args, context);
  for (const phase of PUBLISHING_PHASES) {
    args.ctx.hooks.on(phase, "*", handler);
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
  context: HookContext<unknown>
): Promise<void> {
  try {
    const notice = await composeNotice(args, context);
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
  context: HookContext<unknown>
): Promise<Parameters<typeof recordAdvisoryNotice>[0] | null> {
  const target = writeTargetOf<ReadinessDirectApi>(context, {
    // The component store itself is NOT excluded: a component embedding another
    // component has the same hole for the same reason, and an author publishing
    // it wants the same sentence.
    excluded: [],
  });
  if (target === null) return null;
  if (!leavesDocumentPublished(context)) return null;

  const collection = await args.ctx.services.collections.getCollection(
    target.slug,
    requestContextFor(context)
  );
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

  const live = await publishedIds(
    target.nextly,
    args.componentCollection,
    embedded
  );
  const missing = unpublishedAmong(embedded, live);
  if (missing.length === 0) return null;

  return {
    phase: phaseOf(context),
    collection: target.slug,
    code: COMPONENTS_NOT_PUBLISHED_CODE,
    message: describe(missing.length),
    entryId: target.documentId,
  };
}

/**
 * Which phase produced this notice.
 *
 * Read defensively rather than coerced: `type` arrives on a context this module
 * does not own, and stringifying whatever is there would put `[object Object]`
 * in a field a consumer branches on. The registration names the two phases, so
 * an unreadable one falls back to the phase that raised it in every ordinary
 * case rather than to something no consumer recognises.
 */
function phaseOf(context: HookContext<unknown>): string {
  const type = (context as unknown as Record<string, unknown>).type;
  return typeof type === "string" && type.length > 0 ? type : "afterUpdate";
}

/**
 * Whether this write LEAVES the document published.
 *
 * The state the write leaves behind, not the transition into it. The admin
 * sends `status` on every save, so a rule reading a change would fire only on
 * the one save that flipped it — and an author who later drops an unpublished
 * component into an already-live page would be told nothing, which is the case
 * most worth catching.
 */
function leavesDocumentPublished(context: HookContext<unknown>): boolean {
  const data = (context as unknown as Record<string, unknown>).data;
  if (typeof data !== "object" || data === null) return false;
  return (data as { status?: unknown }).status === "published";
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
 * Which of the wanted ids the store answers for under a PUBLISHED scope.
 *
 * `overrideAccess` because the question is about the document's lifecycle, not
 * about what this caller may read: an author who cannot read a component still
 * needs to be told the page they just published has a hole in it, and judging
 * it by their permissions would answer "missing" for a component that is
 * perfectly live.
 */
async function publishedIds(
  nextly: ReadinessDirectApi,
  collection: string,
  wanted: readonly string[]
): Promise<Set<string>> {
  const page = await nextly.find({
    collection,
    where: { id: { in: [...wanted] } },
    limit: wanted.length,
    status: "published",
    overrideAccess: true,
    depth: 0,
  });
  const live = new Set<string>();
  for (const item of page.items) {
    const id = (item as { id?: unknown } | null)?.id;
    if (typeof id === "string") live.add(id);
  }
  return live;
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
