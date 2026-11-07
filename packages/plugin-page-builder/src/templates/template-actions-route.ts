/**
 * `POST /templates/actions`: the actions an author takes on a collection's
 * template, offered to an API client one at a time, each with a dry run.
 *
 * - **create-template** gives a collection its template: an empty template
 *   document, a draft unless `publish` is set. Refused when the collection
 *   cannot have one, or already has one, naming it.
 * - **publish-template** publishes a template, its working draft included,
 *   as the editor's Publish does.
 * - **delete-template** deletes a template by id, a collection's or an
 *   entry's own design; its dry run answers which, so the admin can say what
 *   the delete means before it is confirmed.
 * - **set-template-address** sets, changes or removes the address a
 *   collection's entries are served at, stored on its template. The routing
 *   permission is asked before anything else; the address is then judged in
 *   the guard's own words. A published template's entries move as the write
 *   commits, and the answer says how many wait for an address another
 *   document holds.
 *
 * Each is checked and written as the caller. Nothing here decides what the
 * site accepts that its own write path decides already: the write is judged
 * by core's rights and the templates collection's guard, exactly as an
 * admin save is, and a dry run makes that write and rolls it back (see
 * `judged-writes`). What this route adds before writing are the caller's
 * rights, asked first, and the same eligibility and holder checks the guard
 * makes, so an apply refuses up front, in the same words, what the write
 * would refuse; and, when two creates race past those checks to the unique
 * index, the name of the template that won.
 *
 * @experimental Settles when collection templates ship.
 * @module templates/template-actions-route
 */
import {
  templateActionJsonSchema,
  templateActionSchema,
} from "@nextlyhq/builder/ops";
import {
  getCachedNextly,
  NextlyError,
  readableTitleText,
  respondMutation,
  type PluginCollectionTransaction,
  type PluginRouteContext,
} from "@nextlyhq/plugin-sdk";
import { z } from "nextly/zod";

import {
  entryDesignKey,
  TEMPLATE_COLLECTION_FIELD,
  TEMPLATE_CONTENT_FIELD,
  TEMPLATE_ENTRY_COLLECTION_FIELD,
  TEMPLATE_ENTRY_FIELD,
  TEMPLATE_ENTRY_ID_FIELD,
  TEMPLATE_FORKED_FROM_FIELD,
} from "../collections/templates";
import {
  actingCaller,
  asCaller,
  parsedWith,
  readJsonBody,
  readOrNull,
  requestJsonSchema,
  type ActionAnswer,
  type CompositionRouteContext,
} from "../composition-route-kit";
import {
  asOverwrite,
  documentVersionOf,
  withVersionFrom,
} from "../document-version";
import { titleFieldIn } from "../entries-route";
import { emptyBlockDocument } from "../fields/blocks-document";
import { JUDGEMENT_CONTEXT, judgeInTransaction } from "../judged-writes";
import { readingAsUser } from "../library-route";

import {
  TEMPLATE_ACTIONS_ROUTE_PATH,
  TEMPLATE_ROUTING_ROUTE_PATH,
  type TemplateAction,
  type TemplateActionRequest,
  type TemplateActionResult,
  type TemplateRoutingAccess,
  type TemplateSummary,
} from "./template-actions-contract";
import {
  addressCollectionProblem,
  addressHolderProblem,
  ASKED_BEFORE_CONTEXT,
  secondTemplateRefusal,
  templateCollectionProblem,
  type MayReadTemplate,
  type TemplateGuardSetup,
} from "./template-guard";
import {
  addressRefusal,
  heldAddressMessage,
  storedAddressOf,
  storedAddressProblem,
  TEMPLATE_ADDRESS_FIELD,
  TEMPLATE_ROUTING_ASK,
} from "./template-routing";

/**
 * The request around the action. The action itself is parsed by the
 * builder's published schema, so the route and any client validating against
 * `@nextlyhq/builder/ops` refuse the same actions.
 */
const TemplateActionEnvelope = z.strictObject({
  action: z.unknown(),
  dryRun: z.boolean().optional(),
});

/** The JSON Schema of a template action request, as the route parses it. */
export function templateActionRequestJsonSchema(): Record<string, unknown> {
  return requestJsonSchema(TemplateActionEnvelope, templateActionJsonSchema());
}

/**
 * A template action request read from outside input: a route body, or what a
 * caller of the service passed. Refused with the path of each problem.
 */
export function templateActionRequestOf(raw: unknown): TemplateActionRequest {
  const envelope = parsedWith(raw, TemplateActionEnvelope);
  return {
    action: parsedWith(envelope.action, templateActionSchema, "action"),
    ...(envelope.dryRun === undefined ? {} : { dryRun: envelope.dryRun }),
  };
}

/** The context the template actions run with. */
export type TemplateActionsContext = CompositionRouteContext & {
  services: {
    collections: Pick<
      PluginRouteContext["services"]["collections"],
      "getCollection" | "deleteEntry" | "deleteEntryInTransaction"
    >;
  };
};

