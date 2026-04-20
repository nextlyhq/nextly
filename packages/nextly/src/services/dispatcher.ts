/**
 * Re-export shim for the decomposed dispatcher.
 *
 * The dispatcher lives under `src/dispatcher/` as of Plan 23 Phase 9.
 * This module is preserved so existing imports
 * (`@nextly/services/dispatcher`, `from "./dispatcher"`, etc.) keep
 * working while we migrate callers.
 */

export {
  ServiceDispatcher,
  type DispatchRequest,
  type DispatchResult,
  type MethodHandler,
  type OperationType,
  type Params,
  type ServiceType,
} from "../dispatcher";
