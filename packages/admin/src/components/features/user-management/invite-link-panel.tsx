"use client";

import { Alert, AlertDescription, Button } from "@nextlyhq/ui";
import { useCallback, useState } from "react";

import { Check, Copy, Info } from "@admin/components/icons";
import { UI } from "@admin/constants/ui";

export interface InviteLinkPanelProps {
  /** The person the link was created for — for a friendly heading. */
  userName: string;
  /** The copyable set-password link. */
  link: string;
  /** When the link stops working (ISO string from the API). */
  expiresAt: string;
  /** Create another user — resets the form. */
  onCreateAnother: () => void;
  /** Finish — go back to the users list. */
  onDone: () => void;
}

/**
 * Success panel shown after a user is created in invite mode. The link is the
 * artifact: it is not emailed automatically, so the admin copies it here and
 * delivers it however they choose. Modelled on the API-key reveal — copy now,
 * because the link is what gives the new person access.
 */
export function InviteLinkPanel({
  userName,
  link,
  expiresAt,
  onCreateAnother,
  onDone,
}: InviteLinkPanelProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(() => {
    void navigator.clipboard.writeText(link).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), UI.COPY_FEEDBACK_TIMEOUT_MS);
    });
  }, [link]);

  // Format the expiry as a plain date; fall back to the raw value if the
  // string is not a parseable date.
  const parsed = new Date(expiresAt);
  const expiryLabel = Number.isNaN(parsed.getTime())
    ? expiresAt
    : parsed.toLocaleDateString(undefined, {
        year: "numeric",
        month: "short",
        day: "numeric",
      });

  return (
    <div className="bg-card border border-border rounded-none p-6 shadow-none">
      <div className="mb-6">
        <h2 className="text-xl font-semibold text-foreground">
          {userName} was created
        </h2>
        <p className="text-sm text-muted-foreground mt-1">
          Share this set-password link so they can choose their own password and
          sign in.
        </p>
      </div>

      <Alert variant="info" role="status" className="mb-4">
        <Info className="h-4 w-4" />
        <AlertDescription>
          This link is not emailed automatically — copy it now and send it to
          the person. It expires on {expiryLabel}.
        </AlertDescription>
      </Alert>

      <div className="space-y-2">
        <p className="text-sm font-medium">Set-password link</p>
        <div className="flex items-center gap-2">
          <code className="flex-1 overflow-x-auto rounded-none border border-border bg-primary/5 px-3 py-2 font-mono text-sm break-all">
            {link}
          </code>
          <Button
            type="button"
            variant="outline"
            size="icon-sm"
            onClick={handleCopy}
            aria-label={copied ? "Copied" : "Copy link"}
            className="shrink-0"
          >
            {copied ? (
              <Check className="h-4 w-4 text-success-600" />
            ) : (
              <Copy className="h-4 w-4" />
            )}
          </Button>
        </div>
      </div>

      <div className="mt-8 flex items-center gap-3">
        <Button type="button" onClick={onDone}>
          Back to Users
        </Button>
        <Button type="button" variant="outline" onClick={onCreateAnother}>
          Create Another User
        </Button>
      </div>
    </div>
  );
}
