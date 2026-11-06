"use client";

/**
 * The notice on an email kept on the engine it was written for, with the act
 * that reads it as Liquid from now on.
 *
 * A template stored before Liquid that Liquid would read differently keeps
 * sending exactly as before. The notice names the fields and reasons that
 * keep it there; once those lines are changed and saved, "Read it as Liquid"
 * switches it, after a confirmation, because tags and filters then start to
 * work in what it sends. The server refuses while the flagged text is
 * unchanged, and its reason is shown as it gives it.
 */
import {
  Alert,
  AlertDescription,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@nextlyhq/ui";
import { useState, type JSX } from "react";

import {
  KEPT_HELP,
  KEPT_LABEL,
} from "@admin/components/features/email-hub/messages/messages-model";
import { Info, Loader2 } from "@admin/components/icons";
import { toast } from "@admin/components/ui";
import {
  useReadAsLiquid,
  useTemplateEngine,
} from "@admin/hooks/queries/useEmailTemplates";
import type { EmailTemplateRecord } from "@admin/services/emailTemplateApi";

/** The confirmation: what changes when the email is read as Liquid. */
function ReadAsLiquidConfirm({
  open,
  onOpenChange,
  name,
  isPending,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  name: string;
  isPending: boolean;
  onConfirm: () => void;
}): JSX.Element {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Read {name} as Liquid?</DialogTitle>
          <DialogDescription>
            From now on its tags and filters work, as in every other email.
            Check the preview first: what it sends changes wherever it used{" "}
            <code>{"{% %}"}</code>, a filter, or text the previous engine sent
            as written.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isPending}
          >
            Cancel
          </Button>
          <Button type="button" onClick={onConfirm} disabled={isPending}>
            {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            Read as Liquid
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function KeptOnOldEngineNotice({
  record,
  isDirty,
}: {
  record: EmailTemplateRecord;
  /** Unsaved edits: the server checks the saved text, so they're saved first. */
  isDirty: boolean;
}): JSX.Element {
  const engine = useTemplateEngine(record.id);
  const readAsLiquid = useReadAsLiquid();
  const [confirming, setConfirming] = useState(false);
  const reasons = engine.data?.reasons ?? [];

  const confirm = () =>
    readAsLiquid.mutate(record.id, {
      onSuccess: () => {
        setConfirming(false);
        toast.success("This email is now read as Liquid.");
      },
      onError: error => {
        setConfirming(false);
        toast.error("Still kept as before", {
          description:
            error instanceof Error
              ? error.message
              : "It could not be read as Liquid.",
        });
      },
    });

  return (
    <Alert variant="warning" data-testid="kept-on-old-engine">
      <Info className="h-4 w-4" />
      <AlertDescription className="flex flex-1 flex-wrap items-start gap-3">
        <div className="flex-1 space-y-1.5">
          <p>
            <strong>{KEPT_LABEL}.</strong> {KEPT_HELP}
          </p>
          {reasons.length > 0 ? (
            <ul className="list-disc pl-5" data-testid="kept-reasons">
              {reasons.map(reason => (
                <li key={`${reason.field}:${reason.reason}`}>
                  <strong>{reason.label}:</strong> {reason.reason}
                </li>
              ))}
            </ul>
          ) : null}
          {isDirty ? (
            <p className="text-xs">Save your changes to read it as Liquid.</p>
          ) : null}
        </div>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={isDirty || readAsLiquid.isPending}
          onClick={() => setConfirming(true)}
        >
          Read it as Liquid
        </Button>
      </AlertDescription>
      <ReadAsLiquidConfirm
        open={confirming}
        onOpenChange={setConfirming}
        name={record.name}
        isPending={readAsLiquid.isPending}
        onConfirm={confirm}
      />
    </Alert>
  );
}
