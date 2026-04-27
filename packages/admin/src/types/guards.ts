/**
 * Type Guards for Runtime Validation
 *
 * This module provides type guard functions for validating data at runtime.
 * These are particularly useful for:
 * - Validating API responses before TypeScript assumes the type
 * - Ensuring data integrity in optimistic updates
 * - Defensive programming in critical paths
 *
 * @module types/guards
 */

import type { Role, Permission } from "./entities";
import type { User, UserApiResponse } from "./user";

/**
 * Type guard to check if unknown data is a valid User object
 *
 * Validates that the object has the minimum required User properties:
 * - id: string
 * - email: string
 *
 * @param data - Unknown data to validate
 * @returns True if data is a valid User, with type narrowing to User
 *
 * @example
 * ```ts
 * const data: unknown = await api.fetchUser();
 * if (isUser(data)) {
 *   // TypeScript now knows data is User
 *   console.log(data.email);
 * }
 * ```
 */
export const isUser = (data: unknown): data is User => {
  return (
    typeof data === "object" &&
    data !== null &&
    "id" in data &&
    typeof (data).id === "string" &&
    "email" in data &&
    typeof (data as { email: unknown }).email === "string"
  );
};

/**
 * Type guard to check if unknown data is a valid UserApiResponse object
 *
 * UserApiResponse extends User but has id as number instead of string.
 * Validates minimum required properties for API response format.
 *
 * @param data - Unknown data to validate
 * @returns True if data is a valid UserApiResponse
 *
 * @example
 * ```ts
 * const response: unknown = await fetch('/api/users/1');
 * if (isUserApiResponse(response)) {
 *   console.log(response.id); // number
 * }
 * ```
 */
export const isUserApiResponse = (data: unknown): data is UserApiResponse => {
  return (
    typeof data === "object" &&
    data !== null &&
    "id" in data &&
    typeof (data).id === "number" &&
    "email" in data &&
    typeof (data as { email: unknown }).email === "string"
  );
};

/**
 * Type guard to check if unknown data is a valid Role object
 *
 * Validates that the object has the minimum required Role properties:
 * - id: string
 * - roleName: string
 *
 * @param data - Unknown data to validate
 * @returns True if data is a valid Role
 *
 * @example
 * ```ts
 * const data: unknown = await api.fetchRole('role-123');
 * if (isRole(data)) {
 *   console.log(data.roleName);
 * }
 * ```
 */
export const isRole = (data: unknown): data is Role => {
  return (
    typeof data === "object" &&
    data !== null &&
    "id" in data &&
    typeof (data).id === "string" &&
    "roleName" in data &&
    typeof (data as { roleName: unknown }).roleName === "string"
  );
};

/**
 * Type guard to check if unknown data is a valid Permission object
 *
 * Validates that the object has the minimum required Permission properties:
 * - id: string
 * - name: string
 * - resource: string
 * - action: string
 *
 * @param data - Unknown data to validate
 * @returns True if data is a valid Permission
 *
 * @example
 * ```ts
 * const data: unknown = await api.fetchPermission('perm-123');
 * if (isPermission(data)) {
 *   console.log(`${data.resource}:${data.action}`);
 * }
 * ```
 */
export const isPermission = (data: unknown): data is Permission => {
  return (
    typeof data === "object" &&
    data !== null &&
    "id" in data &&
    typeof (data).id === "string" &&
    "name" in data &&
    typeof (data as { name: unknown }).name === "string" &&
    "resource" in data &&
    typeof (data as { resource: unknown }).resource === "string" &&
    "action" in data &&
    typeof (data as { action: unknown }).action === "string"
  );
};

/**
 * Type guard to check if unknown data is an array of Users
 *
 * For performance on large arrays, validates a sample of items rather than every item.
 * This is a pragmatic trade-off between type safety and performance.
 *
 * @param data - Unknown data to validate
 * @param sampleSize - Number of items to validate (default: 10, 0 = validate all)
 * @returns True if data is an array where sampled items are valid Users
 *
 * @example
 * ```ts
 * const data: unknown = await api.fetchUsers();
 * if (isUserArray(data)) {
 *   data.forEach(user => console.log(user.email));
 * }
 *
 * // Validate all items (slower but more thorough)
 * if (isUserArray(data, 0)) {
 *   // ...
 * }
 * ```
 */
export const isUserArray = (
  data: unknown,
  sampleSize: number = 10
): data is User[] => {
  if (!Array.isArray(data)) return false;
  if (data.length === 0) return true;

  // If sampleSize is 0, validate all items
  if (sampleSize === 0) {
    return data.every(isUser);
  }

  // Validate sample using deterministic, evenly distributed indices
  const itemsToValidate = Math.min(data.length, sampleSize);
  const step = Math.floor(data.length / itemsToValidate);
  const indices = Array.from({ length: itemsToValidate }, (_, i) => i * step);

  return indices.every(i => isUser(data[i]));
};

/**
 * Type guard to check if unknown data is an array of Roles
 *
 * For performance on large arrays, validates a sample of items rather than every item.
 * This is a pragmatic trade-off between type safety and performance.
 *
 * @param data - Unknown data to validate
 * @param sampleSize - Number of items to validate (default: 10, 0 = validate all)
 * @returns True if data is an array where sampled items are valid Roles
 *
 * @example
 * ```ts
 * const data: unknown = await api.fetchRoles();
 * if (isRoleArray(data)) {
 *   data.forEach(role => console.log(role.roleName));
 * }
 * ```
 */
export const isRoleArray = (
  data: unknown,
  sampleSize: number = 10
): data is Role[] => {
  if (!Array.isArray(data)) return false;
  if (data.length === 0) return true;

  // If sampleSize is 0, validate all items
  if (sampleSize === 0) {
    return data.every(isRole);
  }

  // Validate sample using deterministic, evenly distributed indices
  const itemsToValidate = Math.min(data.length, sampleSize);
  const step = Math.floor(data.length / itemsToValidate);
  const indices = Array.from({ length: itemsToValidate }, (_, i) => i * step);

  return indices.every(i => isRole(data[i]));
};

/**
 * Type guard to check if unknown data is an array of Permissions
 *
 * For performance on large arrays, validates a sample of items rather than every item.
 * This is a pragmatic trade-off between type safety and performance.
 *
 * @param data - Unknown data to validate
 * @param sampleSize - Number of items to validate (default: 10, 0 = validate all)
 * @returns True if data is an array where sampled items are valid Permissions
 *
 * @example
 * ```ts
 * const data: unknown = await api.fetchPermissions();
 * if (isPermissionArray(data)) {
 *   data.forEach(perm => console.log(perm.name));
 * }
 * ```
 */
export const isPermissionArray = (
  data: unknown,
  sampleSize: number = 10
): data is Permission[] => {
  if (!Array.isArray(data)) return false;
  if (data.length === 0) return true;

  // If sampleSize is 0, validate all items
  if (sampleSize === 0) {
    return data.every(isPermission);
  }

  // Validate sample using deterministic, evenly distributed indices
  const itemsToValidate = Math.min(data.length, sampleSize);
  const step = Math.floor(data.length / itemsToValidate);
  const indices = Array.from({ length: itemsToValidate }, (_, i) => i * step);

  return indices.every(i => isPermission(data[i]));
};
