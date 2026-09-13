/**
 * `get_collection_schema` and `get_single_schema`: the shape of one entity.
 *
 * `get_initial_context` tells an agent WHICH entities it can work with; these
 * tell it what one of them looks like. Split from that answer rather than
 * folded into it for token economy: an install with forty collections would
 * otherwise spend every conversation's opening on thirty-nine schemas nobody
 * asked about.
 *
 * ## Where the schema comes from, and why it is that source
 *
 * The registry, through the services facade, and NOT a description assembled
 * here. Code-first collections are synced into the same `dynamic_collections`
 * registry the Schema Builder writes to, so the registry is the merged view of
 * both and the type generator reads the same records. A tool that read the
 * config object instead would answer correctly for a code-first install and be
 * blind to every collection an operator built in the admin, while looking right
 * in both.
 *
 * ## What a field publishes is decided in core, not here
 *
 * `declaredShape` is the one projection every surface that describes a field
 * uses. This file deliberately holds no list of member names: it held one for
 * three review rounds and lost a declaration key in each, because a list of
 * names cannot notice a name missing from it. Core classifies every key the
 * manifest schema declares as published or withheld and a test holds that
 * classification total, so a key added there fails the build rather than going
 * quietly absent from this answer.
 *
 * ## Authorization happens BEFORE the read, and it has to
 *
 * `collections.getCollection` takes a request context and does not use it: the
 * registry read is not access-controlled, by design, because the registry is
 * how the system describes itself. So the gate is here, and it is a
 * precondition rather than a filter applied to the result. The check runs first
 * and the read does not happen at all when it refuses.
 *
 * The decision is core's `readableContentKind`, which answers the access
 * question and the KIND question together. Both are needed and asking them
 * separately costs a second registry lookup for the same name. The kind matters
 * because a single is read through its own service: a tool that accepted either
 * kind would send a single's slug to the collection registry and surface its
 * not-found in place of the refusal this file is careful to keep uniform.
 *
 * @module tools/schema
 */
import type { McpServer } from "@modelcontextprotocol/server";
import {
  contentReadability,
  declaredShape,
  readableContentKind,
  type DeclaredField,
  type PluginCollectionService,
  type PluginRouteContext,
  type PluginSinglesService,
} from "@nextlyhq/plugin-sdk";
import { z } from "zod";

export const COLLECTION_SCHEMA_TOOL = "get_collection_schema";
export const SINGLE_SCHEMA_TOOL = "get_single_schema";

/**
 * The declared shape, to whatever depth it is declared, with an OPEN key set.
 *
 * `catchall` rather than a closed object, because the projection publishes what
 * a declaration carries and that depends on the field's type and on which
 * writer produced it. The server validates a tool result against this schema,
 * so a closed one turns every field carrying a key not named here into a
 * validation failure instead of an answer. `name`, `type` and `fields` are
 * named because they are the three every consumer reads, and `fields` is what
 * makes this recursive.
 *
 * Recursive because a repeater or a group holds its own fields, and a
 * projection that stopped at the top level would describe the document as
 * having a `sections` field of no particular shape. An agent cannot write or
 * even read such a document's values from that.
 */
const FIELD: z.ZodType<DeclaredField> = z.lazy(() =>
  z
    .object({
      name: z.string().optional(),
      type: z.string(),
      fields: z.array(FIELD).optional(),
    })
    .catchall(z.unknown())
);

const SCHEMA_OUTPUT = z.object({
  slug: z.string(),
  kind: z.enum(["collection", "single"]),
  label: z.string().optional(),
  fields: z.array(FIELD),
});

type SchemaResult = z.infer<typeof SCHEMA_OUTPUT>;

/**
 * The one refusal, worded identically whatever the reason.
 *
 * Names only the slug the CALLER supplied, and says nothing about whether it
 * exists. "Not permitted" and "no such entity" are deliberately one answer:
 * separating them tells an unauthorized caller which slugs are real, so an
 * install's shape can be mapped by asking about guesses.
 */
function refuse(slug: string) {
  return {
    isError: true as const,
    content: [
      {
        type: "text" as const,
        text:
          `No readable entity ${JSON.stringify(slug)}. It may not exist, or ` +
          `your credential may not permit reading it. Call ` +
          `get_initial_context for the entities you can read.`,
      },
    ],
  };
}

