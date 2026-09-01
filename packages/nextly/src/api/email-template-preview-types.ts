/**
 * The draft-preview wire contract, for the client that has to satisfy it.
 *
 * A types-only entry point so an admin — or any consumer building the request
 * — derives its payload from the schema the server validates against, rather
 * than mirroring it. A hand-written mirror compiles happily while the server
 * rejects every call: adding a required field on one side is invisible to the
 * other until runtime, which is the same failure mode this feature already had
 * when the preview render existed twice.
 *
 * Re-exported from the leaf that declares it, so importing this pulls zod and
 * nothing else — no DI container, no route handler.
 *
 * @module api/email-template-preview-types
 */
export {
  draftPreviewSchema,
  type DraftPreviewRequest,
  type DraftPreviewParsed,
} from "../domains/email/draft-preview-request";
export type { RenderedTemplate } from "../domains/email/services/render-template";
