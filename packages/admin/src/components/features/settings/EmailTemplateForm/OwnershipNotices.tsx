"use client";

/**
 * What the content column says about whose email this is, above the envelope.
 *
 * One notice per fact, each with the act it leads to: an owner's email can be
 * overridden, an owner's update reviewed, a customised email reset, and an
 * applied review or reset undone until the person leaves.
 */
import { Alert, AlertDescription, Button } from "@nextlyhq/ui";
import type { JSX } from "react";

import { Info, Lock, RotateCcw } from "@admin/components/icons";
import type { EmailTemplateRecord } from "@admin/services/emailTemplateApi";

import { KeptOnOldEngineNotice } from "./KeptOnOldEngineNotice";
import { ownerName } from "./workbench-model";

/** An act just done that can still be undone. */
export interface UndoNote {
  message: string;
  onUndo: () => void;
  isPending: boolean;
}

export function OwnershipNotices({
  record,
  ownsContent,
  keptOnOldEngine,
  isDirty = false,
  undo,
  onOverride,
  onReview,
  onReset,
}: {
  record?: EmailTemplateRecord;
  ownsContent: boolean;
  keptOnOldEngine: boolean;
  /** Unsaved edits, which reading as Liquid waits for. */
  isDirty?: boolean;
  undo: UndoNote | null;
  onOverride: () => void;
  onReview: () => void;
  onReset: () => void;
}): JSX.Element | null {
  if (!record) return null;
  const owner = ownerName(record);

  return (
    <div className="flex flex-col gap-3" data-testid="ownership-notices">
      {undo ? (
        <div className="flex items-center gap-2 rounded-md border border-border bg-card px-3 py-2 text-sm text-muted-foreground">
          <span className="flex-1">{undo.message}</span>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={undo.isPending}
            onClick={undo.onUndo}
          >
            Undo
          </Button>
        </div>
      ) : null}

      {!ownsContent ? (
        // Foreground ink rather than the info variant's primary: a site's
        // brand primary can be light, and this notice is body text to read.
        <Alert variant="info" className="text-foreground">
          <Lock className="h-4 w-4" />
          <AlertDescription className="flex flex-1 flex-wrap items-center gap-3">
            <span className="flex-1">
              {owner} keeps this email up to date. You can preview it, change
              the test data and send a test. Override it to change its subject,
              preview text or body.
            </span>
            <Button type="button" size="sm" onClick={onOverride}>
              Override
            </Button>
          </AlertDescription>
        </Alert>
      ) : null}

      {record.ownerChanged ? (
        <Alert variant="warning">
          <Info className="h-4 w-4" />
          <AlertDescription className="flex flex-1 flex-wrap items-center gap-3">
            <span className="flex-1">
              {owner} updated this email since your site customised it.
            </span>
            <Button type="button" size="sm" onClick={onReview}>
              Review the changes
            </Button>
          </AlertDescription>
        </Alert>
      ) : record.overridden && !undo ? (
        <div className="flex items-center gap-2 rounded-md border border-border bg-card px-3 py-2 text-sm text-muted-foreground">
          <span className="flex-1">
            Your site&apos;s version of {owner}&apos;s email.
          </span>
          <Button type="button" size="sm" variant="ghost" onClick={onReset}>
            <RotateCcw className="h-4 w-4" />
            Reset to {owner}&apos;s version
          </Button>
        </div>
      ) : null}

      {keptOnOldEngine ? (
        <KeptOnOldEngineNotice record={record} isDirty={isDirty} />
      ) : null}
    </div>
  );
}
