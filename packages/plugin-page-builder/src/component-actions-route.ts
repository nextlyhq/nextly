/**
 * Three composition actions as routes, each run as its caller, with a dry run
 * and the caller reported in the answer:
 *
 * - `POST /components/detach` replaces a placement with the plain blocks it
 *   draws, resolved against the definitions the editor's canvas shows (each
 *   component's working draft where the caller may read it). The answer says
 *   when the component has unpublished changes, so the editor can warn first.
 * - `POST /components/:id/duplicate` copies a component's PUBLISHED definition
 *   (what pages draw) into a new published component, records where it came
 *   from in the plugin's own bookkeeping, and, given a placement, points that
 *   one placement at the copy. Exposed ids are kept, so its own values carry
 *   over; other placements are untouched.
 * - `POST /patterns/:id/from-selection` replaces a pattern's content with a
 *   selection, published, so the insert panel serves it. Pages that inserted
 *   the pattern earlier keep their copies.
 *
 * In `library` mode (the editor's) the server writes only the library row and
 * answers with the page ops for the editor to apply as one undoable step. In
 * `stored` mode (the API's) it applies them to the stored page itself, in the
 * same transaction as the duplicate's create.
 *
 * @module component-actions-route
 */
import {
  applyOps,
  DEFAULT_LIMITS,
  isComponentInstance,
  findNode,
  planDetach,
  planDuplicateComponent,
  planUpdatePatternFromSelection,
  registryNestingSource,
  sameStoredValue,
  type BlockDocument,
  type BlockNode,
  type BuilderOp,
  type ComponentDocument,
  type DocumentLimits,
} from "@nextlyhq/blocks-engine";
import {
  NextlyError,
  respondMutation,
  type PluginRouteContext,
  type PluginRoutePermissionScope,
} from "@nextlyhq/plugin-sdk";
import { requireNextly } from "nextly/runtime";
import { z } from "nextly/zod";

import { COMPONENTS_SLUG } from "./collections/components";
import { PATTERNS_SLUG } from "./collections/patterns";
import {
  DETACH_ROUTE_PATH,
  DUPLICATE_ROUTE_PATH,
  UPDATE_PATTERN_ROUTE_PATH,
  type DetachResult,
  type DuplicateResult,
  type UpdatePatternResult,
} from "./component-actions-contract";
import { MOST_COMPOSED_NODES } from "./component-cycle-guard";
import {
  composeWithReads,
  documentReader,
  heldLibrary,
  type ComponentSource,
} from "./composition-reading";
import {
  actingCaller,
  asCaller,
  blocksDocumentOf,
  createdId,
  derivedSlug,
  planRefusal,
  readBodyWith,
  readOrNull,
  reconcileAfterCommit,
  requirePluginStore,
  requireUnchangedPage,
  storedPageReadOf,
  storeOf,
  type CompositionRouteContext,
  type CompositionRouteSetup,
  type StoredPageRead,
} from "./composition-route-kit";
import { documentVersionOf, withVersionFrom } from "./document-version";
import { DRY_RUN_COMPONENT_ID } from "./library-contract";
import { readingAsUser } from "./library-route";
import type { OriginStore } from "./origin-store";

/** The blocks field a stored page holds its document in, when none is named. */
const DEFAULT_PAGE_FIELD = "content";

/** Where a placement is, as the request names it. */
const PlacementBody = z.union([
  z.strictObject({
    apply: z.literal("library").optional(),
    document: z.unknown(),
    instanceId: z.string().min(1),
    // The language the editor shows components in, for a translated field.
    locale: z.string().min(1).optional(),
  }),
  z.strictObject({
    apply: z.literal("stored"),
    page: z.strictObject({
      collection: z.string().min(1),
      id: z.string().min(1),
      field: z.string().min(1).optional(),
      locale: z.string().min(1).optional(),
    }),
    instanceId: z.string().min(1),
  }),
]);

const DetachBody = z.intersection(
  PlacementBody,
  z.object({ dryRun: z.boolean().optional() })
);

const DuplicateBody = z.strictObject({
  dryRun: z.boolean().optional(),
  title: z.string().trim().min(1).optional(),
  placement: PlacementBody.optional(),
});

const UpdatePatternBody = z.strictObject({
  dryRun: z.boolean().optional(),
  document: z.unknown(),
  selectedIds: z.array(z.string().min(1)).min(1),
});

