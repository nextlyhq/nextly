/**
 * LanguageSwitcher — entry-header control for the active content language (i18n M7).
 *
 * Renders a dropdown of the app's configured locales. Selecting one calls `onChange`, which the
 * entry page uses to refetch the entry in that language (useEntry is keyed by locale) and to route
 * subsequent saves to it (useUpdateEntry forwards the locale). The default locale is marked; RTL
 * locales are flagged. Renders nothing when localization is not configured — so non-localized
 * collections are visually unchanged.
 *
 * @module components/features/entries/LanguageSwitcher
 */

import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@nextlyhq/ui";
import { Check, Globe } from "lucide-react";
import type React from "react";

import { useLocalization } from "@admin/hooks/useLocalization";

export interface LanguageSwitcherProps {
  /** The active locale code. Defaults to the configured default locale when undefined. */
  value?: string;
  /** Called with the newly-selected locale code. */
  onChange: (locale: string) => void;
}

export function LanguageSwitcher({
  value,
  onChange,
}: LanguageSwitcherProps): React.ReactElement | null {
  const { enabled, locales, defaultLocale, getLocale } = useLocalization();

  // Nothing to switch between → render nothing (non-localized apps unchanged).
  if (!enabled) return null;

  const active = value ?? defaultLocale;
  const activeMeta = getLocale(active);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="gap-1.5"
          aria-label="Content language"
        >
          <Globe className="h-3.5 w-3.5" />
          <span>{activeMeta?.label ?? active}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {locales.map(locale => (
          <DropdownMenuItem
            key={locale.code}
            onClick={() => onChange(locale.code)}
            className="justify-between gap-4"
            {...(locale.rtl ? { dir: "rtl" as const } : {})}
          >
            <span className="flex items-center gap-2">
              {locale.code === active ? (
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
