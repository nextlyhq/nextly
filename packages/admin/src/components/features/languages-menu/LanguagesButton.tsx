"use client";

/**
 * LanguagesButton: the one way from a document into its other languages.
 *
 * A button beside History that counts the translations needing work, and its menu: every
 * language's status in one line with the way to translate it, publishing the other languages,
 * and managing the site's. Everything it says and leads to is passed in, so any bar can draw it.
 *
 * Draws nothing without a model, which a site with fewer than two languages never has.
 *
 * @module components/features/languages-menu/LanguagesButton
 */

import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@nextlyhq/ui";
import { useId, type JSX, type ReactNode } from "react";

import { ToolbarLabel } from "@admin/components/features/entries/EntryForm/toolbar-density";
import {
  LANGUAGE_MARK_CLASS,
  type LanguageChipState,
} from "@admin/components/features/entries/EntryList/language-chips";
import { ChevronDown, Globe } from "@admin/components/icons";
import { Link } from "@admin/components/ui/link";
import { ROUTES } from "@admin/constants/routes";
import { cn } from "@admin/lib/utils";

import {
  needWorkWords,
  type LanguageRow,
  type LanguagesMenuModel,
} from "./languages-menu-model";

export interface LanguagesButtonProps {
  /** What the menu says; null draws nothing. */
  model: LanguagesMenuModel | null;
  /** Where a language other than the default is translated. */
  translateHref: (code: string) => string;
  /** The editor, which edits the default language. */
  editHref: string;
  /**
   * The language on screen. Its row says so, in place of a link to where the person already is.
   */
  currentLanguage?: string | undefined;
  /**
   * Why no other language can be opened at this moment, said above the languages. Each row then
   * keeps its status and leads nowhere. Absent, nothing holds them.
   */
  heldReason?: string | undefined;
  /** Opens the choice of which languages to publish. Absent where the person may not publish. */
  onPublishOthers?: (() => void) | undefined;
  /** Whether the person may manage the site's languages. */
  canManageLanguages: boolean;
  /** Whether the bar is too narrow for the button's word, which it then only speaks. */
  iconOnly?: boolean;
}

/** Each state's colour. Amber marks only the two states that ask for work. */
const MARK_TONE: Record<LanguageChipState, string> = {
  live: "text-foreground",
  changes: "text-warning-text",
  outOfDate: "text-warning-text",
  draft: "text-foreground",
  missing: "text-muted-foreground",
};

const ROW_CLASS = "items-start gap-2 p-2";

/** One language: its mark, its name and status, and what choosing the row does. */
function RowContent({
  row,
  action,
}: {
  row: LanguageRow;
  action: ReactNode;
}): JSX.Element {
  return (
    <>
      <span
        aria-hidden="true"
        className="flex h-5 w-3 shrink-0 items-center justify-center"
      >
        {row.state === null ? null : (
          <span
            data-language-state={row.state}
            className={cn(
              "inline-block shrink-0",
              MARK_TONE[row.state],
              LANGUAGE_MARK_CLASS[row.state]
            )}
          />
        )}
      </span>
      {/* The hidden commas keep the parts apart where the row is spoken as one name. */}
      <span className="min-w-0 flex-1">
        <bdi {...row.nameAttributes} className="break-words">
          {row.name}
        </bdi>
        {row.isDefault ? (
          <>
            <span className="sr-only">,</span>{" "}
            <span className="text-xs text-muted-foreground">default</span>
          </>
        ) : null}
        {row.status === null ? null : (
          <>
            <span className="sr-only">, </span>
            <span className="block text-xs text-muted-foreground">
              {row.status}
            </span>
          </>
        )}
        {action === null ? null : <span className="sr-only">, </span>}
      </span>
      {action}
    </>
  );
}

