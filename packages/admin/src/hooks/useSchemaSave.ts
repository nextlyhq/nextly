"use client";

/**
 * useSchemaSave — the pipeline between the toolbar's Save and a schema that has
 * actually changed.
 *
 * Save previews first, because what happens next depends on what the change is:
 * nothing to migrate means the page persists its settings and stops, and
 * anything else goes to the user for confirmation before a single statement
 * runs. Once confirmed, the apply is bracketed by the restart overlay and
 * reports through one toast.
 *
 * Every builder kind runs exactly that sequence, and differs only in which
 * client it previews and applies through and what it persists afterwards — so
 * those arrive as functions. The orchestration around them is delicate in a way
 * that does not survive being written three times: an early return that skips
 * `endApply` leaves the page permanently "applying", and a `stopRestart` missed
 * on one branch leaves the overlay up over a page that has finished.
 */
import { useCallback } from "react";

import type { SchemaChangeConfirmation } from "@admin/components/features/schema-builder/types";
import { toast } from "@admin/components/ui";
import { useRestart } from "@admin/context/RestartContext";
import type {
  FieldResolution,
  SchemaPreviewResponse,
  SchemaRenameResolution,
} from "@admin/services/schemaApi";
import type { FieldDefinition } from "@admin/types/collection";

/** What every kind's apply endpoint answers with. */
export interface SchemaApplyOutcome {
  success: boolean;
  message?: string;
  toastSummary?: string;
}

/**
 * Mirror a schema change into the committable ui-schema.json, so a
 * database-mode entity carries the same migration record a code-first one does.
 *
 * Best-effort by design: the database write has already succeeded by the time
 * this runs, so a failure here warns and never undoes it.
 */
export async function mirrorSchemaFile(
  write: () => Promise<unknown>,
  /** How the warning opens, e.g. "Collection updated". */
  warningLead: string
): Promise<void> {
  try {
    await write();
  } catch (err) {
    const message = (err as { message?: string })?.message;
    toast.warning(
      `${warningLead}, but ui-schema.json could not be updated${message ? `: ${message}` : ""}.`
    );
  }
}

/**
 * Run whatever follows a landed apply, reporting its own failure as its own.
 *
 * It runs after the success toast, so letting a rejection reach the apply's
 * catch would tell the user the apply failed immediately after telling them it
 * succeeded, and name the wrong step as the cause. The schema is already
 * written by this point; only the follow-up can still go wrong.
 */
async function runPostApply(
  /** Awaited whether or not it returns a promise, so a sync throw is caught
   *  here rather than escaping to the apply's own handler. */
  step: () => void | Promise<void>,
  /** How the warning opens, e.g. "Posts". */
  label: string
): Promise<void> {
  try {
    await step();
  } catch (err) {
    const message = (err as { message?: string })?.message;
    toast.warning(
      `${label} schema updated, but a follow-up step did not complete${
        message ? `: ${message}` : ""
      }.`
    );
  }
}

/**
 * What the success toast calls the entity: its own name, or the slug when it
 * has none yet. Trimmed, because a name of spaces reads as a missing one.
 */
export function displayLabel(
  settings: { singularName?: string } | null,
  fallback: string
): string {
  return settings?.singularName?.trim() || fallback;
}

export interface UseSchemaSaveOptions {
  /** The entity's slug. Absent means the route gave us nothing to save. */
  slug: string | undefined;
  /** What to tell the user when it is absent. */
  missingSlugMessage: string;
  /** The entity's display name, for the success toast. */
  label: string;
  confirmation: SchemaChangeConfirmation;
  getValidatedFields: () => FieldDefinition[] | null;
  preview: (fields: FieldDefinition[]) => Promise<SchemaPreviewResponse>;
  apply: (
    fields: FieldDefinition[],
    schemaVersion: number,
    resolutions: Record<string, FieldResolution>,
    renameResolutions: SchemaRenameResolution[]
  ) => Promise<SchemaApplyOutcome>;
  /** The preview found nothing to migrate — persist the rest and stop. */
  onNoChanges: (fields: FieldDefinition[]) => void;
  /** The schema landed — re-pin the baselines, persist settings, mirror the file. */
  onApplied: (fields: FieldDefinition[]) => void | Promise<void>;
}

export interface UseSchemaSaveReturn {
  /** The toolbar's Save. */
  handleSave: () => void;
  /** The confirmation dialog's confirm. */
  confirmApply: (
    resolutions: Record<string, FieldResolution>,
    renameResolutions: SchemaRenameResolution[]
  ) => void;
}

export function useSchemaSave({
  slug,
  missingSlugMessage,
  label,
  confirmation,
  getValidatedFields,
  preview,
  apply,
  onNoChanges,
  onApplied,
}: UseSchemaSaveOptions): UseSchemaSaveReturn {
  const { startRestart, stopRestart } = useRestart();

  const handleSave = useCallback(() => {
    void (async () => {
      if (!slug) {
        toast.error(missingSlugMessage);
        return;
      }

      const fields = getValidatedFields();
      if (!fields) return;

      try {
        const previewed = await preview(fields);
        if (!previewed.hasChanges) {
          onNoChanges(fields);
          return;
        }
        confirmation.request(previewed);
      } catch (err) {
        const message = (err as { message?: string })?.message;
        toast.error(message || "Failed to preview schema changes");
      }
    })();
  }, [
    slug,
    missingSlugMessage,
    getValidatedFields,
    preview,
    onNoChanges,
    confirmation,
  ]);

  const confirmApply = useCallback(
    (
      resolutions: Record<string, FieldResolution>,
      renameResolutions: SchemaRenameResolution[]
    ) => {
      const fields = getValidatedFields();
      const previewed = confirmation.preview;
      if (!slug || !fields || !previewed) return;

      void (async () => {
        confirmation.beginApply();
        startRestart();
        try {
          const result = await apply(
            fields,
            previewed.schemaVersion,
            resolutions,
            renameResolutions
          );
          if (!result.success) {
            stopRestart(
              false,
              result.message || "Failed to apply schema changes"
            );
            return;
          }
          // "no changes" is the server's way of saying the apply was a no-op,
          // which reads oddly appended to a success line.
          const summarySuffix =
            result.toastSummary && result.toastSummary !== "no changes"
              ? `. ${result.toastSummary}`
              : "";
          stopRestart(true, `${label} schema updated${summarySuffix}`);
          confirmation.settle();

          await runPostApply(() => onApplied(fields), label);
        } catch (err) {
          const message = (err as { message?: string })?.message;
          stopRestart(
            false,
            message || "An error occurred while applying changes"
          );
        } finally {
          confirmation.endApply();
        }
      })();
    },
    [
      slug,
      label,
      confirmation,
      getValidatedFields,
      apply,
      onApplied,
      startRestart,
      stopRestart,
    ]
  );

  return { handleSave, confirmApply };
}
