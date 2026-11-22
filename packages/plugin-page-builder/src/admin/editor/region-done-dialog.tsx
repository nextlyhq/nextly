"use client";

/**
 * The two questions header editing asks: Done's, when the header holds
 * changes not saved ("Publish your header changes?" with "Publish to N
 * pages", "Save as draft", "Discard" and "Keep editing"), and a publish's,
 * which confirms how far it reaches ("Publish the header to N pages?").
 *
 * Someone who may not publish components is offered no publish: Done then
 * asks with "Save as draft", "Discard" and "Keep editing" alone.
 *
 * "Keep editing" is the dialog's own cancel, so it takes the first focus and
 * Escape or a click outside answers it: nothing is published, saved or
 * thrown away by a key pressed without reading.
 *
 * @module admin/editor/region-done-dialog
 */
import type { RegionArea } from "@nextlyhq/blocks-engine";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  Button,
} from "@nextlyhq/ui";
import type { JSX } from "react";

import {
  DISCARD,
  doneQuestion,
  KEEP_EDITING,
  publishLabel,
  publishQuestion,
  publishToLabel,
  SAVE_AS_DRAFT,
  type RegionReach,
} from "./region-editing-words";

/** An answer to Done's question. */
export type DoneAnswer = "publish" | "save" | "discard" | "keep";

/** What both dialogs say of the region and its reach. */
interface RegionQuestion {
  readonly area: RegionArea;
  readonly reach: RegionReach;
  /** An answer is being carried out: every choice waits for it. */
  readonly busy: boolean;
}

/** Why the description says what it says: what each choice leaves. */
function doneDescription(area: RegionArea, mayPublish: boolean): string {
  const word = area === "header" ? "header" : "footer";
  return mayPublish
    ? `Publishing changes the ${word} on every page that shows it. A draft is kept for later, and visitors see the ${word} as it was.`
    : `A draft is kept for someone who can publish, and visitors see the ${word} as it was.`;
}

/** Done's question, shown while `open`. */
export function RegionDoneDialog({
  open,
  area,
  reach,
  busy,
  mayPublish,
  draftable,
  onAnswer,
}: RegionQuestion & {
  open: boolean;
  /** Whether the person may publish components: else no publish is offered. */
  mayPublish: boolean;
  /** Whether a draft can be saved without changing what is live. */
  draftable: boolean;
  onAnswer: (answer: DoneAnswer) => void;
}): JSX.Element {
  return (
    <AlertDialog
      open={open}
      onOpenChange={next => {
        if (!next && !busy) onAnswer("keep");
      }}
    >
      <AlertDialogContent className="max-w-lg" data-region-done={area}>
        <AlertDialogHeader className="text-left sm:text-left">
          <AlertDialogTitle>{doneQuestion(area)}</AlertDialogTitle>
          <AlertDialogDescription>
            {doneDescription(area, mayPublish)}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter className="gap-2 sm:justify-between">
          <AlertDialogCancel className="mt-0" disabled={busy}>
            {KEEP_EDITING}
          </AlertDialogCancel>
          <div className="flex flex-col-reverse gap-2 sm:flex-row">
            <Button
              type="button"
              variant="outline"
              disabled={busy}
              onClick={() => onAnswer("discard")}
            >
              {DISCARD}
            </Button>
            {draftable ? (
              <Button
                type="button"
                variant={mayPublish ? "outline" : "default"}
                disabled={busy}
                onClick={() => onAnswer("save")}
              >
                {SAVE_AS_DRAFT}
              </Button>
            ) : null}
            {mayPublish ? (
              <Button
                type="button"
                disabled={busy}
                onClick={() => onAnswer("publish")}
              >
                {publishToLabel(reach)}
              </Button>
            ) : null}
          </div>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

/** A publish's question, shown while `open`. */
export function RegionPublishDialog({
  open,
  area,
  reach,
  busy,
  onPublish,
  onCancel,
}: RegionQuestion & {
  open: boolean;
  onPublish: () => void;
  onCancel: () => void;
}): JSX.Element {
  return (
    <AlertDialog
      open={open}
      onOpenChange={next => {
        if (!next && !busy) onCancel();
      }}
    >
      <AlertDialogContent className="max-w-md" data-region-publish={area}>
        <AlertDialogHeader className="text-left sm:text-left">
          <AlertDialogTitle>{publishQuestion(area, reach)}</AlertDialogTitle>
          <AlertDialogDescription>
            {`Visitors see the new ${area === "header" ? "header" : "footer"} on every page that shows it as soon as it is published.`}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter className="gap-2">
          <AlertDialogCancel className="mt-0" disabled={busy}>
            Cancel
          </AlertDialogCancel>
          <Button type="button" disabled={busy} onClick={onPublish}>
            {publishLabel(area)}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

/**
 * The top bar's Save and Publish while a header or footer is edited in
 * place: "Save header" and "Publish header", acting on it and never on the
 * page, whose own Save waits until Done. Publish is offered only to someone
 * who may publish components, and asks how far it reaches first.
 */
export function RegionSaveAndPublish({
  bar,
}: {
  bar: {
    readonly area: RegionArea;
    readonly saveLabel: string;
    readonly publishLabel: string;
    readonly mayPublish: boolean;
    readonly draftable: boolean;
    readonly dirty: boolean;
    readonly busy: boolean;
    readonly save: () => void;
    readonly publish: () => void;
  };
}): JSX.Element {
  return (
    <div
      className="flex items-center gap-1.5"
      role="group"
      aria-label={bar.area === "header" ? "Site header" : "Site footer"}
      data-region-save={bar.area}
    >
      {bar.draftable ? (
        <Button
          type="button"
          size="sm"
          variant="outline"
          // Focusable while there is nothing to save, so the bar reads the
          // same to a keyboard; pressing it then does nothing.
          aria-disabled={!bar.dirty || bar.busy}
          onClick={() => {
            if (bar.dirty && !bar.busy) bar.save();
          }}
        >
          {bar.saveLabel}
        </Button>
      ) : null}
      {bar.mayPublish ? (
        <Button
          type="button"
          size="sm"
          aria-disabled={bar.busy}
          onClick={() => {
            if (!bar.busy) bar.publish();
          }}
        >
          {bar.publishLabel}
        </Button>
      ) : null}
    </div>
  );
}
