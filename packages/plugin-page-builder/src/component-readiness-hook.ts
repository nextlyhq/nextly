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
import type { BlockDocument, DocumentLimits } from "@nextlyhq/blocks-engine";
import { unsuppliedComponentIds } from "@nextlyhq/blocks-react";
import type { HookContext } from "nextly";
import { recordAdvisoryNotice } from "nextly";

import { blocksFieldsOf } from "./class-usage-blocks-fields";
import {
  AS_THE_SYSTEM,
  asDocument,
  publishedStoreSource,
} from "./component-store-source";
import { areaComponentIds, layoutAreasDocument } from "./layout-areas-document";
import {
  requestContextFor,
  writeTargetOf,
  type WriteTarget,
} from "./write-target";

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
    // Part of this call's SHAPE, so a caller cannot build a read here that
    // omits one and silently inherits the instance's identity.
    user?: undefined;
    req?: undefined;
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
  /**
   * The collections a route actually renders, when a host names them.
   *
   * The hook is registered on the wildcard because the set of collections is
   * not known when a plugin is wired. That is right for finding blocks fields
   * and wrong for claiming what a VISITOR sees: a blocks field on a collection
   * no `createBlocksPage` route renders is content nobody visits, and saying
   * its components "will not appear for visitors" is a claim about a page that
   * does not exist. Left unset every collection with a blocks field is
   * examined, which is the useful default; named, only these are.
   */
  renderedCollections?: readonly string[];
  /**
   * The field on a written PAGE holding the document the route renders, when a
   * host renders one specific field.
   *
   * `createBlocksPage` names the page field it draws, and a collection may
   * declare more than one blocks field. Left unset every blocks field on the
   * written document is examined, which is right for the ordinary collection
   * that has one and wrong for a host that renders a chosen field: an
   * unpublished reference sitting in a field the route never reads would report
   * a page as holed while it draws correctly.
   */
  pageField?: string;
  /**
   * The field on a component row holding its document.
   *
   * Named rather than discovered, because the renderer names it: a route sets
   * `componentField` and reads exactly that one. Traversing every blocks field
   * on the store instead would count a reference in a field nothing renders,
   * and report a page as holed when it draws correctly.
   */
  componentField: string;
  /**
   * The RESOLVED slug Layouts are stored under, when a host has them. A Layout
   * names its area components in a repeater rather than a blocks field, so its
   * writes are read through that repeater; unset, Layouts are not examined.
   */
  layoutCollection?: string;
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
  const subject = await subjectOf(args, context);
  if (subject === null) return null;
  const { target, documents } = subject;

  const store = await args.ctx.services.collections.getCollection(
    args.componentCollection,
    requestContextFor(context)
  );
  if ((store as { localized?: unknown } | null)?.localized === true) {
    return null;
  }

  // ASKED of the render's own discovery rather than derived from a walk of the
  // stored nodes. The two are different questions, and the resolver's docblock
  // says which one is right: reachability is decided after an instance's
  // overrides have chosen a component, under the composition cap, over the tree
  // the repair pass retained. A walk answers before all three, so it names
  // components a visitor never meets — slot content the chosen definition
  // discards, an id an override replaced — and misses ones it does. A
  // condition-gated instance is composed like any other: it shows wherever
  // its conditions hold.
  // `overrideAccess` because the question is about the document's lifecycle,
  // not about what this caller may read: an author who cannot read a component
  // still needs to know their page has a hole, and judging it by their
  // permissions answers "missing" for one that is perfectly live.
  const source = publishedStoreSource(target.nextly, {
    collection: args.componentCollection,
    field: args.componentField,
    reading: AS_THE_SYSTEM,
  });
  const missing = new Set<string>();
  for (const document of documents) {
    for (const id of await unsuppliedComponentIds(
      document,
      source,
      args.limits()
    )) {
      missing.add(id);
    }
  }
  if (missing.size === 0) return null;

  return {
    phase,
    collection: target.slug,
    code: COMPONENTS_NOT_PUBLISHED_CODE,
    // Named for what was actually written. A component definition is kept in
    // scope on purpose — the hole it leaves appears on every page embedding it
    // — and telling its author "this page embeds…" points them at a document
    // they were not editing.
    message: describe(missing.size, subjectNoun(args, target.slug)),
    entryId: target.documentId,
  };
}

/**
 * The write this notice may speak about, and the documents it wrote.
 *
 * Every reason to say nothing is gathered here, so the notice itself reads as
 * one sequence rather than as a decision interleaved with its own preconditions.
 * `null` at any point is "not my business", never an error.
 */
