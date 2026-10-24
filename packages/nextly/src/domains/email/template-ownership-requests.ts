/**
 * The bodies of the template ownership routes, parsed at the boundary.
 *
 * One schema per body, shared by every transport that accepts it, so a body
 * one route accepts is never refused by another.
 */

import { z } from "zod";

import { writtenDocumentSchema } from "./written/document";

const versionSchema = z
  .object({
    subject: z.string(),
    htmlContent: z.string(),
    plainTextContent: z.string().nullable(),
    preheader: z.string().nullable(),
  })
  .strict();

/** `PATCH /email-templates/:id/override`: where the site's version starts. */
export const overrideTemplateSchema = z
  .object({ version: versionSchema.partial().optional() })
  .strict();

const choiceSchema = z.discriminatedUnion("use", [
  z.object({ use: z.literal("mine") }).strict(),
  z.object({ use: z.literal("theirs") }).strict(),
  z.object({ use: z.literal("edited"), text: z.string() }).strict(),
]);

/**
 * `PATCH /email-templates/:id/apply-update`: a choice per offered change, and
 * the `review` token of the comparison they were made on.
 */
export const applyOwnerUpdateSchema = z
  .object({
    choices: z.record(z.string(), choiceSchema),
    review: z.string().min(1),
  })
  .strict();

/** `PATCH /email-templates/:id/undo-update`: what the apply returned. */
export const undoOwnerUpdateSchema = z
  .object({
    undo: z
      .object({
        version: versionSchema,
        blocks: writtenDocumentSchema.nullable().optional(),
        base: versionSchema,
        applied: z.string().min(1),
        appliedBase: z.string().min(1),
      })
      .strict(),
  })
  .strict();
