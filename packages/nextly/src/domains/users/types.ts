/**
 * Users Domain Types
 *
 * Consolidated re-exports of all user-domain-specific types.
 *
 * @module domains/users/types
 */

// ── UserService Types ───────────────────────────────────────────────────────
export type {
  User,
  CreateUserInput,
  UpdateUserInput,
  ListUsersQueryOptions,
  PasswordHasher,
} from "./services/user-service";

// ── UserQueryService Types ──────────────────────────────────────────────────
export type {
  ListUsersOptions,
  ListUsersResponse,
  GetUserResponse,
} from "./services/user-query-service";

// ── UserMutationService Types ───────────────────────────────────────────────
// DeleteUserResponse removed in PR 4 (unified-error-system migration):
// deleteUser now returns void and throws NextlyError on failure.
export type {
  CreateLocalUserData,
  UpdateUserData,
  UserMutationResponse,
} from "./services/user-mutation-service";

// UserAccountService has no result types to list here: its methods return
// data or throw NextlyError, and the linked-account results went with the
// retired linked-account endpoints.

// ── UserFieldDefinitionService Types ────────────────────────────────────────
export type {
  CreateUserFieldDefinitionInput,
  UpdateUserFieldDefinitionInput,
} from "./services/user-field-definition-service";

// ── UserExtSchemaService Types ──────────────────────────────────────────────
export type { SupportedDialect } from "./services/user-ext-schema-service";