/** What these routes read besides their context. */
export interface ComponentActionReads {
  /**
   * A stored page's blocks document, read as the caller, with the version of
   * the read, or `null`.
   */
  page(
    address: StoredAt,
    ctx: CompositionRouteContext
  ): Promise<StoredPageRead | null>;
  /** A component as the canvas shows it to this caller: its draft overlaid. */
  shown(
    id: string,
    ctx: CompositionRouteContext,
    locale: string | undefined
  ): Promise<ReadComponent>;
  /** A component as pages draw it, published, as this caller may read it. */
  published(
    id: string,
    ctx: CompositionRouteContext,
    locale: string | undefined
  ): Promise<ReadComponent>;
  /** A pattern's row as the caller may read it, or `null`. */
  pattern(id: string, ctx: CompositionRouteContext): Promise<unknown>;
}

/** One component read: its title and definition, or nothing. */
export type ReadComponent = {
  readonly title: string;
  readonly document: ComponentDocument;
} | null;

/** What the routes are built with. */
export interface ComponentActionsSetup extends CompositionRouteSetup {
  readonly reads?: ComponentActionReads;
  /** Where a duplicate's origin is recorded. */
  readonly origins?: () => OriginStore | undefined;
}

/** A stored page's address, with its field defaulted. */
interface StoredAt {
  readonly collection: string;
  readonly id: string;
  readonly field: string;
  readonly locale?: string;
}

/** A placement resolved against the page that holds it. */
interface PlacementIn {
  readonly document: BlockDocument;
  readonly instanceId: string;
  /** The stored page, when the server applies the ops itself. */
  readonly stored?: StoredAt;
  /** The language components are read in, when the field is translated. */
  readonly locale?: string;
}

// ---------------------------------------------------------------------------
// Detach
// ---------------------------------------------------------------------------

/** Detach a placement, as the module docblock describes. */
export async function detachPlacement(
  req: Request,
  ctx: CompositionRouteContext,
  setup: ComponentActionsSetup = {}
): Promise<Response> {
  const by = await actingCaller(ctx);
  const body = await readBodyWith(req, DetachBody, "detach");
  const reads = setup.reads ?? directReads(setup, ctx);
  const at = await placementIn(ctx, reads, body);
  const componentId = placedComponentId(at);
  const limits = setup.limits?.() ?? undefined;

  const shown = await readShownLibrary(at, reads, ctx, limits);
  const plan = planDetach(
    at.document,
    at.instanceId,
    shown.definitions,
    registryNestingSource(),
    limits
  );
  if (plan.problem !== undefined) throw planRefusal(plan, "detach");

  const live = await reads.published(componentId, ctx, at.locale);
  const drawn = shown.titles.get(componentId);
  const result = (dryRun: boolean): DetachResult => ({
    dryRun,
    pageOps: plan.pageOps,
    component: { id: componentId, title: drawn ?? live?.title ?? "" },
    unpublishedChanges:
      live === null ||
      !sameStoredValue(live.document, shown.definitions.get(componentId)),
    by,
  });

  if (body.dryRun === true || at.stored === undefined) {
    // A library detach writes nothing on the server: the editor applies the
    // ops to the page it holds.
    return respondMutation<DetachResult>(
      body.dryRun === true
        ? "Nothing was written: this is what the detach would do."
        : "Apply these ops to detach the placement.",
      result(body.dryRun === true)
    );
  }

  // An ordinary update, whose own hooks keep the usage indexes.
  const stored = at.stored;
  const rev = await requireUnchangedPage(
    () => reads.page(stored, ctx),
    at.document
  );
  await writeStoredPage(ctx, at, plan.pageOps, limits, rev);
  return respondMutation<DetachResult>(
    "The placement was detached.",
    result(false)
  );
}

/**
 * The definitions the page reaches, read as the canvas shows them, with each
 * component's title for the answer.
 */
async function readShownLibrary(
  at: PlacementIn,
  reads: ComponentActionReads,
  ctx: CompositionRouteContext,
  limits: DocumentLimits | undefined
): Promise<{
  definitions: Map<string, BlockDocument>;
  titles: Map<string, string>;
}> {
  const titles = new Map<string, string>();
  const source: ComponentSource = async id => {
    const read = await reads.shown(id, ctx, at.locale);
    if (read === null) return { kind: "absent" };
    titles.set(id, read.title);
    return { kind: "document", document: read.document };
  };
  const library = heldLibrary();
  await composeWithReads({
    // Only the selected placement and what it reaches: unrelated placements
    // elsewhere on the page would spend the walk's read budget.
    host: { ...at.document, nodes: placementOnly(at) },
    library,
    read: documentReader(source, true),
    limits: limits ?? DEFAULT_LIMITS,
    work: { left: MOST_COMPOSED_NODES },
  });
  return {
    definitions: library.held as Map<string, BlockDocument>,
    titles,
  };
}

