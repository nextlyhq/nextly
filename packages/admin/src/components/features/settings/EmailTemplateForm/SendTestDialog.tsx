"use client";

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
import type { JSX } from "react";

import { AlertTriangle, Loader2, Send } from "@admin/components/icons";
import { toast } from "@admin/components/ui";
import {
  useSendTestEmailTemplate,
  useSendTestTarget,
} from "@admin/hooks/queries/useEmailTemplates";
import { useDashboardUser } from "@admin/hooks/useDashboardUser";
import type {
  TemplateTestDraft,
  TestDelivery,
} from "@admin/services/emailTemplateApi";

// ============================================================
// Send-test dialog
// ============================================================

/**
 * Who will deliver the test, and a warning when that is nobody: the log
 * provider, which a site with no provider falls back to, writes the email to
 * the server log instead of sending it.
 */
function DeliveryLine({
  delivery,
}: {
  delivery: TestDelivery | undefined;
}): JSX.Element | null {
  if (!delivery) return null;
  if (!delivery.delivers) {
    return (
      <Alert variant="warning" role="status" data-testid="send-test-log">
        <AlertTriangle className="h-4 w-4" />
        <AlertDescription>
          <strong>Nothing will be delivered.</strong> This site sends through{" "}
          {delivery.provider}, which writes the email to the server log instead.
          Add an email provider in Settings to receive the test.
        </AlertDescription>
      </Alert>
    );
  }
  return (
    <p className="text-sm" data-testid="send-test-provider">
      Delivered by <strong>{delivery.provider}</strong>.
    </p>
  );
}

export function SendTestDialog({
  open,
  onOpenChange,
  templateId,
  templateName,
  sampleData,
  draftOf,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  templateId: string;
  templateName: string;
  sampleData: Record<string, unknown>;
  /** What is on screen, unsaved edits included, read when the test is sent. */
  draftOf: () => TemplateTestDraft;
}): JSX.Element {
  const { mutate: doSend, isPending } = useSendTestEmailTemplate();
  // A test goes to the signed-in user's own address, and only there: the
  // server picks it, so the dialog only says where it will arrive, and who
  // will deliver it.
  const target = useSendTestTarget(templateId, { enabled: open });
  const { user } = useDashboardUser();
  const address = target.data?.to ?? user?.email;

  const handleSubmit = () => {
    // Block duplicate sends while a request is in flight.
    if (isPending || !templateId) return;
    doSend(
      { templateId, variables: sampleData, draft: draftOf() },
      {
        onSuccess: res => {
          if (!res.success) {
            toast.error("Test failed", {
              description:
                "The provider returned unsuccessful. Check your provider configuration.",
            });
          } else if (res.delivery && !res.delivery.delivers) {
            toast.warning("Test written to the server log", {
              description: `${res.delivery.provider} delivers nothing. Add an email provider in Settings to receive it.`,
            });
            onOpenChange(false);
          } else {
            toast.success("Test email sent", {
              description: address
                ? `Check ${address} for the test email.`
                : "Check your inbox for the test email.",
            });
            onOpenChange(false);
          }
        },
        onError: err => {
          toast.error("Test failed", {
            description:
              err instanceof Error
                ? err.message
                : "Failed to send the test email.",
          });
        },
      }
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Send test email</DialogTitle>
          <DialogDescription>
            Send <strong>{templateName || "this template"}</strong> as it is on
            screen, unsaved edits included, with the current sample data. Only
            you receive it: nobody the email copies does.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <p className="text-sm" data-testid="send-test-recipient">
            It will be sent to{" "}
            <strong>{address ?? "your account's email address"}</strong>.
          </p>
          <DeliveryLine delivery={target.data?.delivery} />
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={isPending}
            >
              Cancel
            </Button>
            <Button
              type="button"
              onClick={handleSubmit}
              disabled={isPending || !templateId}
            >
              {isPending ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Sending…
                </>
              ) : (
                <>
                  <Send className="h-4 w-4" />
                  Send test
                </>
              )}
            </Button>
          </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  );
}
