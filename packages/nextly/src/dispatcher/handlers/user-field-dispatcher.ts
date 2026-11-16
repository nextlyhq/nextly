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
import { busyTableBounds } from "../../domains/schema/busy-table/bounds";
import { withSchemaChangeExcluded } from "../../domains/schema/services/schema-change-exclusion";
import { NextlyError } from "../../errors";
import type { UserExtSchemaService } from "../../services/users/user-ext-schema-service";
import type { UserFieldDefinitionService } from "../../services/users/user-field-definition-service";
import { consoleLogger } from "../../shared/types";
import {
  getAdapterFromDI,
  getConfigFromDI,
  getLoggerFromDI,
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
  const adapter = getAdapterFromDI();
  // A user field's column waits for a table another session is using in short tries, as
  // `nextly migrate` waits, each try after the first noted in the log.
  await userExtSchemaService.ensureUserExtSchema(
    adapter?.getDrizzle(),
    adapter === undefined
      ? {}
      : {
          busyTable: {
            adapter,
            notify: line => (getLoggerFromDI() ?? consoleLogger).warn(line),
          },
        }
  );
}

/**
 * Run a user field change and the `user_ext` sync that follows it as one schema change, holding
 * the schema lock throughout and refused at once while a migration holds it.
 *
 * The definition row and the `user_ext` column are the two halves of one field, and the sync is
 * DDL. Held only around the sync, a migration could run between the row write and the column
 * change; held only around the row, the column change would run unguarded. So both run inside one
 * exclusion, which may create the lock table because the sync issues DDL.
 */
function withUserFieldChangeExcluded<T>(
  label: string,
  svc: UserFieldsServices,
  change: () => Promise<T>,
  /**
   * Takes back what `change` wrote when the `user_ext` sync after it fails (a busy table whose
   * tries ran out, say), so the change reads as not made and can be made again as it was.
   */
  undo?: (result: T) => Promise<void>
): Promise<T> {
  // The bounds a busy table is waited for within, read before anything changes: a value out of
  // range refuses the change here rather than after its definition was written.
  if (getAdapterFromDI() !== undefined) busyTableBounds({ env: process.env });
  return withSchemaChangeExcluded(
    {
      adapter: getAdapterFromDI(),
      // An app whose DI registered no logger still saves; the refusal's log line then goes to the
      // console.
      logger: getLoggerFromDI() ?? consoleLogger,
      label,
      // May create the lock table only in development, as a collection save may. In production
      // the application's role can hold data rights and no DDL rights, so the save never creates
      // the lock table: it takes the lock wherever that table exists, and runs its best-effort
      // `user_ext` DDL (a statement the role may not run is skipped, as before) under it. On a
      // database that has not run `nextly migrate` since the lock table was added, the table is
      // absent and that DDL runs unlocked, the residual `withMigrationExcluded` documents.
      issuesDdl: process.env.NODE_ENV === "development",
    },
    async () => {
      const result = await change();
      try {
        await syncUserExtSchema(svc.userExtSchemaService);
      } catch (error) {
        if (undo !== undefined) {
          const logger = getLoggerFromDI() ?? consoleLogger;
          const message = (failure: unknown): string =>
            failure instanceof Error ? failure.message : String(failure);
          const undone = await undo(result).then(
            () => true,
            (undoError: unknown) => {
              logger.error(
                `The ${label} failed, and what it wrote could not be taken back: ${message(undoError)}`
              );
              return false;
            }
          );
          // The sync loaded the fields with the change in them; once it is taken back they are
          // loaded again, so the user model is not built with a field that is not there. A reload
          // that fails is logged as such: what the change wrote was taken back all the same.
          if (undone) {
            await Promise.resolve(
              svc.userExtSchemaService?.reloadMergedFields()
            ).catch((reloadError: unknown) =>
              logger.error(
                `The ${label} failed and was taken back, but the user fields could not be loaded again: ${message(reloadError)}`
              )
            );
          }
        }
        throw error;
      }
      return result;
    }
  );
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
      const field = await withUserFieldChangeExcluded(
        "create user field",
        svc,
        () =>
          svc.fieldDefinitionService.createField(
            body as Parameters<typeof svc.fieldDefinitionService.createField>[0]
          ),
        // A field whose column could not be made is not created: its definition goes too.
        created => svc.fieldDefinitionService.deleteField(created.id)
      );
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
      const field = await withUserFieldChangeExcluded(
        `update user field "${p.fieldId}"`,
        svc,
        () =>
          svc.fieldDefinitionService.updateField(
            p.fieldId,
            body as Parameters<typeof svc.fieldDefinitionService.updateField>[1]
          )
      );
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
      await withUserFieldChangeExcluded(
        `delete user field "${p.fieldId}"`,
        svc,
        () => svc.fieldDefinitionService.deleteField(p.fieldId)
      );
      return respondAction("User field deleted.", { fieldId: p.fieldId });
    },
  },

  reorderFields: {
    // Takes no schema lock: a reorder rewrites the definitions' sort order and nothing else, so no
    // `user_ext` column changes and there is no DDL for a migration to collide with.
    //
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
