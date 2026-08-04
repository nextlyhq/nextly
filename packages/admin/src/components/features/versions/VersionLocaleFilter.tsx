/**
 * Locale filter for the version-history panel.
 *
 * A localized document captures a version per locale, so the history can be
 * scoped to one language or left showing every locale ("All locales", the
 * default). Reuses the app's localization config and the shared dropdown
 * primitives so it matches the entry-header language switcher, and renders
 * nothing when the app is not localized — so non-localized documents are
 * visually unchanged.
 *
 * @module components/features/versions/VersionLocaleFilter
 */

import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@nextlyhq/ui";
import { Check, Globe } from "lucide-react";
import type React from "react";

import { useLocalization } from "@admin/hooks/useLocalization";

export interface VersionLocaleFilterProps {
  /** The active locale filter, or undefined for "All locales". */
  value?: string;
  /** Called with the newly-selected locale, or undefined to clear the filter. */
  onChange: (locale: string | undefined) => void;
}

export function VersionLocaleFilter({
  value,
  onChange,
}: VersionLocaleFilterProps): React.ReactElement | null {
  const { enabled, locales, defaultLocale, getLocale } = useLocalization();

  // A single-locale (or non-localized) history has nothing to filter.
  if (!enabled) return null;

  const activeMeta = value ? getLocale(value) : undefined;
  const activeLabel = activeMeta?.label ?? value ?? "All locales";

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="gap-1.5"
          aria-label="Filter history by language"
        >
          <Globe className="h-3.5 w-3.5" />
          <span>{activeLabel}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onClick={() => onChange(undefined)} className="gap-2">
          {value === undefined ? (
            <Check className="h-3.5 w-3.5" />
          ) : (
            <span className="w-3.5" />
          )}
          All locales
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        {locales.map(locale => (
          <DropdownMenuItem
            key={locale.code}
            onClick={() => onChange(locale.code)}
            className="justify-between gap-4"
            {...(locale.rtl ? { dir: "rtl" as const } : {})}
          >
            <span className="flex items-center gap-2">
              {locale.code === value ? (
                <Check className="h-3.5 w-3.5" />
              ) : (
                <span className="w-3.5" />
              )}
              {locale.label}
            </span>
            {locale.code === defaultLocale && (
              <span className="text-xs text-muted-foreground">default</span>
            )}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
