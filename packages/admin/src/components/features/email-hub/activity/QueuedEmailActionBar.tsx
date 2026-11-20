"use client";

import {
  Alert,
  AlertDescription,
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertTitle,
  Button,
} from "@nextlyhq/ui";
import type { JSX } from "react";
import { useState } from "react";

import { toast } from "@admin/components/ui";
import {
  useQueuedEmailAction,
  type QueuedEmailAction,
} from "@admin/hooks/queries/useEmailActivity";
import type { QueuedEmailState } from "@admin/services/emailActivityApi";

import { queuedEmailActions } from "./activity-detail-model";

export interface QueuedEmailActionBarProps {
  id: string;
  email: { state: QueuedEmailState; messageHeld: boolean };
  /** What the reader may do, as the server asks it (`manage-email-deliveries`). */
  can: { retry: boolean; cancel: boolean };
}

/**
 * A queued email's Retry and Cancel, in its detail sheet: offered only to a reader who may do
 * them, and only while the server allows them (`queuedEmailActions`). Cancel asks first, since a
 * cancelled email can't be tried again. A refusal, an email that moved on meanwhile say, is
 * shown with the server's reason, and every Activity read is read again either way.
 */
export function QueuedEmailActionBar({
  id,
  email,
  can,
}: QueuedEmailActionBarProps): JSX.Element | null {
  const action = useQueuedEmailAction();
  const [confirming, setConfirming] = useState(false);
  const [refused, setRefused] = useState<string | null>(null);
  if (!can.retry && !can.cancel) return null;
  const allowed = queuedEmailActions(email);
  const offerRetry = can.retry && allowed.retry;
  const offerCancel = can.cancel && allowed.cancel;
  if (!offerRetry && !offerCancel && allowed.note === null) return null;

  const run = (which: QueuedEmailAction) => {
    setRefused(null);
    action.mutate(
      { action: which, id },
      {
        onSuccess: answer => {
          setConfirming(false);
          toast.success(answer.message);
        },
        onError: error => {
          setConfirming(false);
          setRefused(error.message);
        },
      }
    );
  };

  return (
    <div className="space-y-2">
      {(offerRetry || offerCancel) && (
        <div className="flex flex-wrap gap-2">
          {offerRetry && (
            <Button
              variant="outline"
              size="sm"
              disabled={action.isPending}
              onClick={() => run("retry")}
            >
              Try again now
            </Button>
          )}
          {offerCancel && (
            <Button
              variant="outline"
              size="sm"
              disabled={action.isPending}
              onClick={() => setConfirming(true)}
            >
              Cancel email
            </Button>
          )}
        </div>
      )}
      {allowed.note && (
        <p className="text-xs text-muted-foreground">{allowed.note}</p>
      )}
      {refused && (
        <Alert variant="destructive" role="alert">
          <AlertTitle>That couldn’t be done</AlertTitle>
          <AlertDescription>{refused}</AlertDescription>
        </Alert>
      )}
      <AlertDialog open={confirming} onOpenChange={setConfirming}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Cancel this email?</AlertDialogTitle>
            <AlertDialogDescription>
              {email.state === "sending"
                ? "It’s with the provider now: it’s cancelled only if this attempt fails, and sent if it succeeds."
                : "It won’t be sent, and a cancelled email can’t be tried again."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={action.isPending}>
              Keep it
            </AlertDialogCancel>
            <AlertDialogAction
              // Kept open until the cancel settles, so its pending state shows.
              onClick={event => {
                event.preventDefault();
                run("cancel");
              }}
              disabled={action.isPending}
            >
              Cancel email
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
