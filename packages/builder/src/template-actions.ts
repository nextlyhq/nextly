/**
 * The collection template actions as data: what an API client, a script or an
 * agent sends to give a collection its template, to publish it and to delete
 * it, and to give one entry a design of its own or take it away, with the
 * schema that judges it.
 *
 * Published from the `ops` subpath beside the composition actions, for the
 * same reason: the page builder's template route parses its bodies with this
 * schema, so a client that validates against it is refused for exactly what
 * the server refuses. What a template may be (which collections can have one,
 * and that a collection has at most one) is the server's to judge, so the
 * schema holds the request's shape and no more.
 *
 * @experimental Settles when collection templates ship.
 * @module template-actions
 */
import { z } from "zod";

/**
 * One action on a collection's template.
 *
 * @experimental Settles when collection templates ship.
 */
export type TemplateAction =
  /**
   * Give a collection its template: an empty template document, saved as a
   * draft unless `publish` is set. Refused when the collection already has
   * one, naming it.
   */
  | {
      readonly kind: "create-template";
      /** The collection whose entries the template renders, by slug. */
      readonly collection: string;
      /** The template's name in the admin; the collection's name by default. */
      readonly title?: string;
      readonly publish?: boolean;
    }
  /** Publish a template, its working draft included, as the editor's Publish does. */
  | {
      readonly kind: "publish-template";
      readonly id: string;
    }
  /**
   * Give an entry its own design: a copy of its collection's published
   * template, saved as a draft, so the entry keeps being drawn with the
   * template until the copy is published. Refused when the collection has no
   * published template, or the entry already has its own design.
   */
  | {
      readonly kind: "give-entry-design";
      /** The entry's collection, by slug. */
      readonly collection: string;
      /** The entry's id. */
      readonly entry: string;
      /** The own design's name in the admin; the entry's title by default. */
      readonly title?: string;
    }
  /**
   * Remove an entry's own design, so the entry is drawn with its
   * collection's template again.
   */
  | {
      readonly kind: "remove-entry-design";
      readonly collection: string;
      readonly entry: string;
    }
  /**
   * Delete a template by id: a collection's template, after which the
   * collection's entries without their own design are not shown as pages until
   * it has a published template again, or an entry's own design, after which
   * the entry is drawn with its collection's template. A dry run answers the
   * template it would delete, so a client can say what that means first.
   */
  | {
      readonly kind: "delete-template";
      readonly id: string;
    };

const id = z.string().min(1).max(512);

/**
 * Each template action's shape, once: the schema is their union, and the
 * kinds a client is told about are read off them, so the two cannot disagree.
 */
const templateActionOptions = [
  z.strictObject({
    kind: z.literal("create-template"),
    collection: id,
    title: z.string().trim().min(1).max(255).optional(),
    publish: z.boolean().optional(),
  }),
  z.strictObject({
    kind: z.literal("publish-template"),
    id,
  }),
  z.strictObject({
    kind: z.literal("give-entry-design"),
    collection: id,
    entry: id,
    title: z.string().trim().min(1).max(255).optional(),
  }),
  z.strictObject({
    kind: z.literal("remove-entry-design"),
    collection: id,
    entry: id,
  }),
  z.strictObject({
    kind: z.literal("delete-template"),
    id,
  }),
] as const;

/**
 * A template action, as the template actions route reads `action`.
 *
 * @experimental Settles when collection templates ship.
 */
export const templateActionSchema: z.ZodType<TemplateAction> =
  z.discriminatedUnion("kind", templateActionOptions);

/** Every template action's `kind`, in the order the schema lists them. */
export const TEMPLATE_ACTION_KINDS: readonly TemplateAction["kind"][] =
  templateActionOptions.map(option => option.shape.kind.value);

/**
 * The JSON Schema form of a template action.
 *
 * @experimental Settles when collection templates ship.
 */
export function templateActionJsonSchema(): Record<string, unknown> {
  return z.toJSONSchema(templateActionSchema, { io: "input" });
}
