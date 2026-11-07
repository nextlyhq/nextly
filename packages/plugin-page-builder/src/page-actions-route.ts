/**
 * `POST /pages/actions`: the actions the editor takes on a page, offered to an
 * API client one at a time, each with a dry run.
 *
 * - **insert-pattern** copies a published pattern into the page, through the
 *   same planner the insert panel uses.
 * - **place-component** places a component by reference, with a variant and
 *   values if given.
 * - **set-placement-values** and **choose-variant** change one placement.
 * - **set-layout** chooses the page's Layout, or switches it off.
 * - **set-list-query** changes a collection list's source, filters, sort,
 *   limit and offset, as the list's inspector does.
 * - **set-conditions** sets a block's visibility conditions, as the block's
 *   "Show when" controls do.
 *
 * Each is read, planned and written as the caller. The stored page is read as
 * its working draft, as the editor opens it, and written back as a draft
 * unless `publish` is set. Nothing here decides what the page may hold: the
 * write is judged by the blocks field's own validation and the caller's
 * rights, exactly as an editor save is. A dry run makes that write and rolls
 * it back (see `judged-writes`), so its answer says whether the site would
 * accept it, and shows the page as the write stored it, after its hooks; an
 * apply refuses up front what the dry run would report.
 *
 * Every write carries the version the page was read at (`_rev`), so a page
 * someone else saved between this action's read and its write is refused with
 * 409 rather than overwritten by a plan made from the older page.
 *
 * @experimental Settles when the composition API ships.
 * @module page-actions-route
 */
import {
  applyOps,
  COLLECTION_LIST_TYPE,
  COMPONENT_INSTANCE_TYPE,
  findNode,
  isComponentInstance,
  newId,
  OpError,
  planInsertPattern,
  registryNestingSource,
  type BlockDocument,
  type BlockNode,
  type BuilderOp,
  type DocumentLimits,
  type OpPosition,
} from "@nextlyhq/blocks-engine";
import {
  conditionsOp,
  pageActionJsonSchema,
  pageActionSchema,
} from "@nextlyhq/builder/ops";
import {
  getCachedNextly,
  NextlyError,
  respondMutation,
  type PluginCollectionTransaction,
  type PluginRouteContext,
} from "@nextlyhq/plugin-sdk";
import { z } from "nextly/zod";

import { PAGES_SLUG } from "./collections/pages";
import { PATTERNS_SLUG } from "./collections/patterns";
import {
  PAGE_ACTIONS_ROUTE_PATH,
  type ListQueryChange,
  type PageAction,
  type PageActionRequest,
  type PageActionResult,
} from "./composition-actions-contract";
import {
  actingCaller,
  asCaller,
  blocksDocumentOf,
  parsedWith,
  planRefusal,
  readJsonBody,
  readOrNull,
  requestJsonSchema,
  savesLive,
  storeOf,
  type ActionAnswer,
  type CompositionRouteContext,
} from "./composition-route-kit";
import { relationId } from "./default-layout/store";
import {
  JUDGEMENT_CONTEXT,
  judgeInTransaction,
  storedFingerprint,
} from "./judged-writes";
import { readingAsUser, type ComponentStore } from "./library-route";

/** The blocks field a page action edits when the address names none. */
const DEFAULT_FIELD = "content";

const id = z.string().min(1).max(512);

/**
 * The request around the action: which page, and how to apply. The action
 * itself is parsed by the builder's published schema, so the route and any
 * client validating against `@nextlyhq/builder/ops` refuse the same actions.
 */
const PageActionEnvelope = z.strictObject({
  page: z.strictObject({
    collection: id,
    id,
    field: id.optional(),
    locale: id.optional(),
  }),
  action: z.unknown(),
  dryRun: z.boolean().optional(),
  expect: z.string().max(128).optional(),
  publish: z.boolean().optional(),
});

/** The JSON Schema of a page action request, as the route parses it. */
export function pageActionRequestJsonSchema(): Record<string, unknown> {
  return requestJsonSchema(PageActionEnvelope, pageActionJsonSchema());
}

/**
 * A page action request read from outside input: a route body, or what a
 * caller of the service passed. Refused with the path of each problem.
 */
