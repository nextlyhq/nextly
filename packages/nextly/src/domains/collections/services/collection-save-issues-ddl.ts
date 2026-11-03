/**
 * Whether a collection update issues DDL as it saves.
 *
 * A save changes the table only when it changes what the table is built from: its fields, its
 * localization (which moves translatable columns between the table and its companion) or its
 * Draft/Published status (which adds or drops the status column). A save of labels or admin
 * options writes the registry row alone. And only in development does a save execute its DDL at
 * once; elsewhere it records a migration file.
 *
 * The schema lock asks this to decide whether the save may create the lock table, which is itself
 * DDL: a row-only save must not ask a role for a right it never needed before.
 */
export function collectionSaveIssuesDdl(
  body: { fields?: unknown; localized?: unknown; status?: unknown },
  isDevelopment: boolean
): boolean {
  return (
    isDevelopment &&
    (body.fields !== undefined ||
      body.localized !== undefined ||
      body.status !== undefined)
  );
}
