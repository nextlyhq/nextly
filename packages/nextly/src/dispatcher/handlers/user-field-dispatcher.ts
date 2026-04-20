/**
 * User field definition dispatch handlers.
 *
 * Routes 6 operations against `UserFieldDefinitionService` — CRUD plus
 * `reorderFields`. After each mutating op, the `UserExtSchemaService`
 * is asked to reload merged fields and ensure the `user_ext` table
 * schema reflects the change so new columns appear immediately.
 */

import type { NextlyServiceConfig } from "../../di/register";
import type { UserExtSchemaService } from "../../services/users/user-ext-schema-service";
import type { UserFieldDefinitionService } from "../../services/users/user-field-definition-service";
import {
  getAdapterFromDI,
  getConfigFromDI,
  getUserExtSchemaServiceFromDI,
  getUserFieldDefinitionServiceFromDI,
} from "../helpers/di";
import type { MethodHandler, Params } from "../types";

interface UserFieldsServices {
  config: NextlyServiceConfig;
  fieldDefinitionService?: UserFieldDefinitionService;
  userExtSchemaService?: UserExtSchemaService;
}

async function syncUserExtSchema(
  userExtSchemaService: UserExtSchemaService | undefined
): Promise<void> {
  if (!userExtSchemaService) return;
  await userExtSchemaService.reloadMergedFields();
  const drizzleDb = getAdapterFromDI()?.getDrizzle();
  await userExtSchemaService.ensureUserExtSchema(drizzleDb);
}

const USER_FIELDS_METHODS: Record<string, MethodHandler<UserFieldsServices>> = {
  listUserFields: {
    execute: async svc => {
      const admin = svc.config.users?.admin;
      // Prefer the merged list (code + UI) when the service is available.
      if (svc.fieldDefinitionService) {
        const fields = await svc.fieldDefinitionService.listFields();
        return {
          success: true,
          statusCode: 200,
          data: fields,
          meta: { total: fields.length, adminConfig: admin || {} },
        };
      }
      // Fallback: return code-config fields only.
      const fields = svc.config.users?.fields || [];
      return {
        success: true,
        statusCode: 200,
        data: fields,
        meta: { total: fields.length, adminConfig: admin || {} },
      };
    },
  },

  createField: {
    execute: async (svc, _p, body) => {
      if (!svc.fieldDefinitionService) {
        throw new Error("User field definition service not available.");
      }
      const data = await svc.fieldDefinitionService.createField(
        body as Parameters<typeof svc.fieldDefinitionService.createField>[0]
      );
      await syncUserExtSchema(svc.userExtSchemaService);
      return { success: true, statusCode: 201, data };
    },
  },

  getField: {
    execute: async (svc, p) => {
      if (!svc.fieldDefinitionService) {
        throw new Error("User field definition service not available.");
      }
      const data = await svc.fieldDefinitionService.getField(p.fieldId);
      return { success: true, statusCode: 200, data };
    },
  },

  updateField: {
    execute: async (svc, p, body) => {
      if (!svc.fieldDefinitionService) {
        throw new Error("User field definition service not available.");
      }
      const data = await svc.fieldDefinitionService.updateField(
        p.fieldId,
        body as Parameters<typeof svc.fieldDefinitionService.updateField>[1]
      );
      await syncUserExtSchema(svc.userExtSchemaService);
      return { success: true, statusCode: 200, data };
    },
  },

  deleteField: {
    execute: async (svc, p) => {
      if (!svc.fieldDefinitionService) {
        throw new Error("User field definition service not available.");
      }
      await svc.fieldDefinitionService.deleteField(p.fieldId);
      await syncUserExtSchema(svc.userExtSchemaService);
      return { success: true, statusCode: 204, data: null };
    },
  },

  reorderFields: {
    execute: async (svc, _p, body) => {
      if (!svc.fieldDefinitionService) {
        throw new Error("User field definition service not available.");
      }
      const { fieldIds } = body as { fieldIds: string[] };
      const data = await svc.fieldDefinitionService.reorderFields(fieldIds);
      return { success: true, statusCode: 200, data };
    },
  },
};

/**
 * Dispatch a user-fields method call. Resolves the config + optional
 * services from DI. The config is required (the listFields fallback
 * path still needs it to look up `users.fields`), but the field
 * definition service may be absent if the app is running without the
 * user-extension feature enabled.
 */
export function dispatchUserFields(
  method: string,
  params: Params,
  body: unknown
): Promise<unknown> {
  const config = getConfigFromDI();
  if (!config) {
    throw new Error(
      "User fields config not available. " +
        "Ensure registerServices() or getNextly() has been called before API requests."
    );
  }

  const services: UserFieldsServices = {
    config,
    fieldDefinitionService: getUserFieldDefinitionServiceFromDI(),
    userExtSchemaService: getUserExtSchemaServiceFromDI(),
  };

  const handler = USER_FIELDS_METHODS[method];
  if (!handler) throw new Error(`Unknown method: ${method}`);
  return handler.execute(services, params, body);
}