export function pageActionRequestOf(raw: unknown): PageActionRequest {
  const envelope = parsedWith(raw, PageActionEnvelope);
  const { page, dryRun, expect, publish } = envelope;
  return {
    page: {
      collection: page.collection,
      id: page.id,
      ...(page.field === undefined ? {} : { field: page.field }),
      ...(page.locale === undefined ? {} : { locale: page.locale }),
    },
    action: parsedWith(envelope.action, pageActionSchema, "action"),
    ...(dryRun === undefined ? {} : { dryRun }),
    ...(expect === undefined ? {} : { expect }),
    ...(publish === undefined ? {} : { publish }),
  };
}

/** What the page actions are built with. */
export interface PageActionsSetup {
  readonly store?: ComponentStore;
  readonly limits?: () => DocumentLimits;
}

/** The context the page actions run with. */
export type PageActionsContext = CompositionRouteContext & {
  services: {
    collections: Parameters<typeof savesLive>[0];
  };
};

/**
 * The key a read gives a document's version under, and an update hands back
 * to be applied only to that version.
 */
const VERSION_KEY = "_rev";

/** The page as an action reads it: its blocks field and its Layout fields. */
interface StoredPage {
  readonly document: BlockDocument | null;
  readonly layout: string | null;
  readonly noHeaderFooter: boolean;
}

/** The stored page, and the version it was read at. */
interface ReadPage {
  readonly page: StoredPage;
  readonly version: unknown;
}

/** What an action plans: the write it makes, and what it answers with. */
interface PlannedWrite {
  readonly data: Record<string, unknown>;
  readonly ops: readonly BuilderOp[];
  readonly document?: BlockDocument;
  readonly layout?: { layout: string | null; noHeaderFooter: boolean };
  readonly insertedId?: string;
}

/**
 * Run one page action, as the docblock describes, for the route and the
 * service alike: every check, the dry run and the write are made here.
 */
export async function runPageAction(
  ctx: PageActionsContext,
  body: PageActionRequest,
  setup: PageActionsSetup
): Promise<ActionAnswer<PageActionResult>> {
  const page = body.page;
  const collections = ctx.services.collections;
  // Preconditions first: the caller may change this collection's entries,
  // and publish them when asked to, or when the collection holds no working
  // draft and a save lands on the live entry. Asked of any entry: whether
  // the caller may change THIS page is the write's to decide, made as the
  // caller against the row.
  const publishes =
    body.publish === true || (await savesLive(collections, page.collection));
  const by = await actingCaller(
    ctx,
    [
      ["update", page.collection],
      ...(publishes ? ([["publish", page.collection]] as const) : []),
    ],
    { anyEntry: true }
  );
  const field = page.field ?? DEFAULT_FIELD;
  const read = await readForAction(ctx, page, field, body.expect);
  const planned = await planAction(
    ctx,
    body.action,
    read.page,
    field,
    page.collection,
    setup
  );
  const data = {
    ...planned.data,
    ...(body.publish === true ? { status: "published" } : {}),
    ...(read.version === undefined ? {} : { [VERSION_KEY]: read.version }),
  };
  const options = asCaller(ctx, page.locale);
  await collections.warmLocalizedReadiness(page.collection);
  const judged = await judgeInTransaction(
    run => collections.withTransaction(run),
    (tx: PluginCollectionTransaction) =>
      collections.updateEntryInTransaction(tx, page.collection, page.id, data, {
        ...options,
        context: { [JUDGEMENT_CONTEXT]: true },
      })
  );
  const result = (
    dryRun: boolean,
    written: unknown,
    refusals: readonly string[]
  ): PageActionResult => {
    const shown = asWritten(planned, written, field);
    return {
      dryRun,
      page: { collection: page.collection, id: page.id },
      ops: planned.ops,
      ...(shown.document === undefined ? {} : { document: shown.document }),
      ...(shown.layout === undefined ? {} : { layout: shown.layout }),
      ...(planned.insertedId === undefined
        ? {}
        : { insertedId: planned.insertedId }),
      refusals,
      fingerprint: read.fingerprint,
      by,
    };
  };

  if (judged.refusal !== null) {
    if (body.dryRun !== true) throw refusedAction(judged.refusal.messages);
    return {
      message: "Nothing was written: the site would refuse this action.",
      item: result(true, undefined, judged.refusal.messages),
    };
  }
  if (body.dryRun === true) {
    return {
      message: "Nothing was written: this is what the action would do.",
      item: result(true, judged.written, []),
    };
  }
  // The answer is the committed write's: a hook may store something other
  // than what the rolled-back judgement stored.
  const applied = await collections.updateEntry(
    page.collection,
    page.id,
    data,
    options
  );
  return {
    message: "The page was changed.",
    item: result(false, applied.item, []),
    ...(applied.warnings === undefined ? {} : { warnings: applied.warnings }),
  };
}