/**
 * What the template actions are built with: the guard's own lookups, so the
 * route asks the questions the write's guard asks with the same functions.
 * Resolved per call, since they need the installed plugin.
 */
export interface TemplateActionsSetup {
  readonly guard: () => TemplateGuardSetup;
  /**
   * How many of `collection`'s entries wait for an address another document
   * holds, as last committed.
   */
  readonly waitingEntries: (collection: string) => Promise<number>;
}

/** Run one template action, for the route and the service alike. */
export async function runTemplateAction(
  ctx: TemplateActionsContext,
  request: TemplateActionRequest,
  setup: TemplateActionsSetup
): Promise<ActionAnswer<TemplateActionResult>> {
  const guard = setup.guard();
  const action = request.action;
  const dryRun = request.dryRun === true;
  switch (action.kind) {
    case "create-template":
      return createTemplate(ctx, action, dryRun, guard);
    case "publish-template":
      return publishTemplate(ctx, action, dryRun, guard);
    case "give-entry-design":
      return giveEntryDesign(ctx, action, dryRun, guard);
    case "remove-entry-design":
      return removeEntryDesign(ctx, action, dryRun, guard);
    case "delete-template":
      return deleteTemplate(ctx, action, dryRun, guard);
    case "set-template-address":
      return setTemplateAddress(ctx, action, dryRun, guard, setup);
  }
}

/**
 * The where filter the Direct API's `find` takes, read off the plugin SDK's
 * own handle to it, so the plugin names no core query type.
 */
type FindWhere = NonNullable<
  Parameters<Awaited<ReturnType<typeof getCachedNextly>>["find"]>[0]["where"]
>;

/** One stored template found as the system, in any state, or `null`. */
async function templateWhere(
  templates: string,
  where: FindWhere,
  status: "all" | "published"
): Promise<Record<string, unknown> | null> {
  const found = await (
    await getCachedNextly()
  ).find({
    collection: templates,
    where,
    limit: 1,
    overrideAccess: true,
    status,
    depth: 0,
  });
  return recordOf(found.items[0]);
}

/**
 * `give-entry-design`: copy the collection's published template into a new
 * draft that names the entry. The entry is read as the caller, so a caller
 * who may not see it learns nothing of it here.
 */
async function giveEntryDesign(
  ctx: TemplateActionsContext,
  action: Extract<TemplateAction, { kind: "give-entry-design" }>,
  dryRun: boolean,
  guard: TemplateGuardSetup
): Promise<ActionAnswer<TemplateActionResult>> {
  const templates = guard.templatesCollection;
  const by = await actingCaller(ctx, [["create", templates]], {
    anyEntry: true,
  });
  const title = await designTitle(ctx, action);
  const asked: TemplateSummary = {
    title,
    collection: action.collection,
    entry: action.entry,
    status: "draft",
  };
  const key = entryDesignKey(action.collection, action.entry);
  const base = await designSource(action.collection, key, guard);
  if (base instanceof NextlyError) {
    if (!dryRun) throw base;
    return dryRunAnswer("give-entry-design", asked, refusalMessages(base), by);
  }
  const data = {
    title,
    [TEMPLATE_ENTRY_FIELD]: key,
    [TEMPLATE_ENTRY_COLLECTION_FIELD]: action.collection,
    [TEMPLATE_ENTRY_ID_FIELD]: action.entry,
    [TEMPLATE_FORKED_FROM_FIELD]: idOf(base) ?? null,
    [TEMPLATE_CONTENT_FIELD]: base[TEMPLATE_CONTENT_FIELD],
  };
  if (dryRun) {
    const collections = ctx.services.collections;
    const judged = await judgeInTransaction(
      run => collections.withTransaction(run),
      (tx: PluginCollectionTransaction) =>
        collections.createEntryInTransaction(tx, templates, data, {
          ...asCaller(ctx),
          context: { [JUDGEMENT_CONTEXT]: true },
        })
    );
    return judged.refusal === null
      ? dryRunAnswer(
          "give-entry-design",
          summaryOf(judged.written.item, asked),
          [],
          by
        )
      : dryRunAnswer("give-entry-design", asked, judged.refusal.messages, by);
  }
  const created = await createDesign(ctx, action, data, key, guard);
  return {
    message: "The entry was given its own design.",
    item: {
      dryRun: false,
      kind: "give-entry-design",
      template: summaryOf(created, asked),
      refusals: [],
      by,
    },
  };
}

/**
 * The own design's name: the one the action gives, or its entry's title. The
 * entry is read as the caller, its id and title field alone, and a caller who
 * may not read it is answered not found.
 */