/**
 * The answer, in both shapes a client might read it in.
 *
 * `structuredContent` is the real one. The text block beside it exists for
 * clients that negotiated a 2025 revision, which consume `content` alone and do
 * not understand structured output: the protocol library appends a text
 * rendering only when `structuredContent` is a NON-object value, so an
 * object-shaped result like this one reaches those clients as a success with an
 * empty body. Serialized rather than described, so the two carry the same
 * facts.
 */
function answer(schema: SchemaResult) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(schema, null, 2) }],
    structuredContent: schema,
  };
}

/** Whether naming this slug inside a schema would disclose a withheld entity. */
type Withholds = (slug: string) => Promise<boolean>;

/** The slugs a relationship or upload field can point at, in either spelling. */
function targetsOf(field: DeclaredField): string[] {
  const declared = field.relationTo;
  if (typeof declared === "string") return [declared];
  if (Array.isArray(declared)) {
    return declared.filter((slug): slug is string => typeof slug === "string");
  }
  return [];
}

/**
 * The legacy definition's target, which lives in the options bag rather than at
 * the top level.
 *
 * The Builder writes a relation's target as `options.target` where a code-first
 * field writes `relationTo`. Both are the same disclosure, so both are
 * redacted; reading only the top-level spelling would leave every
 * Builder-authored relationship naming a withheld collection.
 */
function legacyTarget(field: DeclaredField): string | undefined {
  const options = field.options;
  if (options === null || typeof options !== "object") return undefined;
  if (Array.isArray(options)) return undefined;
  const target = (options as Record<string, unknown>).target;
  return typeof target === "string" ? target : undefined;
}

/** The declared targets this caller may be told about. */
async function visibleTargets(
  targets: readonly string[],
  withholds: Withholds
): Promise<string[]> {
  const visible: string[] = [];
  for (const slug of targets) {
    if (!(await withholds(slug))) visible.push(slug);
  }
  return visible;
}

/**
 * `relationTo`, reduced to the arms the caller may know about.
 *
 * The key goes entirely when nothing survives, rather than staying as an empty
 * array: a client should read "this field's target is not described" and not
 * "this field points at no collection". A single target that is withheld is the
 * same case, since one withheld arm of one is none.
 */
async function redactRelationTo(
  field: DeclaredField,
  into: DeclaredField,
  withholds: Withholds
): Promise<void> {
  const targets = targetsOf(field);
  if (targets.length === 0) return;
  const visible = await visibleTargets(targets, withholds);
  if (visible.length === 0) delete into.relationTo;
  else if (typeof field.relationTo === "string") into.relationTo = visible[0];
  else into.relationTo = visible;
}

/**
 * The same disclosure in the Builder's spelling, which puts the target inside
 * the options bag rather than at the top level.
 *
 * The bag is copied before the key is removed, because it belongs to the record
 * the registry returned and deleting from it in place would edit the caller's
 * own data.
 */
async function redactLegacyTarget(
  field: DeclaredField,
  into: DeclaredField,
  withholds: Withholds
): Promise<void> {
  const legacy = legacyTarget(field);
  if (legacy === undefined || !(await withholds(legacy))) return;
  const options = { ...(field.options as Record<string, unknown>) };
  delete options.target;
  into.options = options;
}

/**
 * A field with every target the caller may not know about removed.
 *
 * A schema names other entities from inside itself, and a relationship's target
 * is the name of a collection. Forwarding it tells a caller that a collection
 * it was refused by name nonetheless exists, which is the enumeration
 * {@link refuse} is careful to prevent, reached from a different direction.
 *
 * 🔴 Redacted on WITHHELD, never on unreadable. Those differ: `users` and the
 * media library are not registered content entities at all, so
 * `contentReadability` reports no kind for them and they are kept. Redacting on
 * readability alone would strip the target from every upload field and every
 * relationship to a system entity, for a super administrator included, and the
 * schema would describe a reference to nothing.
 *
 * A polymorphic target keeps the arm the caller may read and drops the rest,
 * because the readable arms are still true and still usable. The key goes
 * entirely when nothing survives, rather than staying as an empty array, so a
 * client reads "this field's target is not described" instead of "this field
 * points at no collection".
 */
async function withoutWithheldTargets(
  fields: readonly DeclaredField[],
  withholds: Withholds
): Promise<DeclaredField[]> {
  const kept: DeclaredField[] = [];
  for (const field of fields) {
    const next: DeclaredField = { ...field };
    await redactRelationTo(field, next, withholds);
    await redactLegacyTarget(field, next, withholds);
    // A container's children name targets of their own, and a walk that stopped
    // at the top level would forward every nested relationship untouched.
    if (Array.isArray(field.fields)) {
      next.fields = await withoutWithheldTargets(field.fields, withholds);
    }
    kept.push(next);
  }
  return kept;
}