/**
 * The page an action plans against, the version it was read at, and its
 * fingerprint, refused when `expect` names another.
 */
async function readForAction(
  ctx: PageActionsContext,
  page: { collection: string; id: string; locale?: string | undefined },
  field: string,
  expected: string | undefined
): Promise<ReadPage & { fingerprint: string }> {
  const read = await readStoredPage(
    ctx,
    page.collection,
    page.id,
    field,
    page.locale
  );
  if (read === null) {
    throw NextlyError.notFound({
      logContext: { reason: "page-action-missing-page" },
    });
  }
  const fingerprint = storedFingerprint(read.page);
  if (expected !== undefined && expected !== fingerprint) {
    throw NextlyError.conflict({
      reason: "state",
      message:
        "The page changed since this action was planned. Nothing was written; plan it again.",
      logContext: { reason: "page-action-stale" },
    });
  }
  return { ...read, fingerprint };
}

/** The stored page as the caller may read it, its working draft first. */
async function readStoredPage(
  ctx: PageActionsContext,
  collection: string,
  pageId: string,
  field: string,
  locale: string | undefined
): Promise<ReadPage | null> {
  const row = await readOrNull(async () =>
    (await getCachedNextly()).findByID({
      collection,
      id: pageId,
      ...(await readingAsUser(ctx)),
      ...(locale === undefined ? {} : { locale }),
      status: "all",
      draft: true,
      depth: 0,
    })
  );
  if (typeof row !== "object" || row === null) return null;
  const record = row as Record<string, unknown>;
  return { page: storedPageOf(record, field), version: record[VERSION_KEY] };
}

/** The parts of a page row an action reads and writes. */
function storedPageOf(
  record: Record<string, unknown>,
  field: string
): StoredPage {
  return {
    document: blocksDocumentOf(record, field),
    layout: relationId(record.layout),
    noHeaderFooter: record.noHeaderFooter === true,
  };
}

/**
 * What a judged write stored, in place of what was planned: the hooks a save
 * runs may change the blocks field or the Layout fields, and the answer shows
 * what an apply would keep. A field the write's answer leaves out (one the
 * caller may not read back) is shown as planned.
 */
function asWritten(
  planned: PlannedWrite,
  written: unknown,
  field: string
): Pick<PlannedWrite, "document" | "layout"> {
  if (typeof written !== "object" || written === null) return planned;
  const record = written as Record<string, unknown>;
  const stored = storedPageOf(record, field);
  return {
    ...(planned.document === undefined
      ? {}
      : { document: stored.document ?? planned.document }),
    ...(planned.layout === undefined
      ? {}
      : {
          layout:
            "layout" in record
              ? { layout: stored.layout, noHeaderFooter: stored.noHeaderFooter }
              : planned.layout,
        }),
  };
}

async function planAction(
  ctx: PageActionsContext,
  action: PageAction,
  stored: StoredPage,
  field: string,
  collection: string,
  setup: PageActionsSetup
): Promise<PlannedWrite> {
  if (action.kind === "set-layout") return planLayout(ctx, action, collection);
  const document = stored.document;
  if (document === null) {
    throw refusedAction([`This entry has no "${field}" blocks to change.`]);
  }
  const limits = setup.limits?.();
  const ops = await opsFor(
    ctx,
    action,
    document,
    storeOf(ctx, setup).collection
  );
  let next: BlockDocument;
  try {
    next = applyOps(document, ops.ops, limits).document;
  } catch (error) {
    if (error instanceof OpError) throw refusedAction([error.message]);
    throw error;
  }
  return {
    data: { [field]: next },
    ops: ops.ops,
    document: next,
    ...(ops.insertedId === undefined ? {} : { insertedId: ops.insertedId }),
  };
}