async function designTitle(
  ctx: TemplateActionsContext,
  action: Extract<TemplateAction, { kind: "give-entry-design" }>
): Promise<string> {
  const titleField =
    action.title === undefined
      ? await titleFieldOf(ctx, action.collection)
      : null;
  const entry = await entryAsCaller(
    ctx,
    action.collection,
    action.entry,
    titleField
  );
  if (entry === null) {
    throw NextlyError.notFound({
      logContext: { reason: "entry-design-missing-entry" },
    });
  }
  return action.title ?? entryTitle(entry, titleField, action.entry);
}

/**
 * The template an own design for the entry keyed `key` is copied from, its
 * published state, or the refusal of giving one: a collection that may not
 * have a template, an entry that already has its own design, or no published
 * template to copy.
 */
async function designSource(
  collection: string,
  key: string,
  guard: TemplateGuardSetup
): Promise<Record<string, unknown> | NextlyError> {
  const templates = guard.templatesCollection;
  const problem = await templateCollectionProblem(
    collection,
    guard.readCollection,
    guard.ownCollections()
  );
  if (problem !== null) return refusedAction([problem]);
  const held = await templateWhere(
    templates,
    { [TEMPLATE_ENTRY_FIELD]: { equals: key } },
    "all"
  );
  if (held !== null) return alreadyHasDesign(held);
  // The copy is of the template as visitors see it: its published state.
  const base = await templateWhere(
    templates,
    { [TEMPLATE_COLLECTION_FIELD]: { equals: collection } },
    "published"
  );
  return (
    base ??
    refusedAction([
      `The collection "${collection}" has no published template to copy. Publish its template first.`,
    ])
  );
}

/**
 * Create the own design, under the entry's lock, which deleting the entry
 * takes too, and check once it has committed that the entry is still there:
 * a delete that held the lock first has committed by then, and the design
 * made after it is removed. Two gives meet at the unique key; the one that
 * loses is told the entry has one now.
 */
async function createDesign(
  ctx: TemplateActionsContext,
  action: Extract<TemplateAction, { kind: "give-entry-design" }>,
  data: Record<string, unknown>,
  key: string,
  guard: TemplateGuardSetup
): Promise<unknown> {
  const templates = guard.templatesCollection;
  const collections = ctx.services.collections;
  // An in-transaction write answers the stored entry itself, not the
  // mutation envelope a write outside a transaction answers.
  let created: unknown;
  try {
    created = await collections.withTransaction(async tx => {
      await guard.lockEntry(tx, action.collection, action.entry);
      return collections.createEntryInTransaction(tx, templates, data, {
        ...asCaller(ctx),
        context: { [ASKED_BEFORE_CONTEXT]: true },
      });
    });
  } catch (error) {
    if (!NextlyError.isCode(error, "DUPLICATE")) throw error;
    const winner = await templateWhere(
      templates,
      { [TEMPLATE_ENTRY_FIELD]: { equals: key } },
      "all"
    );
    if (winner === null) throw error;
    throw alreadyHasDesign(winner);
  }
  if (!(await guard.entryExists(action.collection, action.entry))) {
    const id = idOf(created);
    if (id !== undefined) {
      await collections.deleteEntry(templates, id, { as: "system" });
    }
    throw NextlyError.notFound({
      logContext: { reason: "entry-design-entry-deleted" },
    });
  }
  await unlinkIfSourceGone(ctx, data, created, guard);
  return created;
}

/**
 * Empty the new design's link to the template it was copied from when that
 * template was deleted while the copy was being made: the delete emptied the
 * link of every copy it found, and this one was not yet there to find.
 */
async function unlinkIfSourceGone(
  ctx: TemplateActionsContext,
  data: Record<string, unknown>,
  item: unknown,
  guard: TemplateGuardSetup
): Promise<void> {
  const source = data[TEMPLATE_FORKED_FROM_FIELD];
  const id = idOf(item);
  if (typeof source !== "string" || id === undefined) return;
  const templates = guard.templatesCollection;
  const stillThere = await templateWhere(
    templates,
    { id: { equals: source } },
    "all"
  );
  if (stillThere !== null) return;
  await ctx.services.collections.updateEntry(
    templates,
    id,
    asOverwrite({ [TEMPLATE_FORKED_FROM_FIELD]: null }),
    { as: "system" }
  );
}

/** The refusal of a second own design for an entry, naming the first by id. */
function alreadyHasDesign(held: Record<string, unknown>): NextlyError {
  return NextlyError.conflict({
    reason: "state",
    message: `This entry already has its own design (${idOf(held) ?? "unknown"}). Edit that one, or remove it first.`,
    logContext: { reason: "second-entry-design", holder: idOf(held) },
  });
}

/**
 * `remove-entry-design`: delete the entry's own design, as the caller, so
 * the entry is drawn with its collection's template again.
 */
