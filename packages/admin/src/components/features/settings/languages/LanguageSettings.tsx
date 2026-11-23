"use client";

/**
 * Settings › Languages: each language of the site with its code, writing
 * direction, fallback and how much content it holds, in the site's order.
 *
 * An admin who may update settings adds, edits, reorders and removes
 * languages, and makes one the default, each through one change the server
 * judges. A configuration that declares the languages locks the list: it is
 * shown read-only, saying where it is set, and the server would refuse any
 * change anyway. A reader who may not update settings sees the same list with
 * no controls. Removed languages are listed apart, with their content kept, so
 * one can be added back.
 */

import {
  Badge,
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@nextlyhq/ui";
import type React from "react";
import { useRef, useState } from "react";

import { MoreHorizontal } from "@admin/components/icons";
import { toast } from "@admin/components/ui";
import {
  useChangeLanguages,
  useDefaultChangePreview,
} from "@admin/hooks/queries/useLanguageSettings";
import { useCurrentUserPermissions } from "@admin/hooks/useCurrentUserPermissions";
import { apiErrorMessage } from "@admin/lib/api/parseApiError";
import { UPDATE_SETTINGS } from "@admin/lib/permissions/system-policy";
import type {
  LanguageChange,
  LanguageList,
  LanguageView,
} from "@admin/types/languages";

import { AddLanguageDialog } from "./AddLanguageDialog";
import { EditLanguageDialog } from "./EditLanguageDialog";
import {
  activeLanguages,
  contentCount,
  directionLabel,
  fallbackPhrase,
  itemsPhrase,
  movedOrder,
  removedLanguages,
} from "./language-settings-model";
import type { LanguageDialogSave } from "./LanguageDialogParts";
import { MakeDefaultDialog } from "./MakeDefaultDialog";
import { RemoveLanguageDialog } from "./RemoveLanguageDialog";

/** The dialog open on the page, if any. */
type OpenDialog =
  | { kind: "add" }
  | { kind: "edit" | "remove" | "default"; language: LanguageView };

/** A dialog asked for, and the control it was asked from. */
type OpenDialogFrom = OpenDialog & { opener: HTMLElement | null };

export interface LanguageSettingsProps {
  list: LanguageList;
}

export function LanguageSettings({
  list,
}: LanguageSettingsProps): React.JSX.Element {
  const { hasPermission } = useCurrentUserPermissions();
  const mayChange = !list.lockedByConfig && hasPermission(UPDATE_SETTINGS);
  const active = activeLanguages(list.languages);
  const removed = removedLanguages(list.languages);
  const defaultCode = active.find(language => language.isDefault)?.code;
  // How much content each language holds: what making the current default the
  // default would touch, which is nothing, so the server answers the counts
  // alone. The server will not answer it for a list the configuration locks.
  const content = useDefaultChangePreview(
    list.lockedByConfig ? undefined : defaultCode
  ).data?.translationsPerLanguage;
  const changeLanguages = useChangeLanguages();
  const [open, setOpen] = useState<OpenDialogFrom | null>(null);

  const save = async (change: LanguageChange): Promise<boolean> => {
    try {
      await changeLanguages.mutateAsync(change);
      return true;
    } catch {
      return false;
    }
  };
  const openDialog = (dialog: OpenDialog, opener: HTMLElement | null) => {
    changeLanguages.reset();
    setOpen({ ...dialog, opener });
  };
  const dialogSave: LanguageDialogSave = {
    saving: changeLanguages.isPending,
    error: changeLanguages.error
      ? apiErrorMessage(
          changeLanguages.error,
          "The languages could not be saved."
        )
      : undefined,
    onSave: save,
    onClose: () => setOpen(null),
    opener: open?.opener ?? null,
  };
  const move = (language: LanguageView, step: -1 | 1) => {
    const codes = movedOrder(active, language.code, step);
    if (!codes) return;
    changeLanguages.mutate(
      { kind: "reorder", codes },
      {
        onError: error => {
          toast.error("The order could not be saved", {
            description: apiErrorMessage(error),
          });
        },
      }
    );
  };
  // A removed language added again with its old details, which brings its
  // kept content back. Its fallback keeps only the languages still in use: the
  // server refuses a fallback naming a removed one, and a removed one would be
  // skipped on reading anyway.
  const addBack = (language: LanguageView) => {
    const inUse = new Set(active.map(each => each.code));
    changeLanguages.mutate(
      {
        kind: "add",
        code: language.code,
        label: language.label,
        direction: language.direction,
        fallback: language.fallback.filter(code => inUse.has(code)),
      },
      {
        onError: error => {
          toast.error(`${language.label} could not be added back`, {
            description: apiErrorMessage(error),
          });
        },
      }
    );
  };

  return (
    <div className="space-y-6">
      {list.lockedByConfig && <LockedNotice />}

      <section aria-labelledby="languages-heading" className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 id="languages-heading" className="text-base font-semibold">
            Languages in use
          </h2>
          {mayChange && (
            <Button
              type="button"
              size="sm"
              onClick={event =>
                openDialog({ kind: "add" }, event.currentTarget)
              }
            >
              Add language
            </Button>
          )}
        </div>
        <ul
          aria-labelledby="languages-heading"
          className="divide-y divide-border rounded-lg border border-border bg-card"
        >
          {active.map((language, index) => (
            <LanguageRow
              key={language.code}
              language={language}
              languages={list.languages}
              content={contentCount(content, language.code)}
              actions={
                mayChange ? (
                  <LanguageActions
                    language={language}
                    first={index === 0}
                    last={index === active.length - 1}
                    onEdit={opener =>
                      openDialog({ kind: "edit", language }, opener)
                    }
                    onMove={step => move(language, step)}
                    onMakeDefault={opener =>
                      openDialog({ kind: "default", language }, opener)
                    }
                    onRemove={opener =>
                      openDialog({ kind: "remove", language }, opener)
                    }
                  />
                ) : undefined
              }
            />
          ))}
        </ul>
        {mayChange && (
          <p className="text-xs text-muted-foreground">
            {active.length === 1
              ? "This site has one language. Add another to translate content into it."
              : "The default language can't be removed. Make another language the default first."}
          </p>
        )}
      </section>

      {removed.length > 0 && (
        <RemovedLanguages
          removed={removed}
          languages={list.languages}
          content={content}
          adding={changeLanguages.isPending}
          onAddBack={mayChange ? addBack : undefined}
        />
      )}

      {open && (
        <LanguageDialog
          {...dialogSave}
          open={open}
          active={active}
          content={content}
        />
      )}
    </div>
  );
}

/** Where a list the configuration declares is set, said above it. */
function LockedNotice(): React.JSX.Element {
  return (
    <p className="rounded-md border border-border bg-muted/50 p-4 text-sm">
      These languages are set in this site&apos;s configuration, in the{" "}
      <code className="font-mono">localization</code> block of{" "}
      <code className="font-mono">nextly.config.ts</code>, so they can only be
      changed there.
    </p>
  );
}

interface RemovedLanguagesProps {
  removed: readonly LanguageView[];
  /** Every language, to name the codes in a fallback. */
  languages: readonly LanguageView[];
  /** How many items each language holds, when known. */
  content: Record<string, number> | undefined;
  adding: boolean;
  /** Adds one back, or undefined where the reader may not. */
  onAddBack: ((language: LanguageView) => void) | undefined;
}

/** The removed languages, listed apart with their content kept. */
function RemovedLanguages({
  removed,
  languages,
  content,
  adding,
  onAddBack,
}: RemovedLanguagesProps): React.JSX.Element {
  return (
    <section aria-labelledby="removed-languages-heading" className="space-y-3">
      <div>
        <h2 id="removed-languages-heading" className="text-base font-semibold">
          Removed languages
        </h2>
        <p className="text-sm text-muted-foreground">
          Their content is kept. Adding one back brings it back.
        </p>
      </div>
      <ul
        aria-labelledby="removed-languages-heading"
        className="divide-y divide-border rounded-lg border border-border bg-card"
      >
        {removed.map(language => (
          <LanguageRow
            key={language.code}
            language={language}
            languages={languages}
            content={contentCount(content, language.code)}
            actions={
              onAddBack ? (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={adding}
                  aria-label={`Add ${language.label} back`}
                  onClick={() => onAddBack(language)}
                >
                  Add back
                </Button>
              ) : undefined
            }
          />
        ))}
      </ul>
    </section>
  );
}

interface LanguageDialogProps extends LanguageDialogSave {
  open: OpenDialog;
  /** The site's active languages, in order. */
  active: readonly LanguageView[];
  /** How many items each language holds, when known. */
  content: Record<string, number> | undefined;
}

/** The one dialog open on the page. */
function LanguageDialog({
  open,
  active,
  content,
  ...save
}: LanguageDialogProps): React.JSX.Element {
  switch (open.kind) {
    case "add":
      return <AddLanguageDialog {...save} active={active} />;
    case "edit":
      return (
        <EditLanguageDialog
          {...save}
          language={open.language}
          active={active}
        />
      );
    case "remove":
      return (
        <RemoveLanguageDialog
          {...save}
          language={open.language}
          content={contentCount(content, open.language.code)}
        />
      );
    case "default":
      return (
        <MakeDefaultDialog {...save} language={open.language} active={active} />
      );
  }
}

interface LanguageRowProps {
  language: LanguageView;
  /** Every language, to name the codes in its fallback. */
  languages: readonly LanguageView[];
  /** How many items are stored in it, when known. */
  content: number | undefined;
  actions: React.ReactNode;
}

/** One language: its name and code, then its direction, fallback and content. */
function LanguageRow({
  language,
  languages,
  content,
  actions,
}: LanguageRowProps): React.JSX.Element {
  return (
    <li className="flex items-start gap-3 px-4 py-3">
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-medium">{language.label}</span>
          <code className="font-mono text-xs text-muted-foreground">
            {language.code}
          </code>
          {language.isDefault && <Badge>Default</Badge>}
        </div>
        <dl className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
          <LanguageFact term="Direction">
            {directionLabel(language.direction)}
          </LanguageFact>
          <LanguageFact term="Falls back to">
            {fallbackPhrase(languages, language.fallback)}
          </LanguageFact>
          {content !== undefined && (
            <LanguageFact term="Content">{itemsPhrase(content)}</LanguageFact>
          )}
        </dl>
      </div>
      {actions}
    </li>
  );
}

function LanguageFact({
  term,
  children,
}: {
  term: string;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <div className="flex gap-1">
      <dt className="text-muted-foreground">{term}</dt>
      <dd>{children}</dd>
    </div>
  );
}

interface LanguageActionsProps {
  language: LanguageView;
  first: boolean;
  last: boolean;
  /** Each given the menu's button, which the dialog gives focus back to. */
  onEdit: (opener: HTMLElement | null) => void;
  onMove: (step: -1 | 1) => void;
  onMakeDefault: (opener: HTMLElement | null) => void;
  onRemove: (opener: HTMLElement | null) => void;
}

/**
 * A language's menu. Moving is offered only where the language can move, and
 * making default and removing only for a language that is not the default.
 */
function LanguageActions({
  language,
  first,
  last,
  onEdit,
  onMove,
  onMakeDefault,
  onRemove,
}: LanguageActionsProps): React.JSX.Element {
  const trigger = useRef<HTMLButtonElement>(null);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          ref={trigger}
          type="button"
          variant="ghost"
          size="icon"
          aria-label={`Actions for ${language.label}`}
        >
          <MoreHorizontal className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onSelect={() => onEdit(trigger.current)}>
          Edit…
        </DropdownMenuItem>
        {!first && (
          <DropdownMenuItem onSelect={() => onMove(-1)}>
            Move up
          </DropdownMenuItem>
        )}
        {!last && (
          <DropdownMenuItem onSelect={() => onMove(1)}>
            Move down
          </DropdownMenuItem>
        )}
        {!language.isDefault && (
          <>
            <DropdownMenuItem onSelect={() => onMakeDefault(trigger.current)}>
              Make default…
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              className="text-destructive"
              onSelect={() => onRemove(trigger.current)}
            >
              Remove…
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
