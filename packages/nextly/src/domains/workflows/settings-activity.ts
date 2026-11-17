/**
 * Where a change to a workflow's settings is filed in the activity log.
 *
 * A module of its own, with no imports, so the audit domain's list of settings namespaces can
 * name it without loading the workflow domain.
 *
 * @module domains/workflows/settings-activity
 * @experimental
 */

/**
 * The activity-log `collection` a workflow's settings changes are filed under, with the
 * workflow's slug as the entry. The feed shows these to a reader `canReadEntity` admits for it,
 * which no seeded grant does, so to the super-admin alone.
 *
 * @experimental
 */
export const WORKFLOW_SETTINGS_ACTIVITY_COLLECTION = "workflows";