async function removeEntryDesign(
  ctx: TemplateActionsContext,
  action: Extract<TemplateAction, { kind: "remove-entry-design" }>,
  dryRun: boolean,
  guard: TemplateGuardSetup
): Promise<ActionAnswer<TemplateActionResult>> {
  const templates = guard.templatesCollection;
  const by = await actingCaller(ctx, [["delete", templates]], {
    anyEntry: true,
  });
  // The entry read as the caller first, as giving one a design reads it: a
  // caller who may not read the entry learns nothing of its design, and
  // removes none.
  if (
    (await entryAsCaller(ctx, action.collection, action.entry, null)) === null
  ) {
    throw NextlyError.notFound({
      logContext: { reason: "entry-design-missing-entry" },
    });
  }
  const held = await templateWhere(
    templates,
    {
      [TEMPLATE_ENTRY_FIELD]: {
        equals: entryDesignKey(action.collection, action.entry),
      },
    },
    "all"
  );
  const id = held === null ? undefined : idOf(held);
  if (held === null || id === undefined) {
    throw NextlyError.notFound({
      logContext: { reason: "entry-design-missing" },
    });
  }
  const asked = summaryOf(held, {
    title: "",
    collection: action.collection,
    entry: action.entry,
    status: "draft",
  });
  const collections = ctx.services.collections;
  if (dryRun) {
    const judged = await judgeInTransaction(
      run => collections.withTransaction(run),
      (tx: PluginCollectionTransaction) =>
        collections.deleteEntryInTransaction(tx, templates, id, {
          ...asCaller(ctx),
          context: { [JUDGEMENT_CONTEXT]: true },
        })
    );
    return dryRunAnswer(
      "remove-entry-design",
      asked,
      judged.refusal === null ? [] : judged.refusal.messages,
      by
    );
  }
  await collections.deleteEntry(templates, id, asCaller(ctx));
  return {
    message: "The entry's own design was removed.",
    item: {
      dryRun: false,
      kind: "remove-entry-design",
      template: asked,
      refusals: [],
      by,
    },
  };
}

/**
 * `delete-template`: delete one template, as the caller. A collection's
 * template takes its collection's entries off the site, but for those with
 * their own design; an own design returns its entry to the template. The row
 * is read as the caller first, so a caller who may not see it learns nothing
 * of it, and its summary says which it is.
 */
async function deleteTemplate(
  ctx: TemplateActionsContext,
  action: Extract<TemplateAction, { kind: "delete-template" }>,
  dryRun: boolean,
  guard: TemplateGuardSetup
): Promise<ActionAnswer<TemplateActionResult>> {
  const templates = guard.templatesCollection;
  // Preconditions first: the right to delete templates at all, then whether
  // the caller may read this one.
  const by = await actingCaller(ctx, [["delete", templates]], {
    anyEntry: true,
  });
  const row = recordOf(
    await readOrNull(async () =>
      (await getCachedNextly()).findByID({
        collection: templates,
        id: action.id,
        ...(await readingAsUser(ctx)),
        status: "all",
        depth: 0,
      })
    )
  );
  if (row === null) {
    throw NextlyError.notFound({
      logContext: { reason: "template-action-missing-template" },
    });
  }
  // An own design names its entry, so it is deleted only by a caller who may
  // read that entry, as `remove-entry-design` asks: one who may not is told
  // nothing of the design, the dry run included.
  const entryCollection = row[TEMPLATE_ENTRY_COLLECTION_FIELD];
  const entryId = row[TEMPLATE_ENTRY_ID_FIELD];
  if (
    typeof entryCollection === "string" &&
    entryCollection !== "" &&
    typeof entryId === "string" &&
    entryId !== "" &&
    (await entryAsCaller(ctx, entryCollection, entryId, null)) === null
  ) {
    throw NextlyError.notFound({
      logContext: { reason: "template-action-missing-template" },
    });
  }
  const asked = summaryOf(row, {
    id: action.id,
    title: "",
    collection: "",
    status: "draft",
  });
  const collections = ctx.services.collections;
  if (dryRun) {
    const judged = await judgeInTransaction(
      run => collections.withTransaction(run),
      (tx: PluginCollectionTransaction) =>
        collections.deleteEntryInTransaction(tx, templates, action.id, {
          ...asCaller(ctx),
          context: { [JUDGEMENT_CONTEXT]: true },
        })
    );
    return dryRunAnswer(
      "delete-template",
      asked,
      judged.refusal === null ? [] : judged.refusal.messages,
      by
    );
  }
  await collections.deleteEntry(templates, action.id, asCaller(ctx));
  return {
    message: "The template was deleted.",
    item: {
      dryRun: false,
      kind: "delete-template",
      template: asked,
      refusals: [],
      by,
    },
  };
}

/**
 * The entry `id` of `collection` as the caller may read it, with its id and
 * `titleField` alone, or null where the caller may not.
 */
async function entryAsCaller(
  ctx: TemplateActionsContext,
  collection: string,
  id: string,
  titleField: string | null
): Promise<Record<string, unknown> | null> {
  return recordOf(
    await readOrNull(async () =>
      (await getCachedNextly()).findByID({
        collection,
        id,
        ...(await readingAsUser(ctx)),
        status: "all",
        depth: 0,
        select:
          titleField === null ? { id: true } : { id: true, [titleField]: true },
      })
    )
  );
}

