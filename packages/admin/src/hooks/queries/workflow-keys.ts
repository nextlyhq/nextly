/**
 * The query keys of the registered workflows and their settings, apart from
 * the hooks that read them, so a hook that moves a document (a step) can mark
 * the workflows list stale without importing the settings hooks.
 *
 * @module hooks/queries/workflow-keys
 */

export const workflowKeys = {
  all: () => ["workflows"] as const,
  list: () => [...workflowKeys.all(), "list"] as const,
  settings: (slug: string) =>
    [...workflowKeys.all(), "settings", slug] as const,
};
