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
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { FieldGroupCreate } from "@admin/components/features/schema-builder/FieldGroupCreatesList";
import type { SchemaChangeConfirmation } from "@admin/components/features/schema-builder/types";
import { toast } from "@admin/components/ui";
import { useRestart } from "@admin/context/RestartContext";
import { apiErrorMessage } from "@admin/lib/api/parseApiError";
import { acknowledgedConversionsOf } from "@admin/lib/builder/brought-up-to-date";
import type { PendingChange } from "@admin/lib/builder/pending-changes";
import {
  draftRenamesOf,
  renameAnswers,
  renameNotOffered,
  withDecidedRenames,
} from "@admin/lib/builder/rename-answers";
import type { SettingChange } from "@admin/lib/builder/settings-changes";
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
    // Read through the API's envelope, so a refusal's own reasons reach the user rather than its
    // generic summary; empty when there is none.
    const message = apiErrorMessage(err, "");
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
    const message = apiErrorMessage(err, "");
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
    renameResolutions: SchemaRenameResolution[],
    /** The keys of the conversions the reviewed preview listed, which its Save confirmed. */
    acknowledgedConversions: string[]
  ) => Promise<SchemaApplyOutcome>;
  /**
   * The preview found nothing to migrate: persist the settings. Run at once
   * when no setting changed either, and otherwise once the review of the
   * settings it changes is confirmed.
   */
  onNoChanges: (fields: FieldDefinition[]) => void;
  /** The schema landed — re-pin the baselines, persist settings, mirror the file. */
  onApplied: (fields: FieldDefinition[]) => void | Promise<void>;
  /**
   * The settings `preview` and `apply` are sent besides the fields, such as
   * the entity's localization. A confirmation applies only when they are as
   * the preview was made with, as for the fields.
   */
  previewedWith?: unknown;
  /**
   * The draft's pending changes: its renames of saved fields are the save's to answer as renames
   * (`draftRenamesOf`), and the review shows them as renames whose values are kept.
   */
  pendingChanges?: readonly PendingChange[];
  /**
   * The entity's settings changed since the save. A save that changes only
   * these is reviewed before it is saved, and a confirmation saves them only
   * as the review showed them.
   */
  settingChanges?: readonly SettingChange[];
  /**
   * The entities not saved yet that the fields need (field groups they use,
   * collections they link to), which the save creates before the entity:
   * listed in the review, and created by `create` once it is confirmed, so
   * cancelling the review creates nothing. `create` answers why one was
   * refused, which stops the save before the entity; null when every one was
   * created. `letGoUnused` runs once a schema apply has landed, for the ones
   * the entity made that no field needs any more; a save that changes no
   * schema writes later, so it keeps them, and leaving the editor releases
   * them.
   */
  fieldGroupsFirst?: {
    creates: readonly FieldGroupCreate[];
    create: () => Promise<string | null>;
    letGoUnused?: () => void;
  };
}

/** One empty list, so a page passing none keeps one value between renders. */
const NO_SETTING_CHANGES: readonly SettingChange[] = [];

export interface UseSchemaSaveReturn {
  /**
   * The setting changes the review on show was previewed with: what it lists,
   * and what its confirmation saves. A setting changed while the preview was
   * on its way is not listed, and the confirmation refuses it unseen.
   */
  reviewedSettingChanges: readonly SettingChange[];
  /** The toolbar's Save. */
  handleSave: () => void;
  /** The confirmation dialog's confirm. */
  confirmApply: (
    resolutions: Record<string, FieldResolution>,
    renameResolutions: SchemaRenameResolution[]
  ) => void;
}

