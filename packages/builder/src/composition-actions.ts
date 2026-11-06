/**
 * The composition actions as data: what an API client, a script or an agent
 * sends to change a page or a component's definition, with the schema that
 * judges it and, for a definition, the planner each edit is.
 *
 * Published from the server-safe `ops` subpath beside the ops themselves,
 * because an action is the request form of an edit the editor already makes.
 * The page builder's routes parse their bodies with these schemas, so a client
 * that validates against them is refused for exactly what the server refuses,
 * and an agent that registers them as tool inputs offers the same actions the
 * routes take. `z.toJSONSchema(schema, { io: "input" })` gives their JSON
 * Schema form, which the page builder's manifest carries.
 *
 * A definition edit is pure: {@link planDefinitionAction} runs the editor's
 * own planner over a definition, so the edit a client previews offline is the
 * edit the server would make. A page action needs the stored page, the pattern
 * it copies and the caller's rights, so it is planned by the route.
 *
 * @experimental Settles when the composition API ships.
 * @module composition-actions
 */
import {
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
  type BlockDocument,
  type DocumentLimits,
  type ExposureEditResult,
  type ExposureSources,
  type ExposureTarget,
  LIST_FILTER_OPS,
  type ListFilter,
  type ListRelation,
  type OpPosition,
  type RetiredExposures,
  type VariantEditResult,
} from "@nextlyhq/blocks-engine";
import { z } from "zod";

/** Where on the page an inserted block goes; the end of the page when absent. */
export type ActionPosition = OpPosition;

/**
 * One action on a stored page.
 *
 * @experimental Settles when the composition API ships.
 */
export type PageAction =
  /** Insert a published pattern's blocks, copied, as the editor's insert panel does. */
  | {
      readonly kind: "insert-pattern";
      readonly patternId: string;
      readonly at?: ActionPosition;
    }
  /** Place a component by reference, optionally choosing a variant and values. */
  | {
      readonly kind: "place-component";
      readonly componentId: string;
      readonly variant?: string;
      readonly values?: Readonly<Record<string, unknown>>;
      readonly at?: ActionPosition;
    }
  /**
   * Set a placement's exposed values, keyed by exposure id. `{ "$unset": true }`
   * empties a field ("Cleared"); `reset` returns fields to what the variant or
   * the definition gives them.
   */
  | {
      readonly kind: "set-placement-values";
      readonly instanceId: string;
      readonly values?: Readonly<Record<string, unknown>>;
      readonly reset?: readonly string[];
    }
  /** Choose a placement's variant by its stable id, or `null` for the defaults. */
  | {
      readonly kind: "choose-variant";
      readonly instanceId: string;
      readonly variant: string | null;
    }
  /**
   * Change a collection list's query: its source, filters, sort, limit and
   * offset, each part set when given, removed when `null`, and kept as
   * stored when absent. The write is judged as an editor save is, so a limit
   * outside 1 to 100, a negative offset, a field the collection lacks or
   * visitors can't see, a related list nested too deep, and a split into
   * pages a page cannot serve are refused.
   */
  | {
      readonly kind: "set-list-query";
      readonly listId: string;
      readonly query: ListQueryChange;
    }
  /**
   * Choose the page's Layout: a Layout's id, or `null` for the site's default.
   * `noHeaderFooter: true` switches the Layout off for this page; absent, it
   * is turned back on, as choosing a Layout in the editor does.
   */
  | {
      readonly kind: "set-layout";
      readonly layout: string | null;
      readonly noHeaderFooter?: boolean;
    };

/**
 * The parts of a collection list's query a `set-list-query` action changes:
 * each one set when given, removed when `null`, kept when absent. Shaped as
 * the block stores them (`ListQuery` in the engine reads them back).
 *
 * @experimental Settles when the composition API ships.
 */
export interface ListQueryChange {
  /** The collection read, or the one a related source's entries are in. */
  readonly collection?: string | null;
  /** A to-many relation of the page's entry or of the outer list's item. */
  readonly relation?: ListRelation | null;
  /** Rows an entry must all meet. */
  readonly filters?: readonly ListFilter[] | null;
  /** Sort keys, comma-separated, `-` for descending: `-publishedAt,title`. */
  readonly sort?: string | null;
  /** How many entries to show, 1 to 100. */
  readonly limit?: number | null;
  /** How many matching entries to skip, from 0. */
  readonly offset?: number | null;
  /**
   * Split into pages of `limit` entries, each at its own address
   * (`/news/page/2`). One list on a page may be, and not one inside another
   * list, one showing related entries, or one in a component or a Layout
   * region; the write is refused naming the reason.
   */
  readonly paginate?: boolean | null;
}

