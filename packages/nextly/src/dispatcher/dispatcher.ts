/**
 * Service dispatcher — thin router that delegates every incoming
 * request to a domain-specific handler.
 *
 * The legacy monolithic dispatcher held ~3,000 lines of per-method
 * logic. That logic now lives in `./handlers/*`. This class keeps only:
 *
 * - Lazy initialization of the underlying `ServiceContainer` (it resolves
 *   the adapter from DI or falls back to env-based adapter creation).
 * - Request validation (service + operation + method presence/shape).
 * - Service-name → handler dispatch (the `executeServiceMethod` switch).
 * - Response normalization (`ServiceResult` → `DispatchResult`).
 * - Error-status mapping (heuristic text match on error messages).
 *
 * Route handlers (e.g. `auth-handler.ts`, `route-parser.ts`) import
 * `ServiceDispatcher` from `@nextly/services` / `src/services/dispatcher.ts`,
 * which re-exports this class.
 */

import { createAdapterFromEnv } from "../database/factory";
import { NextlyError } from "../errors/nextly-error";
import { ServiceContainer } from "../services";
import { ServiceResult } from "../types/auth";

import { dispatchAuth, dispatchRbac } from "./handlers/auth-dispatcher";
import { dispatchCollections } from "./handlers/collection-dispatcher";
import { dispatchComponents } from "./handlers/component-dispatcher";
import {
  dispatchEmailProviders,
  dispatchEmailTemplates,
} from "./handlers/email-dispatcher";
import { dispatchForms } from "./handlers/form-dispatcher";
import { dispatchSingles } from "./handlers/single-dispatcher";
import { dispatchUser } from "./handlers/user-dispatcher";
import { dispatchUserFields } from "./handlers/user-field-dispatcher";
import { getAdapterFromDI } from "./helpers/di";
import type {
  DispatchRequest,
  DispatchResult,
  OperationType,
  Params,
  ServiceType,
} from "./types";

/**
 * ServiceDispatcher routes API requests to the appropriate service
 * method. It provides a unified dispatch interface for all service
 * operations, handling parameter validation, type coercion, and error
 * handling.
 *
 * @example
 * ```typescript
 * const dispatcher = new ServiceDispatcher();
 * const result = await dispatcher.dispatch({
 *   service: 'users',
 *   operation: 'single',
 *   method: 'getUserById',
 *   params: { userId: '123' }
 * });
 * ```
 */
export class ServiceDispatcher {
  private container: ServiceContainer;
  private availableServices: Set<ServiceType> = new Set([
    "users",
    "rbac",
    "auth",
    "collections",
    "singles",
    "forms",
    "components",
    "userFields",
    "emailProviders",
    "emailTemplates",
  ]);

  constructor() {
    const adapter = getAdapterFromDI();
    if (!adapter) {
      throw new Error(
        "Database adapter not found in DI container. Ensure nextly is initialized before dispatching."
      );
    }
    this.container = new ServiceContainer(adapter);
  }

  /** Returns the underlying service container. */
  getContainer(): ServiceContainer {
    return this.container;
  }

  /** Checks if a service is available. */
  isServiceAvailable(service: ServiceType): boolean {
    return this.availableServices.has(service);
  }

  /** Validates a dispatch request. */
  validateRequest(request: DispatchRequest): {
    valid: boolean;
    error?: string;
  } {
    if (!request.service)
      return { valid: false, error: "Service type is required" };

    if (!this.isServiceAvailable(request.service)) {
      return {
        valid: false,
        error: `Service '${request.service}' is not available. Available services: ${Array.from(this.availableServices).join(", ")}`,
      };
    }

    if (!request.operation)
      return { valid: false, error: "Operation type is required" };

    const validOperations: OperationType[] = [
      "single",
      "list",
      "create",
      "update",
      "delete",
      "count",
    ];
    if (!validOperations.includes(request.operation)) {
      return {
        valid: false,
        error: `Invalid operation '${request.operation}'. Valid operations: ${validOperations.join(", ")}`,
      };
    }

    if (!request.method)
      return { valid: false, error: "Method name is required" };

    return { valid: true };
  }

  /**
   * Ensure the service container is fully initialized with an adapter.
   * Resolves from DI first and falls back to environment-based adapter
   * creation when DI hasn't been initialized (e.g. certain test paths).
   */
  private async ensureInitialized(): Promise<void> {
    if (this.container.hasAdapter) return;

    const adapter = getAdapterFromDI();
    if (adapter) {
      this.container = new ServiceContainer(adapter);
      return;
    }

    try {
      const envAdapter = await createAdapterFromEnv();
      await envAdapter.connect();
      this.container = new ServiceContainer(envAdapter);
    } catch {
      throw new Error(
        "ServiceDispatcher: Could not initialize database adapter from DI or environment."
      );
    }
  }

