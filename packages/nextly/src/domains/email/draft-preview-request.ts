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

import { writtenDocumentSchema } from "./written/document";

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
    /**
     * The saved template these fields are a draft of, if any. Without
     * `legacy`, its engine decides the preview's: one kept on the old engine
     * previews as it sends.
     */
    id: z.string().optional(),
    /**
     * Preview with the old `{{variable}}` engine (true) or Liquid (false),
     * whatever the saved template uses.
     */
    legacy: z.boolean().optional(),
    /**
     * A written draft's blocks, previewed from the blocks as they are typed.
     * Checked by the same rules a save of them is.
     */
    format: z.enum(["code", "written"]).optional(),
    blocks: writtenDocumentSchema.nullable().optional(),
  }),
  data: z.record(z.string(), z.unknown()),
});

/**
 * What a CALLER sends — the schema's input, not its output.
 *
 * `z.infer` describes the value after parsing, where every `.default(null)`
 * field has been filled in and is therefore required. Publishing that as the
 * request contract rejects payloads the server accepts: omitting
 * `plainTextContent` is valid on the wire and a compile error against the
 * output type. The two differ precisely BECAUSE the schema has defaults, so
 * the distinction is load-bearing rather than stylistic.
 */
export type DraftPreviewRequest = z.input<typeof draftPreviewSchema>;

/**
 * What the SERVER holds once the body has been parsed: defaults applied, so
 * every field is present. Named separately because a handler reading
 * `template.preheader` needs the guarantee that the caller's type cannot give.
 */
export type DraftPreviewParsed = z.output<typeof draftPreviewSchema>;
