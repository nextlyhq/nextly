export type {
  UserFieldType,
  UserFieldConfig,
  UserPluginFieldConfig,
  UserPluginFieldInput,
  UserAdminOptions,
  UserConfig,
} from "./types";

export { pluginUserField } from "./types";

export {
  validateUserConfig,
  assertValidUserConfig,
  RESERVED_USER_FIELD_NAMES,
  ALLOWED_USER_FIELD_TYPES,
  type UserValidationErrorCode,
  type UserValidationError,
  type UserValidationResult,
} from "./validate-user-config";
