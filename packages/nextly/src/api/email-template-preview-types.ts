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
  type DraftPreview,
} from "../domains/email/draft-preview-request";
export type { RenderedTemplate } from "../domains/email/services/render-template";
/**
 * Whether an address a written email holds can be saved, as a save checks it:
 * an editor tells the author while they type, from the same rule, rather than
 * a copy of it. It imports nothing, so this entry point stays light.
 */
export { allowedUrl, type UrlKind } from "../domains/email/written/urls";
/**
 * Whether a written email can store a variable path, as a save checks it:
 * the name pattern, the length cap and the names its compiler keeps for
 * itself. Its module needs only zod and the address rule above.
 */
export { storableVariablePath } from "../domains/email/written/document";