/** The field `collection` names its entries by, or "title" where it says none. */
async function titleFieldOf(
  ctx: TemplateActionsContext,
  collection: string
): Promise<string> {
  const record = recordOf(
    await readOrNull(() =>
      ctx.services.collections.getCollection(collection, undefined as never)
    )
  );
  return record === null ? "title" : (titleFieldIn(record)?.name ?? "title");
}

/**
 * An own design's default name: its entry's title, read from `field`, or
 * the entry's id where it has none.
 */
function entryTitle(
  entry: Record<string, unknown>,
  field: string | null,
  id: string
): string {
  const title =
    (field === null ? undefined : readableTitleText(entry[field])) ?? id;
  return [...title].slice(0, TITLE_MAX).join("").trimEnd();
}

/** `create-template`, as the module docblock describes. */
async function createTemplate(
  ctx: TemplateActionsContext,
  action: Extract<TemplateAction, { kind: "create-template" }>,
  dryRun: boolean,
  guard: TemplateGuardSetup
): Promise<ActionAnswer<TemplateActionResult>> {
  const templates = guard.templatesCollection;
  const publishes = action.publish === true;
  // Preconditions first, before anything about the collection is read: a
  // caller who may not create templates learns nothing from this route.
  // Asked of any entry: a create rule that limits which templates the caller
  // may make is the write's to apply, made as the caller with the data.
  const by = await actingCaller(
    ctx,
    [
      ["create", templates],
      ...(publishes ? ([["publish", templates]] as const) : []),
    ],
    { anyEntry: true }
  );

  const title = action.title ?? (await defaultTitle(ctx, action.collection));
  const asked: TemplateSummary = {
    title,
    collection: action.collection,
    status: publishes ? "published" : "draft",
  };

  // The guard's own questions, asked up front so an apply refuses before
  // writing, and a dry run answers them as refusals rather than as an error.
  const mayRead = mayReadAsCaller(ctx, templates);
  const problem = await templateCollectionProblem(
    action.collection,
    guard.readCollection,
    guard.ownCollections()
  );
  const held =
    problem === null ? await guard.holderOf(action.collection) : null;
  const refusal =
    problem !== null
      ? refusedAction([problem])
      : held === null
        ? null
        : await secondTemplateRefusal(action.collection, held, mayRead);
  if (refusal !== null) {
    if (!dryRun) throw refusal;
    return dryRunAnswer("create-template", asked, refusalMessages(refusal), by);
  }

  const data = {
    title,
    [TEMPLATE_COLLECTION_FIELD]: action.collection,
    [TEMPLATE_CONTENT_FIELD]: emptyBlockDocument(["template"]),
    ...(publishes ? { status: "published" } : {}),
  };

  if (dryRun) {
    const collections = ctx.services.collections;
    const judged = await judgeInTransaction(
      run => collections.withTransaction(run),
      (tx: PluginCollectionTransaction) =>
        collections.createEntryInTransaction(tx, templates, data, {
          ...asCaller(ctx),
          context: { [JUDGEMENT_CONTEXT]: true },
        })
    );
    return judged.refusal === null
      ? dryRunAnswer(
          "create-template",
          summaryOf(judged.written.item, asked),
          [],
          by
        )
      : dryRunAnswer("create-template", asked, judged.refusal.messages, by);
  }

  let created: { item: unknown };
  try {
    created = await ctx.services.collections.createEntry(
      templates,
      data,
      asCaller(ctx)
    );
  } catch (error) {
    // Two creates that both passed the holder check above meet at the unique
    // index, and the one that loses is refused there with no name. The
    // winner has committed by then, so it is read and named.
    if (!NextlyError.isCode(error, "DUPLICATE")) throw error;
    const winner = await guard.holderOf(action.collection);
    if (winner === null) throw error;
    throw await secondTemplateRefusal(action.collection, winner, mayRead);
  }
  return {
    message: "The template was created.",
    item: {
      dryRun: false,
      kind: "create-template",
      template: summaryOf(created.item, asked),
      refusals: [],
      by,
    },
  };
}

