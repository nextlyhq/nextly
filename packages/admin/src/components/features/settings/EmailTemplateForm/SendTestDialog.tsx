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

import { Loader2, Send } from "@admin/components/icons";
import { toast } from "@admin/components/ui";
import { useSendTestEmailTemplate } from "@admin/hooks/queries/useEmailTemplates";
import { useDashboardUser } from "@admin/hooks/useDashboardUser";

// ============================================================
// Send-test dialog
// ============================================================

export function SendTestDialog({
  open,
  onOpenChange,
  templateId,
  templateName,
  sampleData,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  templateId: string;
  templateName: string;
  /** The template's slug; kept for callers, the test is sent by id. */
  slug?: string;
  sampleData: Record<string, unknown>;
}) {
  const { mutate: doSend, isPending } = useSendTestEmailTemplate();
  // A test goes to the signed-in user's own address, and only there: the
  // server picks it, so the dialog only says where it will arrive.
  const { user } = useDashboardUser();
  const address = user?.email;

  const handleSubmit = () => {
    // Block duplicate sends while a request is in flight.
    if (isPending || !templateId) return;
    doSend(
      { templateId, variables: sampleData },
      {
        onSuccess: res => {
          if (res.success) {
            toast.success("Test email sent", {
              description: address
                ? `Check ${address} for the test email.`
                : "Check your inbox for the test email.",
            });
            onOpenChange(false);
          } else {
            toast.error("Test failed", {
              description:
                "The provider returned unsuccessful. Check your provider configuration.",
            });
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
            Send <strong>{templateName || "this template"}</strong> to your own
            address using the current sample data. This sends the saved
            template, not unsaved edits.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <p className="text-sm" data-testid="send-test-recipient">
            It will be sent to{" "}
            <strong>{address ?? "your account's email address"}</strong>.
          </p>
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
