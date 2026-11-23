"use client";

/**
 * The entry list's "Titles in" control: which language the title column shows.
 *
 * A visible control in the toolbar rather than an item in the filter menu, because it filters
 * nothing: every row stays, only the language its title is read in changes, and a reader checks
 * which language that is before trusting a title.
 *
 * @module components/features/entries/EntryList/TitleLanguageSelect
 */

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@nextlyhq/ui";
import type { JSX } from "react";

/** A language the titles can be shown in. */
export interface TitleLanguage {
  code: string;
  label: string;
  rtl: boolean;
}

/** The list's choice of title language, and the titles that choice read. */
export interface TitleLanguageChoice {
  /** Every configured language, in order. */
  languages: readonly TitleLanguage[];
  /** The default language: the list's own read shows titles in it. */
  defaultLocale: string;
  /** The language chosen. */
  value: string;
  onChange: (code: string) => void;
  /** Each row's title in the chosen language, by id, once read. */
  titles: ReadonlyMap<string, unknown> | undefined;
  /** Whether the titles in the chosen language could not be read. */
  failed: boolean;
  /**
   * Whether the default language falls back to another on a read, so a title the list shows
   * may be that other language's.
   */
  defaultMayFallBack?: boolean;
}

export function TitleLanguageSelect({
  choice,
}: {
  choice: TitleLanguageChoice;
}): JSX.Element {
  const chosen = choice.languages.find(
    language => language.code === choice.value
  );
  return (
    <Select value={choice.value} onValueChange={choice.onChange}>
      {/* Named in full, "Titles in Spanish", as it reads: the trigger's own
          content does not name it. */}
      <SelectTrigger
        aria-label={`Titles in ${chosen?.label ?? choice.value}`}
        className="w-auto bg-background text-foreground"
      >
        <span className="flex items-center gap-1.5 whitespace-nowrap">
          <span className="text-muted-foreground">Titles in</span>
          <SelectValue />
        </span>
      </SelectTrigger>
      <SelectContent>
        {choice.languages.map(language => (
          <SelectItem key={language.code} value={language.code}>
            {language.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/** The chosen language, where it is not the default and is still configured. */
export function chosenTitleLanguage(
  choice: TitleLanguageChoice | undefined
): TitleLanguage | undefined {
  if (!choice || choice.value === choice.defaultLocale) return undefined;
  return choice.languages.find(language => language.code === choice.value);
}
