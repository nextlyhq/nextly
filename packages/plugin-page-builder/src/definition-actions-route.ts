/**
 * `POST /components/:id/definition`: the edits the component's own view makes
 * to its definition, offered to an API client one at a time, each with a dry
 * run: expose, rename, retarget and remove a field, remove an exposed slot,
 * and add, rename and delete a variant or set and reset one of its values.
 *
 * Each edit is the editor's own planner (blocks-engine's exposure and variant
 * planners), so an API client is held to the rules the view is held to: one
 * label per variant, stable ids never handed out twice, a retired field's id
 * never reused, a value that fits its field. The definition is read as its
 * working draft, as the view opens it, and written back as a draft unless
 * `publish` is set, so a removed field retires only when the component is
 * published, as in the view. The write is judged as any save of the
 * component is: a dry run makes it and rolls it back (`judged-writes`).
 *
 * The component may live in the plugin's own store or in a host collection
 * named by `componentReadiness`: an edit changes only the configured document
 * field, so it needs none of the title and slug fields a new component does.
 *
 * @experimental Settles when the composition API ships.
 * @module definition-actions-route
 */
import {
  isComponentDocument,
  registryBlockSource,
  type BlockDocument,
  type ComponentDocument,
  type DocumentLimits,
  type ExposureEdit,
  type ExposureEditRefusal,
  type RetiredExposures,
  type VariantEdit,
  type VariantEditRefusal,
} from "@nextlyhq/blocks-engine";
import {
  definitionActionJsonSchema,
  definitionActionSchema,
  planDefinitionAction,
} from "@nextlyhq/builder/ops";
import {
  getCachedNextly,
  NextlyError,
  respondMutation,
  type PluginCollectionTransaction,
  type PluginRouteContext,
  type PluginRoutePermissionScope,
} from "@nextlyhq/plugin-sdk";
import { z } from "nextly/zod";

import { COMPONENTS_SLUG } from "./collections/components";
import type { ActionBy } from "./component-actions-contract";
import {
  DEFINITION_ACTIONS_ROUTE_PATH,
  type DefinitionActionRequest,
  type DefinitionActionResult,
} from "./composition-actions-contract";
import {
  actingCaller,
  asCaller,
  blocksDocumentOf,
  parsedWith,
  readJsonBody,
  readOrNull,
  requestJsonSchema,
  savesLive,
  storeOf,
  type ActionAnswer,
  type CompositionRouteContext,
} from "./composition-route-kit";
import {
  JUDGEMENT_CONTEXT,
  judgeInTransaction,
  storedFingerprint,
} from "./judged-writes";
import { readingAsUser, type ComponentStore } from "./library-route";

/** A component id, as a path segment or a service argument carries it. */
const ComponentId = z.string().min(1).max(512);

/**
 * The request around the edit: how to apply it. The edit itself is parsed by
 * the builder's published schema, which also refuses a target naming both a
 * prop and the visibility switch, or neither.
 */
const DefinitionActionEnvelope = z.strictObject({
  action: z.unknown(),
  dryRun: z.boolean().optional(),
  expect: z.string().max(128).optional(),
  publish: z.boolean().optional(),
});

/** The JSON Schema of a definition action request, as the route parses it. */
export function definitionActionRequestJsonSchema(): Record<string, unknown> {
  return requestJsonSchema(
    DefinitionActionEnvelope,
    definitionActionJsonSchema()
  );
}

/**
 * A definition action request read from outside input: a route body, or what
 * a caller of the service passed. Refused with the path of each problem.
 */
function definitionActionRequestOf(raw: unknown): DefinitionActionRequest {
  const { action, dryRun, expect, publish } = parsedWith(
    raw,
    DefinitionActionEnvelope
  );
  return {
    action: parsedWith(action, definitionActionSchema, "action"),
    ...(dryRun === undefined ? {} : { dryRun }),
    ...(expect === undefined ? {} : { expect }),
    ...(publish === undefined ? {} : { publish }),
  };
}

/** What the definition actions are built with. */
export interface DefinitionActionsSetup {
  readonly store?: ComponentStore;
  readonly limits?: () => DocumentLimits;
  /** A component's retired ids, which a new exposure is never given. */
  readonly readRetired?: (
    ctx: PluginRouteContext
  ) => (componentId: string) => Promise<RetiredExposures | null>;
}

/**
 * The key a read gives a document's version under, and an update hands back
 * to be applied only to that version: a component someone else saved between
 * this edit's read and its write is refused with 409, not overwritten.
 */
