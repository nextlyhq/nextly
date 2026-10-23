"use client";

import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@nextlyhq/ui";
import type { JSX } from "react";
import { useEffect, useState } from "react";

import { Loader2 } from "@admin/components/icons";
import { toast } from "@admin/components/ui";
import { usePreviewEmailTemplate } from "@admin/hooks/queries/useEmailTemplates";

/** An email or layout a dialog acts on. */
export interface TemplateRef {
  id: string;
  name: string;
}

// Sample data for the list preview — mirrors the workbench values so the
// preview renders the real variables instead of leaving them blank.
const PREVIEW_SAMPLE_DATA: Record<string, string> = {
  appName: "Northwind",
  year: String(new Date().getFullYear()),
  userName: "Priya Raman",
  userEmail: "priya.raman@northwind.io",
  verifyLink: "https://app.northwind.io/verify?token=8f2c1a",
  resetLink: "https://app.northwind.io/reset?token=8f2c1a",
  url: "https://app.northwind.io/action?token=8f2c1a",
  token: "8f2c1a",
  expiresIn: "30 minutes",
  siteName: "Northwind",
  siteUrl: "https://northwind.io",
};

export function TemplateDeleteDialog({
  open,
  onOpenChange,
  template,
  onConfirm,
  isLoading,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  template: TemplateRef | null;
  onConfirm: () => void;
  isLoading: boolean;
}): JSX.Element | null {
  if (!template) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="sm:max-w-md"
        aria-describedby="delete-template-description"
        role="alertdialog"
      >
        <DialogHeader>
          <DialogTitle>Delete this email?</DialogTitle>
          <DialogDescription id="delete-template-description">
            Are you sure you want to delete <strong>{template.name}</strong>?
            This action cannot be undone.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isLoading}
          >
            Cancel
          </Button>
          <Button
            variant="destructive"
            onClick={onConfirm}
            disabled={isLoading}
          >
            {isLoading ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Deleting...
              </>
            ) : (
              "Delete"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function TemplatePreviewDialog({
  open,
  onOpenChange,
  template,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  template: TemplateRef | null;
}): JSX.Element | null {
  const { mutate: doPreview, isPending: isLoading } = usePreviewEmailTemplate();
  const [previewHtml, setPreviewHtml] = useState("");
  const [previewSubject, setPreviewSubject] = useState("");

  useEffect(() => {
    if (!open || !template) return;
    doPreview(
      { id: template.id, sampleData: PREVIEW_SAMPLE_DATA },
      {
        onSuccess: result => {
          setPreviewSubject(result.subject);
          setPreviewHtml(result.html);
        },
        onError: err => {
          toast.error("Failed to load preview", {
            description: err instanceof Error ? err.message : "Unknown error",
          });
          onOpenChange(false);
        },
      }
    );
  }, [open, template, doPreview, onOpenChange]);

  if (!template) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[80vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>Preview: {template.name}</DialogTitle>
          {previewSubject && (
            <DialogDescription>Subject: {previewSubject}</DialogDescription>
          )}
        </DialogHeader>
        <div className="flex-1 overflow-auto border border-border rounded-md">
          {isLoading ? (
            <div className="flex items-center justify-center h-48">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <iframe
              srcDoc={previewHtml}
              title={`Preview: ${template.name}`}
              className="w-full h-[400px] border-0"
              sandbox=""
            />
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
