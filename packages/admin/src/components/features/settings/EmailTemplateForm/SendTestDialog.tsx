"use client";

import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
} from "@nextlyhq/ui";
import { useEffect, useState } from "react";

import { Loader2, Send } from "@admin/components/icons";
import { toast } from "@admin/components/ui";
import { useSendTestEmailTemplate } from "@admin/hooks/queries/useEmailTemplates";

// ============================================================
// Send-test dialog
// ============================================================

export function SendTestDialog({
  open,
  onOpenChange,
  templateName,
  slug,
  sampleData,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  templateName: string;
  slug: string;
  sampleData: Record<string, unknown>;
}) {
  const [email, setEmail] = useState("");
  const { mutate: doSend, isPending } = useSendTestEmailTemplate();

  useEffect(() => {
    if (open) setEmail("");
  }, [open]);

  const handleSubmit = () => {
    // Block duplicate sends while a request is in flight (Enter can re-fire), and
    // validate the address since the manual Enter path bypasses native
    // `type="email"` validation.
    if (isPending) return;
    const to = email.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) {
      toast.error("Enter a valid email address");
      return;
    }
    doSend(
      { slug, to, variables: sampleData },
      {
        onSuccess: res => {
          if (res.success) {
            toast.success("Test email sent", {
              description: `Check ${to} for the test email.`,
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
            Send <strong>{templateName || "this template"}</strong> to an
            address using the current sample data. This sends the saved
            template, not unsaved edits.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <label htmlFor="send-test-email" className="text-sm font-medium">
              Recipient email
            </label>
            <Input
              id="send-test-email"
              type="email"
              placeholder="you@example.com"
              value={email}
              onChange={e => setEmail(e.target.value)}
              onKeyDown={e => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  handleSubmit();
                }
              }}
              autoFocus
              required
            />
          </div>
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
              disabled={isPending || !email.trim()}
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
