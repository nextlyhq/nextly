"use client";

/**
 * What the workbench can do about whose email it is: override it, reset it to
 * its owner's version, review the owner's update, undo the last of those, and
 * duplicate or delete it. Each act's confirmation is one of the workbench's
 * dialogs, and which one is open is held here too.
 */
import { useState } from "react";

import { isDeletable } from "@admin/components/features/email-hub/messages/messages-model";
import { toast } from "@admin/components/ui";
import {
  EMAIL_TEMPLATE_CREATE_PERMISSIONS,
  EMAIL_TEMPLATE_DELETE_PERMISSIONS,
  holdsAny,
} from "@admin/constants/email-hub";
import { ROUTES, withQuery } from "@admin/constants/routes";
import {
  useDeleteEmailTemplate,
  useOverrideEmailTemplate,
  useResetEmailTemplate,
  useUndoOwnerUpdate,
  useUpdateEmailTemplate,
} from "@admin/hooks/queries/useEmailTemplates";
import { useCurrentUserPermissions } from "@admin/hooks/useCurrentUserPermissions";
import { navigateTo } from "@admin/lib/navigation";
import type {
  EmailTemplateRecord,
  EmailTemplateVersion,
  OwnerUpdateUndo,
} from "@admin/services/emailTemplateApi";

import type { UndoNote } from "./OwnershipNotices";
import { ownerName } from "./workbench-model";
import type { WorkbenchMenu } from "./WorkbenchHeader";

export type WorkbenchDialog =
  | "override"
  | "reset"
  | "review"
  | "unsaved"
  | "delete";

/** What a Reset replaces beside the text: the site's description and declarations. */
type SiteDetails = Pick<EmailTemplateRecord, "description" | "variables">;

/** What an Undo puts back: the site's version before a Reset, or a review's. */
type Undoable =
  | { kind: "reset"; version: EmailTemplateVersion; details: SiteDetails }
  | { kind: "review"; undo: OwnerUpdateUndo };

/** The acts that start from the saved email, so unsaved edits go first. */
type SavedAct = "override" | "reset" | "review";

function versionOf(template: EmailTemplateRecord): EmailTemplateVersion {
  return {
    subject: template.subject,
    htmlContent: template.htmlContent,
    plainTextContent: template.plainTextContent,
    preheader: template.preheader,
  };
}

/** Why Delete isn't offered for an email the server won't delete. */
function deleteRefusalFor(
  template: EmailTemplateRecord | undefined
): string | undefined {
  if (!template || isDeletable(template)) return undefined;
  return template.owner.kind === "site"
    ? "The default layout can't be deleted"
    : `Can't delete: ${ownerName(template)}'s email`;
}

/** The note offering to undo the last reset or applied review. */
function undoNoteFor(
  undoable: Undoable | null,
  owner: string,
  onUndo: () => void,
  isPending: boolean
): UndoNote | null {
  if (!undoable) return null;
  const message =
    undoable.kind === "reset"
      ? `Reset to ${owner}'s version.`
      : `${owner}'s update applied.`;
  return { message, onUndo, isPending };
}

/** The header menu's acts for this email and this reader. */
function menuFor({
  template,
  hasPermission,
  startAct,
  setDialog,
}: {
  template: EmailTemplateRecord | undefined;
  hasPermission: (slug: string) => boolean;
  startAct: (act: SavedAct) => void;
  setDialog: (dialog: WorkbenchDialog) => void;
}): WorkbenchMenu {
  if (!template) return {};
  const canDuplicate =
    template.kind === "template" &&
    holdsAny(hasPermission, EMAIL_TEMPLATE_CREATE_PERMISSIONS);
  const canDelete =
    isDeletable(template) &&
    holdsAny(hasPermission, EMAIL_TEMPLATE_DELETE_PERMISSIONS);
  return {
    onDuplicate: canDuplicate
      ? () =>
          navigateTo(
            withQuery(ROUTES.EMAIL_MESSAGES_CREATE, { duplicate: template.id })
          )
      : undefined,
    onReview: template.ownerChanged ? () => startAct("review") : undefined,
    onReset: template.overridden ? () => startAct("reset") : undefined,
    onDelete: canDelete ? () => setDialog("delete") : undefined,
    deleteRefusal: deleteRefusalFor(template),
  };
}

