/**
 * API Route Error Handler Middleware
 *
 * Provides reusable error handling utilities for Next.js API routes.
 * Works with the ServiceError class to provide consistent error responses.
 *
 * Note: Uses standard Response API instead of NextResponse for compatibility
 * with both Next.js runtime and Node.js CLI environments.
 *
 * @example
 * ```typescript
 * import { withErrorHandler } from '@revnixhq/nextly/api/error-handler';
 * import { getService } from '@revnixhq/nextly';
 *
 * export async function GET(request: Request) {
 *   return withErrorHandler(async () => {
 *     const userService = getService('userService');
 *     const users = await userService.list({}, context);
 *     return users;
 *   });
 * }
 * ```
 *
 * @module api/error-handler
 */

import { isServiceError } from "../errors";
import type { ServiceError } from "../errors";

/**
 * Options for the error handler
 */
export interface ErrorHandlerOptions {
  /**
   * Whether to log errors to console.
   * Defaults to true.
   */
  logErrors?: boolean;

  /**
   * Custom error logger function.
   * If not provided, uses console.error.
   */
  logger?: (message: string, error: unknown) => void;

  /**
   * Whether to include stack traces in development mode.
   * Defaults to true when NODE_ENV !== 'production'.
   */
  includeStack?: boolean;

  /**
   * Custom error message for internal errors.
   * Defaults to "An unexpected error occurred".
   */
  internalErrorMessage?: string;
}

/**
 * API response format for errors
 */
export interface ApiErrorResponse {
  success: false;
  statusCode: number;
  error: {
    code: string;
    message: string;
    details?: unknown;
    stack?: string;
  };
}

/**
 * API response format for success
 */
export interface ApiSuccessResponse<T> {
  success: true;
  statusCode: number;
  data: T;
}

const defaultOptions: Required<ErrorHandlerOptions> = {
  logErrors: true,
  logger: (message, error) => console.error(message, error),
  includeStack: process.env.NODE_ENV !== "production",
  internalErrorMessage: "An unexpected error occurred",
};

function jsonResponse<T>(data: T, status: number): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/**
 * Wrap an API route handler with error handling.
 *
 * Catches errors thrown by the handler and converts them to appropriate
 * HTTP responses. ServiceError instances are converted to their HTTP status
 * codes, while other errors result in 500 Internal Server Error.
 *
 * @param handler - Async function that returns data or Response
 * @param options - Error handling options
 * @returns Response with appropriate status and body
 *
 * @example
 * ```typescript
 * // In an API route
 * export async function GET(request: Request) {
 *   return withErrorHandler(async () => {
 *     const userService = getService('userService');
 *     const users = await userService.list({}, context);
 *     return users; // Will be wrapped in { success: true, data: users }
 *   });
 * }
 *
 * // With custom options
 * export async function POST(request: Request) {
 *   return withErrorHandler(
 *     async () => {
 *       // Handler logic
 *     },
 *     { logErrors: false }
 *   );
 * }
 * ```
 */
export function withErrorHandler<T>(
  handler: () => Promise<T>,
  options: ErrorHandlerOptions = {}
): Promise<Response> {
  const opts = { ...defaultOptions, ...options };

  return handler()
    .then(result => {
      // If handler already returned a Response, pass it through
      if (result instanceof Response) {
        return result;
      }

      const response: ApiSuccessResponse<T> = {
        success: true,
        statusCode: 200,
        data: result,
      };

      return jsonResponse(response, 200);
    })
    .catch((error: unknown) => {
      if (isServiceError(error)) {
        if (opts.logErrors) {
          opts.logger(`[API Error] ${error.code}: ${error.message}`, error);
        }

        const errorObj: ApiErrorResponse["error"] = {
          code: error.code,
          message: error.message,
        };

        if (error.details) {
          errorObj.details = error.details;
        }

        if (opts.includeStack && error.stack) {
          errorObj.stack = error.stack;
        }

        const errorResponse: ApiErrorResponse = {
          success: false,
          statusCode: error.httpStatus,
          error: errorObj,
        };

        return jsonResponse(errorResponse, error.httpStatus);
      }

      if (opts.logErrors) {
        opts.logger("[API Error] Unexpected error:", error);
      }

      const genericErrorObj: ApiErrorResponse["error"] = {
        code: "INTERNAL_ERROR",
        message: opts.internalErrorMessage,
      };

      if (opts.includeStack && error instanceof Error && error.stack) {
        genericErrorObj.stack = error.stack;
      }

      const errorResponse: ApiErrorResponse = {
        success: false,
        statusCode: 500,
        error: genericErrorObj,
      };

      return jsonResponse(errorResponse, 500);
    });
}

/**
 * Convert a ServiceError to a Response.
 *
 * Useful when you need to handle ServiceError manually without the wrapper.
 *
 * @param error - ServiceError instance
 * @param options - Error handling options
 * @returns Response with appropriate status and body
 *
 * @example
 * ```typescript
 * try {
 *   await someOperation();
 * } catch (error) {
 *   if (isServiceError(error)) {
 *     return serviceErrorToResponse(error);
 *   }
 *   throw error; // Re-throw non-service errors
 * }
 * ```
 */
export function serviceErrorToResponse(
  error: ServiceError,
  options: Pick<ErrorHandlerOptions, "includeStack"> = {}
): Response {
  const includeStack =
    options.includeStack ?? process.env.NODE_ENV !== "production";

  const errorObj: ApiErrorResponse["error"] = {
    code: error.code,
    message: error.message,
  };

  if (error.details) {
    errorObj.details = error.details;
  }

  if (includeStack && error.stack) {
    errorObj.stack = error.stack;
  }

  const errorResponse: ApiErrorResponse = {
    success: false,
    statusCode: error.httpStatus,
    error: errorObj,
  };

  return jsonResponse(errorResponse, error.httpStatus);
}

/**
 * Create a success response in the standard format.
 *
 * @param data - Response data
 * @param statusCode - HTTP status code (default: 200)
 * @returns Response with success format
 *
 * @example
 * ```typescript
 * return createSuccessResponse(users, 200);
 * return createSuccessResponse(newUser, 201);
 * ```
 */
export function createSuccessResponse<T>(
  data: T,
  statusCode: number = 200
): Response {
  const response: ApiSuccessResponse<T> = {
    success: true,
    statusCode,
    data,
  };

  return jsonResponse(response, statusCode);
}

/**
 * Create an error response in the standard format.
 *
 * @param code - Error code
 * @param message - Error message
 * @param statusCode - HTTP status code (default: 500)
 * @param details - Additional error details
 * @returns Response with error format
 *
 * @example
 * ```typescript
 * return createErrorResponse('VALIDATION_ERROR', 'Email is required', 400);
 * return createErrorResponse('NOT_FOUND', 'User not found', 404, { userId: id });
 * ```
 */
export function createErrorResponse(
  code: string,
  message: string,
  statusCode: number = 500,
  details?: unknown
): Response {
  const errorObj: ApiErrorResponse["error"] = {
    code,
    message,
  };

  if (details !== undefined) {
    errorObj.details = details;
  }

  const errorResponse: ApiErrorResponse = {
    success: false,
    statusCode,
    error: errorObj,
  };

  return jsonResponse(errorResponse, statusCode);
}