// ---------------------------------------------------------------------------
// Duplicate
// ---------------------------------------------------------------------------

/** Duplicate a component, as the module docblock describes. */
export async function duplicateComponent(
  req: Request,
  ctx: CompositionRouteContext,
  setup: ComponentActionsSetup = {}
): Promise<Response> {
  requirePluginStore(ctx, setup);
  const store = storeOf(ctx, setup);
  const by = await actingCaller(ctx, [["publish", store.collection]]);
  const body = await readBodyWith(req, DuplicateBody, "duplicate");
  const reads = setup.reads ?? directReads(setup, ctx);
  const sourceId = ctx.params?.id ?? "";
  const source = await reads.published(sourceId, ctx, undefined);
  if (source === null) {
    throw NextlyError.notFound({
      logContext: { reason: "duplicate-source-missing" },
    });
  }
  const at =
    body.placement === undefined
      ? undefined
      : await placementIn(ctx, reads, body.placement);
  if (at !== undefined && placedComponentId(at) !== sourceId) {
    throw NextlyError.validation({
      errors: [
        {
          path: "placement.instanceId",
          code: "INVALID",
          message: "That placement does not place this component.",
        },
      ],
    });
  }

  const limits = setup.limits?.() ?? undefined;
  const title = body.title ?? `${source.title} copy`;
  const plan = planDuplicateComponent(
    source.document,
    { collection: store.collection, fields: {} },
    limits
  );
  if (plan.problem !== undefined) throw planRefusal(plan, "duplicate");
  const definition = plan.create?.document as ComponentDocument;
  const repoint = (id: string): BuilderOp[] =>
    at === undefined ? [] : [repointOp(at, id)];
  const result = (id: string, dryRun: boolean): DuplicateResult => ({
    dryRun,
    component: { id, title },
    source: { id: sourceId },
    definition,
    pageOps: repoint(id),
    by,
  });

  if (body.dryRun === true) {
    return respondMutation<DuplicateResult>(
      "Nothing was written: this is what the duplicate would do.",
      result(DRY_RUN_COMPONENT_ID, true)
    );
  }

  const data = {
    title,
    slug: derivedSlug(title),
    [store.field]: definition,
    status: "published",
  };
  const id =
    at?.stored === undefined
      ? createdId(
          (
            await ctx.services.collections.createEntry(
              store.collection,
              data,
              asCaller(ctx)
            )
          ).item
        )
      : await duplicateStored(
          ctx,
          store.collection,
          data,
          at,
          repoint,
          limits,
          reads
        );

  await recordOrigin(ctx, setup, id, sourceId);
  // Only a write made in the transaction this route owns skips the usage
  // hooks; an ordinary create keeps the indexes itself.
  if (at?.stored !== undefined) {
    await reconcileAfterCommit(setup, [
      { slug: store.collection, documentId: id },
      { slug: at.stored.collection, documentId: at.stored.id },
    ]);
  }
  return respondMutation<DuplicateResult>(
    "The component was duplicated.",
    result(id, false),
    { status: 201 }
  );
}

/**
 * Record where the copy came from. Logged, never raised: the copy has been
 * made, and failing here would report it as not made and invite a retry
 * that makes a second.
 */
async function recordOrigin(
  ctx: CompositionRouteContext,
  setup: ComponentActionsSetup,
  copyId: string,
  sourceId: string
): Promise<void> {
  try {
    await setup.origins?.()?.record(copyId, sourceId);
  } catch (error) {
    ctx.logger?.warn(
      "[page-builder] a duplicated component's origin could not be recorded",
      { copyId, sourceId, error }
    );
  }
}

/** A stored duplicate's create and the page's re-point, in one transaction. */
async function duplicateStored(
  ctx: CompositionRouteContext,
  collection: string,
  data: Record<string, unknown>,
  at: PlacementIn,
  repoint: (id: string) => BuilderOp[],
  limits: DocumentLimits | undefined,
  reads: ComponentActionReads
): Promise<string> {
  const stored = at.stored;
  if (stored === undefined) throw new Error("a stored placement has a page");
  const collections = ctx.services.collections;
  await collections.warmLocalizedReadiness(collection);
  await collections.warmLocalizedReadiness(stored.collection);
  return collections.withTransaction(async tx => {
    const id = createdId(
      await collections.createEntryInTransaction(
        tx,
        collection,
        data,
        asCaller(ctx)
      )
    );
    const rev = await requireUnchangedPage(
      () => reads.page(stored, ctx),
      at.document
    );
    const converted = applyOps(at.document, repoint(id), limits).document;
    await collections.updateEntryInTransaction(
      tx,
      stored.collection,
      stored.id,
      withVersionFrom({ [stored.field]: converted }, rev),
      asCaller(ctx, stored.locale)
    );
    return id;
  });
}

