/**
 * CopyFromLanguageMenu — seed the current language from another (i18n M7, spec §10).
 *
 * Translators shouldn't start from a blank form. This control copies another language's values into
 * the *translatable* fields of the language being edited, so translation starts from filled content.
 * Per the spec it is **explicit** (a deliberate menu action), **field-scoped** (only translatable
 * fields, never shared ones), **reversible** (it fills the form but does not save — discard to
 * revert), and it **warns before overwriting** any values the current language already has.
 *
 * Renders nothing unless localization is on, the collection is localized, the entry exists, and
 * there is more than one language — so non-localized editors are unchanged.
 *
 * @module components/features/entries/CopyFromLanguageMenu
 */

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@nextlyhq/ui";
import { Languages } from "lucide-react";
import { useState } from "react";
import { useFormContext } from "react-hook-form";

import { toast } from "@admin/components/ui";
import { useLocalization } from "@admin/hooks/useLocalization";
import { entryApi } from "@admin/services/entryApi";

import { useEntryLocale } from "./EntryLocaleContext";

/** True when a value counts as "present" (would be overwritten). Mirrors the blank=empty rule. */
function isPresent(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === "string") return value.trim() !== "";
  return true;
}

/**
 * Pick the translatable field values to copy from a source entry: only the named localized fields
 * that actually have a value in the source (so absent source fields don't blank the target).
 */
export function pickLocalizedValues(
  source: Record<string, unknown>,
  localizedFieldNames: string[]
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const name of localizedFieldNames) {
    if (isPresent(source[name])) out[name] = source[name];
  }
  return out;
}

export function CopyFromLanguageMenu() {
  const { enabled, locales, defaultLocale, getLocale } = useLocalization();
  const {
    locale,
    collectionLocalized,
    collectionSlug,
    entryId,
    localizedFieldNames,
  } = useEntryLocale();
  const form = useFormContext();

  const [pending, setPending] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const active = locale ?? defaultLocale;
  const sources = locales.filter(l => l.code !== active);

  // Nothing to copy from / not applicable → render nothing.
  if (
    !enabled ||
    !collectionLocalized ||
    !collectionSlug ||
    !entryId ||
    !localizedFieldNames ||
    localizedFieldNames.length === 0 ||
    sources.length === 0
  ) {
    return null;
  }

  const activeLabel = getLocale(active)?.label ?? active;
  const pendingLabel = pending ? (getLocale(pending)?.label ?? pending) : "";

  async function applyCopy(sourceCode: string) {
    setBusy(true);
    try {
      // Fetch the source language's raw values (no fallback — copy what that language actually has).
      const source = (await entryApi.findByID(collectionSlug!, entryId!, {
        locale: sourceCode,
        fallbackLocale: "none",
        depth: 0,
      })) as unknown as Record<string, unknown>;

      const patch = pickLocalizedValues(source, localizedFieldNames!);
      const count = Object.keys(patch).length;
      if (count === 0) {
        toast.info(`${pendingLabel} has no content to copy.`);
        return;
      }
      // Fill the form (dirty, so the user can review then save — or discard to revert).
      for (const [name, value] of Object.entries(patch)) {
        form.setValue(name, value, { shouldDirty: true, shouldValidate: true });
      }
      toast.success(
        `Copied ${count} field${count === 1 ? "" : "s"} from ${pendingLabel}. Review, then save.`
      );
    } catch {
      toast.error(`Couldn't copy from ${pendingLabel}.`);
    } finally {
      setBusy(false);
      setPending(null);
    }
  }

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
          {sources.map(l => (
            <DropdownMenuItem
              key={l.code}
              onClick={() => setPending(l.code)}
              {...(l.rtl ? { dir: "rtl" as const } : {})}
            >
              {l.label}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>

      <AlertDialog
        open={pending !== null}
        onOpenChange={open => {
          if (!open && !busy) setPending(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Copy from {pendingLabel}?</AlertDialogTitle>
            <AlertDialogDescription>
              This fills {activeLabel}&rsquo;s translatable fields with{" "}
              {pendingLabel}&rsquo;s values, overwriting anything already entered
              for {activeLabel}. Shared fields are untouched. Nothing is saved
              until you save the form, so you can review or discard first.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={busy}
              onClick={e => {
                e.preventDefault();
                if (pending) void applyCopy(pending);
              }}
            >
              {busy ? "Copying…" : `Copy from ${pendingLabel}`}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
