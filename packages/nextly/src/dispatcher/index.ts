/**
 * Barrel export for the decomposed dispatcher.
 *
 * Consumers should import `ServiceDispatcher` and its request/result
 * types from `@nextly/services/dispatcher` (which re-exports from
 * here). Handlers and helpers are implementation details and not
 * re-exported at this layer.
 */

export { ServiceDispatcher } from "./dispatcher";
export type {
  DispatchRequest,
  DispatchResult,
  MethodHandler,
  OperationType,
  Params,
  ServiceType,
} from "./types";