/** A language's row: the way to it, or a note that it is the one on screen. */
function LanguageMenuRow({
  row,
  href,
  current,
  held,
}: {
  row: LanguageRow;
  href: string;
  current: boolean;
  /** Whether no other language can be opened now. */
  held: boolean;
}): JSX.Element {
  if (held && !current) {
    // Reached by keyboard still, so its status is heard, with the reason above it.
    return (
      <DropdownMenuItem
        aria-disabled="true"
        className={ROW_CLASS}
        onSelect={event => event.preventDefault()}
      >
        <RowContent row={row} action={null} />
      </DropdownMenuItem>
    );
  }
  if (current) {
    // A row the keyboard reaches like the others, so its status is heard too. Choosing it closes
    // the menu, back to the document it names.
    return (
      <DropdownMenuItem aria-current="true" className={ROW_CLASS}>
        <RowContent
          row={row}
          action={
            <span className="shrink-0 text-xs leading-5 text-muted-foreground">
              Editing
            </span>
          }
        />
      </DropdownMenuItem>
    );
  }
  return (
    <DropdownMenuItem asChild className={ROW_CLASS}>
      <Link href={href}>
        <RowContent
          row={row}
          action={
            <span className="inline-flex h-6 shrink-0 items-center rounded-md border border-border bg-background px-2 text-xs font-medium">
              {row.isDefault ? "Edit" : "Translate"}
            </span>
          }
        />
      </Link>
    </DropdownMenuItem>
  );
}

/** How many translations need work, drawn as a number and spoken in words; nothing at none. */
function NeedWorkCount({ count }: { count: number }): JSX.Element | null {
  if (count === 0) return null;
  return (
    <>
      <span className="sr-only">{`, ${needWorkWords(count)}`}</span>
      <span
        aria-hidden="true"
        className="inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-warning-surface px-1 text-[11px] font-semibold leading-none tabular-nums text-warning-text"
      >
        {count}
      </span>
    </>
  );
}

/** What the menu does beyond opening a language, where the person may do any of it. */
function MenuActions({
  onPublishOthers,
  canManageLanguages,
}: Pick<
  LanguagesButtonProps,
  "onPublishOthers" | "canManageLanguages"
>): JSX.Element | null {
  if (onPublishOthers === undefined && !canManageLanguages) return null;
  return (
    <>
      <DropdownMenuSeparator />
      {onPublishOthers !== undefined ? (
        // Wrapped, so the menu's own event is not passed on.
        <DropdownMenuItem onSelect={() => onPublishOthers()}>
          Publish other languages…
        </DropdownMenuItem>
      ) : null}
      {canManageLanguages ? (
        <DropdownMenuItem asChild>
          <Link href={ROUTES.SETTINGS_LANGUAGES}>Manage languages…</Link>
        </DropdownMenuItem>
      ) : null}
    </>
  );
}

/** The document's Languages button and its menu. */
export function LanguagesButton({
  model,
  translateHref,
  editHref,
  currentLanguage,
  heldReason,
  onPublishOthers,
  canManageLanguages,
  iconOnly = false,
}: LanguagesButtonProps): JSX.Element | null {
  const reasonId = useId();
  if (model === null || model.rows.length < 2) return null;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="gap-1.5"
          // Named for a pointer once its word has stepped aside for the icon.
          title="Languages"
        >
          <Globe className="h-4 w-4" aria-hidden="true" />
          {iconOnly ? (
            <span className="sr-only">Languages</span>
          ) : (
            <ToolbarLabel priority="secondary">Languages</ToolbarLabel>
          )}
          <NeedWorkCount count={model.needWork} />
          {iconOnly ? null : (
            <ChevronDown className="h-4 w-4" aria-hidden="true" />
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        collisionPadding={16}
        className="w-[21.25rem] max-w-[calc(100vw-2rem)]"
      >
        {heldReason === undefined ? null : (
          <DropdownMenuLabel
            id={reasonId}
            className="text-xs font-normal text-muted-foreground"
          >
            {heldReason}
          </DropdownMenuLabel>
        )}
        {/* Described by the reason, which the keyboard does not stop on by itself. */}
        <DropdownMenuGroup
          aria-label="Languages"
          {...(heldReason === undefined
            ? {}
            : { "aria-describedby": reasonId })}
        >
          {model.rows.map(row => (
            <LanguageMenuRow
              key={row.code}
              row={row}
              href={row.isDefault ? editHref : translateHref(row.code)}
              current={row.code === currentLanguage}
              held={heldReason !== undefined}
            />
          ))}
        </DropdownMenuGroup>
        <MenuActions
          onPublishOthers={onPublishOthers}
          canManageLanguages={canManageLanguages}
        />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
