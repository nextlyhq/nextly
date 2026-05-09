export type {
  UserFieldType,
  UserFieldConfig,
  UserAdminOptions,
  UserConfig,
} from "./config";

export {
  validateUserConfig,
  assertValidUserConfig,
  RESERVED_USER_FIELD_NAMES,
  ALLOWED_USER_FIELD_TYPES,
  type UserValidationErrorCode,
  type UserValidationError,
  type UserValidationResult,
} from "./config";
