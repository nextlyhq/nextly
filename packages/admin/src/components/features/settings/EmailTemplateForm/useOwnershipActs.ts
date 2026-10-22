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

/** What an Undo puts back: the site's text before a Reset, or a review's. */
type Undoable =
  | { kind: "reset"; version: EmailTemplateVersion }
  | { kind: "review"; undo: OwnerUpdateUndo };

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
  startReview,
  setDialog,
}: {
  template: EmailTemplateRecord | undefined;
  hasPermission: (slug: string) => boolean;
  startReview: () => void;
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
    onReview: template.ownerChanged ? startReview : undefined,
    onReset: template.overridden ? () => setDialog("reset") : undefined,
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
  const { hasPermission } = useCurrentUserPermissions();
  const override = useOverrideEmailTemplate();
  const reset = useResetEmailTemplate();
  const undoUpdate = useUndoOwnerUpdate();
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
    const before = versionOf(template);
    reset.mutate(template.id, {
      onSuccess: () => {
        setDialog(null);
        setUndoable({ kind: "reset", version: before });
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

  /** A review starts from what's saved, so unsaved edits are asked about first. */
  const startReview = () => setDialog(isDirty ? "unsaved" : "review");

  const runUndo = () => {
    if (!template || !undoable) return;
    const done = {
      onSuccess: () => {
        setUndoable(null);
        toast.success("Undone");
      },
      onError: failed("It couldn't be undone"),
    };
    if (undoable.kind === "reset") {
      override.mutate({ id: template.id, version: undoable.version }, done);
    } else {
      undoUpdate.mutate({ id: template.id, undo: undoable.undo }, done);
    }
  };

  return {
    dialog,
    setDialog,
    owner,
    menu: menuFor({ template, hasPermission, startReview, setDialog }),
    undoNote: undoNoteFor(
      undoable,
      owner,
      runUndo,
      override.isPending || undoUpdate.isPending
    ),
    startReview,
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