/** The op that points a placement at another component, keeping its values. */
function repointOp(at: PlacementIn, componentId: string): BuilderOp {
  const node = findNode(at.document.nodes, at.instanceId);
  return {
    kind: "update",
    id: at.instanceId,
    patch: { props: { ...(node?.props ?? {}), componentId } },
  };
}

// ---------------------------------------------------------------------------
// Update a pattern
// ---------------------------------------------------------------------------

/** Replace a pattern's content with a selection, as the docblock describes. */
export async function updatePatternFromSelection(
  req: Request,
  ctx: CompositionRouteContext,
  setup: ComponentActionsSetup = {}
): Promise<Response> {
  const slug = ctx.self.collections[PATTERNS_SLUG] ?? PATTERNS_SLUG;
  const by = await actingCaller(ctx, [["publish", slug]]);
  const body = await readBodyWith(req, UpdatePatternBody, "update-pattern");
  const reads = setup.reads ?? directReads(setup, ctx);
  const id = ctx.params?.id ?? "";
  const pattern = await reads.pattern(id, ctx);
  if (pattern === null) {
    throw NextlyError.notFound({
      logContext: { reason: "update-pattern-missing" },
    });
  }
  const document = documentOf(body.document);
  const plan = planUpdatePatternFromSelection(
    document,
    body.selectedIds,
    { collection: slug, id },
    registryNestingSource()
  );
  if (plan.problem !== undefined) throw planRefusal(plan, "update-pattern");
  const update = plan.update;
  if (update === undefined)
    throw planRefusal({ problem: "invalid-source" }, "update-pattern");
  const result = (dryRun: boolean): UpdatePatternResult => ({
    dryRun,
    pattern: { id },
    document: update.document,
    pageOps: plan.pageOps,
    by,
  });
  if (body.dryRun === true) {
    return respondMutation<UpdatePatternResult>(
      "Nothing was written: this is what the update would do.",
      result(true)
    );
  }
  // Sent with the version the pattern was read at, so a save of it made
  // since refuses this update rather than being replaced by it.
  await ctx.services.collections.updateEntry(
    slug,
    id,
    withVersionFrom(
      { content: update.document, status: "published" },
      documentVersionOf(pattern)
    ),
    asCaller(ctx)
  );
  return respondMutation<UpdatePatternResult>(
    "The pattern was updated.",
    result(false)
  );
}

// ---------------------------------------------------------------------------
// Shared
// ---------------------------------------------------------------------------

/** The placement the request names, in the page that holds it. */
async function placementIn(
  ctx: CompositionRouteContext,
  reads: ComponentActionReads,
  body: z.infer<typeof PlacementBody>
): Promise<PlacementIn> {
  if (body.apply !== "stored") {
    return {
      document: documentOf(body.document),
      instanceId: body.instanceId,
      ...(body.locale === undefined ? {} : { locale: body.locale }),
    };
  }
  const stored: StoredAt = {
    collection: body.page.collection,
    id: body.page.id,
    field: body.page.field ?? DEFAULT_PAGE_FIELD,
    ...(body.page.locale === undefined ? {} : { locale: body.page.locale }),
  };
  if (!(await ctx.caller?.can("update", stored.collection))) {
    throw NextlyError.forbidden({
      logContext: { reason: "composition-needs-page-update" },
    });
  }
  const read = await reads.page(stored, ctx);
  if (read === null) {
    throw NextlyError.notFound({
      logContext: { reason: "composition-page-missing" },
    });
  }
  return {
    document: documentOf(read.document),
    instanceId: body.instanceId,
    stored,
    ...(stored.locale === undefined ? {} : { locale: stored.locale }),
  };
}

/** The selected placement alone, as the forest a detach's walk starts from. */
function placementOnly(at: PlacementIn): BlockNode[] {
  const node = findNode(at.document.nodes, at.instanceId);
  return node === undefined ? [] : [node];
}

/** The component a placement names, or the refusal that it is no placement. */
function placedComponentId(at: PlacementIn): string {
  const node = findNode(at.document.nodes, at.instanceId);
  if (node !== undefined && isComponentInstance(node)) {
    const id = (node.props as { componentId?: unknown }).componentId;
    if (typeof id === "string" && id !== "") return id;
  }
  throw NextlyError.validation({
    errors: [
      {
        path: "instanceId",
        code: "INVALID",
        message: "That block is not a placement of a component.",
      },
    ],
  });
}

