"use client";

/**
 * useCopyFromLanguage — the one implementation of "seed this language from
 * another", shared by every surface that offers it.
 *
 * The action renders in more than one place (the document rail, the header's
 * Languages menu), and two copies of the fill logic would agree today and
 * drift silently. The hook owns gating, the pending/confirm handshake and the
 * copy itself; surfaces own only their trigger.
 *
 * The contract is unchanged from the original control: explicit (a deliberate
 * action), field-scoped (translatable fields only, absent source fields never
 * blank the target), reversible (fills the form without saving), and it warns
 * before overwriting via the confirm step.
 *
 * @module components/features/entries/useCopyFromLanguage
 */

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

export interface CopyFromLanguageSource {
  code: string;
  label: string;
  rtl: boolean;
}

export interface CopyFromLanguage {
  /** Whether the action applies here at all; surfaces render nothing when false. */
  available: boolean;
  /** Languages that can be copied from (every locale except the active one). */
  sources: CopyFromLanguageSource[];
  /** Label of the language being edited (the copy target). */
  activeLabel: string;
  /** Label of the source awaiting confirmation, or "" when none is pending. */
  pendingLabel: string;
  /** Locale code awaiting confirmation, or null. */
  pending: string | null;
  /** True while a confirmed copy is fetching and filling. */
  busy: boolean;
  /** Ask to copy from a source; opens the confirm step. */
  requestCopy: (code: string) => void;
  /** Dismiss the confirm step without copying. */
  cancel: () => void;
  /** Run the pending copy. */
  confirm: () => Promise<void>;
}

export function useCopyFromLanguage(): CopyFromLanguage {
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

  const available =
    enabled &&
    collectionLocalized &&
    !!collectionSlug &&
    !!entryId &&
    !!localizedFieldNames &&
    localizedFieldNames.length > 0 &&
    sources.length > 0 &&
    !!form;

  const activeLabel = getLocale(active)?.label ?? active;
  const pendingLabel = pending ? (getLocale(pending)?.label ?? pending) : "";

  async function confirm(): Promise<void> {
    if (!pending || !available) return;
    setBusy(true);
    try {
      // Fetch the source language's raw values (no fallback — copy what that language actually has).
      const source = (await entryApi.findByID(collectionSlug, entryId, {
        locale: pending,
        fallbackLocale: "none",
        depth: 0,
      })) as unknown as Record<string, unknown>;

      const patch = pickLocalizedValues(source, localizedFieldNames);
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

  return {
    available,
    sources,
    activeLabel,
    pendingLabel,
    pending,
    busy,
    requestCopy: setPending,
    cancel: () => {
      if (!busy) setPending(null);
    },
    confirm,
  };
}
