/**
 * Role Services — Auth Domain
 *
 * Exports focused services for role management:
 * - RoleQueryService: Read operations (list, get, find)
 * - RoleMutationService: Write operations (create, update, delete)
 *
 * @module domains/auth/services/role
 */

export { RoleQueryService } from "./role-query-service";
export { RoleMutationService } from "./role-mutation-service";
export { isValidUUID, validateRoleId, toDialectBool } from "./utils";
