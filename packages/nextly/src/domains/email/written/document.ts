/**
 * A written email: the blocks an editor writes in place of HTML.
 *
 * Stored as Nextly's own versioned data, never as HTML, so the look comes
 * from the brand settings and the layout, and every value a send supplies is
 * written safely for where it sits. A template is written or coded, never
 * both: a coded template is never turned into blocks.
 *
 * @experimental The block set may grow; a stored document carries its
 * `version` so a later format can read an earlier one.
 *
 * @module domains/email/written/document
 */

import { z } from "zod";

/** The format a template is stored in. Rows stored before written emails read as `code`. */
export type TemplateFormat = "code" | "written";

/** A variable a send supplies, by path: `name`, `order.total`, and inside a list `item.price`. */
const variablePath = z
  .string()
  .regex(
    /^[A-Za-z_]\w*(\.[A-Za-z_]\w*)*$/,
    "Use a variable name such as order.total."
  )
  .max(200);

/** Where a link or an image may point: the web, and for a link a mail client. */
const WEB = /^https?:\/\//i;
const MAIL = /^mailto:/i;

const linkUrl = z
  .string()
  .trim()
  .max(2048)
  .refine(
    url => WEB.test(url) || MAIL.test(url),
    "Use an http, https or mailto link."
  );

const imageUrl = z
  .string()
  .trim()
  .max(2048)
  .refine(url => WEB.test(url), "Use an http or https image address.");

/**
 * A variable shown in an email. Its fallback is used when the value is absent,
 * null or an empty string, and never for false or 0, which are values.
 */
const chipSchema = z
  .object({
    variable: variablePath,
    fallback: z.string().max(500).optional(),
  })
  .strict();

export type Chip = z.infer<typeof chipSchema>;

/** A link's destination: fixed, or a variable holding the address. */
const linkSchema = z.union([
  z.object({ url: linkUrl }).strict(),
  z
    .object({
      chip: chipSchema.extend({ fallback: linkUrl.optional() }).strict(),
    })
    .strict(),
]);

export type WrittenLink = z.infer<typeof linkSchema>;

const marks = {
  bold: z.boolean().optional(),
  italic: z.boolean().optional(),
  link: linkSchema.optional(),
};

/** A run of text, or a chip, with the marks rich text allows. */
const inlineSchema = z.discriminatedUnion("type", [
  z
    .object({ type: z.literal("text"), text: z.string().max(10_000), ...marks })
    .strict(),
  z.object({ type: z.literal("chip"), ...chipSchema.shape, ...marks }).strict(),
]);

export type Inline = z.infer<typeof inlineSchema>;

/** Plain text with chips: a heading, a button's label, an image's alt text. */
const plainInlineSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("text"), text: z.string().max(10_000) }).strict(),
  z.object({ type: z.literal("chip"), ...chipSchema.shape }).strict(),
]);

export type PlainInline = z.infer<typeof plainInlineSchema>;

/**
 * When a block shows: when a variable has a value (present, and not null, an
 * empty string or an empty list; 0 and false are values), is yes (true), or
 * is no (false).
 */
const conditionSchema = z
  .object({
    variable: variablePath,
    when: z.enum(["present", "yes", "no"]),
  })
  .strict();

export type Condition = z.infer<typeof conditionSchema>;

const show = { show: conditionSchema.optional() };

const contentBlocks = [
  z
    .object({
      type: z.literal("heading"),
      text: z.array(plainInlineSchema).max(200),
      ...show,
    })
    .strict(),
  z
    .object({
      type: z.literal("text"),
      text: z.array(inlineSchema).max(500),
      ...show,
    })
    .strict(),
  z
    .object({
      type: z.literal("button"),
      label: z.array(plainInlineSchema).min(1).max(50),
      link: linkSchema,
      ...show,
    })
    .strict(),
  z
    .object({
      type: z.literal("image"),
      src: z.union([
        z.object({ url: imageUrl }).strict(),
        z
          .object({
            chip: chipSchema.extend({ fallback: imageUrl.optional() }).strict(),
          })
          .strict(),
      ]),
      alt: z.array(plainInlineSchema).max(50),
      width: z.number().int().min(16).max(600).optional(),
      ...show,
    })
    .strict(),
  z.object({ type: z.literal("divider"), ...show }).strict(),
  z
    .object({
      type: z.literal("spacer"),
      height: z.number().int().min(4).max(96).optional(),
      ...show,
    })
    .strict(),
] as const;

/** A block a list can repeat: anything but another list. */
const contentBlockSchema = z.discriminatedUnion("type", [...contentBlocks]);

export type ContentBlock = z.infer<typeof contentBlockSchema>;

/** Repeats its blocks for each item of a list variable; inside, `item` is the current one. */
const listBlockSchema = z
  .object({
    type: z.literal("list"),
    variable: variablePath,
    blocks: z.array(contentBlockSchema).max(50),
    ...show,
  })
  .strict();

export type ListBlock = z.infer<typeof listBlockSchema>;

const blockSchema = z.discriminatedUnion("type", [
  ...contentBlocks,
  listBlockSchema,
]);

export type WrittenBlock = z.infer<typeof blockSchema>;

/** The written form of a template, as stored. */
export const writtenDocumentSchema = z
  .object({
    version: z.literal(1),
    blocks: z.array(blockSchema).max(200),
  })
  .strict();

export type WrittenDocument = z.infer<typeof writtenDocumentSchema>;

/** The name a list's blocks read their current item under. */
export const LIST_ITEM = "item";
