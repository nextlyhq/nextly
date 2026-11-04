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
 * @experimental Settles when the composition API ships.
 * @module definition-actions-route
 */
import {
  isComponentDocument,
  planAddVariant,
  planDeleteVariant,
  planExposeProperty,
  planRemoveExposedSlot,
  planRemoveExposure,
  planRenameExposure,
  planRenameVariant,
  planResetVariantValue,
  planRetargetExposure,
  planSetVariantValue,
  registryBlockSource,
  type BlockDocument,
  type ComponentDocument,
  type DocumentLimits,
  type ExposureEditResult,
  type ExposureTarget,
  type RetiredExposures,
  type VariantEditResult,
} from "@nextlyhq/blocks-engine";
import {
  NextlyError,
  respondMutation,
  type PluginCollectionTransaction,
  type PluginRouteContext,
  type PluginRoutePermissionScope,
} from "@nextlyhq/plugin-sdk";
import { requireNextly } from "nextly/runtime";
import { z } from "nextly/zod";

import { COMPONENTS_SLUG } from "./collections/components";
import {
  DEFINITION_ACTIONS_ROUTE_PATH,
  type DefinitionAction,
  type DefinitionActionResult,
  type ExposureTargetInput,
} from "./composition-actions-contract";
import {
  actingCaller,
  asCaller,
  blocksDocumentOf,
  readBodyWith,
  readOrNull,
  requirePluginStore,
  storeOf,
  type CompositionRouteContext,
} from "./composition-route-kit";
import {
  JUDGEMENT_CONTEXT,
  judgeInTransaction,
  type Judgement,
  storedFingerprint,
} from "./judged-writes";
import { readingAsUser, type ComponentStore } from "./library-route";

const id = z.string().min(1).max(512);
const label = z.string().max(200);
/** A prop path or the visibility switch: exactly one of the two. */
const target = {
  nodeId: id,
  propPath: z.string().min(1).max(512).optional(),
  visibility: z.literal(true).optional(),
};

const DefinitionActionBody = z.strictObject({
  action: z.discriminatedUnion("kind", [
    z.strictObject({ kind: z.literal("expose"), label, ...target }),
    z.strictObject({
      kind: z.literal("rename-exposure"),
      exposureId: id,
      label,
    }),
    z.strictObject({
      kind: z.literal("retarget-exposure"),
      exposureId: id,
      ...target,
    }),
    z.strictObject({ kind: z.literal("remove-exposure"), exposureId: id }),
    z.strictObject({ kind: z.literal("remove-exposed-slot"), slotId: id }),
    z.strictObject({ kind: z.literal("add-variant"), label }),
    z.strictObject({ kind: z.literal("rename-variant"), variantId: id, label }),
    z.strictObject({ kind: z.literal("delete-variant"), variantId: id }),
    z.strictObject({
      kind: z.literal("set-variant-value"),
      variantId: id,
      exposureId: id,
      value: z.unknown(),
    }),
    z.strictObject({
      kind: z.literal("reset-variant-value"),
      variantId: id,
      exposureId: id,
    }),
  ]),
  dryRun: z.boolean().optional(),
  expect: z.string().max(128).optional(),
  publish: z.boolean().optional(),
});

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

