/**
 * `POST /components/from-selection`: make a component from a selection, as
 * the author asking for it.
 *
 * Two verbs share one route because they share everything but the page's
 * half: `save-as` stores the selection as a published component and leaves
 * the page alone; `convert` also replaces the selection with a placement of
 * it. The engine's planners decide what is stored and what the page becomes,
 * against the server's block registry, which knows every block a plugin
 * declared.
 *
 * ## Two ways to apply a convert
 *
 * - **`library`**, the editor's. The editor holds the page unsaved, so the
 *   server creates the component and answers with the page ops; the editor
 *   applies them as one undoable step and saves nothing else of the page
 *   behind the author's back. If the create fails, nothing changed. If the
 *   page is then never saved, the component stays in the library unused, as
 *   a saved-as component would.
 * - **`stored`**, the API's. The component's create and the stored page's
 *   update run in one transaction, as the caller, so a refusal of either
 *   leaves neither. The convert is planned again with the created id inside
 *   the transaction, so the placement names the row that was made. The usage
 *   indexes are brought up to date once it commits, since a write in a
 *   transaction the caller owns is skipped by their hooks.
 *
 * ## What it checks first
 *
 * The declared permission (`create` on components) runs before the handler.
 * The handler also asks for `publish` on components, since the component is
 * created published so that a convert renders unchanged on a live page, and
 * for `update` on the page's collection in `stored` mode. Every write still
 * runs as the caller, so core enforces each grant again where it applies.
 *
 * A convert is refused when the page would compose components deeper than
 * the limit, judged against the definitions the selection places.
 *
 * ## Dry run and attribution
 *
 * `dryRun: true` answers the plan (the definition, the page ops, the
 * warnings) and writes nothing; its page ops name {@link DRY_RUN_COMPONENT_ID}
 * for the component it did not create. Every answer says who ran it: the
 * signed-in user, or the API key and the user it belongs to, which is also
 * who the writes are made as.
 *
 * @module component-from-selection-route
 */