/** The ops one blocks action makes on the document. */
async function opsFor(
  ctx: PageActionsContext,
  action: Exclude<PageAction, { kind: "set-layout" }>,
  document: BlockDocument,
  components: string
): Promise<{ ops: readonly BuilderOp[]; insertedId?: string }> {
  switch (action.kind) {
    case "insert-pattern":
      return insertPatternOps(ctx, action.patternId, action.at, document);
    case "place-component":
      return placeComponentOps(ctx, action, document, components);
    case "set-placement-values":
      return {
        ops: [
          placementUpdate(document, action.instanceId, props =>
            valuesSet(props, action.values ?? {}, action.reset ?? [])
          ),
        ],
      };
    case "set-list-query":
      return {
        ops: [listQueryUpdate(document, action.listId, action.query)],
      };
    case "set-conditions":
      return {
        ops: [conditionsUpdate(document, action.nodeId, action.conditions)],
      };
    case "choose-variant":
      return {
        ops: [
          placementUpdate(document, action.instanceId, props => {
            const next = { ...props };
            if (action.variant === null) delete next.variant;
            else next.variant = action.variant;
            return next;
          }),
        ],
      };
  }
}

async function insertPatternOps(
  ctx: PageActionsContext,
  patternId: string,
  at: OpPosition | undefined,
  document: BlockDocument
): Promise<{ ops: readonly BuilderOp[] }> {
  // A published pattern, as the caller may read it: the insert panel offers
  // only published patterns.
  const row = await readOrNull(async () =>
    (await getCachedNextly()).findByID({
      collection: ctx.self.collections[PATTERNS_SLUG] ?? PATTERNS_SLUG,
      id: patternId,
      ...(await readingAsUser(ctx)),
      depth: 0,
    })
  );
  const pattern = blocksDocumentOf(row, "content");
  if (pattern === null) {
    throw NextlyError.notFound({
      logContext: { reason: "page-action-missing-pattern" },
    });
  }
  const plan = planInsertPattern(
    document,
    { id: patternId, document: pattern },
    at ?? { index: document.nodes.length },
    registryNestingSource()
  );
  if (plan.problem !== undefined) throw planRefusal(plan, "insert-pattern");
  return { ops: plan.pageOps };
}

async function placeComponentOps(
  ctx: PageActionsContext,
  action: Extract<PageAction, { kind: "place-component" }>,
  document: BlockDocument,
  components: string
): Promise<{ ops: readonly BuilderOp[]; insertedId: string }> {
  // A component the caller may read; whether it may be placed here, and
  // whether the variant and values fit it, is the write's to judge.
  await requireReadable(ctx, components, action.componentId);
  const node: BlockNode = {
    id: newId(),
    type: COMPONENT_INSTANCE_TYPE,
    version: 1,
    props: {
      componentId: action.componentId,
      ...(action.variant === undefined ? {} : { variant: action.variant }),
      ...(action.values === undefined
        ? {}
        : { overrides: { ...action.values } }),
    },
  };
  return {
    ops: [
      {
        kind: "insert",
        node,
        at: action.at ?? { index: document.nodes.length },
      },
    ],
    insertedId: node.id,
  };
}

async function requireReadable(
  ctx: PageActionsContext,
  collection: string,
  componentId: string
): Promise<void> {
  const row = await readOrNull(async () =>
    (await getCachedNextly()).findByID({
      collection,
      id: componentId,
      ...(await readingAsUser(ctx)),
      status: "all",
      depth: 0,
    })
  );
  if (row === null) {
    throw NextlyError.notFound({
      logContext: { reason: "page-action-missing-component" },
    });
  }
}