/** `publish-template`, as the module docblock describes. */
async function publishTemplate(
  ctx: TemplateActionsContext,
  action: Extract<TemplateAction, { kind: "publish-template" }>,
  dryRun: boolean,
  guard: TemplateGuardSetup
): Promise<ActionAnswer<TemplateActionResult>> {
  const templates = guard.templatesCollection;
  // Asked of any template: whether the caller may publish THIS one is the
  // write's to decide, made as the caller against the row. Reading it is
  // asked too, since the action reads the template it publishes as the
  // caller, to send its version back with the write.
  const by = await actingCaller(
    ctx,
    [
      ["read", templates],
      ["publish", templates],
    ],
    { anyEntry: true }
  );
  const stored = await readOrNull(async () =>
    (await getCachedNextly()).findByID({
      collection: templates,
      id: action.id,
      ...(await readingAsUser(ctx)),
      status: "all",
      depth: 0,
    })
  );
  const row = recordOf(stored);
  if (row === null) {
    throw NextlyError.notFound({
      logContext: { reason: "template-action-missing-template" },
    });
  }
  const asked = summaryOf(row, {
    title: "",
    collection: "",
    status: "published",
  });
  // Status alone, so the write is a publish and is judged by the publish
  // right rather than as an edit, and promotes the working draft as the
  // editor's Publish does. It carries the version it was read at, so a save
  // someone made since is refused rather than published unseen.
  const data = withVersionFrom({ status: "published" }, documentVersionOf(row));
  const collections = ctx.services.collections;
  if (dryRun) {
    const judged = await judgeInTransaction(
      run => collections.withTransaction(run),
      (tx: PluginCollectionTransaction) =>
        collections.updateEntryInTransaction(tx, templates, action.id, data, {
          ...asCaller(ctx),
          context: { [JUDGEMENT_CONTEXT]: true },
        })
    );
    return judged.refusal === null
      ? dryRunAnswer(
          "publish-template",
          summaryOf(judged.written.item, asked),
          [],
          by
        )
      : dryRunAnswer("publish-template", asked, judged.refusal.messages, by);
  }
  const published = await collections.updateEntry(
    templates,
    action.id,
    data,
    asCaller(ctx)
  );
  return {
    message: "The template was published.",
    item: {
      dryRun: false,
      kind: "publish-template",
      template: summaryOf(published.item, asked),
      refusals: [],
      by,
    },
  };
}

/** `set-template-address`, as the module docblock describes. */
async function setTemplateAddress(
  ctx: TemplateActionsContext,
  action: Extract<TemplateAction, { kind: "set-template-address" }>,
  dryRun: boolean,
  guard: TemplateGuardSetup,
  setup: TemplateActionsSetup
): Promise<ActionAnswer<TemplateActionResult>> {
  const templates = guard.templatesCollection;
  // The routing permission before anything is read: a caller who may not
  // change routing learns nothing about templates or addresses here. Then
  // the template rights, asked of any template, since the write made as the
  // caller decides whether this one may be changed.
  await actingCaller(ctx, [TEMPLATE_ROUTING_ASK]);
  const by = await actingCaller(
    ctx,
    [
      ["read", templates],
      ["update", templates],
    ],
    { anyEntry: true }
  );
  // An emptied address is none, as the guard reads one.
  const address = action.address === "" ? null : action.address;
  const row = await templateWithDraft(ctx, templates, action.id);
  const collection = row[TEMPLATE_COLLECTION_FIELD];
  const asked: TemplateSummary = {
    ...summaryOf(row, { title: "", collection: "", status: "draft" }),
    address,
  };
  const refusals = await addressRefusals(guard, row, address);
  if (refusals.length > 0) {
    if (!dryRun) throw addressRefusal(refusals[0] ?? "");
    return dryRunAnswer("set-template-address", asked, refusals, by);
  }

  // Written to the live template: a status-less save of a published one
  // would be held as a working draft, serving nothing until a publish. It
  // carries the version it was read at, so a save someone made since is
  // refused rather than overwritten.
  const data = withVersionFrom(
    {
      [TEMPLATE_ADDRESS_FIELD]: address,
      ...(row.status === "published" ? { status: "published" } : {}),
    },
    documentVersionOf(row)
  );
  if (dryRun) {
    return dryRunAddress(ctx, templates, action.id, data, asked, by);
  }
  const written = await writeAddress(ctx, guard, action.id, data, address);
  return {
    message:
      address === null
        ? "The template's address was removed."
        : "The template's address was set.",
    item: {
      dryRun: false,
      kind: "set-template-address",
      template: summaryOf(written, asked),
      refusals: [],
      by,
      ...(await waitingAfter(setup, collection)),
    },
  };
}

/**
 * How many of `collection`'s entries wait, for the answer to a write that
 * has committed: a read that fails then leaves the count out rather than
 * reporting the write as failed.
 */
async function waitingAfter(
  setup: TemplateActionsSetup,
  collection: unknown
): Promise<{ waiting?: number }> {
  if (typeof collection !== "string") return {};
  try {
    return { waiting: await setup.waitingEntries(collection) };
  } catch {
    return {};
  }
}

/**
 * Template `id` as the caller reads it, with its working draft, which a
 * caller who may update templates is shown: the read says whether the
 * template holds unpublished changes, which writing its address would
 * otherwise put live.
 */
async function templateWithDraft(
  ctx: TemplateActionsContext,
  templates: string,
  id: string
): Promise<Record<string, unknown>> {
  const stored = await readOrNull(async () =>
    (await getCachedNextly()).findByID({
      collection: templates,
      id,
      ...(await readingAsUser(ctx)),
      status: "all",
      draft: true,
      depth: 0,
    })
  );
  const row = recordOf(stored);
  if (row === null) {
    throw NextlyError.notFound({
      logContext: { reason: "template-action-missing-template" },
    });
  }
  return row;
}