import {
  applyOps,
  DEFAULT_LIMITS,
  planConvertToComponent,
  planSaveAsComponent,
  registryNestingSource,
  type BlockDocument,
  type BuilderOp,
  type ComponentDocument,
  type ComponentExposure,
  type ComponentLookup,
  type DocumentLimits,
  type PlanRefusal,
  type PlanResult,
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
import { withVersionFrom } from "./document-version";
import {
  COMPONENT_FROM_SELECTION_ROUTE_PATH,
  DRY_RUN_COMPONENT_ID,
  type ComponentApplyMode,
  type ComponentFromSelectionAction,
  type ComponentFromSelectionFields,
  type ComponentFromSelectionResult,
  type StoredPageAddress,
} from "./library-contract";
import { readingAsUser } from "./library-route";
import { carryingTemplateTarget } from "./templates/template-target";

/** The status a new component is created with. */
const CREATED_STATUS = "published";

/** The blocks field a stored page holds its document in, when none is named. */
const DEFAULT_PAGE_FIELD = "content";

/**
 * The request body. Unknown keys are refused: a misspelt `dryRun` silently
 * ignored would perform the write the caller meant to preview.
 */
const RequestBody = z
  .strictObject({
    action: z.enum(["save-as", "convert"]),
    apply: z.enum(["library", "stored"]).optional(),
    dryRun: z.boolean().optional(),
    fields: z.strictObject({
      title: z.string().trim().min(1),
      slug: z.string().trim().min(1).optional(),
      description: z.string().optional(),
      category: z.string().optional(),
    }),
    // Judged by the planner, which reports each nomination it refuses by its
    // path, so it is carried as sent rather than restated as a schema here.
    exposure: z.unknown().optional(),
    selectedIds: z.array(z.string().min(1)).min(1),
    document: z.unknown().optional(),
    page: z
      .strictObject({
        collection: z.string().min(1),
        id: z.string().min(1),
        field: z.string().min(1).optional(),
        locale: z.string().min(1).optional(),
      })
      .optional(),
  })
  .superRefine((body, issues) => {
    const apply = body.apply ?? "library";
    if (apply === "library" && body.document === undefined) {
      issues.addIssue({
        code: "custom",
        path: ["document"],
        message: "A library request carries the document it selected in.",
      });
    }
    if (apply === "stored" && body.page === undefined) {
      issues.addIssue({
        code: "custom",
        path: ["page"],
        message: "A stored request names the page it converts.",
      });
    }
  });

type ParsedBody = z.infer<typeof RequestBody>;

/** The capabilities this route uses. */
export type ComponentFromSelectionContext = CompositionRouteContext;

/** What the route reads besides its context: pages and definitions. */
export interface ComponentFromSelectionReads {
  /**
   * A stored page's blocks document, read as the caller, with the version of
   * the read, or `null`.
   */
  page(
    address: StoredAddress,
    ctx: ComponentFromSelectionContext
  ): Promise<StoredPageRead | null>;
  /** The published definitions placements resolve to, read for judging. */
  definitions: ComponentSource;
}

/** Where the route stores components, and what it reads and reconciles. */
export interface ComponentFromSelectionSetup extends CompositionRouteSetup {
  readonly reads?: ComponentFromSelectionReads;
}

/**
 * Make a component from a selection, as the module docblock describes.
 */
export async function componentFromSelection(
  req: Request,
  ctx: ComponentFromSelectionContext,
  setup: ComponentFromSelectionSetup = {}
): Promise<Response> {
  requirePluginStore(ctx, setup);
  const by = await actingCaller(ctx, [
    ["publish", storeOf(ctx, setup).collection],
  ]);
  const body = await readBodyWith(req, RequestBody, "component-from-selection");
  const apply: ComponentApplyMode = body.apply ?? "library";
  const store = storeOf(ctx, setup);
  const reads = setup.reads ?? directReads(store);
  const limits = setup.limits?.() ?? DEFAULT_LIMITS;

  const page =
    apply === "stored"
      ? await storedPage(ctx, reads, pageAddressOf(body), body.action)
      : undefined;
  const document = page?.document ?? documentOf(body.document);
  const components =
    body.action === "convert"
      ? await placedDefinitions(document, reads, limits)
      : undefined;

  const planFor = (componentId: string) =>
    plannedAction({
      action: body.action,
      document,
      selectedIds: body.selectedIds,
      collection: store.collection,
      componentId,
      exposure: body.exposure ?? {},
      limits,
      ...(components === undefined ? {} : { components }),
    });

  const preview = planFor(DRY_RUN_COMPONENT_ID);
  if (preview.problem !== undefined)
    throw planRefusal(preview, "component-from-selection");

  const fields = fieldsToStore(body.fields);
  // The definition is the one stored: each plan re-identifies the run, so
  // the plan made with the created id carries different node ids.
  const answer = (
    id: string,
    plan: Planned,
    dryRun: boolean
  ): ComponentFromSelectionResult => ({
    dryRun,
    action: body.action,
    apply,
    component: { id, title: fields.title },
    definition: preview.definition,
    pageOps: plan.pageOps,
    warnings: plan.warnings,
    by,
  });

  if (body.dryRun === true) {
    return respondMutation<ComponentFromSelectionResult>(
      "Nothing was written: this is what the action would do.",
      answer(DRY_RUN_COMPONENT_ID, preview, true)
    );
  }

  const row = (definition: ComponentDocument) => ({
    ...fields,
    [store.field]: definition,
    status: CREATED_STATUS,
  });

  if (page === undefined || body.action === "save-as") {
    const created = await ctx.services.collections.createEntry(
      store.collection,
      row(preview.definition),
      asCaller(ctx)
    );
    const id = createdId(created.item);
    const plan = planFor(id);
    if (plan.problem !== undefined)
      throw planRefusal(plan, "component-from-selection");
    return respondMutation<ComponentFromSelectionResult>(
      "Component created.",
      answer(id, plan, false),
      { status: 201 }
    );
  }

  const { id, plan } = await convertStored(ctx, {
    store,
    page,
    limits,
    data: row(preview.definition),
    planFor,
    reads,
  });
  await reconcileAfterCommit(setup, [
    { slug: page.address.collection, documentId: page.address.id },
    { slug: store.collection, documentId: id },
  ]);
  return respondMutation<ComponentFromSelectionResult>(
    "Component created, and the page converted.",
    answer(id, plan, false),
    { status: 201 }
  );
}

/** A plan this route can answer with: the definition, the ops, the warnings. */
interface Planned {
  readonly definition: ComponentDocument;
  readonly pageOps: readonly BuilderOp[];
  readonly warnings: ComponentFromSelectionResult["warnings"];
  readonly problem?: undefined;
}

/** The planner for the verb, with its result narrowed to what this route uses. */
function plannedAction(args: {
  action: ComponentFromSelectionAction;
  document: BlockDocument;
  selectedIds: readonly string[];
  collection: string;
  componentId: string;
  exposure: ComponentExposure;
  limits: DocumentLimits;
  components?: ComponentLookup;
}): Planned | PlanRefusal {
  const target = { collection: args.collection, fields: {} };
  const nesting = registryNestingSource();
  const result: PlanResult<object> =
    args.action === "save-as"
      ? planSaveAsComponent(
          args.document,
          args.selectedIds,
          target,
          args.exposure,
          nesting,
          args.limits
        )
      : planConvertToComponent(
          args.document,
          args.selectedIds,
          target,
          args.componentId,
          args.exposure,
          nesting,
          args.limits,
          args.components
        );
  if (result.problem !== undefined) return result;
  // Both planners always create; a plan without a row is not one to write.
  if (result.create === undefined) return { problem: "unusable-document" };
  return {
    definition: result.create.document as ComponentDocument,
    pageOps: result.pageOps,
    warnings: result.warnings,
  };
}

/** The stored page, once read, with where it lives. */
interface StoredPage {
  readonly address: StoredAddress;
  readonly document: BlockDocument;
}

/**
 * The convert's two writes in one transaction: the component first, then the
 * page with the selection replaced by a placement of the id just created.
 */
async function convertStored(
  ctx: ComponentFromSelectionContext,
  args: {
    store: { collection: string; field: string };
    page: StoredPage;
    limits: DocumentLimits;
    data: Record<string, unknown>;
    planFor: (componentId: string) => Planned | PlanRefusal;
    reads: ComponentFromSelectionReads;
  }
): Promise<{ id: string; plan: Planned }> {
  const collections = ctx.services.collections;
  const { address } = args.page;
  // Before the transaction, as core asks: a localized read inside it can only
  // be read, never resolved.
  await collections.warmLocalizedReadiness(args.store.collection);
  await collections.warmLocalizedReadiness(address.collection);
  return collections.withTransaction(async tx => {
    const created = await collections.createEntryInTransaction(
      tx,
      args.store.collection,
      args.data,
      asCaller(ctx)
    );
    const id = createdId(created);
    const plan = args.planFor(id);
    // Throwing rolls the create back with the transaction.
    if (plan.problem !== undefined)
      throw planRefusal(plan, "component-from-selection");
    const read = await requireUnchangedPage(
      () => args.reads.page(args.page.address, ctx),
      args.page.document
    );
    const converted = applyOps(
      args.page.document,
      plan.pageOps,
      args.limits
    ).document;
    await collections.updateEntryInTransaction(
      tx,
      address.collection,
      address.id,
      // A template's collection with it, read with the page, so the write is
      // judged against it inside this transaction.
      carryingTemplateTarget(
        ctx.self,
        address.collection,
        read.templateTarget,
        withVersionFrom({ [address.field]: converted }, read.rev)
      ),
      asCaller(ctx, address.locale)
    );
    return { id, plan };
  });
}

/**

/**
 * The stored page the request names, read as the caller, and refused for a
 * convert unless the caller may update it.
 */
async function storedPage(
  ctx: ComponentFromSelectionContext,
  reads: ComponentFromSelectionReads,
  address: StoredAddress,
  action: ComponentFromSelectionAction
): Promise<StoredPage> {
  // Only a convert writes the page; a save reads it, as the caller.
  if (
    action === "convert" &&
    !(await ctx.caller?.can("update", address.collection))
  ) {
    throw NextlyError.forbidden({
      logContext: { reason: "component-from-selection-needs-page-update" },
    });
  }
  const read = await reads.page(address, ctx);
  if (read === null) {
    throw NextlyError.notFound({
      logContext: {
        reason: "component-from-selection-page-missing",
        collection: address.collection,
      },
    });
  }
  return { address, document: documentOf(read.document) };
}

/**
 * The published definitions the page places, read through the same bounded
 * walk the field validator composes with, as the convert planner's lookup for
 * judging depth.
 */
async function placedDefinitions(
  document: BlockDocument,
  reads: ComponentFromSelectionReads,
  limits: DocumentLimits
): Promise<ComponentLookup> {
  const library = heldLibrary();
  const walked = await composeWithReads({
    host: document,
    library,
    read: documentReader(reads.definitions, false),
    limits,
    work: { left: MOST_COMPOSED_NODES },
  });
  // A walk cut short (too many components, a definition that could not be
  // read) would judge the run against definitions it lacks, and a missing
  // one reads as no depth at all.
  if (walked.incomplete) {
    throw new NextlyError({
      code: "BUSINESS_RULE_VIOLATION",
      publicMessage:
        "This page places more components than a convert can check, or one could not be read, so the convert was not made.",
      logMessage: "Refused a convert whose definitions could not all be read",
      logContext: { reason: "component-from-selection-walk-incomplete" },
    });
  }
  return {
    has: id => library.held.has(id),
    get: id => library.held.get(id) as BlockDocument | undefined,
  };
}

/** The component's metadata as stored, with a slug when none was given. */
function fieldsToStore(
  fields: ParsedBody["fields"]
): ComponentFromSelectionFields & { slug: string } {
  const description = fields.description?.trim();
  const category = fields.category?.trim();
  return {
    title: fields.title,
    slug: fields.slug ?? derivedSlug(fields.title),
    ...(description === undefined || description === "" ? {} : { description }),
    ...(category === undefined || category === "" ? {} : { category }),
  };
}

/** The page address with its field defaulted. */
function pageAddressOf(body: ParsedBody): StoredAddress {
  const page = body.page;
  if (page === undefined) throw malformed("page");
  return {
    collection: page.collection,
    id: page.id,
    field: page.field ?? DEFAULT_PAGE_FIELD,
    ...(page.locale === undefined ? {} : { locale: page.locale }),
  };
}

/** A stored page's address with its field defaulted. */
type StoredAddress = Required<Omit<StoredPageAddress, "locale">> &
  Pick<StoredPageAddress, "locale">;

/** The document a library request carries, or the refusal that it is not one. */
function documentOf(value: unknown): BlockDocument {
  const nodes = (value as { nodes?: unknown } | null)?.nodes;
  if (typeof value !== "object" || value === null || !Array.isArray(nodes)) {
    throw malformed("document");
  }
  return value as BlockDocument;
}

/** What a request this route cannot read answers with. */
function malformed(path: string): NextlyError {
  return NextlyError.validation({
    errors: [
      {
        path,
        code: "INVALID_TYPE",
        message: "The request is not a component-from-selection request.",
      },
    ],
  });
}

/**
 * The reads the route makes on a live server: the stored page AS THE CALLER,
 * in its working-draft form where it has one, and definitions as stored and
 * published, which is what a page composes against once live.
 */
function directReads(store: {
  collection: string;
  field: string;
}): ComponentFromSelectionReads {
  return {
    page: async (address, ctx) =>
      storedPageReadOf(
        await readOrNull(async () =>
          requireNextly().findByID({
            collection: address.collection,
            id: address.id,
            ...(await readingAsUser(ctx)),
            ...(address.locale === undefined ? {} : { locale: address.locale }),
            status: "all",
            draft: true,
            depth: 0,
          })
        ),
        address.field
      ),
    definitions: async id => {
      try {
        const row = await requireNextly().findByID({
          collection: store.collection,
          id,
          overrideAccess: true,
          depth: 0,
        });
        const value = row?.[store.field];
        return value === undefined || value === null
          ? { kind: "absent" }
          : { kind: "document", document: value };
      } catch (error) {
        if (NextlyError.isNotFound(error)) return { kind: "absent" };
        return { kind: "unreadable" };
      }
    },
  };
}

/**
 * The route declaration. `create` on components is the declared door; the
 * handler asks the rest (see the module docblock).
 */
export function componentFromSelectionRoute(
  setup: ComponentFromSelectionSetup = {}
): {
  method: "POST";
  path: string;
  requiredPermission: (scope: PluginRoutePermissionScope) => string;
  handler: (req: Request, ctx: PluginRouteContext) => Promise<Response>;
} {
  return {
    method: "POST",
    path: COMPONENT_FROM_SELECTION_ROUTE_PATH,
    requiredPermission: ({ collection }) =>
      setup.store?.collection === undefined
        ? collection(COMPONENTS_SLUG, "create")
        : `create-${setup.store.collection}`,
    handler: (req, ctx) => componentFromSelection(req, ctx, setup),
  };
}
