/**
 * Users Domain
 *
 * Re-exports all user services and types from the domain.
 *
 * @module domains/users
 */

// ── Services ────────────────────────────────────────────────────────────────

export { UserService } from "./services/user-service";
export type {
  User,
  CreateUserInput,
  UpdateUserInput,
  ListUsersQueryOptions,
  PasswordHasher,
} from "./services/user-service";

export { UserQueryService } from "./services/user-query-service";
export type {
  ListUsersOptions,
  ListUsersResponse,
  GetUserResponse,
} from "./services/user-query-service";

export { UserMutationService } from "./services/user-mutation-service";
// DeleteUserResponse removed in PR 4: deleteUser now returns void and
// throws NextlyError on failure. Likewise UserMutationResponse is now an
// alias for MinimalUser since the result envelope is gone.
export type {
  CreateLocalUserData,
  UpdateUserData,
  UserMutationResponse,
} from "./services/user-mutation-service";

// The account service exports no result types: its methods return data or
// throw NextlyError, and the linked-account results went with the retired
// linked-account endpoints.
export { UserAccountService } from "./services/user-account-service";

export { UserExtSchemaService } from "./services/user-ext-schema-service";
export type { SupportedDialect } from "./services/user-ext-schema-service";

export { UserFieldDefinitionService } from "./services/user-field-definition-service";
export type {
  CreateUserFieldDefinitionInput,
  UpdateUserFieldDefinitionInput,
} from "./services/user-field-definition-service";
