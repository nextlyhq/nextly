"use client";

/**
 * CopyFromLanguageMenu — the document rail's trigger for copy-from-language.
 *
 * The logic lives in `useCopyFromLanguage` and the warning in
 * `CopyFromLanguageDialog`, because the header's Languages menu offers the
 * same action: one implementation, two triggers. This component is only the
 * rail's button-and-menu shape around them.
 *
 * Renders nothing when the action does not apply, so non-localized editors
 * are unchanged.
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
import { Languages } from "lucide-react";

import { CopyFromLanguageDialog } from "./CopyFromLanguageDialog";
import { useCopyFromLanguage } from "./useCopyFromLanguage";

export { pickLocalizedValues } from "./useCopyFromLanguage";

export function CopyFromLanguageMenu() {
  const copy = useCopyFromLanguage();
  if (!copy.available) return null;

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="gap-1.5"
            aria-label="Copy content from another language"
          >
            <Languages className="h-3.5 w-3.5" />
            <span>Copy from…</span>
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
      <CopyFromLanguageDialog copy={copy} />
    </>
  );
}