const failed = (title: string) => (error: Error) =>
  toast.error(title, { description: error.message });

export function useOwnershipActs({
  template,
  isDirty,
  listHref,
}: {
  /** The saved email; nothing while creating one, when there's nothing to do. */
  template: EmailTemplateRecord | undefined;
  isDirty: boolean;
  /** Where the workbench returns once its email is deleted. */
  listHref: string;
}) {
  const [dialog, setDialog] = useState<WorkbenchDialog | null>(null);
  const [undoable, setUndoable] = useState<Undoable | null>(null);
  // The act the unsaved-edits question was asked for, to continue to.
  const [afterUnsaved, setAfterUnsaved] = useState<SavedAct>("review");
  const { hasPermission } = useCurrentUserPermissions();
  const override = useOverrideEmailTemplate();
  const reset = useResetEmailTemplate();
  const undoUpdate = useUndoOwnerUpdate();
  const update = useUpdateEmailTemplate();
  const remove = useDeleteEmailTemplate();
  const owner = template ? ownerName(template) : "";

  const confirmOverride = () => {
    if (!template) return;
    override.mutate(
      { id: template.id },
      {
        onSuccess: () => {
          setDialog(null);
          toast.success("Overridden", {
            description: `${template.name} is now your site's version.`,
          });
        },
        onError: failed("It couldn't be overridden"),
      }
    );
  };

  const confirmReset = () => {
    if (!template) return;
    const version = versionOf(template);
    const details = {
      description: template.description,
      variables: template.variables,
    };
    reset.mutate(template.id, {
      onSuccess: () => {
        setDialog(null);
        // Undone by overriding again, which bases the override on the
        // owner's version now. That is the base the email had only when no
        // owner update was waiting; with one waiting, an undo would quietly
        // drop it from review, so none is offered.
        if (!template.ownerChanged) {
          setUndoable({ kind: "reset", version, details });
        }
      },
      onError: failed("It couldn't be reset"),
    });
  };

  const confirmDelete = () => {
    if (!template) return;
    remove.mutate(template.id, {
      onSuccess: () => {
        toast.success("Email deleted", {
          description: `${template.name} has been deleted.`,
        });
        navigateTo(listHref);
      },
      onError: failed("Delete failed"),
    });
  };

  /**
   * Override, Reset and a review each start from the saved email and replace
   * the form with what the server returns, so unsaved edits (a setting, say)
   * are asked about first rather than silently dropped.
   */
  const startAct = (act: SavedAct) => {
    setAfterUnsaved(act);
    setDialog(isDirty ? "unsaved" : act);
  };

  /** Put back what the last Reset or review replaced. */
  const restore = async (id: string, last: Undoable) => {
    if (last.kind === "review") {
      await undoUpdate.mutateAsync({ id, undo: last.undo });
      return;
    }
    // The text comes back as an override; the site's description and
    // declarations, which Reset gave back to the owner, come back after it.
    await override.mutateAsync({ id, version: last.version });
    await update.mutateAsync({ id, data: last.details });
  };

  const runUndo = () => {
    if (!template || !undoable) return;
    restore(template.id, undoable).then(() => {
      setUndoable(null);
      toast.success("Undone");
    }, failed("It couldn't be undone"));
  };

  return {
    dialog,
    setDialog,
    owner,
    menu: menuFor({ template, hasPermission, startAct, setDialog }),
    undoNote: undoNoteFor(
      undoable,
      owner,
      runUndo,
      override.isPending || undoUpdate.isPending || update.isPending
    ),
    startAct,
    /** After discarding unsaved edits: on to the act they were asked for. */
    continueAfterUnsaved: () => setDialog(afterUnsaved),
    confirmOverride,
    confirmReset,
    confirmDelete,
    onReviewApplied: (undo: OwnerUpdateUndo) =>
      setUndoable({ kind: "review", undo }),
    isOverriding: override.isPending,
    isResetting: reset.isPending,
    isDeleting: remove.isPending,
  };
}

export type OwnershipActs = ReturnType<typeof useOwnershipActs>;
