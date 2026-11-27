"use client";

/**
 * The buttons of the language being written: Save, the one main button, and
 * what is done less often under its arrow.
 *
 * @module components/features/translations/page/LanguageActionButtons
 */

import { useRef, type JSX, type ReactNode, type RefObject } from "react";

import { ChevronDown } from "@admin/components/icons";
import {
  Button,
  buttonVariants,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@admin/components/ui";
import { Link } from "@admin/components/ui/link";
import { cn } from "@admin/lib/utils";

import type { LanguageActions, MainAction } from "./language-actions";

export interface LanguageActionButtonsProps {
  /** The language's name. */
  language: string;
  can: LanguageActions;
  isDirty: boolean;
  isSaving: boolean;
  /** The sentences under the buttons, by the id each is described by. */
  noteId: string;
  waitingId: string;
  /** The document's editor. */
  editorHref: string;
  actions: RefObject<HTMLDivElement | null>;
  arrow: RefObject<HTMLButtonElement | null>;
  onSave: () => void;
  onPublish: () => void;
  onTakeOffline: () => void;
}

function SaveButton({
  main,
  can,
  isDirty,
  isSaving,
  noteId,
  onSave,
}: LanguageActionButtonsProps & { main: boolean }): JSX.Element {
  return (
    <Button
      type="button"
      size="sm"
      variant={main ? "default" : "outline"}
      className={main ? "rounded-r-none" : undefined}
      data-slot="translation-save"
      disabled={!isDirty || isSaving}
      aria-describedby={can.note === undefined ? undefined : noteId}
      onClick={onSave}
    >
      {isSaving ? "Saving…" : can.saveLabel}
    </Button>
  );
}

function PublishButton({
  language,
  can,
  isDirty,
  waitingId,
  onPublish,
}: LanguageActionButtonsProps): JSX.Element {
  return (
    <Button
      type="button"
      size="sm"
      // Not `disabled`, which would drop focus while the save it starts is on
      // its way.
      aria-disabled={!can.canPublishNow}
      aria-describedby={isDirty && !can.savesFirst ? waitingId : undefined}
      className="rounded-r-none aria-disabled:cursor-not-allowed aria-disabled:opacity-50"
      onClick={onPublish}
    >
      Publish {language}
    </Button>
  );
}

function OpenInEditorButton({
  editorHref,
  can,
}: LanguageActionButtonsProps): JSX.Element {
  return (
    <Link
      href={editorHref}
      className={cn(
        buttonVariants({ variant: "outline", size: "sm" }),
        can.offersOffline && "rounded-r-none"
      )}
    >
      Open in editor
    </Link>
  );
}

function MainButton(props: LanguageActionButtonsProps): JSX.Element {
  switch (props.can.main) {
    case "publish":
      return <PublishButton {...props} />;
    case "save":
      return <SaveButton {...props} main />;
    case "open":
      return <OpenInEditorButton {...props} />;
  }
}

/** How the arrow looks beside each main button. */
function arrowLook(main: MainAction): {
  variant: "default" | "outline";
  className: string;
} {
  return main === "open"
    ? { variant: "outline", className: "border-l-0" }
    : { variant: "default", className: "border-l-primary-foreground/25" };
}

/** The arrow, and what is under it. */
function MoreActions({
  language,
  can,
  isDirty,
  isSaving,
  waitingId,
  editorHref,
  arrow,
  onTakeOffline,
}: LanguageActionButtonsProps): JSX.Element {
  // Asked from the menu, which would otherwise take focus back as it closes.
  const leaving = useRef(false);
  const look = arrowLook(can.main);
  return (
    // Not modal: what it opens is, and two would hold the page at once.
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <Button
          ref={arrow}
          type="button"
          size="sm"
          variant={look.variant}
          className={cn("rounded-l-none px-1.5", look.className)}
          aria-label={`More actions for ${language}`}
        >
          <ChevronDown className="h-4 w-4" aria-hidden />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        onCloseAutoFocus={event => {
          if (leaving.current) event.preventDefault();
          leaving.current = false;
        }}
      >
        {can.offersOffline ? (
          <DropdownMenuItem
            disabled={isDirty || isSaving}
            aria-describedby={can.waiting === undefined ? undefined : waitingId}
            onSelect={() => {
              leaving.current = true;
              onTakeOffline();
            }}
          >
            Take offline…
          </DropdownMenuItem>
        ) : null}
        {can.main === "open" ? null : (
          <DropdownMenuItem asChild>
            <Link href={editorHref}>Open in editor</Link>
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function LanguageActionButtons(
  props: LanguageActionButtonsProps & {
    readOnly: boolean;
    /** Drawn in place of these, where a workflow's step leads. */
    reviewed: ReactNode;
    /** What is drawn around the actions: History, and a version's own. */
    around: (actions: ReactNode) => ReactNode;
  }
): JSX.Element {
  const { language, can, actions, readOnly, reviewed, around } = props;
  const { main, offersOffline } = can;
  const own = (
    <>
      {/* Save beside the main button, where it is not it. */}
      {main === "publish" && !readOnly ? (
        <SaveButton {...props} main={false} />
      ) : null}
      <div className="flex">
        <MainButton {...props} />
        {main === "open" && !offersOffline ? null : <MoreActions {...props} />}
      </div>
    </>
  );
  return (
    <div
      ref={actions}
      role="group"
      aria-label={`${language} actions`}
      tabIndex={-1}
      className="flex min-w-0 flex-wrap items-center justify-end gap-2"
    >
      {around(reviewed ?? own)}
    </div>
  );
}
