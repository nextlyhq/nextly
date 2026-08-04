export type {
  UserFieldType,
  UserFieldConfig,
  UserPluginFieldConfig,
  UserPluginFieldInput,
  UserAdminOptions,
  UserConfig,
} from "./config";

// A user field whose type a plugin contributed. `UserFieldConfig` is a union
// of the built-in shapes, so an arm open enough to accept an unknown type token
// would accept a malformed built-in too; the helper marks the open arm instead,
// and the brand is what marks it.
export { pluginUserField, pluginUserFieldBrand } from "./config";

export {
  validateUserConfig,
  assertValidUserConfig,
  RESERVED_USER_FIELD_NAMES,
  ALLOWED_USER_FIELD_TYPES,
  type UserValidationErrorCode,
  type UserValidationError,
  type UserValidationResult,
} from "./config";
