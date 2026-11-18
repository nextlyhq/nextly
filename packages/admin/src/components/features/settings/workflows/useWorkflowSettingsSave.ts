/**
 * Saving one change to a workflow's settings, and what the screen says about
 * it.
 *
 * Each change is its own PATCH over the revision the screen last read, naming
 * only the setting changed, so a save never rewrites a setting someone else
 * changed meanwhile. The answer is one of:
 * - saved: announced in the page's status region;
 * - a conflict (the settings moved since they were read): the settings are
 *   read again and the screen asks for the change to be reviewed and saved
 *   again; the control that sent it keeps its pending choice;
 * - refused: each problem's message is kept by the setting its path names, so
 *   it is shown beside that control; a problem naming no setting is announced.
 *
 * @module components/features/settings/workflows/useWorkflowSettingsSave
 */

import { useCallback, useState } from "react";

import { useUpdateWorkflowSettings } from "@admin/hooks/queries/useWorkflows";
import {
  apiErrorMessage,
  isApiError,
  validationIssues,
} from "@admin/lib/api/parseApiError";
import type {
  WorkflowSettingsPatch,
  WorkflowSettingsView,
} from "@admin/types/workflows";

import { issuesByField } from "./workflow-settings-model";

/** What a save came to, for the control that asked it. */
export type SaveOutcome = "saved" | "conflict" | "refused";

/** The message shown when the settings moved since they were read. */
export const CONFLICT_MESSAGE =
  "Someone changed these settings; review and save again.";

export interface WorkflowSettingsSave {
  /**
   * Saves `patch` as the change to `field` (`grants.<step>`,
   * `defaultReviewers.<stage>`, `labels.<stage>` or `emails.<trigger>`).
   */
  save: (field: string, patch: WorkflowSettingsPatch) => Promise<SaveOutcome>;
  /** The setting being saved, whose control is held meanwhile, or null. */
  saving: string | null;
  /** Each refused setting's message, by field. */
  errors: Record<string, string>;
  /** The last save's announcement, for the page's status region. */
  status: string;
  /** Whether the last save met settings changed since they were read. */
  conflict: boolean;
}

/** `record` without the entry for `key`: a setting saved or refused anew loses its old message. */
function without(
  record: Record<string, string>,
  key: string
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(record).filter(([each]) => each !== key)
  );
}

export function useWorkflowSettingsSave(
  slug: string,
  settings: WorkflowSettingsView | undefined,
  refetch: () => Promise<unknown>
): WorkflowSettingsSave {
  const { mutateAsync } = useUpdateWorkflowSettings(slug);
  const [saving, setSaving] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [status, setStatus] = useState("");
  const [conflict, setConflict] = useState(false);

  const save = useCallback(
    async (field: string, patch: WorkflowSettingsPatch) => {
      if (!settings) return "refused" as const;
      setSaving(field);
      setStatus("");
      try {
        await mutateAsync({ revision: settings.revision, ...patch });
        setErrors(current => without(current, field));
        setConflict(false);
        setStatus("Saved.");
        return "saved" as const;
      } catch (error) {
        if (isApiError(error) && error.status === 409) {
          setConflict(true);
          setStatus(CONFLICT_MESSAGE);
          await refetch();
          return "conflict" as const;
        }
        const byField = issuesByField(validationIssues(error));
        setErrors(current => ({ ...without(current, field), ...byField }));
        // A problem naming no setting on the screen, or a failure that is not
        // a validation error, is said where every save is announced.
        setStatus(
          Object.keys(byField).length > 0
            ? "Not saved: see the message beside the setting."
            : `Not saved: ${apiErrorMessage(error, "the change could not be saved.")}`
        );
        return "refused" as const;
      } finally {
        setSaving(null);
      }
    },
    [mutateAsync, refetch, settings]
  );

  return { save, saving, errors, status, conflict };
}
