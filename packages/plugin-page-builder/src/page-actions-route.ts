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
 *
 * Each is read, planned and written as the caller. The stored page is read as
 * its working draft, as the editor opens it, and written back as a draft
 * unless `publish` is set. Nothing here decides what the page may hold: the
 * write is judged by the blocks field's own validation and the caller's
 * rights, exactly as an editor save is. A dry run makes that write and rolls
 * it back (see `judged-writes`), so its answer says whether the site would
 * accept it; an apply refuses up front what the dry run would report.
 *
 * @experimental Settles when the composition API ships.
 * @module page-actions-route
 */
import {
  applyOps,
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
  NextlyError,
  respondMutation,
  type PluginCollectionTransaction,
  type PluginRouteContext,
} from "@nextlyhq/plugin-sdk";
import { requireNextly } from "nextly/runtime";
import { z } from "nextly/zod";

import { PAGES_SLUG } from "./collections/pages";
import { PATTERNS_SLUG } from "./collections/patterns";
import {
  PAGE_ACTIONS_ROUTE_PATH,
  type PageAction,
  type PageActionResult,
} from "./composition-actions-contract";
import {
  actingCaller,
  asCaller,
  blocksDocumentOf,
  planRefusal,
  readBodyWith,
  readOrNull,
  storeOf,
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
const position = z.union([
  z.strictObject({ index: z.number().int().nonnegative() }),
  z.strictObject({
    parentId: id,
    slot: id,
    index: z.number().int().nonnegative(),
  }),
]);
const values = z.record(z.string().max(512), z.unknown());

const PageActionBody = z.strictObject({
  page: z.strictObject({
    collection: id,
    id,
    field: id.optional(),
    locale: id.optional(),
  }),
  action: z.discriminatedUnion("kind", [
    z.strictObject({
      kind: z.literal("insert-pattern"),
      patternId: id,
      at: position.optional(),
    }),
    z.strictObject({
      kind: z.literal("place-component"),
      componentId: id,
      variant: id.optional(),
      values: values.optional(),
      at: position.optional(),
    }),
    z.strictObject({
      kind: z.literal("set-placement-values"),
      instanceId: id,
      values: values.optional(),
      reset: z.array(z.string().max(512)).max(200).optional(),
    }),
    z.strictObject({
      kind: z.literal("choose-variant"),
      instanceId: id,
      variant: id.nullable(),
    }),
    z.strictObject({
      kind: z.literal("set-layout"),
      layout: id.nullable(),
      noHeaderFooter: z.boolean().optional(),
    }),
  ]),
  dryRun: z.boolean().optional(),
  expect: z.string().max(128).optional(),
  publish: z.boolean().optional(),
});

/** What the page actions are built with. */
export interface PageActionsSetup {
  readonly store?: ComponentStore;
  readonly limits?: () => DocumentLimits;
}

/** The context the page actions run with. */
type PageActionsContext = CompositionRouteContext;

/** The page as an action reads it: its blocks field and its Layout fields. */
interface StoredPage {
  readonly document: BlockDocument | null;
  readonly layout: string | null;
  readonly noHeaderFooter: boolean;
}

/** What an action plans: the write it makes, and what it answers with. */
interface PlannedWrite {
  readonly data: Record<string, unknown>;
  readonly ops: readonly BuilderOp[];
  readonly document?: BlockDocument;
  readonly layout?: { layout: string | null; noHeaderFooter: boolean };
  readonly insertedId?: string;
}

/** Run one page action, as the docblock describes. */
async function runPageAction(
  req: Request,
  ctx: PageActionsContext,
  setup: PageActionsSetup
): Promise<Response> {
  const body = await readBodyWith(req, PageActionBody, "page action");
  const page = body.page;
  // Preconditions first: the caller may change this collection's entries,
  // and publish them when asked to.
  const by = await actingCaller(ctx, [
    ["update", page.collection],
    ...(body.publish === true ? ([["publish", page.collection]] as const) : []),
  ]);
  const field = page.field ?? DEFAULT_FIELD;
  const stored = await readStoredPage(
    ctx,
    page.collection,
    page.id,
    field,
    page.locale
  );
  if (stored === null) {
    throw NextlyError.notFound({
      logContext: { reason: "page-action-missing-page" },
    });
  }
  const fingerprint = storedFingerprint(stored);
  if (body.expect !== undefined && body.expect !== fingerprint) {
    throw NextlyError.conflict({
      reason: "state",
      message:
        "The page changed since this action was planned. Nothing was written; plan it again.",
      logContext: { reason: "page-action-stale" },
    });
  }

  const planned = await planAction(
    ctx,
    body.action,
    stored,
    field,
    page.collection,
    setup
  );
  const data = {
    ...planned.data,
    ...(body.publish === true ? { status: "published" } : {}),
  };
  const options = asCaller(ctx, page.locale);
  const collections = ctx.services.collections;
  await collections.warmLocalizedReadiness(page.collection);
  const refusal = await judgeInTransaction(
    run => collections.withTransaction(run),
    async (tx: PluginCollectionTransaction) => {
      await collections.updateEntryInTransaction(
        tx,
        page.collection,
        page.id,
        data,
        {
          ...options,
          context: { [JUDGEMENT_CONTEXT]: true },
        }
      );
    }
  );
  const result = (dryRun: boolean): PageActionResult => ({
    dryRun,
    page: { collection: page.collection, id: page.id },
    ops: planned.ops,
    ...(planned.document === undefined ? {} : { document: planned.document }),
    ...(planned.layout === undefined ? {} : { layout: planned.layout }),
    ...(planned.insertedId === undefined
      ? {}
      : { insertedId: planned.insertedId }),
    refusals: refusal?.messages ?? [],
    fingerprint,
    by,
  });

  if (body.dryRun === true) {
    return respondMutation<PageActionResult>(
      refusal === null
        ? "Nothing was written: this is what the action would do."
        : "Nothing was written: the site would refuse this action.",
      result(true)
    );
  }
  if (refusal !== null) throw refusedAction(refusal.messages);
  await collections.updateEntry(page.collection, page.id, data, options);
  return respondMutation<PageActionResult>(
    "The page was changed.",
    result(false)
  );
}

/** The stored page as the caller may read it, its working draft first. */
async function readStoredPage(
  ctx: PageActionsContext,
  collection: string,
  pageId: string,
  field: string,
  locale: string | undefined
): Promise<StoredPage | null> {
  const row = await readOrNull(async () =>
    requireNextly().findByID({
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
  return {
    document: blocksDocumentOf(record, field),
    layout: relationId(record.layout),
    noHeaderFooter: record.noHeaderFooter === true,
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
  if (action.kind === "set-layout")
    return planLayout(ctx, action, stored, collection);
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
    requireNextly().findByID({
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
    requireNextly().findByID({
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
  stored: StoredPage,
  collection: string
): PlannedWrite {
  // Only the plugin's own pages hold a Layout; a host collection with a blocks
  // field has no such fields to write.
  if (collection !== (ctx.self.collections[PAGES_SLUG] ?? PAGES_SLUG)) {
    throw refusedAction(["Only the page builder's own pages choose a Layout."]);
  }
  const layout = {
    layout: action.layout,
    noHeaderFooter: action.noHeaderFooter ?? stored.noHeaderFooter,
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
    handler: (req, ctx) => runPageAction(req, ctx, setup),
  };
}