  /**
   * Dispatches a request to the appropriate service method.
   *
   * @param request - Service, method, params, and body to execute.
   * @returns Standardized dispatch result with success, data, and error.
   */
  async dispatch(request: DispatchRequest): Promise<DispatchResult> {
    await this.ensureInitialized();

    const validation = this.validateRequest(request);
    if (!validation.valid) {
      return {
        success: false,
        error: NextlyError.validation({
          errors: [
            {
              path: "request",
              code: "INVALID_REQUEST",
              message: validation.error ?? "Invalid request.",
            },
          ],
        }),
        status: 400,
      };
    }

    try {
      const result = await this.executeServiceMethod(request);

      // Handlers built via respondX helpers return a Response directly
      // (body, status, content-type already set). Pass through unchanged
      // via DispatchResult.data; routeHandler reads it as `instanceof
      // Response` and returns it. This MUST come before the smart-extract
      // path below: a Response has a `.status` property which would
      // falsely trigger smart-extract and lose the body.
      if (result instanceof Response) {
        return { success: true, data: result, status: result.status };
      }

      // Normalize ServiceResult-shaped responses so every dispatch
      // exits via the same DispatchResult contract. The smart-extract
      // path below remains for unmigrated handlers that still return
      // ServiceResult-shaped objects.
      if (
        result &&
        typeof result === "object" &&
        ("statusCode" in result || "status" in result)
      ) {
        const r = result as ServiceResult;
        return {
          success: r.success ?? true,
          message: r.success ? r.message : undefined,
          // Even for legacy ServiceResult errors, propagate as NextlyError
          // so the route wrapper can build a canonical response. Wrap the
          // legacy string message in INTERNAL_ERROR.
          error:
            !r.success && r.message
              ? NextlyError.internal({
                  logContext: { legacyServiceResultMessage: r.message },
                })
              : undefined,
          status: r.statusCode ?? r.status ?? 200,
          data: r.data,
          meta: (r as Record<string, unknown>).meta,
        };
      }

      return { success: true, data: result, status: 200 };
    } catch (error) {
      // Propagate the original NextlyError (not a stringified message) so
      // the route wrapper rebuilds the response with the correct status,
      // code, publicData, and headers.
      const nextlyErr = NextlyError.is(error)
        ? error
        : NextlyError.internal({
            cause: error instanceof Error ? error : undefined,
          });
      return {
        success: false,
        error: nextlyErr,
        status: nextlyErr.statusCode,
      };
    }
  }

  private executeServiceMethod(request: DispatchRequest): Promise<unknown> {
    const { service, method, params = {}, body } = request;
    const p = params as Params;

    switch (service) {
      case "users":
        return dispatchUser(this.container, method, p, body);
      case "auth":
        return dispatchAuth(this.container, method, p, body);
      case "collections":
        return dispatchCollections(this.container, method, p, body);
      case "rbac":
        return dispatchRbac(this.container, method, p, body);
      case "singles":
        return dispatchSingles(method, p, body);
      case "forms":
        return dispatchForms(this.container, method, p, body, request.request);
      case "components":
        return dispatchComponents(method, p, body);
      case "userFields":
        return dispatchUserFields(method, p, body);
      case "emailProviders":
        return dispatchEmailProviders(method, p, body);
      case "emailTemplates":
        return dispatchEmailTemplates(method, p, body);
      case "posts":
        throw new Error("Posts service is not yet implemented");
      default:
        throw new Error(`Unknown service: ${service as string}`);
    }
  }

  /** Registers a new service type. */
  addService(service: ServiceType): void {
    this.availableServices.add(service);
  }

  /** Unregisters a service type. */
  removeService(service: ServiceType): void {
    this.availableServices.delete(service);
  }

  /** Returns list of available service types. */
  getAvailableServices(): ServiceType[] {
    return Array.from(this.availableServices);
  }

  /** Executes a function within a database transaction. */
  async withTransaction<T>(
    fn: (dispatcher: ServiceDispatcher) => Promise<T>
  ): Promise<T> {
    return this.container.withTransaction(async txServices => {
      const txDispatcher = new ServiceDispatcher();
      txDispatcher.container = txServices;
      txDispatcher.availableServices = new Set(this.availableServices);
      return fn(txDispatcher);
    });
  }
}