/**
 * Why `row` cannot be given `address`, in the guard's own words, asked up
 * front so an apply refuses before writing and a dry run answers them as
 * refusals; empty when nothing refuses it.
 */
async function addressRefusals(
  guard: TemplateGuardSetup,
  row: Record<string, unknown>,
  address: string | null
): Promise<string[]> {
  const refusals: string[] = [];
  if (address !== null) {
    const problem = await addressProblem(guard, row, address);
    if (problem !== null) refusals.push(problem);
  }
  // A published template's address goes live by publishing the template,
  // which would also put its unpublished design changes live unseen.
  if (row.status === "published" && row._isWorkingDraft === true) {
    refusals.push(
      "This template has unpublished changes. Publish or discard them first, so changing its address puts nothing else live."
    );
  }
  return refusals;
}

/** The first of the guard's refusals of `address` on `row`, or null. */
async function addressProblem(
  guard: TemplateGuardSetup,
  row: Record<string, unknown>,
  address: string
): Promise<string | null> {
  const collection = row[TEMPLATE_COLLECTION_FIELD];
  const problem =
    addressHolderProblem(row) ??
    storedAddressProblem(address, collection, {
      declared: guard.declaredAddresses,
    }) ??
    (await addressCollectionProblem(guard, collection));
  if (problem !== null) return problem;
  const holder = await guard.addressHolderOf(address);
  return holder !== null && holder.id !== idOf(row)
    ? heldAddressMessage(address, holder)
    : null;
}

/** A dry run of the address's write: made as the caller, then rolled back. */
async function dryRunAddress(
  ctx: TemplateActionsContext,
  templates: string,
  id: string,
  data: Record<string, unknown>,
  asked: TemplateSummary,
  by: TemplateActionResult["by"]
): Promise<ActionAnswer<TemplateActionResult>> {
  const collections = ctx.services.collections;
  const judged = await judgeInTransaction(
    run => collections.withTransaction(run),
    (tx: PluginCollectionTransaction) =>
      collections.updateEntryInTransaction(tx, templates, id, data, {
        ...asCaller(ctx),
        context: { [JUDGEMENT_CONTEXT]: true },
      })
  );
  return judged.refusal === null
    ? dryRunAnswer(
        "set-template-address",
        summaryOf(judged.written.item, asked),
        [],
        by
      )
    : dryRunAnswer("set-template-address", asked, judged.refusal.messages, by);
}

/**
 * Write the address as the caller, answering the template as stored. Two
 * templates given one address at once both pass the reads before it and meet
 * at the unique index, which names nobody; the winner has committed by then,
 * so it is read and named.
 */
async function writeAddress(
  ctx: TemplateActionsContext,
  guard: TemplateGuardSetup,
  id: string,
  data: Record<string, unknown>,
  address: string | null
): Promise<unknown> {
  try {
    return (
      await ctx.services.collections.updateEntry(
        guard.templatesCollection,
        id,
        data,
        asCaller(ctx)
      )
    ).item;
  } catch (error) {
    if (address === null || !NextlyError.isCode(error, "DUPLICATE")) {
      throw error;
    }
    const winner = await guard.addressHolderOf(address);
    if (winner === null) throw error;
    throw addressRefusal(heldAddressMessage(address, winner));
  }
}

/** A dry run's answer: the template as it would be stored, or why not. */
function dryRunAnswer(
  kind: TemplateAction["kind"],
  template: TemplateSummary,
  refusals: readonly string[],
  by: TemplateActionResult["by"]
): ActionAnswer<TemplateActionResult> {
  return {
    message:
      refusals.length === 0
        ? "Nothing was written: this is what the action would do."
        : "Nothing was written: the site would refuse this action.",
    item: { dryRun: true, kind, template, refusals, by },
  };
}

/** Every message a refusal carries, in the words it gave them. */
function refusalMessages(error: NextlyError): string[] {
  const listed = recordOf(error.publicData)?.errors;
  const messages = Array.isArray(listed)
    ? listed
        .map(item => recordOf(item)?.message)
        .filter((message): message is string => typeof message === "string")
    : [];
  return messages.length > 0 ? messages : [error.publicMessage];
}

/** A template's address as stored, or as asked where the row holds none. */
function summaryAddress(
  stored: Record<string, unknown> | null,
  asked: TemplateSummary
): string | null | undefined {
  return stored !== null && TEMPLATE_ADDRESS_FIELD in stored
    ? storedAddressOf(stored[TEMPLATE_ADDRESS_FIELD])
    : asked.address;
}

/**
 * A template as the write stored it, or would have: its row's own values
 * where it has them, after every hook, and what was asked where it has not.
 */
