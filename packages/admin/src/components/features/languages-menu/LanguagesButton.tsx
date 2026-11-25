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
import { Fragment, useId, type JSX, type ReactNode } from "react";

import { ToolbarLabel } from "@admin/components/features/entries/EntryForm/toolbar-density";
import { ChevronDown, Globe } from "@admin/components/icons";
import { Link } from "@admin/components/ui/link";
import { ROUTES } from "@admin/constants/routes";

import {
  needWorkWords,
  statusParts,
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

const ROW_CLASS = "items-center gap-3 px-2.5 py-2";

/** A row's line: its parts set apart by a dot for the eye, and by a comma where it is spoken. */
function StatusLine({ parts }: { parts: string[] }): JSX.Element | null {
  if (parts.length === 0) return null;
  return (
    <>
      <span className="sr-only">, </span>
      <span className="block text-xs text-muted-foreground">
        {parts.map((part, index) => (
          <Fragment key={part}>
            {index === 0 ? null : (
              <>
                <span aria-hidden="true"> · </span>
                <span className="sr-only">, </span>
              </>
            )}
            {part}
          </Fragment>
        ))}
      </span>
    </>
  );
}

/** One language: its name and line, and what choosing the row does. */
function RowContent({
  row,
  editing = false,
  action = null,
}: {
  row: LanguageRow;
  /** Whether it is the language on screen. */
  editing?: boolean;
  action?: ReactNode;
}): JSX.Element {
  return (
    <>
      {/* The hidden commas keep the parts apart where the row is spoken as one name. */}
      <span className="min-w-0 flex-1">
        <bdi {...row.nameAttributes} className="break-words">
          {row.name}
        </bdi>
        {row.isDefault ? (
          <>
            <span className="sr-only">,</span>{" "}
            <span className="font-mono text-[10px] uppercase tracking-wide text-muted-foreground">
              default
            </span>
          </>
        ) : null}
        <StatusLine parts={statusParts(row, editing)} />
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
        <RowContent row={row} />
      </DropdownMenuItem>
    );
  }
  if (current) {
    // A row the keyboard reaches like the others, so its status is heard too. Choosing it closes
    // the menu, back to the document it names.
    return (
      <DropdownMenuItem aria-current="true" className={ROW_CLASS}>
        <RowContent row={row} editing />
      </DropdownMenuItem>
    );
  }
  return (
    <DropdownMenuItem asChild className={ROW_CLASS}>
      <Link href={href}>
        <RowContent
          row={row}
          action={
            <span className="inline-flex h-8 shrink-0 items-center rounded-md border border-border bg-background px-3 text-sm font-medium">
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
        className="inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full border border-border bg-background px-1 text-[11px] font-semibold leading-none tabular-nums text-foreground"
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
          className="gap-1.5 data-[state=open]:bg-muted"
          // Named for a pointer once its word has stepped aside for the icon.
          title="Languages"
        >
          <Globe className="h-4 w-4" aria-hidden="true" />
          {iconOnly ? (
            <span className="sr-only">Languages</span>
          ) : (
            // With History's word beside it, as one cluster.
            <ToolbarLabel priority="cluster-with-languages">
              Languages
            </ToolbarLabel>
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
        className="w-[18.75rem] max-w-[calc(100vw-2rem)]"
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
