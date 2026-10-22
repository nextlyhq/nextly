"use client";

/** The workbench's confirmations and its review, one open at a time. */
import { TemplateDeleteDialog } from "@admin/components/features/email-hub/TemplateDialogs";
import type { EmailTemplateRecord } from "@admin/services/emailTemplateApi";

import {
  OverrideDialog,
  ResetDialog,
  UnsavedBeforeActDialog,
} from "./OwnershipDialogs";
import { OwnerUpdateReview } from "./OwnerUpdateReview";
import type { OwnershipActs, WorkbenchDialog } from "./useOwnershipActs";

export function WorkbenchDialogs({
  template,
  acts,
  onDiscardEdits,
}: {
  template: EmailTemplateRecord;
  acts: OwnershipActs;
  /** Put the form back to the saved email, so an act can start from it. */
  onDiscardEdits: () => void;
}) {
  const { dialog, setDialog, owner } = acts;
  const openIf = (which: WorkbenchDialog) => (open: boolean) =>
    setDialog(open ? which : null);
  return (
    <>
      <OverrideDialog
        open={dialog === "override"}
        onOpenChange={openIf("override")}
        name={template.name}
        owner={owner}
        isPending={acts.isOverriding}
        onConfirm={acts.confirmOverride}
      />
      <ResetDialog
        open={dialog === "reset"}
        onOpenChange={openIf("reset")}
        name={template.name}
        owner={owner}
        isPending={acts.isResetting}
        onConfirm={acts.confirmReset}
      />
      <UnsavedBeforeActDialog
        open={dialog === "unsaved"}
        onOpenChange={openIf("unsaved")}
        onDiscard={() => {
          onDiscardEdits();
          acts.continueAfterUnsaved();
        }}
      />
      <OwnerUpdateReview
        open={dialog === "review"}
        onOpenChange={openIf("review")}
        templateId={template.id}
        name={template.name}
        owner={owner}
        onApplied={acts.onReviewApplied}
      />
      <TemplateDeleteDialog
        open={dialog === "delete"}
        onOpenChange={openIf("delete")}
        template={{ id: template.id, name: template.name }}
        onConfirm={acts.confirmDelete}
        isLoading={acts.isDeleting}
      />
    </>
  );
}