/** Readable AND of the kind the asking tool serves, or nothing to act on. */
type Servable = (
  slug: string,
  kind: "collection" | "single"
) => Promise<boolean>;

function registerCollectionSchema(
  server: McpServer,
  ctx: PluginRouteContext,
  servable: Servable,
  withholds: Withholds
): void {
  server.registerTool(
    COLLECTION_SCHEMA_TOOL,
    {
      title: "Get collection schema",
      description:
        "The fields of one collection, as this install declares them. Only for a collection your credential may read; call get_initial_context first for the list.",
      inputSchema: z.object({
        slug: z
          .string()
          .describe("The collection's slug, from get_initial_context"),
      }),
      outputSchema: SCHEMA_OUTPUT,
    },
    async ({ slug }) => {
      if (!(await servable(slug, "collection"))) return refuse(slug);

      const collections: PluginCollectionService = ctx.services.collections;
      // An EMPTY context, deliberately. This is a registry read: it is not
      // access-controlled, its context parameter is documented as unused, and
      // the authorization that matters already happened above. Passing a
      // fabricated identity would suggest this call is gated by it when it is
      // not, and passing the caller's real one would be the same suggestion
      // with better disguise.
      const found = await collections.getCollection(slug, {});

      return answer({
        slug,
        kind: "collection",
        ...(found.label ? { label: found.label } : {}),
        fields: await withoutWithheldTargets(
          declaredShape(found.schemaDefinition?.fields ?? []),
          withholds
        ),
      });
    }
  );
}

function registerSingleSchema(
  server: McpServer,
  ctx: PluginRouteContext,
  servable: Servable,
  withholds: Withholds
): void {
  server.registerTool(
    SINGLE_SCHEMA_TOOL,
    {
      title: "Get single schema",
      description:
        "The fields of one single, as this install declares them. Only for a single your credential may read; call get_initial_context first for the list.",
      inputSchema: z.object({
        slug: z
          .string()
          .describe("The single's slug, from get_initial_context"),
      }),
      outputSchema: SCHEMA_OUTPUT,
    },
    async ({ slug }) => {
      if (!(await servable(slug, "single"))) return refuse(slug);

      const singles: PluginSinglesService = ctx.services.singles;
      // Narrowed to the one slug rather than listed and searched here. The
      // registry deserializes every record it returns, fields JSON included, so
      // an unfiltered list materializes the whole registry to answer about one
      // Single, and an agent walking the entities from `get_initial_context`
      // would pay that once per entity.
      const declared = await singles.list({ slugAllowlist: [slug], limit: 1 });
      const found = declared.data.find(item => item.slug === slug);
      // The registry named it a single a moment ago, so its absence from the
      // singles listing is the two registries disagreeing rather than a caller
      // error. Refused the same way, because there is still nothing to answer.
      if (!found) return refuse(slug);

      return answer({
        slug,
        kind: "single",
        ...(found.label ? { label: found.label } : {}),
        // Already projected: the facade reduces a registry record's fields
        // through the same `declaredShape` this file applies to a collection's.
        // Projecting again here would be a second answer to one question.
        fields: await withoutWithheldTargets(found.fields, withholds),
      });
    }
  );
}

/**
 * Both schema tools, on a server built for one caller.
 *
 * The access-and-kind question is resolved once here and handed to each tool,
 * so the two cannot answer it differently: a caller admitted by one and refused
 * by the other is the drift this shares a resolver to prevent. The disclosure
 * question is resolved once for the same reason.
 */
export function registerSchemaTools(
  server: McpServer,
  ctx: PluginRouteContext
): void {
  const caller = ctx.user
    ? {
        user: ctx.user,
        ...(ctx.authenticatedScope
          ? { authenticatedScope: ctx.authenticatedScope }
          : {}),
      }
    : undefined;

  const servable: Servable = async (slug, kind) =>
    caller !== undefined && (await readableContentKind(slug, caller)) === kind;

  // With no caller there is nobody to judge a target against, so every named
  // entity is withheld. The tools refuse before reaching this, since `servable`
  // is false for the same reason; it fails closed rather than relying on that.
  const withholds: Withholds = async slug => {
    if (caller === undefined) return true;
    const { kind, readable } = await contentReadability(slug, caller);
    return kind !== undefined && !readable;
  };

  registerCollectionSchema(server, ctx, servable, withholds);
  registerSingleSchema(server, ctx, servable, withholds);
}