const VERSION_KEY = "_rev";

/**
 * Run one definition edit, as the docblock describes, for the route and the
 * service alike.
 *
 * `admitted` says the route's declared permission already admitted the
 * caller to update the store, as the route's dispatch does. A caller reaching
 * this any other way (the service) is asked it here first, before anything is
 * read: the precondition is the same whichever door the request came in by.
 */
export async function runDefinitionAction(
  ctx: PluginRouteContext,
  rawComponentId: string,
  rawRequest: unknown,
  setup: DefinitionActionsSetup,
  admitted: "update-admitted" | "ask-update"
): Promise<ActionAnswer<DefinitionActionResult>> {
  const { store, componentId, body, by } = await admittedEdit(
    ctx,
    rawComponentId,
    rawRequest,
    setup,
    admitted
  );
  const read = await readForEdit(ctx, store, componentId, body.expect);
  const plan = await plannedEdit(
    ctx,
    setup,
    componentId,
    read.definition,
    body
  );

  const data = {
    [store.field]: plan.document,
    ...(body.publish === true ? { status: "published" } : {}),
    ...(read.version === undefined ? {} : { [VERSION_KEY]: read.version }),
  };
  const collections = ctx.services.collections;
  await collections.warmLocalizedReadiness(store.collection);
  const judged = await judgeInTransaction(
    run => collections.withTransaction(run),
    (tx: PluginCollectionTransaction) =>
      collections.updateEntryInTransaction(
        tx,
        store.collection,
        componentId,
        data,
        {
          ...asCaller(ctx),
          context: { [JUDGEMENT_CONTEXT]: true },
        }
      )
  );
  const refusal = judged.refusal;
  const result = (
    dryRun: boolean,
    written: unknown
  ): DefinitionActionResult => ({
    dryRun,
    component: { id: componentId },
    // As the write stored it, after its hooks, where its answer shows it.
    definition: storedDefinition(written, store.field) ?? plan.document,
    targetId: plan.id,
    ...("prunedVariants" in plan
      ? { prunedVariants: plan.prunedVariants }
      : {}),
    warnings: plan.warnings,
    refusals: refusal?.messages ?? [],
    fingerprint: read.fingerprint,
    by,
  });
  if (body.dryRun === true) {
    return {
      message:
        refusal === null
          ? "Nothing was written: this is what the edit would do."
          : "Nothing was written: the site would refuse this edit.",
      item: result(true, judged.refusal === null ? judged.written : undefined),
    };
  }
  if (refusal !== null) throw refusedWrite(refusal.messages);
  // The answer is the committed write's: a hook may store something other
  // than what the rolled-back judgement stored.
  const applied = await collections.updateEntry(
    store.collection,
    componentId,
    data,
    asCaller(ctx)
  );
  return {
    message: "The component was changed.",
    item: result(false, applied.item),
    ...(applied.warnings === undefined ? {} : { warnings: applied.warnings }),
  };
}

/**
 * The caller admitted to the edit, and the edit read: the route's declared
 * `update` right where the route did not ask it, then the request, then
 * `publish` where the edit publishes. Each right comes before the request is
 * read, as the route's dispatch has it.
 */
async function admittedEdit(
  ctx: PluginRouteContext,
  rawComponentId: string,
  rawRequest: unknown,
  setup: DefinitionActionsSetup,
  admitted: "update-admitted" | "ask-update"
): Promise<{
  store: { collection: string; field: string };
  componentId: string;
  body: DefinitionActionRequest;
  by: ActionBy;
}> {
  const store = storeOf(ctx, setup);
  // Asked exactly as the route declares it, of the collection rather than of
  // any entry, and before the request is read, so the service admits no
  // caller the route would refuse and tells such a caller nothing the route
  // would not.
  if (admitted === "ask-update") {
    await actingCaller(ctx, [["update", store.collection]]);
  }
  // Read here, where every caller passes, so the route's path and body and
  // the service's arguments are held to one parse.
  const componentId = parsedWith(rawComponentId, ComponentId, "id");
  const body = definitionActionRequestOf(rawRequest);
  // Publish is asked of any entry, and the write, made as the caller, decides
  // this one. A store that holds no working draft saves onto the live
  // component, so an edit there is a publish whether or not it says so.
  const publishes =
    body.publish === true ||
    (await savesLive(ctx.services.collections, store.collection));
  const by = await actingCaller(
    ctx,
    publishes ? [["publish", store.collection]] : [],
    { anyEntry: true }
  );
  return { store, componentId, body, by };
}