/** Which part of a block an exposure targets: a prop, or its visibility. */
export type ExposureTargetInput =
  | { readonly nodeId: string; readonly propPath: string }
  | { readonly nodeId: string; readonly visibility: true };

/**
 * One edit to a component's definition, each the editor's own planner.
 *
 * @experimental Settles when the composition API ships.
 */
export type DefinitionAction =
  | ({ readonly kind: "expose"; readonly label: string } & ExposureTargetInput)
  | {
      readonly kind: "rename-exposure";
      readonly exposureId: string;
      readonly label: string;
    }
  | ({
      readonly kind: "retarget-exposure";
      readonly exposureId: string;
    } & ExposureTargetInput)
  | { readonly kind: "remove-exposure"; readonly exposureId: string }
  | { readonly kind: "remove-exposed-slot"; readonly slotId: string }
  | { readonly kind: "add-variant"; readonly label: string }
  | {
      readonly kind: "rename-variant";
      readonly variantId: string;
      readonly label: string;
    }
  | { readonly kind: "delete-variant"; readonly variantId: string }
  | {
      readonly kind: "set-variant-value";
      readonly variantId: string;
      readonly exposureId: string;
      readonly value: unknown;
    }
  | {
      readonly kind: "reset-variant-value";
      readonly variantId: string;
      readonly exposureId: string;
    };

const id = z.string().min(1).max(512);
const label = z.string().max(200);
const position = z.union([
  z.strictObject({ index: z.number().int().nonnegative() }),
  z.strictObject({
    parentId: id,
    slot: id,
    index: z.number().int().nonnegative(),
  }),
]);
const values = z.record(z.string().max(512), z.unknown());
const filterScalar = z.union([z.string().max(2048), z.number(), z.boolean()]);

/**
 * Each page action's shape, once: the schema is their union, and the kinds a
 * client is told about are read off them, so the two cannot disagree.
 */
const pageActionOptions = [
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
    kind: z.literal("set-list-query"),
    listId: id,
    // The shape the block stores, and no more: what each part may hold (the
    // bounds, a field the collection has and visitors may read, how deep
    // related lists go) is the page's blocks field to judge on the write, so
    // a client is refused in the editor's own words, not by a second set here.
    query: z.strictObject({
      collection: z.string().max(512).nullable().optional(),
      relation: z
        .strictObject({ of: z.enum(["entry", "item"]), field: id })
        .nullable()
        .optional(),
      filters: z
        .array(
          z.strictObject({
            field: id,
            op: z.enum(LIST_FILTER_OPS),
            value: z.union([filterScalar, z.array(filterScalar).max(200)]),
          })
        )
        .max(100)
        .nullable()
        .optional(),
      sort: z.string().max(2048).nullable().optional(),
      limit: z.number().nullable().optional(),
      offset: z.number().nullable().optional(),
      paginate: z.boolean().nullable().optional(),
    }),
  }),
  z.strictObject({
    kind: z.literal("set-layout"),
    layout: id.nullable(),
    noHeaderFooter: z.boolean().optional(),
  }),
] as const;

/**
 * A page action, as the page actions route reads `action`.
 *
 * @experimental Settles when the composition API ships.
 */
export const pageActionSchema: z.ZodType<PageAction> = z.discriminatedUnion(
  "kind",
  pageActionOptions
);

/** Every page action's `kind`, in the order the schema lists them. */
export const PAGE_ACTION_KINDS: readonly PageAction["kind"][] =
  pageActionOptions.map(option => option.shape.kind.value);

/**
 * A prop path or the visibility switch. Both are optional in the shape, so
 * that naming both, or neither, is refused in words rather than as a union
 * that matched nothing.
 */
const target = {
  nodeId: id,
  propPath: z
    .string()
    .min(1)
    .max(512)
    .optional()
    .describe("The prop to expose. Send this or `visibility`, not both."),
  visibility: z
    .literal(true)
    .optional()
    .describe("Expose whether the block shows. Send this or `propPath`."),
};

/** Refuse a target naming both a prop and the visibility switch, or neither. */
function oneTarget(
  value: { propPath?: string | undefined; visibility?: true | undefined },
  ctx: z.RefinementCtx
): void {
  if ((value.propPath === undefined) !== (value.visibility === undefined))
    return;
  ctx.addIssue({
    code: "custom",
    path: ["propPath"],
    message:
      "Name the field to expose by `propPath`, or `visibility: true`, but not both.",
  });
}

