/**
 * `get_collection_schema` and `get_single_schema`: the shape of one entity.
 *
 * `get_initial_context` tells an agent WHICH entities it can work with;
 * these tell it what one of them looks like. Split from that answer rather than
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
 * and the read does not happen at all when it refuses, which is the ordering a
 * cost saving must never reverse.
 *
 * The decision itself is core's `canReadContent`, the same one that built the
 * list in `get_initial_context`. Two tools disagreeing about whether a caller
 * may see an entity would let an agent read the shape of something the overview
 * told it did not exist.
 *
 * @module tools/schema
 */
import type { McpServer } from "@modelcontextprotocol/server";
import { canReadContent, type PluginRouteContext } from "@nextlyhq/plugin-sdk";
import { z } from "zod";

export const COLLECTION_SCHEMA_TOOL = "get_collection_schema";
export const SINGLE_SCHEMA_TOOL = "get_single_schema";

/**
 * One field, as the registry declares it.
 *
 * Passed through rather than remapped. A second vocabulary here would be a
 * second answer to "what is this field", and the one the registry holds is the
 * one the generated types, the admin form and the validation all read.
 */
const FIELD = z.object({
  /**
   * Optional because a field's name is. Presentational types carry none, and
   * emitting an empty string for them would invent a field an agent could try
   * to read. Absent says what is true.
   */
  name: z.string().optional(),
  type: z.string(),
  required: z.boolean().optional(),
  localized: z.boolean().optional(),
  label: z.string().optional(),
});

const SCHEMA_OUTPUT = z.object({
  slug: z.string(),
  kind: z.enum(["collection", "single"]),
  label: z.string().optional(),
  fields: z.array(FIELD),
});

/** The refusal, worded the same for both tools so a client can match on it. */
function refuse(slug: string) {
  return {
    isError: true as const,
    content: [
      {
        type: "text" as const,
        // Names the slug the CALLER supplied, which they already hold, and
        // nothing about whether it exists. "Not permitted" and "no such entity"
        // are deliberately one answer: separating them tells an unauthorized
        // caller which slugs are real.
        text:
          `No readable entity ${JSON.stringify(slug)}. It may not exist, or ` +
          `your credential may not permit reading it. Call ` +
          `get_initial_context for the entities you can read.`,
      },
    ],
  };
}

/**
 * A field as both registries declare one: the declaration, never a value.
 *
 * `name` is optional at the source and stays optional here rather than being
 * defaulted. A presentational field carries none, and substituting an empty
 * string would put a field in the answer that an agent could then ask to read.
 */
interface RegistryField {
  name?: string;
  type: string;
  required?: boolean;
  localized?: boolean;
  label?: string;
}

/** Passed through, with only the keys the source actually set. */
function describeFields(fields: readonly RegistryField[]) {
  return fields.map(field => ({
    ...(field.name === undefined ? {} : { name: field.name }),
    type: field.type,
    ...(field.required === undefined ? {} : { required: field.required }),
    ...(field.localized === undefined ? {} : { localized: field.localized }),
    ...(field.label === undefined ? {} : { label: field.label }),
  }));
}

/** The narrow views of the two services these tools read. */
interface CollectionReader {
  getCollection: (
    slug: string,
    opts?: unknown
  ) => Promise<{
    label?: string;
    schemaDefinition?: { fields?: RegistryField[] };
  }>;
}
interface SinglesReader {
  list: () => Promise<{
    items: { slug: string; label?: string; fields?: RegistryField[] }[];
  }>;
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
      if (!caller || !(await canReadContent(slug, caller))) return refuse(slug);

      const collections = ctx.services
        .collections as unknown as CollectionReader;
      const found = await collections.getCollection(slug, {
        as: "user",
        user: ctx.user ?? undefined,
      });

      return {
        content: [],
        structuredContent: {
          slug,
          kind: "collection" as const,
          ...(found.label ? { label: found.label } : {}),
          fields: describeFields(found.schemaDefinition?.fields ?? []),
        },
      };
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
      if (!caller || !(await canReadContent(slug, caller))) return refuse(slug);

      const singles = ctx.services.singles as unknown as SinglesReader;
      const declared = await singles.list();
      const found = declared.items.find(item => item.slug === slug);
      // Registered and readable, yet absent from the singles registry: it is a
      // collection. Refused with the same words rather than a different error,
      // because the caller asked the wrong tool and the right one is named in
      // the refusal.
      if (!found) return refuse(slug);

      return {
        content: [],
        structuredContent: {
          slug,
          kind: "single" as const,
          ...(found.label ? { label: found.label } : {}),
          fields: describeFields(found.fields ?? []),
        },
      };
    }
  );
}
