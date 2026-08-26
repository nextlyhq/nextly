"use client";

/**
 * CopyFromLanguageMenu — pick which language to fill the CURRENT one from.
 *
 * Every other row in the language panel implies its source: the author is
 * standing in one language and acting on another. The row for the language
 * being edited is the one case where that does not work — it IS where they are
 * standing — so the source has to be named, and this is where it is named.
 *
 * Presentational on purpose. The gating, the pending/confirm handshake and the
 * copy itself belong to `useCopyFromLanguage`, and the warning to
 * `CopyFromLanguageDialog`; a trigger that called the hook a second time would
 * hold a second, independent pending state, and a seed arriving from a language
 * switch would open two confirm dialogs at once.
 *
 * Renders nothing when the action does not apply, so non-localized editors are
 * unchanged.
 *
 * @module components/features/entries/CopyFromLanguageMenu
 */

import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@nextlyhq/ui";

import type { CopyFromLanguage } from "./useCopyFromLanguage";

export { pickLocalizedValues } from "./useCopyFromLanguage";

export function CopyFromLanguageMenu({
  copy,
  verb,
  targetLabel,
  disabled,
}: {
  /** The shared copy-from state, owned by whichever surface mounts this. */
  copy: CopyFromLanguage;
  /**
   * "Start" or "Replace" — the same word the other rows use, chosen from the
   * target's translation state rather than fixed here, so one action does not
   * acquire a second name depending on which row offers it.
   */
  verb: string;
  /** The language being filled, for an accessible name that says what it acts on. */
  targetLabel: string;
  disabled: boolean;
}) {
  if (!copy.available) return null;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-7 px-2 text-xs"
          disabled={disabled}
          aria-label={`${verb} ${targetLabel} from another language`}
        >
          {verb} from…
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {copy.sources.map(l => (
          <DropdownMenuItem
            key={l.code}
            onClick={() => copy.requestCopy(l.code)}
            {...(l.rtl ? { dir: "rtl" as const } : {})}
          >
            {l.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