/** Each definition action's shape, once, for the reason the page actions' are. */
const definitionActionOptions = [
  z
    .strictObject({ kind: z.literal("expose"), label, ...target })
    .superRefine(oneTarget),
  z.strictObject({
    kind: z.literal("rename-exposure"),
    exposureId: id,
    label,
  }),
  z
    .strictObject({
      kind: z.literal("retarget-exposure"),
      exposureId: id,
      ...target,
    })
    .superRefine(oneTarget),
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
] as const;

/**
 * A definition action, as the definition actions route reads `action`.
 *
 * @experimental Settles when the composition API ships.
 */
export const definitionActionSchema: z.ZodType<DefinitionAction> = z
  .discriminatedUnion("kind", definitionActionOptions)
  .transform((parsed): DefinitionAction => {
    // A target as the contract types it: exactly the one of the two it names,
    // which the refinement above has already required.
    if (parsed.kind !== "expose" && parsed.kind !== "retarget-exposure")
      return parsed;
    const { propPath, visibility: _visibility, ...rest } = parsed;
    return propPath === undefined
      ? { ...rest, visibility: true }
      : { ...rest, propPath };
  });

/** Every definition action's `kind`, in the order the schema lists them. */
export const DEFINITION_ACTION_KINDS: readonly DefinitionAction["kind"][] =
  definitionActionOptions.map(option => option.shape.kind.value);

/**
 * The JSON Schema form of a page action, as a client that does not run zod
 * reads it: the input the schema accepts, before the parse normalises it.
 *
 * @experimental Settles when the composition API ships.
 */
export function pageActionJsonSchema(): Record<string, unknown> {
  return z.toJSONSchema(pageActionSchema, { io: "input" });
}

/**
 * The JSON Schema form of a definition action. The refinement that a target
 * names exactly one of `propPath` and `visibility` has no JSON Schema form of
 * its own, so it is written into each targeted action here: a tool that
 * validates against this schema refuses what the route refuses.
 *
 * @experimental Settles when the composition API ships.
 */
export function definitionActionJsonSchema(): Record<string, unknown> {
  const schema: { oneOf?: Record<string, unknown>[] } = z.toJSONSchema(
    definitionActionSchema,
    { io: "input" }
  );
  return {
    ...schema,
    ...(schema.oneOf === undefined
      ? {}
      : { oneOf: schema.oneOf.map(withExactlyOneTarget) }),
  };
}

/** The actions whose target is a prop or the visibility switch. */
const TARGETED_KINDS: ReadonlySet<unknown> = new Set([
  "expose",
  "retarget-exposure",
]);

/** One action's JSON Schema, requiring exactly one target where it takes one. */
function withExactlyOneTarget(
  option: Record<string, unknown>
): Record<string, unknown> {
  const properties = option.properties as
    | { kind?: { const?: unknown } }
    | undefined;
  if (!TARGETED_KINDS.has(properties?.kind?.const)) return option;
  return {
    ...option,
    oneOf: [
      { required: ["propPath"], not: { required: ["visibility"] } },
      { required: ["visibility"], not: { required: ["propPath"] } },
    ],
  };
}

/**
 * What a definition edit reads besides the definition.
 *
 * @experimental Settles when the composition API ships.
 */
export interface DefinitionActionSources {
  /** The block definitions, for each prop's type and each slot's lock. */
  readonly definitions: ExposureSources["definitions"];
  /** The ids the component has retired, never to be handed out again. */
  readonly retired?: RetiredExposures;
  /** The host's document limits, which its save judges the definition under. */
  readonly limits?: DocumentLimits;
}

/**
 * Plan one definition edit with the editor's own planner: the edited
 * definition, or why the edit is refused. The definition passed in is never
 * changed.
 *
 * @experimental Settles when the composition API ships.
 */
export function planDefinitionAction(
  definition: BlockDocument,
  action: DefinitionAction,
  sources: DefinitionActionSources
): ExposureEditResult | VariantEditResult {
  const { limits, retired } = sources;
  const exposure: ExposureSources = {
    definitions: sources.definitions,
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

/** An exposure's target, as the planners take it. */
function targetOf(input: ExposureTargetInput): ExposureTarget {
  return "visibility" in input
    ? { nodeId: input.nodeId, visibility: true }
    : { nodeId: input.nodeId, propPath: input.propPath };
}