async function subjectOf(
  args: Parameters<typeof registerComponentReadinessNotice>[0],
  context: HookContext<unknown>
): Promise<{
  target: WriteTarget<ReadinessDirectApi>;
  documents: BlockDocument[];
} | null> {
  const target = writeTargetOf<ReadinessDirectApi>(context, {
    // The component store itself is NOT excluded: a component embedding another
    // component has the same hole for the same reason, and an author publishing
    // it wants the same sentence.
    excluded: [],
  });
  if (target === null) return null;
  if (!withinRenderedScope(args, target.slug)) return null;

  const collection = await args.ctx.services.collections.getCollection(
    target.slug,
    requestContextFor(context)
  );
  if (!leavesDocumentPublished(context, collection)) return null;

  const documents =
    target.slug === args.layoutCollection
      ? layoutDocuments(context)
      : writtenDocuments(
          context,
          renderedFields(
            blocksFieldsOf(collection as never),
            fieldFor(args, target.slug)
          )
        );
  return documents.length === 0 ? null : { target, documents };
}

/**
 * Which field holds the document this write is about.
 *
 * A write to the COMPONENT STORE is not a page, and the page field does not
 * describe it: a host whose pages render `layout` while definitions live in
 * `content` would have every component write filtered to a field the store does
 * not declare, so nothing would be examined and a component embedding an
 * unpublished sibling would publish silently — on the one path this hook keeps
 * in scope precisely because the hole it leaves appears on every page that
 * embeds it.
 */
function fieldFor(
  args: Parameters<typeof registerComponentReadinessNotice>[0],
  slug: string
): string | undefined {
  return slug === args.componentCollection
    ? args.componentField
    : args.pageField;
}

/**
 * Whether a route actually serves this collection.
 *
 * The component store stays in scope even when nothing renders it directly: a
 * component embedding an unpublished component is a hole on every page that
 * embeds IT, which is exactly what its author needs to hear.
 */
function withinRenderedScope(
  args: Parameters<typeof registerComponentReadinessNotice>[0],
  slug: string
): boolean {
  if (args.renderedCollections === undefined) return true;
  return (
    args.renderedCollections.includes(slug) ||
    slug === args.componentCollection ||
    slug === args.layoutCollection
  );
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
export function leavesDocumentPublished(
  context: HookContext<unknown>,
  collection: unknown
): boolean {
  const record = collection as {
    status?: unknown;
    localized?: unknown;
  } | null;
  if (record?.status !== true) return false;
  if (record.localized === true) return false;
  const data = (context as unknown as Record<string, unknown>).data;
  if (typeof data !== "object" || data === null) return false;
  const document = data as { status?: unknown; _isWorkingDraft?: unknown };
  if (document._isWorkingDraft === true) return false;
  return document.status === "published";
}

/**
 * The blocks fields whose content the route actually draws.
 *
 * A named field wins and is the only one read. An unknown name reads NOTHING
 * rather than falling back to every field: a host that named a field this
 * collection does not declare has misconfigured one of the two, and examining
 * everything instead would answer a question nobody asked and report holes in
 * fields the route never touches.
 */
function renderedFields(
  fields: readonly { name: string }[],
  pageField: string | undefined
): readonly { name: string }[] {
  if (pageField === undefined) return fields;
  return fields.filter(field => field.name === pageField);
}

/**
 * The block documents this write stored, one per blocks field.
 *
 * Handed over whole rather than reduced to ids here: what a document needs is
 * the resolver's question, and answering it early is the parallel traversal
 * this deliberately does not have.
 */
function writtenDocuments(
  context: HookContext<unknown>,
  fields: readonly { name: string }[]
): BlockDocument[] {
  const data = (context as unknown as Record<string, unknown>).data as
    | Record<string, unknown>
    | undefined;
  const documents: BlockDocument[] = [];
  for (const field of fields) {
    const document = asDocument(data?.[field.name]);
    if (document !== null) documents.push(document);
  }
  return documents;
}

/**
 * A written Layout's areas, as the one document of placements they are.
 * None when its areas name no component.
 */
function layoutDocuments(context: HookContext<unknown>): BlockDocument[] {
  const data = (context as unknown as Record<string, unknown>).data as
    | Record<string, unknown>
    | undefined;
  const components = areaComponentIds(data?.areas);
  return components.length === 0 ? [] : [layoutAreasDocument(components)];
}

/** What the written document is, in the sentence's words. */
function subjectNoun(
  args: Parameters<typeof registerComponentReadinessNotice>[0],
  slug: string
): "page" | "component" | "Layout" {
  if (slug === args.componentCollection) return "component";
  if (slug === args.layoutCollection) return "Layout";
  return "page";
}

/**
 * The sentence an author reads.
 *
 * States the fact and stops. The offer to publish the components too is made
 * by the editor and the form BEFORE a publish; this is said after it, to every
 * writer, the API's included, so it names no action only one of them has.
 */
function describe(
  count: number,
  subject: "page" | "component" | "Layout"
): string {
  const noun = count === 1 ? "1 component" : `${String(count)} components`;
  const tail =
    count === 1
      ? "that is not published, so it will not appear for visitors."
      : "that are not published, so they will not appear for visitors.";
  return `This ${subject} embeds ${noun} ${tail}`;
}
