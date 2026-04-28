// Public exports for @revnixhq/nextly/api entry point.
//
// Route Handler authoring lives here: wrap handler bodies in `withErrorHandler`
// and return either `createSuccessResponse` / `createPaginatedResponse` for
// success or throw a `NextlyError` for failure.

export { withErrorHandler } from "./with-error-handler";
export {
  createSuccessResponse,
  createPaginatedResponse,
  type PaginationMeta,
} from "./create-success-response";
export { generateRequestId, readOrGenerateRequestId } from "./request-id";
