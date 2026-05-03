import { expect } from "vitest";

/**
 * Custom assertion utilities for service response testing.
 * These helpers make tests more readable and maintainable.
 */

/**
 * Assert that a service response indicates success.
 *
 * @param response - Service response to check
 * @param expectedStatus - Expected HTTP status code (default: 200)
 */
export function expectSuccessResponse<T>(
  response: {
    success: boolean;
    statusCode: number;
    message: string;
    data: T | null;
  },
  expectedStatus: number = 200
) {
  expect(response.success).toBe(true);
  expect(response.statusCode).toBe(expectedStatus);
  expect(response.message).toBeTruthy();
  expect(response.data).not.toBeNull();
}

/**
 * Assert that a service response indicates success for operations that don't return data.
 * Used for update/delete operations that return data: null.
 *
 * @param response - Service response to check
 * @param expectedStatus - Expected HTTP status code (default: 200)
 */
export function expectSuccessResponseNoData(
  response: {
    success: boolean;
    statusCode: number;
    message: string;
    data: null;
  },
  expectedStatus: number = 200
) {
  expect(response.success).toBe(true);
  expect(response.statusCode).toBe(expectedStatus);
  expect(response.message).toBeTruthy();
}

/**
 * Assert that a service response indicates an error.
 *
 * @param response - Service response to check
 * @param expectedStatus - Expected HTTP status code
 * @param expectedMessage - Optional expected error message (partial match)
 */
export function expectErrorResponse(
  response: {
    success: boolean;
    statusCode: number;
    message: string;
    data: any;
  },
  expectedStatus: number,
  expectedMessage?: string
) {
  expect(response.success).toBe(false);
  expect(response.statusCode).toBe(expectedStatus);
  expect(response.data).toBeNull();

  if (expectedMessage) {
    expect(response.message.toLowerCase()).toContain(
      expectedMessage.toLowerCase()
    );
  }
}

/**
 * Assert that a value is a valid UUID format.
 *
 * @param value - Value to check
 */
export function expectValidUUID(value: any) {
  expect(typeof value).toBe("string");
  expect(value).toMatch(
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
  );
}

/**
 * Assert that a response has pagination metadata.
 *
 * @param response - Service response with pagination
 * @param expected - Expected pagination values
 */
export function expectPaginationMeta(
  response: {
    meta?: {
      total: number;
      page: number;
      limit: number;
      totalPages: number;
    };
  },
  expected: {
    total?: number;
    page?: number;
    limit?: number;
    totalPages?: number;
  }
) {
  expect(response.meta).toBeDefined();

  if (expected.total !== undefined) {
    expect(response.meta!.total).toBe(expected.total);
  }
  if (expected.page !== undefined) {
    expect(response.meta!.page).toBe(expected.page);
  }
  if (expected.limit !== undefined) {
    expect(response.meta!.limit).toBe(expected.limit);
  }
  if (expected.totalPages !== undefined) {
    expect(response.meta!.totalPages).toBe(expected.totalPages);
  }
}

/**
 * Assert that an array has a specific length.
 * More readable than expect(array).toHaveLength().
 *
 * @param array - Array to check
 * @param length - Expected length
 */
export function expectArrayLength<T>(array: T[], length: number) {
  expect(array).toHaveLength(length);
}

/**
 * Assert that an array contains an item matching criteria.
 *
 * @param array - Array to search
 * @param matcher - Function to match items
 */
export function expectArrayContains<T>(
  array: T[],
  matcher: (item: T) => boolean
) {
  const found = array.some(matcher);
  expect(found).toBe(true);
}
