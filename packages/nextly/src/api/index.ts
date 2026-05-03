// Public exports for @revnixhq/nextly/api entry point.
//
// Route Handler authoring lives here: wrap handler bodies in `withErrorHandler`
// and return a canonical respondX helper from `./response-shapes`
// (`respondList`, `respondDoc`, `respondMutation`, `respondAction`,
// `respondData`, `respondCount`, `respondBulk`, `respondBulkUpload`) for
// success or throw a `NextlyError` for failure.

export { withErrorHandler } from "./with-error-handler";
export { generateRequestId, readOrGenerateRequestId } from "./request-id";
