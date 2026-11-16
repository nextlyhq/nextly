"use client";

/**
 * What a release does to this document at its moment: it goes live, or it
 * comes down. Asked the one way by every dialog that puts a document in a
 * release, scheduled on its own or added to one.
 *
 * Each option stands on the document's own grant, `publish-<slug>` or
 * `unpublish-<slug>`, and one the reader may not take is held with the reason
 * beside it, so it is never mistaken for a choice that simply is not there.
 *
 * @module components/features/releases/ReleaseActionChoice
 */

import { useId, type JSX } from "react";

import { Label, RadioGroup, RadioGroupItem } from "@admin/components/ui";
import type { ReleaseMemberAction } from "@admin/types/releases";

/** Why an option the reader may not take is held, said of what the choice is about. */
function heldReason(action: ReleaseMemberAction, subject: string): string {
  return `You do not have permission to ${
    action === "publish" ? "publish" : "unpublish"
  } ${subject}.`;
}

const LABEL: Record<ReleaseMemberAction, string> = {
  publish: "Goes live",
  unpublish: "Comes down",
};

/**
 * The action to open on: going live where the reader may publish, else coming
 * down, so a dialog never opens on a choice it holds.
 */
export function initialReleaseAction(canPublish: boolean): ReleaseMemberAction {
  return canPublish ? "publish" : "unpublish";
}

export function ReleaseActionChoice({
  action,
  onChange,
  canPublishDocument,
  canUnpublishDocument,
  subject = "this document",
  heldSubject = subject,
}: {
  action: ReleaseMemberAction;
  onChange: (next: ReleaseMemberAction) => void;
  canPublishDocument: boolean;
  canUnpublishDocument: boolean;
  /** What the choice is about, as the legend names it: one document or several. */
  subject?: string;
  /** What a held option's reason names, where it differs from the legend's subject. */
  heldSubject?: string;
}): JSX.Element {
  const ids = useId();
  const allowed: Record<ReleaseMemberAction, boolean> = {
    publish: canPublishDocument,
    unpublish: canUnpublishDocument,
  };
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-1 text-sm font-medium">
        At that moment, {subject}
      </legend>
      <RadioGroup
        value={action}
        onValueChange={next => onChange(next as ReleaseMemberAction)}
      >
        {(["publish", "unpublish"] as const).map(each => (
          <div key={each} className="flex flex-col gap-0.5">
            <div className="flex items-center gap-2">
              <RadioGroupItem
                value={each}
                id={`${ids}-${each}`}
                disabled={!allowed[each]}
                aria-describedby={
                  allowed[each] ? undefined : `${ids}-${each}-held`
                }
              />
              <Label htmlFor={`${ids}-${each}`} className="font-normal">
                {LABEL[each]}
              </Label>
            </div>
            {allowed[each] ? null : (
              <p
                id={`${ids}-${each}-held`}
                className="pl-6 text-xs text-muted-foreground"
              >
                {heldReason(each, heldSubject)}
              </p>
            )}
          </div>
        ))}
      </RadioGroup>
    </fieldset>
  );
}
