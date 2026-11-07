/**
 * `POST /templates/actions`: the actions an author takes on a collection's
 * template, offered to an API client one at a time, each with a dry run.
 *
 * - **create-template** gives a collection its template: an empty template
 *   document, a draft unless `publish` is set. Refused when the collection
 *   cannot have one, or already has one, naming it.
 * - **publish-template** publishes a template, its working draft included,
 *   as the editor's Publish does.
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
  respondMutation,
  type PluginCollectionTransaction,
  type PluginRouteContext,
} from "@nextlyhq/plugin-sdk";
import { z } from "nextly/zod";

import {
  TEMPLATE_COLLECTION_FIELD,
  TEMPLATE_CONTENT_FIELD,
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
import { documentVersionOf, withVersionFrom } from "../document-version";
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
      "getCollection"
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
    case "set-template-address":
      return setTemplateAddress(ctx, action, dryRun, guard, setup);
  }
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
  const collection = row[TEMPLATE_COLLECTION_FIELD];
  const asked: TemplateSummary = {
    ...summaryOf(row, { title: "", collection: "", status: "draft" }),
    address,
  };

  // The guard's own questions, in its words, asked up front so an apply
  // refuses before writing and a dry run answers them as refusals.
  const refusals: string[] = [];
  if (address !== null) {
    const notHere = addressHolderProblem(row);
    const problem =
      notHere ??
      storedAddressProblem(address, collection, {
        declared: guard.declaredAddresses,
      });
    const unserved =
      problem === null
        ? await addressCollectionProblem(guard, collection)
        : null;
    if (problem !== null || unserved !== null) {
      refusals.push(problem ?? unserved ?? "");
    } else {
      const holder = await guard.addressHolderOf(address);
      if (holder !== null && holder.id !== idOf(row)) {
        refusals.push(heldAddressMessage(address, holder));
      }
    }
  }
  const published = row.status === "published";
  // A published template's address goes live by publishing the template,
  // which would also put its unpublished design changes live unseen.
  if (published && row._isWorkingDraft === true) {
    refusals.push(
      "This template has unpublished changes. Publish or discard them first, so changing its address puts nothing else live."
    );
  }
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
      ...(published ? { status: "published" } : {}),
    },
    documentVersionOf(row)
  );
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
          "set-template-address",
          summaryOf(judged.written.item, asked),
          [],
          by
        )
      : dryRunAnswer(
          "set-template-address",
          asked,
          judged.refusal.messages,
          by
        );
  }
  let written: { item: unknown };
  try {
    written = await collections.updateEntry(
      templates,
      action.id,
      data,
      asCaller(ctx)
    );
  } catch (error) {
    // Two templates given one address at once both pass the read above and
    // meet at the unique index, which names nobody. The winner has
    // committed by then, so it is read and named.
    if (address === null || !NextlyError.isCode(error, "DUPLICATE")) {
      throw error;
    }
    const winner = await guard.addressHolderOf(address);
    if (winner === null) throw error;
    throw addressRefusal(heldAddressMessage(address, winner));
  }
  const template = summaryOf(written.item, asked);
  return {
    message:
      address === null
        ? "The template's address was removed."
        : "The template's address was set.",
    item: {
      dryRun: false,
      kind: "set-template-address",
      template,
      refusals: [],
      by,
      waiting:
        typeof collection === "string"
          ? await setup.waitingEntries(collection)
          : 0,
    },
  };
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

/**
 * A template as the write stored it, or would have: its row's own values
 * where it has them, after every hook, and what was asked where it has not.
 */
function summaryOf(row: unknown, asked: TemplateSummary): TemplateSummary {
  const stored = recordOf(row);
  const id = idOf(stored);
  const title = stored?.title;
  const collection = stored?.[TEMPLATE_COLLECTION_FIELD];
  const status = stored?.status;
  const address =
    stored !== null && TEMPLATE_ADDRESS_FIELD in stored
      ? storedAddressOf(stored[TEMPLATE_ADDRESS_FIELD])
      : asked.address;
  return {
    ...(id === undefined
      ? asked.id === undefined
        ? {}
        : { id: asked.id }
      : { id }),
    title: typeof title === "string" ? title : asked.title,
    collection: typeof collection === "string" ? collection : asked.collection,
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
