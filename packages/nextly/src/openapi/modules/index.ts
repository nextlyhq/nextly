/**
 * Default list of built-in module contributors.
 *
 * The route handler passes this array (or a user-extended version of it)
 * to `generate()`. Order matters when a later module declares a schema
 * with the same name as an earlier one — `pipeline.ts` does
 * `Object.assign(schemas, m.schemas)`, so the last-registered module wins.
 *
 * @module nextly/openapi/modules
 */

import { authModule } from "./auth";
import { collectionsSchemaModule } from "./collections-schema";
import { componentsModule } from "./components";
import { emailProvidersModule } from "./email-providers";
import { emailSendModule } from "./email-send";
import { emailTemplatesModule } from "./email-templates";
import { healthModule } from "./health";
import { mediaModule } from "./media";
import { rbacModule } from "./rbac";
import { singlesModule } from "./singles";
import { systemModule } from "./system";
import { usersModule } from "./users";

export const builtinModules = [
  healthModule,
  authModule,
  usersModule,
  mediaModule,
  emailProvidersModule,
  emailTemplatesModule,
  emailSendModule,
  componentsModule,
  singlesModule,
  collectionsSchemaModule,
  rbacModule,
  systemModule,
] as const;

export {
  authModule,
  collectionsSchemaModule,
  componentsModule,
  emailProvidersModule,
  emailSendModule,
  emailTemplatesModule,
  healthModule,
  mediaModule,
  rbacModule,
  singlesModule,
  systemModule,
  usersModule,
};