/** The editor's own planner run over the definition, or its refusal thrown. */
async function plannedEdit(
  ctx: PluginRouteContext,
  setup: DefinitionActionsSetup,
  componentId: string,
  definition: BlockDocument,
  body: DefinitionActionRequest
): Promise<ExposureEdit | VariantEdit> {
  const retired = (await setup.readRetired?.(ctx)(componentId)) ?? undefined;
  const limits = setup.limits?.();
  const plan = planDefinitionAction(definition, body.action, {
    definitions: registryBlockSource(),
    ...(retired === undefined ? {} : { retired }),
    ...(limits === undefined ? {} : { limits }),
  });
  if ("problem" in plan) throw refusedEdit(plan.problem, refusalDetail(plan));
  return plan;
}

/**
 * The component's working draft as the caller may read it, the version it was
 * read at, and its fingerprint, refused when `expect` names another.
 */
async function readForEdit(
  ctx: CompositionRouteContext,
  store: { collection: string; field: string },
  componentId: string,
  expected: string | undefined
): Promise<{
  definition: BlockDocument;
  version: unknown;
  fingerprint: string;
}> {
  const row = await readOrNull(async () =>
    (await getCachedNextly()).findByID({
      collection: store.collection,
      id: componentId,
      ...(await readingAsUser(ctx)),
      status: "all",
      draft: true,
      depth: 0,
    })
  );
  const definition = blocksDocumentOf(row, store.field);
  if (definition === null) {
    throw NextlyError.notFound({
      logContext: { reason: "definition-action-missing" },
    });
  }
  const fingerprint = storedFingerprint(definition);
  if (expected !== undefined && expected !== fingerprint) {
    throw NextlyError.conflict({
      reason: "state",
      message:
        "The component changed since this edit was planned. Nothing was written; plan it again.",
      logContext: { reason: "definition-action-stale" },
    });
  }
  const version = (row as Record<string, unknown>)[VERSION_KEY];
  return { definition, version, fingerprint };
}

/** The definition a write stored, when its answer shows one. */
function storedDefinition(
  written: unknown,
  field: string
): ComponentDocument | null {
  const stored = blocksDocumentOf(written, field);
  return stored !== null && isComponentDocument(stored) ? stored : null;
}

/** The site's refusal of the edit's write, in its own words. */
function refusedWrite(messages: readonly string[]): NextlyError {
  return new NextlyError({
    code: "BUSINESS_RULE_VIOLATION",
    publicMessage:
      "The edit cannot be applied as it stands. Nothing was written.",
    publicData: {
      errors: messages.map(message => ({
        path: "action",
        code: "REFUSED",
        message,
      })),
    },
    logMessage: "Refused a definition action",
    logContext: { reason: "definition-action-refused" },
  });
}

/** What a variant refusal adds: the clashing label, or what the field takes. */
function refusalDetail(
  refusal: ExposureEditRefusal | VariantEditRefusal
): string | undefined {
  return "clash" in refusal || "needs" in refusal
    ? (refusal.clash ?? refusal.needs)
    : undefined;
}

/** The planner's refusal, its problem as the code. */
function refusedEdit(problem: string, detail: string | undefined): NextlyError {
  const message =
    detail === undefined
      ? `The edit was refused: ${problem}.`
      : `The edit was refused: ${problem} (${detail}).`;
  return new NextlyError({
    code: "BUSINESS_RULE_VIOLATION",
    publicMessage: message,
    publicData: { errors: [{ path: "action", code: problem, message }] },
    logMessage: "Refused a definition action",
    logContext: { reason: "definition-action-planner", problem },
  });
}

/** The definition actions route declaration. */
export function definitionActionsRoute(setup: DefinitionActionsSetup = {}): {
  method: "POST";
  path: string;
  requiredPermission: (scope: PluginRoutePermissionScope) => string;
  handler: (req: Request, ctx: PluginRouteContext) => Promise<Response>;
} {
  return {
    method: "POST",
    path: DEFINITION_ACTIONS_ROUTE_PATH,
    requiredPermission: ({ collection }) =>
      setup.store?.collection === undefined
        ? collection(COMPONENTS_SLUG, "update")
        : `update-${setup.store.collection}`,
    handler: async (req, ctx) => {
      const answered = await runDefinitionAction(
        ctx,
        ctx.params.id ?? "",
        await readJsonBody(req, "definition action"),
        setup,
        "update-admitted"
      );
      return respondMutation<DefinitionActionResult>(
        answered.message,
        answered.item
      );
    },
  };
}
