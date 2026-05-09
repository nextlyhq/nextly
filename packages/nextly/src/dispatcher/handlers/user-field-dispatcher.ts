/**
 * User field definition dispatch handlers.
 *
 * Routes 6 operations against `UserFieldDefinitionService` — CRUD plus
 * `reorderFields`. After each mutating op, the `UserExtSchemaService`
 * is asked to reload merged fields and ensure the `user_ext` table
 * schema reflects the change so new columns appear immediately.
 *
 * Every handler returns a Response built via the respondX helpers in
 * `../../api/response-shapes.ts`. The dispatcher passes the Response
 * through unchanged. See spec §5.1 for the canonical shape contract.
 */

import {
  respondAction,
  respondData,
  respondDoc,
  respondMutation,
} from "../../api/response-shapes";
import type { NextlyServiceConfig } from "../../di/register";
import { NextlyError } from "../../errors";
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

/**
 * Throw a canonical NextlyError when the field-definition feature
 * isn't enabled in this app. Used by every mutation handler so the
 * dispatcher's error path emits a 500 with a generic publicMessage
 * (the operator-facing detail flows through logContext).
 */
function requireFieldDefinitionService(
  svc: UserFieldsServices
): asserts svc is UserFieldsServices & {
  fieldDefinitionService: UserFieldDefinitionService;
} {
  if (!svc.fieldDefinitionService) {
    throw NextlyError.internal({
      logContext: {
        reason: "user-field-definition-service-unavailable",
        hint: "users.fields feature must be enabled in nextly config",
      },
    });
  }
}

const USER_FIELDS_METHODS: Record<string, MethodHandler<UserFieldsServices>> = {
  listUserFields: {
    // The list is non-paginated AND ships adminConfig as a sibling field;
    // we surface both via respondData so the admin can read both off the
    // bare body without an envelope.
    execute: async svc => {
      const admin = svc.config.users?.admin;
      // Prefer the merged list (code + UI) when the service is available.
      if (svc.fieldDefinitionService) {
        const fields = await svc.fieldDefinitionService.listFields();
        return respondData({
          fields,
          total: fields.length,
          adminConfig: admin || {},
        });
      }
      // Fallback: return code-config fields only.
      const fields = svc.config.users?.fields || [];
      return respondData({
        fields,
        total: fields.length,
        adminConfig: admin || {},
      });
    },
  },

  createField: {
    // The user_ext schema sync runs before respond so the toast firing
    // implies "field is queryable".
    execute: async (svc, _p, body) => {
      requireFieldDefinitionService(svc);
      const field = await svc.fieldDefinitionService.createField(
        body as Parameters<typeof svc.fieldDefinitionService.createField>[0]
      );
      await syncUserExtSchema(svc.userExtSchemaService);
      return respondMutation("User field created.", field, { status: 201 });
    },
  },

  getField: {
    // Service throws NextlyError NOT_FOUND if the field doesn't exist,
    // so we never return a null doc here.
    execute: async (svc, p) => {
      requireFieldDefinitionService(svc);
      const field = await svc.fieldDefinitionService.getField(p.fieldId);
      return respondDoc(field);
    },
  },

  updateField: {
    execute: async (svc, p, body) => {
      requireFieldDefinitionService(svc);
      const field = await svc.fieldDefinitionService.updateField(
        p.fieldId,
        body as Parameters<typeof svc.fieldDefinitionService.updateField>[1]
      );
      await syncUserExtSchema(svc.userExtSchemaService);
      return respondMutation("User field updated.", field);
    },
  },

  deleteField: {
    // Spec divergence: spec §5.1 / §7.4 strictly maps delete to
    // respondMutation, but fieldDefinitionService.deleteField returns
    // void (no deleted record to surface). We use respondAction here so
    // the wire shape is `{ message, fieldId }` rather than the awkward
    // `{ message, item: undefined }` that respondMutation would emit. If
    // fieldDefinitionService.deleteField is later refactored to return
    // the deleted record, switch this back to respondMutation.
    execute: async (svc, p) => {
      requireFieldDefinitionService(svc);
      await svc.fieldDefinitionService.deleteField(p.fieldId);
      await syncUserExtSchema(svc.userExtSchemaService);
      return respondAction("User field deleted.", { fieldId: p.fieldId });
    },
  },

  reorderFields: {
    // reorderFields is a non-CRUD mutation: there's no single "item"; a
    // batch of records was rewritten in place. Surface the new ordered
    // list as a sibling field.
    execute: async (svc, _p, body) => {
      requireFieldDefinitionService(svc);
      const { fieldIds } = body as { fieldIds: string[] };
      const fields = await svc.fieldDefinitionService.reorderFields(fieldIds);
      return respondAction("User fields reordered.", { fields });
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
