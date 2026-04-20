/**
 * Public types for the service dispatcher.
 *
 * The dispatcher routes API requests to the appropriate service method,
 * normalizes responses, and maps error messages to HTTP status codes.
 * Consumers (route handlers) import `ServiceDispatcher` plus these
 * types to build and interpret dispatch requests.
 */

export type ServiceType =
  | "users"
  | "rbac"
  | "auth"
  | "posts"
  | "collections"
  | "fieldPermissions"
  | "singles"
  | "forms"
  | "components"
  | "userFields"
  | "emailProviders"
  | "emailTemplates"
  | "apiKeys"
  | "generalSettings"
  | "imageSizes"
  | "dashboard"
  | "email";

export type OperationType =
  | "single"
  | "list"
  | "create"
  | "update"
  | "delete"
  | "count";

export interface DispatchRequest {
  service: ServiceType;
  operation: OperationType;
  method: string;
  params?: Record<string, unknown>;
  body?: unknown;
  userId?: string;
  /** Optional request object for accessing headers. */
  request?: Request;
}

export interface DispatchResult {
  success: boolean;
  data?: unknown;
  error?: string;
  status: number;
  message?: string;
  meta?: unknown;
}

/** Type-safe params record shared by every handler. */
export type Params = Record<string, string>;

/**
 * Method handler contract used by every domain dispatcher's method map.
 * `TService` is the concrete type of the service object passed at runtime
 * (e.g. `UsersService`, `CollectionsHandler`).
 */
export interface MethodHandler<TService> {
  execute: (
    service: TService,
    params: Params,
    body: unknown,
    request?: Request
  ) => Promise<unknown>;
}