/**
 * Write a stored page with the ops applied, as the caller, sent with `rev`:
 * the version the page was read at just before the write.
 */
async function writeStoredPage(
  ctx: CompositionRouteContext,
  at: PlacementIn,
  ops: readonly BuilderOp[],
  limits: DocumentLimits | undefined,
  rev: string | undefined
): Promise<void> {
  const stored = at.stored;
  if (stored === undefined) return;
  const next = applyOps(at.document, ops, limits).document;
  await ctx.services.collections.updateEntry(
    stored.collection,
    stored.id,
    withVersionFrom({ [stored.field]: next }, rev),
    asCaller(ctx, stored.locale)
  );
}

/** A document a request carries, or the refusal that it is not one. */
function documentOf(value: unknown): BlockDocument {
  const nodes = (value as { nodes?: unknown } | null)?.nodes;
  if (typeof value !== "object" || value === null || !Array.isArray(nodes)) {
    throw NextlyError.validation({
      errors: [
        { path: "document", code: "INVALID_TYPE", message: "Not a document." },
      ],
    });
  }
  return value as BlockDocument;
}

/** The reads on a live server. */
function directReads(
  setup: ComponentActionsSetup,
  ctx: CompositionRouteContext
): ComponentActionReads {
  const store = storeOf(ctx, setup);
  const component = (row: unknown): ReadComponent => {
    const document = blocksDocumentOf(row, store.field);
    if (document === null) return null;
    const title = (row as { title?: unknown }).title;
    return {
      title: typeof title === "string" ? title : "",
      document: document as ComponentDocument,
    };
  };
  return {
    page: async (address, caller) =>
      storedPageReadOf(
        await readOrNull(async () =>
          requireNextly().findByID({
            collection: address.collection,
            id: address.id,
            ...(await readingAsUser(caller)),
            ...(address.locale === undefined ? {} : { locale: address.locale }),
            status: "all",
            draft: true,
            depth: 0,
          })
        ),
        address.field
      ),
    shown: async (id, caller, locale) =>
      component(
        await readOrNull(async () =>
          requireNextly().findByID({
            collection: store.collection,
            id,
            ...(await readingAsUser(caller)),
            ...(locale === undefined ? {} : { locale }),
            status: "all",
            draft: true,
            depth: 0,
          })
        )
      ),
    // As the caller, in public states only: a source the caller may not
    // read is not one it may copy.
    published: async (id, caller, locale) =>
      component(
        await readOrNull(async () =>
          requireNextly().findByID({
            collection: store.collection,
            id,
            ...(await readingAsUser(caller)),
            ...(locale === undefined ? {} : { locale }),
            depth: 0,
          })
        )
      ),
    pattern: (id, caller) =>
      readOrNull(async () =>
        requireNextly().findByID({
          collection: ctx.self.collections[PATTERNS_SLUG] ?? PATTERNS_SLUG,
          id,
          ...(await readingAsUser(caller)),
          status: "all",
          depth: 0,
        })
      ),
  };
}

/** The three route declarations. */
export function componentActionRoutes(setup: ComponentActionsSetup = {}): {
  method: "POST";
  path: string;
  requiredPermission: (scope: PluginRoutePermissionScope) => string;
  handler: (req: Request, ctx: PluginRouteContext) => Promise<Response>;
}[] {
  const components = ({ collection }: PluginRoutePermissionScope) =>
    setup.store?.collection === undefined
      ? collection(COMPONENTS_SLUG, "read")
      : `read-${setup.store.collection}`;
  return [
    {
      method: "POST",
      path: DETACH_ROUTE_PATH,
      requiredPermission: components,
      handler: (req, ctx) => detachPlacement(req, ctx, setup),
    },
    {
      method: "POST",
      path: DUPLICATE_ROUTE_PATH,
      requiredPermission: ({ collection }) =>
        setup.store?.collection === undefined
          ? collection(COMPONENTS_SLUG, "create")
          : `create-${setup.store.collection}`,
      handler: (req, ctx) => duplicateComponent(req, ctx, setup),
    },
    {
      method: "POST",
      path: UPDATE_PATTERN_ROUTE_PATH,
      requiredPermission: ({ collection }) =>
        collection(PATTERNS_SLUG, "update"),
      handler: (req, ctx) => updatePatternFromSelection(req, ctx, setup),
    },
  ];
}