function summaryOf(row: unknown, asked: TemplateSummary): TemplateSummary {
  const stored = recordOf(row);
  const id = idOf(stored);
  const title = stored?.title;
  // An own design names no collection; it is reported under its entry's.
  const collection =
    stored?.[TEMPLATE_COLLECTION_FIELD] ??
    stored?.[TEMPLATE_ENTRY_COLLECTION_FIELD];
  const entry = stored?.[TEMPLATE_ENTRY_ID_FIELD];
  const status = stored?.status;
  const address = summaryAddress(stored, asked);
  return {
    ...(id === undefined
      ? asked.id === undefined
        ? {}
        : { id: asked.id }
      : { id }),
    title: typeof title === "string" ? title : asked.title,
    collection: typeof collection === "string" ? collection : asked.collection,
    ...(typeof entry === "string"
      ? { entry }
      : asked.entry === undefined
        ? {}
        : { entry: asked.entry }),
    status:
      status === "published" || status === "draft" ? status : asked.status,
    ...(address === undefined ? {} : { address }),
  };
}

/**
 * Whether the caller may read template `id`, through core's read access as
 * the caller, so a refusal names a template by its title only to someone
 * who may open it.
 */
function mayReadAsCaller(
  ctx: TemplateActionsContext,
  templates: string
): MayReadTemplate {
  return async id =>
    (await readOrNull(async () =>
      (await getCachedNextly()).findByID({
        collection: templates,
        id,
        ...(await readingAsUser(ctx)),
        status: "all",
        depth: 0,
      })
    )) !== null;
}

/** The longest title a template action takes or makes. */
const TITLE_MAX = 255;

/** What a default title adds after the collection's name. */
const TITLE_SUFFIX = " template";

/**
 * A new template's name when the action gives none: after its collection,
 * held to the length a given title is, so a long collection label is cut
 * rather than stored differently on each dialect.
 */
async function defaultTitle(
  ctx: TemplateActionsContext,
  collection: string
): Promise<string> {
  const record = recordOf(
    await readOrNull(() =>
      ctx.services.collections.getCollection(collection, undefined as never)
    )
  );
  const labels = recordOf(record?.labels);
  const singular =
    typeof labels?.singular === "string" && labels.singular.trim() !== ""
      ? labels.singular.trim()
      : collection;
  return `${[...singular]
    .slice(0, TITLE_MAX - TITLE_SUFFIX.length)
    .join("")
    .trimEnd()}${TITLE_SUFFIX}`;
}

/** A refusal of the action as a whole, with the reasons given. */
function refusedAction(messages: readonly string[]): NextlyError {
  return new NextlyError({
    code: "BUSINESS_RULE_VIOLATION",
    publicMessage:
      "The action cannot be applied as it stands. Nothing was written.",
    publicData: {
      errors: messages.map(message => ({
        path: "action",
        code: "REFUSED",
        message,
      })),
    },
    logMessage: "Refused a template action",
    logContext: { reason: "template-action-refused" },
  });
}

function idOf(item: unknown): string | undefined {
  const id = recordOf(item)?.id;
  return typeof id === "string" || typeof id === "number"
    ? String(id)
    : undefined;
}

function recordOf(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : null;
}

/** The template actions route declaration. */
export function templateActionsRoute(setup: TemplateActionsSetup): {
  method: "POST";
  path: string;
  handler: (req: Request, ctx: PluginRouteContext) => Promise<Response>;
} {
  return {
    method: "POST",
    path: TEMPLATE_ACTIONS_ROUTE_PATH,
    // Signed in is all reaching the route asks: each action asks its own
    // rights on the templates collection before it reads anything.
    handler: async (req, ctx) => {
      const request = templateActionRequestOf(
        await readJsonBody(req, "template action")
      );
      const answered = await runTemplateAction(ctx, request, setup);
      return respondMutation<TemplateActionResult>(
        answered.message,
        answered.item
      );
    },
  };
}

/**
 * Whether the caller may set or change a template address. A `null` caller
 * cannot be anybody, so it may not.
 */
export async function readTemplateRoutingAccess(ctx: {
  readonly caller: {
    can(action: string, resource: string): Promise<boolean>;
  } | null;
}): Promise<TemplateRoutingAccess> {
  return {
    mayManageRouting:
      ctx.caller === null
        ? false
        : await ctx.caller.can(...TEMPLATE_ROUTING_ASK),
  };
}

/**
 * The routing question's route: what the template form asks before it offers
 * the address for editing. Authenticated, with no `requiredPermission`, since
 * the permission it reports on is the one asked about. It decides nothing:
 * the address field's rules and the template action do.
 */
export function templateRoutingRoute(): {
  method: "GET";
  path: string;
  handler: (req: Request, ctx: PluginRouteContext) => Promise<Response>;
} {
  return {
    method: "GET",
    path: TEMPLATE_ROUTING_ROUTE_PATH,
    handler: async (_req, ctx) =>
      Response.json(await readTemplateRoutingAccess(ctx)),
  };
}
