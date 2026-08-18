"use client";

/**
 * LanguagesMenu — the header's always-reachable home for language actions.
 *
 * Copy-from and publish-all previously lived only in the document rail, which
 * hides on narrower content widths — taking the two most important
 * translation actions with it. This menu sits in the header at every width.
 * The rail keeps its triggers; both consume the same hooks, so there is one
 * implementation of each action however many places offer it.
 *
 * The menu also carries the legend for the language states, beside the
 * actions that change them — the states were previously decodable only
 * through tooltips.
 *
 * Renders nothing when localization is off or nothing in it applies, so
 * non-localized editors are unchanged.
 *
 * @module components/features/entries/LanguagesMenu
 */

import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@nextlyhq/ui";
import { Globe } from "lucide-react";

import { useLocalization } from "@admin/hooks/useLocalization";

import { CopyFromLanguageDialog } from "./CopyFromLanguageDialog";
import {
  LANGUAGE_STATE_LABEL,
  StateDot,
  type LanguageState,
} from "./LanguageControl";
import { useCopyFromLanguage } from "./useCopyFromLanguage";
import { usePublishAllLanguages } from "./usePublishAllLanguages";

const LEGEND_STATES: readonly LanguageState[] = [
  "published",
  "translated",
  "draft",
  "missing",
];

export interface LanguagesMenuProps {
  /** Whether the collection has the Draft/Published lifecycle. */
  hasStatus?: boolean;
  /**
   * Withholds the mutating actions (e.g. while a past version is on screen,
   * where nothing in the header may write the live document). The menu still
   * opens so the legend stays readable.
   */
  actionsDisabled?: boolean;
}

export function LanguagesMenu({
  hasStatus,
  actionsDisabled = false,
}: LanguagesMenuProps) {
  const { enabled } = useLocalization();
  const copy = useCopyFromLanguage();
  const publish = usePublishAllLanguages(
    hasStatus === undefined ? {} : { hasStatus }
  );

  // Without localization there is nothing to put in the menu; with it, the
  // legend alone justifies rendering even when no action applies yet (a new
  // entry has no id, so copy-from and publish-all are both unavailable).
  if (!enabled) return null;

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="gap-1.5"
            aria-label="Language actions"
          >
            <Globe className="h-3.5 w-3.5" />
            <span>Languages</span>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-52">
          {copy.available && (
            <>
              <DropdownMenuLabel className="text-xs text-muted-foreground">
                Copy into {copy.activeLabel}
              </DropdownMenuLabel>
              {copy.sources.map(l => (
                <DropdownMenuItem
                  key={l.code}
                  disabled={actionsDisabled}
                  onClick={() => copy.requestCopy(l.code)}
                >
                  Copy from {l.label}…
                </DropdownMenuItem>
              ))}
            </>
          )}
          {publish.available && (
            <DropdownMenuItem
              disabled={actionsDisabled || publish.pending}
              onClick={publish.publishAll}
            >
              {publish.pending ? "Publishing…" : "Publish all languages"}
            </DropdownMenuItem>
          )}
          {(copy.available || publish.available) && <DropdownMenuSeparator />}
          <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
            <span className="block mb-1 font-medium">Language states</span>
            {LEGEND_STATES.map(state => (
              <span key={state} className="flex items-center gap-1.5 py-0.5">
                <StateDot state={state} />
                {LANGUAGE_STATE_LABEL[state]}
              </span>
            ))}
          </DropdownMenuLabel>
        </DropdownMenuContent>
      </DropdownMenu>
      <CopyFromLanguageDialog copy={copy} />
    </>
  );
}
