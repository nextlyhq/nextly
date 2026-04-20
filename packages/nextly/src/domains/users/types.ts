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
export type {
  CreateLocalUserData,
  UpdateUserData,
  UserMutationResponse,
  DeleteUserResponse,
} from "./services/user-mutation-service";

// ── UserAccountService Types ────────────────────────────────────────────────
export type {
  GetAccountsResponse,
  PasswordOperationResponse,
  UnlinkAccountResult,
} from "./services/user-account-service";

// ── UserFieldDefinitionService Types ────────────────────────────────────────
export type {
  CreateUserFieldDefinitionInput,
  UpdateUserFieldDefinitionInput,
} from "./services/user-field-definition-service";

// ── UserExtSchemaService Types ──────────────────────────────────────────────
export type { SupportedDialect } from "./services/user-ext-schema-service";
