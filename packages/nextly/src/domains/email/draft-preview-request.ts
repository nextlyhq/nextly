/**
 * The wire contract for rendering UNSAVED email-template fields.
 *
 * Declared once because it has two transports and must not have two answers.
 * A generated app mounts the `createDynamicHandlers` catch-all, while an app
 * that wants the route on its own mounts `api/email-templates-draft-preview`;
 * both accept this body. A second schema beside the other transport is the
 * shape that drifts — one gains a field, the other rejects it, and which one
 * a caller met depends on how the host happened to be mounted.
 *
 * A leaf on purpose: it imports zod and nothing else, so the dispatcher can
 * validate against it without pulling the route module's DI graph in behind it.
 *
 * @module domains/email/draft-preview-request
 */
import { z } from "zod";

/**
 * The fields a render needs, and nothing else.
 *
 * Deliberately not the full template shape: a preview never writes, so
 * accepting a name, a slug or an id would take input it has no use for.
 */
export const draftPreviewSchema = z.object({
  template: z.object({
    subject: z.string(),
    htmlContent: z.string(),
    plainTextContent: z.string().nullable().default(null),
    preheader: z.string().nullable().default(null),
    useLayout: z.boolean(),
    kind: z.enum(["template", "layout", "partial"]),
    layoutId: z.string().nullable().default(null),
  }),
  data: z.record(z.string(), z.unknown()),
});

export type DraftPreviewRequest = z.infer<typeof draftPreviewSchema>;