/** No pending change, as one constant so the callbacks keep their identity across renders. */
const NO_PENDING_CHANGES: readonly PendingChange[] = [];

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
  previewedWith,
  pendingChanges = NO_PENDING_CHANGES,
  settingChanges = NO_SETTING_CHANGES,
  fieldGroupsFirst,
}: UseSchemaSaveOptions): UseSchemaSaveReturn {
  // The saved fields the draft renamed, read from its pending changes, which the save answers.
  const draftRenames = useMemo(
    () => draftRenamesOf(pendingChanges),
    [pendingChanges]
  );
  // The entities the save creates first, by kind and address: part of what a review agrees to,
  // as the fields are, so a confirmation creates exactly the entities the review listed.
  const creates = JSON.stringify(
    (fieldGroupsFirst?.creates ?? []).map(
      each => `${each.kind}:${each.address}`
    )
  );
  const createsAny = (fieldGroupsFirst?.creates.length ?? 0) > 0;
  const { startRestart, stopRestart } = useRestart();
  // The fields and settings each preview was made from. The dialog shows that
  // preview, so those are what a confirmation agrees to: an edit, an undo or a
  // settings change made while the preview was on its way, or while it was
  // shown, is not applied unseen.
  const previewedFields = useRef(new WeakMap<object, string>());
  // Whether the page is still there. Leaving it drops its pending changes, so
  // a preview that answers afterwards saves nothing and asks nobody.
  const mounted = useRef(true);
  // The setting changes the review on show was previewed with.
  const [reviewedSettingChanges, setReviewedSettingChanges] =
    useState<readonly SettingChange[]>(NO_SETTING_CHANGES);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const handleSave = useCallback(() => {
    void (async () => {
      if (!slug) {
        toast.error(missingSlugMessage);
        return;
      }

      const fields = getValidatedFields();
      if (!fields) return;

      // Busy until the preview is answered and acted on, so Discard all
      // cannot clear the editor while this save may still keep its values.
      confirmation.beginPreview();
      try {
        const previewed = await preview(fields);
        if (!mounted.current) return;
        // A rename the preview does not offer as one would not keep the field's values with it, so
        // nothing is put in front of the person to confirm. Judged before a preview with no change
        // is saved as settings alone: two fields trading names leave the same columns, which the
        // preview sees as no change, and saving their definitions would swap their values.
        const { missing } = renameAnswers(
          draftRenames,
          previewed.renamed ?? []
        );
        if (missing) {
          toast.error(renameNotOffered(missing));
          return;
        }
        // Nothing to migrate, no setting changed and no field group to create: nothing to review.
        if (
          !previewed.hasChanges &&
          settingChanges.length === 0 &&
          !createsAny
        ) {
          onNoChanges(fields);
          return;
        }
        previewedFields.current.set(
          previewed,
          JSON.stringify({ fields, previewedWith, settingChanges, creates })
        );
        setReviewedSettingChanges(settingChanges);
        confirmation.request(previewed);
      } catch (err) {
        toast.error(apiErrorMessage(err, "Failed to preview schema changes"));
      } finally {
        confirmation.endPreview();
      }
    })();
  }, [
    slug,
    missingSlugMessage,
    getValidatedFields,
    preview,
    onNoChanges,
    confirmation,
    previewedWith,
    draftRenames,
    settingChanges,
    createsAny,
    creates,
  ]);

  const confirmApply = useCallback(
    (
      resolutions: Record<string, FieldResolution>,
      renameResolutions: SchemaRenameResolution[]
    ) => {
      const fields = getValidatedFields();
      const previewed = confirmation.preview;
      if (!slug || !fields || !previewed) return;
      const shown = previewedFields.current.get(previewed);
      if (
        shown !== undefined &&
        shown !==
          JSON.stringify({ fields, previewedWith, settingChanges, creates })
      ) {
        confirmation.settle();
        toast.error(
          "The fields or settings changed after the preview. Save again to review what changes."
        );
        return;
      }

      // Only settings changed, or field groups to create: the review was of
      // them, and its confirmation creates the groups and saves the settings.
      // Nothing is migrated, so nothing restarts.
      if (!previewed.hasChanges) {
        void (async () => {
          confirmation.beginApply();
          try {
            const refused = await fieldGroupsFirst?.create();
            if (refused) {
              toast.error(refused);
              return;
            }
            confirmation.settle();
            onNoChanges(fields);
          } catch (err) {
            toast.error(apiErrorMessage(err, "Failed to save the changes"));
          } finally {
            confirmation.endApply();
          }
        })();
        return;
      }

      void (async () => {
        confirmation.beginApply();
        startRestart();
        try {
          // The groups the fields use exist before the entity names them; a refused one stops
          // here, before the entity, with every change still pending.
          const refused = await fieldGroupsFirst?.create();
          if (refused) {
            stopRestart(false, refused);
            return;
          }
          // The renames the Builder made are its own to answer, whatever the dialog chose.
          const result = await apply(
            fields,
            previewed.schemaVersion,
            resolutions,
            withDecidedRenames(
              renameResolutions,
              renameAnswers(draftRenames, previewed.renamed ?? []).decided,
              previewed.renamed ?? []
            ),
            // Every conversion the dialog listed: its Save confirms them all.
            acknowledgedConversionsOf(previewed)
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
          // Landed: the groups the entity's picker made that no field uses go.
          fieldGroupsFirst?.letGoUnused?.();
        } catch (err) {
          // A refused apply names each field and why; its envelope's own message is only
          // "Validation failed.", which says neither.
          stopRestart(
            false,
            apiErrorMessage(err, "An error occurred while applying changes")
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
      previewedWith,
      draftRenames,
      settingChanges,
      onNoChanges,
      fieldGroupsFirst,
      creates,
    ]
  );

  return { handleSave, confirmApply, reviewedSettingChanges };
}
