// Public exports for @revnixhq/nextly/errors entry point.

export { NextlyError, type NextlyErrorResponseJSON } from "./nextly-error";
export { NEXTLY_ERROR_STATUS, type NextlyErrorCode } from "./error-codes";
export type {
  PublicData,
  ValidationPublicData,
  RateLimitPublicData,
} from "./public-data";

// Legacy exports kept during the migration shim period (deleted in PR 12).
export {
  ServiceError,
  ServiceErrorCode,
  isServiceError,
} from "./service-error";
