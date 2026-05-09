/**
 * Direct API Namespaces — Barrel Export
 *
 * Aggregates every namespace factory and their related types so the core
 * `Nextly` class has a single import point.
 *
 * @packageDocumentation
 */

export type { NextlyContext } from "./context";

export * as collections from "./collections";
export * as singles from "./singles";
export * as auth from "./auth";

export { createUsersNamespace, type UsersNamespace } from "./users";
export {
  createMediaNamespace,
  type MediaFoldersNamespace,
  type MediaNamespace,
} from "./media";
export { createFormsNamespace, type FormsNamespace } from "./forms";
export {
  createComponentsNamespace,
  type ComponentsNamespace,
} from "./components";
export {
  createEmailNamespace,
  createEmailProvidersNamespace,
  createEmailTemplatesNamespace,
  createUserFieldsNamespace,
  type EmailNamespace,
  type EmailProvidersNamespace,
  type EmailTemplatesNamespace,
  type UserFieldsNamespace,
} from "./email";
export {
  createAccessNamespace,
  createApiKeysNamespace,
  createPermissionsNamespace,
  createRolesNamespace,
  type AccessNamespace,
  type ApiKeysNamespace,
  type PermissionsNamespace,
  type RolesNamespace,
} from "./rbac";
