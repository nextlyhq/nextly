"use client";

import type React from "react";
import { useCallback, useState } from "react";

import { Copy, Edit, Eye, Trash2 } from "@admin/components/icons";
import { toast } from "@admin/components/ui";
import {
  EMAIL_TEMPLATE_CREATE_PERMISSIONS,
  EMAIL_TEMPLATE_DELETE_PERMISSIONS,
  EMAIL_TEMPLATE_PREVIEW_PERMISSIONS,
  EMAIL_TEMPLATE_UPDATE_PERMISSIONS,
  holdsAny,
} from "@admin/constants/email-hub";
import { ROUTES, buildRoute, withQuery } from "@admin/constants/routes";
import { useDeleteEmailTemplate } from "@admin/hooks/queries/useEmailTemplates";
import { useCurrentUserPermissions } from "@admin/hooks/useCurrentUserPermissions";
import { navigateTo } from "@admin/lib/navigation";
import type { EmailTemplateRecord } from "@admin/services/emailTemplateApi";

import { isDeletable } from "./messages/messages-model";
import {
  TemplateDeleteDialog,
  TemplatePreviewDialog,
  type TemplateRef,
} from "./TemplateDialogs";

/** One entry in an email's actions menu. */
export interface TemplateAction {
  id: "open" | "preview" | "duplicate" | "delete";
  label: string;
  icon: React.ReactNode;
  destructive?: boolean;
  onSelect: () => void;
}

/** Where an email or layout opens for editing. */
export function editRouteFor(record: Pick<EmailTemplateRecord, "id">): string {
  return buildRoute(ROUTES.EMAIL_MESSAGES_EDIT, { id: record.id });
}

/**
 * What a reader may do to an email or layout from a list, and the dialogs
 * those actions open.
 *
 * Each action shows only with the grant the server checks for it, so a
 * read-only reader sees the list and no action they would be refused. The
 * server still refuses each one on its own: this hides, it doesn't guard.
 */
export function useTemplateActions() {
  const { hasPermission } = useCurrentUserPermissions();
  const can = {
    open: holdsAny(hasPermission, EMAIL_TEMPLATE_UPDATE_PERMISSIONS),
    preview: holdsAny(hasPermission, EMAIL_TEMPLATE_PREVIEW_PERMISSIONS),
    duplicate: holdsAny(hasPermission, EMAIL_TEMPLATE_CREATE_PERMISSIONS),
    delete: holdsAny(hasPermission, EMAIL_TEMPLATE_DELETE_PERMISSIONS),
  };

  const { mutate: doDelete, isPending: isDeleting } = useDeleteEmailTemplate();
  const [toDelete, setToDelete] = useState<TemplateRef | null>(null);
  const [toPreview, setToPreview] = useState<TemplateRef | null>(null);

  const confirmDelete = useCallback(() => {
    if (!toDelete) return;
    doDelete(toDelete.id, {
      onSuccess: () => {
        toast.success("Email deleted", {
          description: `${toDelete.name} has been deleted.`,
        });
        setToDelete(null);
      },
      onError: err => {
        setToDelete(null);
        const errorMessage =
          err instanceof Error ? err.message : "Unknown error";
        if (!errorMessage.toLowerCase().includes("not found")) {
          toast.error("Delete failed", { description: errorMessage });
        } else {
          toast.success("Email deleted", {
            description: `${toDelete.name} has been deleted.`,
          });
        }
      },
    });
  }, [toDelete, doDelete]);

  const actionsFor = useCallback(
    (record: EmailTemplateRecord): TemplateAction[] => {
      const ref = { id: record.id, name: record.name };
      const actions: TemplateAction[] = [];
      if (can.open) {
        actions.push({
          id: "open",
          label: "Open",
          icon: <Edit className="h-4 w-4" />,
          onSelect: () => navigateTo(editRouteFor(record)),
        });
      }
      if (can.preview) {
        actions.push({
          id: "preview",
          label: "Preview",
          icon: <Eye className="h-4 w-4" />,
          onSelect: () => setToPreview(ref),
        });
      }
      if (can.duplicate && record.kind === "template") {
        actions.push({
          id: "duplicate",
          label: "Duplicate",
          icon: <Copy className="h-4 w-4" />,
          onSelect: () =>
            navigateTo(
              withQuery(ROUTES.EMAIL_MESSAGES_CREATE, { duplicate: record.id })
            ),
        });
      }
      if (can.delete && isDeletable(record)) {
        actions.push({
          id: "delete",
          label: "Delete",
          icon: <Trash2 className="h-4 w-4" />,
          destructive: true,
          onSelect: () => setToDelete(ref),
        });
      }
      return actions;
    },
    [can.open, can.preview, can.duplicate, can.delete]
  );

  // Stable, because the preview dialog requests its preview in an effect that
  // depends on this handler: a new function each render would request again.
  const closeDelete = useCallback((open: boolean) => {
    if (!open) setToDelete(null);
  }, []);
  const closePreview = useCallback((open: boolean) => {
    if (!open) setToPreview(null);
  }, []);

  const dialogs = (
    <>
      <TemplateDeleteDialog
        open={toDelete !== null}
        onOpenChange={closeDelete}
        template={toDelete}
        onConfirm={confirmDelete}
        isLoading={isDeleting}
      />
      <TemplatePreviewDialog
        open={toPreview !== null}
        onOpenChange={closePreview}
        template={toPreview}
      />
    </>
  );

  return { actionsFor, canOpen: can.open, dialogs };
}
