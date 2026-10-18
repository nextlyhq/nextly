import type { UserExtSchemaService } from "./user-ext-schema-service";
import type { UserFieldDefinitionService } from "./user-field-definition-service";

/** What provisioning the user fields' storage reads and writes through. */
export interface ProvisionUserFieldStorageDeps {
  /** The code-defined user fields, from the config's `users.fields`. */
  codeFields: readonly unknown[];
  fieldDefService: Pick<UserFieldDefinitionService, "syncCodeFields">;
  userExtSchemaService: Pick<
    UserExtSchemaService,
    | "loadMergedFields"
    | "hasMergedFields"
    | "getMergedFieldConfigs"
    | "ensureUserExtSchema"
  >;
  /** The Drizzle database the table is created in. */
  db: unknown;
  /**
   * Called when syncing the code-defined fields fails, instead of failing the
   * whole step, so the table is still made for the fields already recorded.
   * Without it, the failure is thrown.
   */
  onSyncError?: (error: unknown) => void;
}

/**
 * Provision the storage a project's user fields need: sync the code-defined
 * fields into `user_field_definitions`, merge them with the fields defined in
 * the admin, and make `user_ext` hold a column for each.
 *
 * One implementation for both places that do it: `nextly migrate`, which sets
 * up every production database, and the boot's background tasks, which keep a
 * development database current as fields change. A production boot never
 * changes the schema, so without the first, a database that never ran
 * `next dev` had no `user_ext`, and every read of a user field failed.
 *
 * Returns how many fields the table holds columns for; 0 means no table was
 * needed, and none is created.
 */
export async function provisionUserFieldStorage(
  deps: ProvisionUserFieldStorageDeps
): Promise<number> {
  try {
    await deps.fieldDefService.syncCodeFields(
      deps.codeFields as { name: string; [key: string]: unknown }[]
    );
  } catch (error) {
    if (!deps.onSyncError) throw error;
    deps.onSyncError(error);
  }
  await deps.userExtSchemaService.loadMergedFields();
  if (!deps.userExtSchemaService.hasMergedFields()) return 0;
  await deps.userExtSchemaService.ensureUserExtSchema(deps.db);
  return deps.userExtSchemaService.getMergedFieldConfigs().length;
}