/** The update op that rewrites one placement's props. */
function placementUpdate(
  document: BlockDocument,
  instanceId: string,
  change: (props: Record<string, unknown>) => Record<string, unknown>
): BuilderOp {
  const node = findNode(document.nodes, instanceId);
  if (node === undefined || !isComponentInstance(node)) {
    throw refusedAction([
      `There is no component placement "${instanceId}" on this page.`,
    ]);
  }
  return {
    kind: "update",
    id: instanceId,
    patch: { props: change({ ...node.props }) },
  };
}

/**
 * The update op that changes one collection list's query: each part given
 * is set, each `null` removed, and the rest of its props kept as stored.
 */
function listQueryUpdate(
  document: BlockDocument,
  listId: string,
  change: ListQueryChange
): BuilderOp {
  const node = findNode(document.nodes, listId);
  if (node === undefined || node.type !== COLLECTION_LIST_TYPE) {
    throw refusedAction([
      `There is no collection list "${listId}" on this page.`,
    ]);
  }
  const props: Record<string, unknown> = { ...node.props };
  for (const [part, value] of Object.entries(change)) {
    if (value === undefined) continue;
    if (value === null) delete props[part];
    else props[part] = value;
  }
  return { kind: "update", id: listId, patch: { props } };
}

/**
 * The update op that sets one block's visibility conditions, through the
 * editor's own writer, so the devices it shows on are kept and a block shown
 * to everyone stores no visibility. Whether each condition fits is the
 * blocks field's to judge on the write, as for an editor save.
 */
function conditionsUpdate(
  document: BlockDocument,
  nodeId: string,
  conditions: Extract<PageAction, { kind: "set-conditions" }>["conditions"]
): BuilderOp {
  const op = conditionsOp(document, nodeId, conditions);
  if (op === null) {
    throw refusedAction([`There is no block "${nodeId}" on this page.`]);
  }
  return op;
}

/** A placement's props with values set and some fields reset to what they inherit. */
function valuesSet(
  props: Record<string, unknown>,
  values: Readonly<Record<string, unknown>>,
  reset: readonly string[]
): Record<string, unknown> {
  const held = props.overrides;
  const overrides: Record<string, unknown> =
    typeof held === "object" && held !== null && !Array.isArray(held)
      ? { ...(held as Record<string, unknown>) }
      : {};
  for (const [exposure, value] of Object.entries(values))
    overrides[exposure] = value;
  for (const exposure of reset) delete overrides[exposure];
  const next = { ...props };
  if (Object.keys(overrides).length === 0) delete next.overrides;
  else next.overrides = overrides;
  return next;
}

function planLayout(
  ctx: PageActionsContext,
  action: Extract<PageAction, { kind: "set-layout" }>,
  collection: string
): PlannedWrite {
  // Only the plugin's own pages hold a Layout; a host collection with a blocks
  // field has no such fields to write.
  if (collection !== (ctx.self.collections[PAGES_SLUG] ?? PAGES_SLUG)) {
    throw refusedAction(["Only the page builder's own pages choose a Layout."]);
  }
  const layout = {
    layout: action.layout,
    // Choosing a Layout, or the site default, turns the switch off unless the
    // caller says otherwise, as the editor's one choice does.
    noHeaderFooter: action.noHeaderFooter ?? false,
  };
  return { data: layout, ops: [], layout };
}

/** A refusal with the reasons the site, or the plan, gave. */
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
    logMessage: "Refused a page action",
    logContext: { reason: "page-action-refused" },
  });
}

/** The page actions route declaration. */
export function pageActionsRoute(setup: PageActionsSetup = {}): {
  method: "POST";
  path: string;
  handler: (req: Request, ctx: PluginRouteContext) => Promise<Response>;
} {
  return {
    method: "POST",
    path: PAGE_ACTIONS_ROUTE_PATH,
    // Signed in is all reaching the route asks: which collection a page lives
    // in is in the body, so the handler asks for update on that collection
    // before it reads anything, and core judges the write itself.
    handler: async (req, ctx) => {
      const request = pageActionRequestOf(
        await readJsonBody(req, "page action")
      );
      const answered = await runPageAction(ctx, request, setup);
      return respondMutation<PageActionResult>(answered.message, answered.item);
    },
  };
}