/** Run one definition edit, as the docblock describes. */
async function runDefinitionAction(
  req: Request,
  ctx: PluginRouteContext,
  setup: DefinitionActionsSetup
): Promise<Response> {
  requirePluginStore(ctx, setup);
  const store = storeOf(ctx, setup);
  const body = await readBodyWith(
    req,
    DefinitionActionBody,
    "definition action"
  );
  // The declared permission admitted the caller to update components; publish
  // is asked of any entry, and the write, made as the caller, decides this one.
  const by = await actingCaller(
    ctx,
    body.publish === true ? [["publish", store.collection]] : [],
    { anyEntry: true }
  );
  const componentId = ctx.params.id ?? "";
  const read = await readForEdit(ctx, store, componentId, body.expect);

  const retired = (await setup.readRetired?.(ctx)(componentId)) ?? undefined;
  const plan = planEdit(asAction(body.action), read.definition, {
    limits: setup.limits?.(),
    retired,
  });
  if ("problem" in plan)
    throw refusedEdit(plan.problem, plan.clash ?? plan.needs);

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
  const result = (dryRun: boolean): DefinitionActionResult => ({
    dryRun,
    component: { id: componentId },
    // As the write stored it, after its hooks, where its answer shows it.
    definition: storedDefinition(judged, store.field) ?? plan.document,
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
    return respondMutation<DefinitionActionResult>(
      refusal === null
        ? "Nothing was written: this is what the edit would do."
        : "Nothing was written: the site would refuse this edit.",
      result(true)
    );
  }
  if (refusal !== null) throw refusedWrite(refusal.messages);
  await collections.updateEntry(
    store.collection,
    componentId,
    data,
    asCaller(ctx)
  );
  return respondMutation<DefinitionActionResult>(
    "The component was changed.",
    result(false)
  );
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
    requireNextly().findByID({
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

/** The definition a judged write stored, when its answer shows one. */
function storedDefinition(
  judged: Judgement<unknown>,
  field: string
): ComponentDocument | null {
  if (judged.refusal !== null) return null;
  const stored = blocksDocumentOf(judged.written, field);
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

/** The planner each edit is, with the sources it reads. */
function planEdit(
  action: DefinitionAction,
  definition: BlockDocument,
  sources: {
    limits: DocumentLimits | undefined;
    retired: RetiredExposures | undefined;
  }
): (ExposureEditResult | VariantEditResult) & {
  clash?: string;
  needs?: string;
} {
  const { limits, retired } = sources;
  const exposure = {
    definitions: registryBlockSource(),
    ...(retired === undefined ? {} : { retired }),
    ...(limits === undefined ? {} : { limits }),
  };
  switch (action.kind) {
    case "expose":
      return planExposeProperty(
        definition,
        { ...targetOf(action), label: action.label },
        exposure
      );
    case "rename-exposure":
      return planRenameExposure(
        definition,
        action.exposureId,
        action.label,
        limits
      );
    case "retarget-exposure":
      return planRetargetExposure(
        definition,
        action.exposureId,
        targetOf(action),
        exposure
      );
    case "remove-exposure":
      return planRemoveExposure(definition, action.exposureId, limits);
    case "remove-exposed-slot":
      return planRemoveExposedSlot(definition, action.slotId, limits);
    case "add-variant":
      return planAddVariant(
        definition,
        action.label,
        limits === undefined ? {} : { limits }
      );
    case "rename-variant":
      return planRenameVariant(
        definition,
        action.variantId,
        action.label,
        limits
      );
    case "delete-variant":
      return planDeleteVariant(definition, action.variantId, limits);
    case "set-variant-value":
      return planSetVariantValue(
        definition,
        action.variantId,
        action.exposureId,
        action.value,
        limits
      );
    case "reset-variant-value":
      return planResetVariantValue(
        definition,
        action.variantId,
        action.exposureId,
        limits
      );
  }
}

/**
 * The parsed action as the contract types it, refusing a target that names
 * both a prop and the visibility switch, or neither.
 */
function asAction(
  parsed: z.infer<typeof DefinitionActionBody>["action"]
): DefinitionAction {
  if (parsed.kind !== "expose" && parsed.kind !== "retarget-exposure")
    return parsed;
  const { propPath, visibility, ...rest } = parsed;
  if ((propPath === undefined) === (visibility === undefined)) {
    throw NextlyError.validation({
      errors: [
        {
          path: "action",
          code: "INVALID",
          message:
            "Name the field to expose by `propPath`, or `visibility: true`, but not both.",
        },
      ],
    });
  }
  return propPath === undefined
    ? { ...rest, visibility: true }
    : { ...rest, propPath };
}

/** An exposure's target, as the planners take it. */
function targetOf(input: ExposureTargetInput): ExposureTarget {
  return "visibility" in input
    ? { nodeId: input.nodeId, visibility: true }
    : { nodeId: input.nodeId, propPath: input.propPath };
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
    handler: (req, ctx) => runDefinitionAction(req, ctx, setup),
  };
}
