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
 * separately costs a second registry enumeration for the same name. The kind
 * matters because a single is read through its own service: a tool that
 * accepted either kind would send a single's slug to the collection registry
 * and surface its not-found in place of the refusal this file is careful to
 * keep uniform.
 *
 * @module tools/schema
 */
import type { McpServer } from "@modelcontextprotocol/server";
import {
  readableContentKind,
  type PluginCollectionService,
  type PluginRouteContext,
  type PluginSinglesService,
} from "@nextlyhq/plugin-sdk";
import { z } from "zod";

export const COLLECTION_SCHEMA_TOOL = "get_collection_schema";
export const SINGLE_SCHEMA_TOOL = "get_single_schema";

/**
 * A field as a registry declares one.
 *
 * Structural rather than imported, because the two registries answer with
 * different types: a single's fields are `SerializedFieldConfig` (name, type
 * and nested fields) and a collection's are `FieldDefinition`, which adds the
 * label, the flags and an `options` bag carrying a relationship's target and a
 * number's format. This is their intersection plus the members only one has,
 * every one optional, so neither source has to be reshaped to fit.
 *
 * `name` is optional at BOTH sources and stays optional here. Presentational
 * types carry none, and substituting an empty string would put a field in the
 * answer that an agent could then try to read.
 */
interface RegistryField {
  name?: string;
  type: string;
  label?: string;
  required?: boolean;
  localized?: boolean;
  /** Type-specific declaration: a relationship's `target`, a number's `format`. */
  options?: Record<string, unknown>;
  /** Present for the container types, which is what makes this recursive. */
  fields?: RegistryField[];
}

/**
 * The declared shape, to whatever depth it is declared.
 *
 * Recursive because a repeater or a group holds its own fields, and a
 * projection that stopped at the top level would describe the document as
 * having a `sections` field of no particular shape. An agent cannot write or
 * even read such a document's values from that.
 */
const FIELD: z.ZodType<RegistryField> = z.lazy(() =>
  z.object({
    name: z.string().optional(),
    type: z.string(),
    label: z.string().optional(),
    required: z.boolean().optional(),
    localized: z.boolean().optional(),
    options: z.record(z.string(), z.unknown()).optional(),
    fields: z.array(FIELD).optional(),
  })
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

/** Passed through, with only the keys the source actually set, at every depth. */
function describeFields(fields: readonly RegistryField[]): RegistryField[] {
  return fields.map(field => ({
    ...(field.name === undefined ? {} : { name: field.name }),
    type: field.type,
    ...(field.label === undefined ? {} : { label: field.label }),
    ...(field.required === undefined ? {} : { required: field.required }),
    ...(field.localized === undefined ? {} : { localized: field.localized }),
    ...(field.options === undefined ? {} : { options: field.options }),
    ...(field.fields === undefined
      ? {}
      : { fields: describeFields(field.fields) }),
  }));
}

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

  /** Readable AND of the kind this tool serves, or nothing to act on. */
  const servable = async (slug: string, kind: "collection" | "single") =>
    caller !== undefined && (await readableContentKind(slug, caller)) === kind;

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
        fields: describeFields(found.schemaDefinition?.fields ?? []),
      });
    }
  );

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
      const declared = await singles.list();
      const found = declared.data.find(item => item.slug === slug);
      // The registry named it a single a moment ago, so its absence from the
      // singles listing is the two registries disagreeing rather than a caller
      // error. Refused the same way, because there is still nothing to answer.
      if (!found) return refuse(slug);

      return answer({
        slug,
        kind: "single",
        ...(found.label ? { label: found.label } : {}),
        fields: describeFields(found.fields),
      });
    }
  );
}
